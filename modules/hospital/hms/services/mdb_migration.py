"""MS Access (.mdb / .accdb) -> PostgreSQL migration for Hospital HMS.

Migrates:
  1. Patient Master  (OPDMAST -> core.parties + hospital.patients)
  2. IPD Bill        (IPDBILL [+ optional IPDMAST / ALLCODES]
                      -> hospital.ipd_admissions + hospital.ipd_bills
                         + hospital.ipd_bill_lines + hospital.ipd_bill_payments)

Reading .mdb files on Windows:
  Most Windows PCs ship with 32-bit Microsoft Jet 4.0 / Access ODBC drivers
  while Python is 64-bit. This module invokes 32-bit Windows PowerShell
  (SysWOW64) using built-in .NET OleDb / Odbc to read .mdb/.accdb files
  read-only and stream rows to temporary UTF-8 CSV files — zero extra Python
  packages or 64-bit Access drivers required.
"""

from __future__ import annotations

import asyncio
import base64
import csv
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from collections import defaultdict
from collections.abc import Awaitable, Callable
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.config import get_settings

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]

MDB_TABLES_CATALOG: list[dict[str, Any]] = [
    {
        "key": "patients",
        "label": "Patient Master (OPDMAST)",
        "mdb_table": "OPDMAST",
        "group": "Masters",
        "default_selected": True,
        "notes": "Imports OPDMAST into patients and creates linked party rows.",
    },
    {
        "key": "ipd_bills",
        "label": "IPD Bill (IPDBILL)",
        "mdb_table": "IPDBILL",
        "group": "Transactions",
        "default_selected": True,
        "notes": "Imports IPDBILL as Cash IPD bills, matching CD against IPD services in Service Master.",
    },
]

MIGRATE_ORDER = ["patients", "ipd_bills"]

_HONORIFICS = {
    "MR",
    "MR.",
    "MRS",
    "MRS.",
    "MS",
    "MS.",
    "MISS",
    "SMT",
    "SMT.",
    "SRI",
    "SHRI",
    "DR",
    "DR.",
    "BABY",
    "MASTER",
    "KUM",
    "KUM.",
    "KM",
    "KM.",
}

_IPD_CODE_RE = re.compile(r"^(?:BL_)?IPD[_-]?(\d+)$", re.IGNORECASE)
_TRAILING_DIGITS_RE = re.compile(r"(\d+)$")

# ---------------------------------------------------------------------------
# Background job state (polled by UI) & temporary upload store
# ---------------------------------------------------------------------------

_job_lock = threading.Lock()
_job_state: dict[str, Any] = {
    "running": False,
    "done": False,
    "percent": 0,
    "message": "",
    "error": None,
    "log_lines": [],
    "summary": None,
}

_upload_lock = threading.Lock()
_uploaded_files: dict[str, dict[str, Any]] = {}
_UPLOAD_TTL_SECONDS = 3600 * 4  # 4 hours


def display_postgres_url(raw_url: str | None = None) -> str:
    url = (raw_url or get_settings().database_url or "").strip()
    return re.sub(r"://([^:@/]+):([^@/]+)@", r"://\1:***@", url)


def job_status() -> dict[str, Any]:
    with _job_lock:
        return {
            **_job_state,
            "log_lines": list(_job_state["log_lines"]),
        }


def mark_started() -> None:
    with _job_lock:
        _job_state.update(
            running=True,
            done=False,
            percent=1,
            message="Starting MDB migration…",
            error=None,
            log_lines=["Starting MDB migration…"],
            summary=None,
        )


def _update_job(
    *,
    percent: int | None = None,
    message: str | None = None,
    log_line: str | None = None,
    done: bool | None = None,
    running: bool | None = None,
    error: str | None = None,
    summary: dict[str, Any] | None = None,
) -> None:
    with _job_lock:
        if percent is not None:
            _job_state["percent"] = max(0, min(100, int(percent)))
        if message is not None:
            _job_state["message"] = message
        if log_line:
            _job_state["log_lines"].append(log_line)
        if done is not None:
            _job_state["done"] = done
        if running is not None:
            _job_state["running"] = running
        if error is not None:
            _job_state["error"] = error
        if summary is not None:
            _job_state["summary"] = summary


def mark_failed(message: str) -> None:
    _update_job(
        running=False,
        done=True,
        error=message,
        message=message,
        log_line=f"Error: {message}",
    )


def register_uploaded_mdb(temp_path: str, original_name: str, size_bytes: int) -> str:
    _cleanup_stale_uploads()
    token = str(uuid4())
    with _upload_lock:
        _uploaded_files[token] = {
            "path": temp_path,
            "name": original_name,
            "size": size_bytes,
            "created_at": time.time(),
        }
    return token


def resolve_mdb_path(file_token: str | None = None, mdb_path: str | None = None) -> str:
    if file_token:
        with _upload_lock:
            entry = _uploaded_files.get(file_token.strip())
        if not entry or not os.path.isfile(entry["path"]):
            raise ValueError(
                "Uploaded MDB file session expired or not found. Please select and test the MDB file again."
            )
        return str(entry["path"])
    cleaned = (mdb_path or "").strip().strip('"').strip("'")
    if not cleaned:
        raise ValueError("Select an MDB file or enter a valid MDB file path.")
    if not os.path.isfile(cleaned):
        raise ValueError(f"MDB file not found: {cleaned}")
    return cleaned


def _cleanup_stale_uploads() -> None:
    now = time.time()
    expired: list[str] = []
    with _upload_lock:
        for token, info in list(_uploaded_files.items()):
            if now - float(info.get("created_at", 0)) > _UPLOAD_TTL_SECONDS:
                expired.append(info["path"])
                _uploaded_files.pop(token, None)
    for path in expired:
        try:
            parent = Path(path).parent
            if parent.name.startswith("hms_mdb_upload_"):
                shutil.rmtree(parent, ignore_errors=True)
            elif os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Windows 32-bit PowerShell (.NET OleDb / Odbc) MDB reader
# ---------------------------------------------------------------------------

def _powershell_exe() -> str:
    sys_root = os.environ.get("SystemRoot") or r"C:\Windows"
    ps32 = os.path.join(sys_root, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe")
    if os.path.isfile(ps32):
        return ps32
    ps64 = os.path.join(sys_root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    if os.path.isfile(ps64):
        return ps64
    found = shutil.which("powershell")
    if found:
        return found
    raise RuntimeError("Windows PowerShell is required to read MS Access (.mdb) files.")


_PS_OPEN_FUNC = r"""
$ErrorActionPreference = 'Stop'
$mdbPath = $env:HMS_MDB_PATH
$mdbPwd  = $env:HMS_MDB_PWD

function Open-MdbConnection {
    param([string]$Path, [string]$Password)
    $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    $providers = if ($ext -eq '.accdb') {
        @('Microsoft.ACE.OLEDB.16.0', 'Microsoft.ACE.OLEDB.12.0')
    } else {
        @('Microsoft.Jet.OLEDB.4.0', 'Microsoft.ACE.OLEDB.12.0', 'Microsoft.ACE.OLEDB.16.0')
    }
    $lastErr = $null
    foreach ($prov in $providers) {
        try {
            $b = New-Object System.Data.OleDb.OleDbConnectionStringBuilder
            $b['Provider'] = $prov
            $b['Data Source'] = $Path
            $b['Mode'] = 'Read'
            if ($Password) {
                $b['Jet OLEDB:Database Password'] = $Password
            }
            $conn = New-Object System.Data.OleDb.OleDbConnection($b.ConnectionString)
            $conn.Open()
            return @{ Conn = $conn; Kind = 'OleDb'; Driver = $prov }
        } catch {
            $msg = $_.Exception.Message
            if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
            $lastErr = "${prov}: $msg"
            if ($msg -match 'Not a valid password|password') {
                throw "Invalid MDB password. ($msg)"
            }
        }
    }
    $odbcDrivers = @('Microsoft Access Driver (*.mdb)', 'Microsoft Access Driver (*.mdb, *.accdb)')
    foreach ($drv in $odbcDrivers) {
        try {
            $b = New-Object System.Data.Odbc.OdbcConnectionStringBuilder
            $b['Driver'] = $drv
            $b['Dbq'] = $Path
            $b['ReadOnly'] = 1
            if ($Password) {
                $b['Pwd'] = $Password
            }
            $conn = New-Object System.Data.Odbc.OdbcConnection($b.ConnectionString)
            $conn.Open()
            return @{ Conn = $conn; Kind = 'Odbc'; Driver = $drv }
        } catch {
            $msg = $_.Exception.Message
            if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
            $lastErr = "${drv}: $msg"
            if ($msg -match 'Not a valid password|password') {
                throw "Invalid MDB password. ($msg)"
            }
        }
    }
    throw "Could not open MDB file. Install Microsoft Access Database Engine or check the file/password. Last error: $lastErr"
}
"""


def _run_ps(ps_body: str, extra_env: dict[str, str]) -> str:
    script = _PS_OPEN_FUNC + "\n" + ps_body
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    env = os.environ.copy()
    env.update(extra_env)
    proc = subprocess.run(
        [_powershell_exe(), "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if proc.returncode != 0:
        err_text = (proc.stderr or proc.stdout or "").strip()
        # Strip PowerShell CLIXML noise if present
        if err_text.startswith("#< CLIXML"):
            matches = re.findall(r"<S S=\"Error\">(.*?)</S>", err_text)
            if matches:
                err_text = "".join(matches).replace("_x000D__x000A_", "\n").strip()
        lines = [line.strip() for line in err_text.splitlines() if line.strip()]
        raise RuntimeError(lines[0] if lines else "Failed to read MDB file.")
    return proc.stdout


def inspect_mdb_sync(mdb_path: str, mdb_password: str) -> dict[str, Any]:
    """Open the MDB read-only and return available tables & row counts."""
    ps_body = r"""
$opened = Open-MdbConnection -Path $mdbPath -Password $mdbPwd
$conn = $opened.Conn
try {
    $schema = $conn.GetSchema('Tables')
    $tableNames = @()
    foreach ($r in $schema.Rows) {
        if ($r['TABLE_TYPE'] -eq 'TABLE') {
            $tableNames += [string]$r['TABLE_NAME']
        }
    }
    $tableNames = $tableNames | Sort-Object

    $counts = @{}
    foreach ($target in @('OPDMAST', 'IPDBILL', 'IPDMAST', 'ALLCODES')) {
        $matched = $tableNames | Where-Object { $_.ToUpperInvariant() -eq $target } | Select-Object -First 1
        if ($matched) {
            $cmd = $conn.CreateCommand()
            $cmd.CommandText = "SELECT COUNT(*) FROM [$matched]"
            $counts[$target] = [int]$cmd.ExecuteScalar()
        }
    }

    $distinctBills = $null
    $ipdMatch = $tableNames | Where-Object { $_.ToUpperInvariant() -eq 'IPDBILL' } | Select-Object -First 1
    if ($ipdMatch) {
        try {
            $cmd = $conn.CreateCommand()
            $cmd.CommandText = "SELECT COUNT(*) FROM (SELECT DISTINCT IPDNO, BILLNO, OPDNO, DATE1 FROM [$ipdMatch])"
            $distinctBills = [int]$cmd.ExecuteScalar()
        } catch {
            $distinctBills = $null
        }
    }

    $out = @{
        driver         = $opened.Driver
        tables         = $tableNames
        counts         = $counts
        distinct_bills = $distinctBills
    }
    Write-Output ($out | ConvertTo-Json -Depth 4 -Compress)
} finally {
    $conn.Close()
}
"""
    import json

    stdout = _run_ps(
        ps_body,
        {"HMS_MDB_PATH": mdb_path, "HMS_MDB_PWD": mdb_password or ""},
    )
    json_line = ""
    for line in reversed(stdout.splitlines()):
        stripped = line.strip()
        if stripped.startswith("{") and stripped.endswith("}"):
            json_line = stripped
            break
    if not json_line:
        raise RuntimeError(f"Unexpected output while inspecting MDB: {stdout[:300]}")
    return json.loads(json_line)


def export_mdb_tables_to_csv_sync(
    mdb_path: str,
    mdb_password: str,
    table_queries: dict[str, str],
    out_dir: str,
) -> dict[str, str]:
    """Stream each SQL query from the MDB into a UTF-8 CSV file in out_dir.

    Dates are formatted as ISO yyyy-MM-dd directly from .NET DateTime objects
    to avoid Windows regional locale ambiguity.
    """
    import json

    spec_path = os.path.join(out_dir, "_export_spec.json")
    spec = {name: {"sql": sql, "out": os.path.join(out_dir, f"{name}.csv")} for name, sql in table_queries.items()}
    with open(spec_path, "w", encoding="utf-8") as fh:
        json.dump(spec, fh)

    ps_body = r"""
Add-Type -ReferencedAssemblies 'System.Data' -TypeDefinition @'
using System;
using System.Data;
using System.Globalization;
using System.IO;
using System.Text;

public static class HmsMdbCsvExporter {
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    private static string Escape(object v) {
        if (v == null || v is DBNull) return "";
        string s;
        if (v is DateTime) {
            s = ((DateTime)v).ToString("yyyy-MM-dd", Inv);
        } else if (v is IFormattable) {
            s = ((IFormattable)v).ToString(null, Inv);
        } else {
            s = v.ToString();
        }
        if (s.IndexOf('\r') >= 0) s = s.Replace("\r", " ");
        if (s.IndexOf('\n') >= 0) s = s.Replace("\n", " ");
        if (s.IndexOf(',') >= 0 || s.IndexOf('"') >= 0) {
            return "\"" + s.Replace("\"", "\"\"") + "\"";
        }
        return s;
    }

    public static int Export(IDbConnection conn, string sql, string outFile) {
        using (var cmd = conn.CreateCommand()) {
            cmd.CommandText = sql;
            using (var reader = cmd.ExecuteReader())
            using (var sw = new StreamWriter(outFile, false, new UTF8Encoding(false), 65536)) {
                int fc = reader.FieldCount;
                var vals = new object[fc];
                var sb = new StringBuilder(512);
                for (int i = 0; i < fc; i++) {
                    if (i > 0) sb.Append(',');
                    sb.Append(Escape(reader.GetName(i)));
                }
                sw.WriteLine(sb.ToString());
                int rows = 0;
                while (reader.Read()) {
                    reader.GetValues(vals);
                    sb.Clear();
                    for (int i = 0; i < fc; i++) {
                        if (i > 0) sb.Append(',');
                        sb.Append(Escape(vals[i]));
                    }
                    sw.WriteLine(sb.ToString());
                    rows++;
                }
                return rows;
            }
        }
    }
}
'@

$spec = Get-Content -LiteralPath $env:HMS_MDB_SPEC -Raw -Encoding UTF8 | ConvertFrom-Json
$opened = Open-MdbConnection -Path $mdbPath -Password $mdbPwd
$conn = $opened.Conn
try {
    foreach ($prop in $spec.PSObject.Properties) {
        [void][HmsMdbCsvExporter]::Export($conn, [string]$prop.Value.sql, [string]$prop.Value.out)
    }
    Write-Output 'OK'
} finally {
    $conn.Close()
}
"""
    _run_ps(
        ps_body,
        {
            "HMS_MDB_PATH": mdb_path,
            "HMS_MDB_PWD": mdb_password or "",
            "HMS_MDB_SPEC": spec_path,
        },
    )
    return {name: info["out"] for name, info in spec.items()}


# ---------------------------------------------------------------------------
# Parsing & normalization helpers
# ---------------------------------------------------------------------------

def _clip(value: Any, max_len: int) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    return s[:max_len]


def _parse_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    s = str(value).strip()
    if not s:
        return default
    try:
        return int(Decimal(s))
    except (InvalidOperation, ValueError):
        return default


def _parse_decimal(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    if value is None:
        return default
    s = str(value).strip()
    if not s:
        return default
    try:
        return Decimal(s).quantize(Decimal("0.01"))
    except InvalidOperation:
        return default


def _parse_iso_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            d = datetime.strptime(s[:10], fmt).date()
            if 1900 <= d.year <= 2100:
                return d
        except ValueError:
            continue
    return None


def _clean_code_int(value: Any) -> str:
    """Turn '4610', '4610.0', Decimal('4610') into '4610'."""
    s = str(value or "").strip()
    if not s:
        return ""
    try:
        d = Decimal(s)
        if d == d.to_integral_value():
            return str(int(d))
    except InvalidOperation:
        pass
    return s


def _split_patient_name(raw_name: Any) -> tuple[str | None, str, str | None, str | None]:
    text_name = " ".join(str(raw_name or "").strip().split())
    if not text_name:
        return None, "Patient", None, None
    tokens = text_name.split(" ")
    title: str | None = None
    if len(tokens) > 1 and tokens[0].upper() in _HONORIFICS:
        title = tokens.pop(0)[:10]
    if len(tokens) == 1:
        return title, tokens[0][:100], None, None
    if len(tokens) == 2:
        return title, tokens[0][:100], None, tokens[1][:100]
    return (
        title,
        tokens[0][:100],
        tokens[1][:100],
        " ".join(tokens[2:])[:100],
    )


def _format_age(age_val: Any, mnt_val: Any) -> str | None:
    age = _parse_int(age_val, 0)
    mnt = _parse_int(mnt_val, 0)
    if age > 0 and mnt > 0:
        return f"{age}Y {mnt}M"[:20]
    if age > 0:
        return f"{age} Years"[:20]
    if mnt > 0:
        return f"{mnt} Months"[:20]
    return None


def _normalize_gender(raw: Any) -> str:
    g = str(raw or "").strip().upper()
    if g.startswith("M"):
        return "M"
    if g.startswith("F"):
        return "F"
    if g.startswith("O"):
        return "O"
    return "U"


def _row_get(row: dict[str, str], *keys: str) -> str:
    for key in keys:
        if key in row:
            return row[key]
        low = key.lower()
        for rk, rv in row.items():
            if rk.lower() == low:
                return rv
    return ""


def _read_csv_rows(csv_path: str) -> list[dict[str, str]]:
    with open(csv_path, "r", encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


# ---------------------------------------------------------------------------
# PostgreSQL lookups
# ---------------------------------------------------------------------------

async def load_ipd_service_lookup(session: AsyncSession) -> dict[int, dict[str, Any]]:
    """Load ONLY IPD services from patient_service_masters keyed by integer CD.

    Matches codes starting with IPD / BL_IPD (e.g. BL_IPD_1, IPD_1, IPD1, IPD-1),
    and as secondary fallback services inside an IPD service group whose code
    ends with an integer.
    """
    res = await session.execute(
        text(
            """
            SELECT
                psm.id,
                psm.code,
                psm.name,
                sg.code AS group_code,
                sg.name AS group_name,
                ssc.name AS sub_category_name
            FROM patient_service_masters psm
            LEFT JOIN service_groups sg ON sg.id = psm.group_id
            LEFT JOIN service_sub_categories ssc ON ssc.id = psm.sub_category_id
            WHERE psm.is_active = TRUE
            ORDER BY psm.code
            """
        )
    )
    by_cd: dict[int, dict[str, Any]] = {}
    secondary: dict[int, dict[str, Any]] = {}
    for row in res.mappings():
        code = str(row["code"] or "").strip()
        if not code:
            continue
        info = {
            "id": str(row["id"]),
            "code": code,
            "name": str(row["name"] or code),
            "category_name": row["group_name"],
            "sub_category_name": row["sub_category_name"],
        }
        m = _IPD_CODE_RE.match(code)
        if m:
            cd = int(m.group(1))
            by_cd.setdefault(cd, info)
            continue
        grp_code = str(row["group_code"] or "").upper()
        grp_name = str(row["group_name"] or "").upper()
        if "IPD" in grp_code or "IPD" in grp_name:
            m2 = _TRAILING_DIGITS_RE.search(code)
            if m2:
                cd = int(m2.group(1))
                secondary.setdefault(cd, info)

    for cd, info in secondary.items():
        by_cd.setdefault(cd, info)
    return by_cd


async def _load_cash_payment_mode_id(session: AsyncSession) -> str | None:
    res = await session.execute(
        text(
            """
            SELECT id FROM payment_modes
            WHERE is_active = TRUE AND (UPPER(code) = 'CASH' OR is_cash = TRUE)
            ORDER BY CASE WHEN UPPER(code) = 'CASH' THEN 0 ELSE 1 END, sort_order
            LIMIT 1
            """
        )
    )
    val = res.scalar()
    return str(val) if val else None


async def _load_patient_lookup(session: AsyncSession) -> dict[str, str]:
    res = await session.execute(
        text("SELECT id, patient_no, old_software_id FROM patients")
    )
    lookup: dict[str, str] = {}
    for row in res.mappings():
        pid = str(row["id"])
        pno = str(row["patient_no"] or "").strip()
        old_id = str(row["old_software_id"] or "").strip()
        if pno:
            lookup[pno] = pid
        if old_id and old_id not in lookup:
            lookup[old_id] = pid
    return lookup


# ---------------------------------------------------------------------------
# Preview helper (API)
# ---------------------------------------------------------------------------

async def preview_mdb(
    mdb_path: str,
    mdb_password: str,
    session: AsyncSession,
) -> dict[str, Any]:
    info = await asyncio.to_thread(inspect_mdb_sync, mdb_path, mdb_password)
    counts = info.get("counts") or {}
    ipd_services = await load_ipd_service_lookup(session)
    cash_mode_id = await _load_cash_payment_mode_id(session)

    tables_out: list[dict[str, Any]] = []
    for item in MDB_TABLES_CATALOG:
        tbl_key = item["mdb_table"].upper()
        exists = tbl_key in counts
        row_count = counts.get(tbl_key, 0) if exists else 0
        extra = ""
        if item["key"] == "ipd_bills" and info.get("distinct_bills") is not None:
            extra = f" ({info['distinct_bills']:,} bills / {row_count:,} lines)"
        tables_out.append(
            {
                **item,
                "exists": exists,
                "source_rows": row_count,
                "distinct_bills": info.get("distinct_bills") if item["key"] == "ipd_bills" else None,
                "count_label": f"{row_count:,} rows{extra}" if exists else "table missing",
            }
        )

    return {
        "ok": True,
        "driver": info.get("driver"),
        "mdb_tables": info.get("tables") or [],
        "tables": tables_out,
        "ipd_service_master_count": len(ipd_services),
        "has_cash_payment_mode": bool(cash_mode_id),
        "has_ipdmast": "IPDMAST" in counts,
        "has_allcodes": "ALLCODES" in counts,
        "target_url": display_postgres_url(),
    }


# ---------------------------------------------------------------------------
# Migration executors
# ---------------------------------------------------------------------------

async def _emit(
    progress: ProgressCallback | None,
    *,
    percent: int,
    message: str,
    log_line: str | None = None,
) -> None:
    _update_job(percent=percent, message=message, log_line=log_line)
    if progress is not None:
        await progress({"type": "progress", "percent": percent, "message": message})


async def _migrate_patients_from_csv(
    session: AsyncSession,
    csv_path: str,
    *,
    replace_existing: bool,
    dry_run: bool,
    progress: ProgressCallback | None,
    pct_start: int,
    pct_end: int,
) -> dict[str, Any]:
    rows = _read_csv_rows(csv_path)
    total = len(rows)
    await _emit(
        progress,
        percent=pct_start,
        message=f"Patient Master: loaded {total:,} rows from OPDMAST",
        log_line=f"Patient Master (OPDMAST): {total:,} source rows.",
    )

    if dry_run:
        seen_opd: set[str] = set()
        valid = 0
        duplicates = 0
        for row in rows:
            opd_no = _clean_code_int(_row_get(row, "OPDNO"))
            if not opd_no:
                continue
            if opd_no in seen_opd:
                duplicates += 1
            else:
                seen_opd.add(opd_no)
                valid += 1
        msg = f"Patient Master (dry run): {valid:,} unique patients ready ({duplicates:,} duplicate OPDNO)."
        await _emit(progress, percent=pct_end, message=msg, log_line=msg)
        return {
            "source_rows": total,
            "imported": valid,
            "skipped": duplicates,
            "dry_run": True,
            "_dry_run_opdnos": seen_opd,
        }

    if replace_existing:
        await session.execute(
            text(
                "TRUNCATE TABLE patient_document_views, patient_documents, "
                "opd_bill_payments, opd_bill_lines, opd_bills, opd_tokens, "
                "ipd_bill_payments, ipd_bill_lines, ipd_bills, ipd_discharge_summaries, "
                "ipd_admissions, patients RESTART IDENTITY CASCADE"
            )
        )
        await session.execute(
            text(
                """
                DELETE FROM parties p
                WHERE p.party_type = 'customer'
                  AND NOT EXISTS (SELECT 1 FROM patients pt WHERE pt.party_id = p.id)
                  AND NOT EXISTS (SELECT 1 FROM cashbook_vouchers v WHERE v.party_id = p.id)
                """
            )
        )
        await session.commit()

    # Load existing patient numbers and customer party codes to avoid conflicts
    existing_patients = await _load_patient_lookup(session)
    party_res = await session.execute(
        text(
            "SELECT code, id FROM parties WHERE party_type IN ('customer', 'both')"
        )
    )
    existing_party_by_code = {str(r[0]): str(r[1]) for r in party_res.fetchall() if r[0]}
    used_party_ids_res = await session.execute(text("SELECT party_id FROM patients"))
    used_party_ids = {str(r[0]) for r in used_party_ids_res.fetchall() if r[0]}

    imported = 0
    skipped = 0
    batch_size = 500
    party_batch: list[dict[str, Any]] = []
    patient_batch: list[dict[str, Any]] = []

    party_insert_sql = text(
        """
        INSERT INTO parties (
            id, party_type, code, name,
            address_line1, address_line2, address_line3, address_line4,
            phone, mobile, opening_balance, opening_type, same_as_billing,
            is_active, created_at, updated_at
        ) VALUES (
            :id, 'customer', :code, :name,
            :address_line1, :address_line2, :address_line3, :address_line4,
            :phone, :mobile, 0, 'Dr', true,
            true, :created_at, NOW()
        )
        """
    )

    patient_insert_sql = text(
        """
        INSERT INTO patients (
            id, party_id, patient_no, title, first_name, middle_name, last_name,
            age, gender,
            contact_address1, contact_address2, contact_address3, contact_address4,
            old_software_id, remarks, phone, mobile,
            is_existing_patient, is_active, created_at, updated_at
        ) VALUES (
            :id, :party_id, :patient_no, :title, :first_name, :middle_name, :last_name,
            :age, :gender,
            :contact_address1, :contact_address2, :contact_address3, :contact_address4,
            :old_software_id, :remarks, :phone, :mobile,
            true, true, :created_at, NOW()
        )
        ON CONFLICT (patient_no) DO NOTHING
        """
    )

    async def flush_batches() -> None:
        if party_batch:
            await session.execute(party_insert_sql, party_batch)
            party_batch.clear()
        if patient_batch:
            await session.execute(patient_insert_sql, patient_batch)
            patient_batch.clear()
        await session.commit()

    seen_in_run: set[str] = set()
    now_dt = datetime.now()

    for idx, row in enumerate(rows, start=1):
        opd_no = _clean_code_int(_row_get(row, "OPDNO"))
        if not opd_no:
            mkey = _clean_code_int(_row_get(row, "mkey", "MKEY"))
            opd_no = f"MDB{mkey or idx}"
        patient_no = opd_no[:20]

        if patient_no in seen_in_run or patient_no in existing_patients:
            skipped += 1
            continue
        seen_in_run.add(patient_no)

        title, first_name, middle_name, last_name = _split_patient_name(_row_get(row, "PNAME"))
        full_name = " ".join(p for p in (first_name, middle_name, last_name) if p) or "Patient"
        age_str = _format_age(_row_get(row, "AGE"), _row_get(row, "MNT"))
        gender = _normalize_gender(_row_get(row, "SEX"))
        addr1 = _clip(_row_get(row, "ADD1"), 200)
        addr2 = _clip(_row_get(row, "TALUK"), 200)
        addr3 = _clip(_row_get(row, "DIST"), 200)
        addr4 = _clip(_row_get(row, "STATE"), 200)
        raw_phone = _clip(_row_get(row, "phone", "PHONE"), 20)
        remarks = _clip(_row_get(row, "REMARKS"), 5000)
        reg_date = _parse_iso_date(_row_get(row, "REGDT")) or _parse_iso_date(_row_get(row, "DATE1"))
        created_at = datetime(reg_date.year, reg_date.month, reg_date.day) if reg_date else now_dt

        # Reuse an unlinked customer party with same code if present, else create one with unique code
        existing_pid = existing_party_by_code.get(patient_no)
        if existing_pid and existing_pid not in used_party_ids:
            party_id = existing_pid
            used_party_ids.add(party_id)
        else:
            party_code = patient_no
            if party_code in existing_party_by_code:
                suffix = 1
                while f"PT-{patient_no}-{suffix}"[:40] in existing_party_by_code:
                    suffix += 1
                party_code = f"PT-{patient_no}-{suffix}"[:40]
            party_id = str(uuid4())
            existing_party_by_code[party_code] = party_id
            used_party_ids.add(party_id)
            party_batch.append(
                {
                    "id": party_id,
                    "code": party_code[:40],
                    "name": full_name[:200],
                    "address_line1": addr1,
                    "address_line2": addr2,
                    "address_line3": addr3,
                    "address_line4": addr4,
                    "phone": raw_phone,
                    "mobile": raw_phone,
                    "created_at": created_at,
                }
            )

        patient_id = str(uuid4())
        existing_patients[patient_no] = patient_id
        patient_batch.append(
            {
                "id": patient_id,
                "party_id": party_id,
                "patient_no": patient_no,
                "title": title,
                "first_name": first_name,
                "middle_name": middle_name,
                "last_name": last_name,
                "age": age_str,
                "gender": gender,
                "contact_address1": addr1,
                "contact_address2": addr2,
                "contact_address3": addr3,
                "contact_address4": addr4,
                "old_software_id": opd_no[:50],
                "remarks": remarks,
                "phone": raw_phone,
                "mobile": raw_phone,
                "created_at": created_at,
            }
        )
        imported += 1

        if len(patient_batch) >= batch_size:
            await flush_batches()
            pct = pct_start + int(((pct_end - pct_start) * idx) / max(total, 1))
            await _emit(
                progress,
                percent=pct,
                message=f"Patient Master: {idx:,} / {total:,} ({imported:,} imported, {skipped:,} skipped)",
            )

    await flush_batches()
    done_msg = f"Patient Master done: {imported:,} imported, {skipped:,} skipped (source {total:,})."
    await _emit(progress, percent=pct_end, message=done_msg, log_line=done_msg)
    return {"source_rows": total, "imported": imported, "skipped": skipped}


async def _migrate_ipd_bills_from_csv(
    session: AsyncSession,
    ipdbill_csv: str,
    *,
    ipdmast_csv: str | None,
    allcodes_csv: str | None,
    replace_existing: bool,
    dry_run: bool,
    progress: ProgressCallback | None,
    pct_start: int,
    pct_end: int,
    extra_dry_run_patients: set[str] | None = None,
) -> dict[str, Any]:
    raw_rows = _read_csv_rows(ipdbill_csv)
    total_lines = len(raw_rows)
    await _emit(
        progress,
        percent=pct_start,
        message=f"IPD Bill: loaded {total_lines:,} lines from IPDBILL",
        log_line=f"IPD Bill (IPDBILL): {total_lines:,} source lines.",
    )

    # Optional fallback names from ALLCODES (SW = 'BL')
    mdb_service_names: dict[int, str] = {}
    if allcodes_csv and os.path.isfile(allcodes_csv):
        for r in _read_csv_rows(allcodes_csv):
            cd = _parse_int(_row_get(r, "CD"), -1)
            name = _clip(_row_get(r, "NAME"), 200)
            if cd >= 0 and name:
                mdb_service_names[cd] = name

    # Optional IPDMAST lookup for admission_date / discharge_date / bed_no / remarks
    ipdmast_by_bill: dict[tuple[str, str, str], dict[str, Any]] = {}
    ipdmast_by_opd_ipd: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    if ipdmast_csv and os.path.isfile(ipdmast_csv):
        for r in _read_csv_rows(ipdmast_csv):
            opdno = _clean_code_int(_row_get(r, "OPDNO"))
            ipdno = _clean_code_int(_row_get(r, "IPDNO"))
            billno = _clean_code_int(_row_get(r, "billno", "BILLNO"))
            adm_dt = _parse_iso_date(_row_get(r, "DATE1"))
            dis_dt = _parse_iso_date(_row_get(r, "DISDT"))
            room = _clean_code_int(_row_get(r, "ROOM"))
            rem = _clip(_row_get(r, "REMARKS"), 2000)
            entry = {
                "admission_date": adm_dt,
                "discharge_date": dis_dt,
                "bed_no": room if room and room != "0" else None,
                "remarks": rem,
            }
            if opdno and ipdno and billno:
                ipdmast_by_bill[(opdno, ipdno, billno)] = entry
            if opdno and ipdno:
                ipdmast_by_opd_ipd[(opdno, ipdno)].append(entry)

    # Group IPDBILL rows into distinct bills: (IPDNO, BILLNO, OPDNO, DATE1)
    grouped: dict[tuple[str, str, str, str], list[dict[str, str]]] = defaultdict(list)
    skipped_deleted = 0
    for r in raw_rows:
        mrk = str(_row_get(r, "mrk", "MRK") or "").strip()
        if mrk:
            skipped_deleted += 1
            continue
        ipdno = _clean_code_int(_row_get(r, "IPDNO"))
        billno = _clean_code_int(_row_get(r, "BILLNO"))
        opdno = _clean_code_int(_row_get(r, "OPDNO"))
        date_str = str(_row_get(r, "DATE1") or "").strip()
        key = (ipdno, billno, opdno, date_str)
        grouped[key].append(r)

    total_bills = len(grouped)
    patient_lookup = await _load_patient_lookup(session)
    ipd_services = await load_ipd_service_lookup(session)
    cash_mode_id = await _load_cash_payment_mode_id(session)

    await _emit(
        progress,
        percent=pct_start + 2,
        message=f"IPD Bill: {total_bills:,} bills grouped; {len(ipd_services)} IPD services matched in Service Master.",
        log_line=(
            f"Grouped {total_lines:,} lines into {total_bills:,} IPD bills "
            f"(matched {len(ipd_services)} IPD services in Service Master; "
            f"Cash payment mode: {'found' if cash_mode_id else 'NOT FOUND'})."
        ),
    )

    if dry_run:
        known_patients = set(patient_lookup.keys()) | (extra_dry_run_patients or set())
        ready = 0
        ready_lines = 0
        missing_pts = 0
        unmatched_cds: set[int] = set()
        for (ipdno, billno, opdno, _date_str), lines in grouped.items():
            if opdno not in known_patients:
                missing_pts += 1
                continue
            ready += 1
            for ln in lines:
                ready_lines += 1
                cd = _parse_int(_row_get(ln, "CD"), -1)
                if cd >= 0 and cd not in ipd_services:
                    unmatched_cds.add(cd)
        msg = (
            f"IPD Bill (dry run): {ready:,} bills ({ready_lines:,} lines) ready, "
            f"{missing_pts:,} skipped (patient not found), "
            f"{len(unmatched_cds)} CD code(s) not in IPD Service Master"
            + (f" ({sorted(unmatched_cds)})" if unmatched_cds else "")
            + "."
        )
        await _emit(progress, percent=pct_end, message=msg, log_line=msg)
        return {
            "source_lines": total_lines,
            "source_bills": total_bills,
            "imported_bills": ready,
            "imported_lines": ready_lines,
            "missing_patients": missing_pts,
            "unmatched_service_codes": sorted(unmatched_cds),
            "dry_run": True,
        }

    if replace_existing:
        await session.execute(
            text(
                "TRUNCATE TABLE ipd_bill_payments, ipd_bill_lines, ipd_bills, "
                "ipd_discharge_summaries, ipd_admissions RESTART IDENTITY CASCADE"
            )
        )
        await session.commit()

    existing_bills_res = await session.execute(text("SELECT bill_no FROM ipd_bills"))
    existing_bill_nos = {str(r[0]).upper() for r in existing_bills_res.fetchall() if r[0]}
    existing_adm_res = await session.execute(text("SELECT admission_no FROM ipd_admissions"))
    existing_adm_nos = {str(r[0]).upper() for r in existing_adm_res.fetchall() if r[0]}

    adm_insert_sql = text(
        """
        INSERT INTO ipd_admissions (
            id, admission_no, admission_date, patient_id, bed_no,
            advance_amount, remarks, status, discharge_date, is_active,
            created_at, updated_at
        ) VALUES (
            :id, :admission_no, :admission_date, :patient_id, :bed_no,
            :advance_amount, :remarks, 'discharged', :discharge_date, true,
            :created_at, NOW()
        )
        """
    )

    bill_insert_sql = text(
        """
        INSERT INTO ipd_bills (
            id, bill_no, bill_date, admission_id, patient_id, bed_no,
            admission_date, discharge_date, stay_days,
            payment_mode_id, is_cash,
            admin_charges, scheme_discount, sanctioned_scheme_amount,
            adjust_advance, hide_advance_on_bill,
            gross_amount, net_amount, remarks, status, is_active,
            created_at, updated_at
        ) VALUES (
            :id, :bill_no, :bill_date, :admission_id, :patient_id, :bed_no,
            :admission_date, :discharge_date, :stay_days,
            :payment_mode_id, true,
            0, :scheme_discount, 0,
            :adjust_advance, false,
            :gross_amount, :net_amount, :remarks, 'discharged', true,
            :created_at, NOW()
        )
        """
    )

    line_insert_sql = text(
        """
        INSERT INTO ipd_bill_lines (
            id, bill_id, service_id, service_code, service_name,
            category_name, sub_category_name,
            rate, quantity, amount, original_rate,
            hospital_amount, doctor_amount,
            line_source, sort_order, is_active,
            created_at, updated_at
        ) VALUES (
            :id, :bill_id, :service_id, :service_code, :service_name,
            :category_name, :sub_category_name,
            :rate, 1, :amount, :original_rate,
            :hospital_amount, 0,
            'mdb', :sort_order, true,
            :created_at, NOW()
        )
        """
    )

    payment_insert_sql = text(
        """
        INSERT INTO ipd_bill_payments (
            id, bill_id, payment_mode_id, amount, sort_order, is_active,
            created_at, updated_at
        ) VALUES (
            :id, :bill_id, :payment_mode_id, :amount, 0, true,
            :created_at, NOW()
        )
        """
    )

    adm_batch: list[dict[str, Any]] = []
    bill_batch: list[dict[str, Any]] = []
    line_batch: list[dict[str, Any]] = []
    pay_batch: list[dict[str, Any]] = []

    async def flush_bill_batches() -> None:
        if adm_batch:
            await session.execute(adm_insert_sql, adm_batch)
            adm_batch.clear()
        if bill_batch:
            await session.execute(bill_insert_sql, bill_batch)
            bill_batch.clear()
        if line_batch:
            await session.execute(line_insert_sql, line_batch)
            line_batch.clear()
        if pay_batch:
            await session.execute(payment_insert_sql, pay_batch)
            pay_batch.clear()
        await session.commit()

    imported_bills = 0
    imported_lines = 0
    skipped_existing = 0
    missing_patients = 0
    unmatched_cds: set[int] = set()
    batch_bills = 300

    for idx, ((ipdno, billno, opdno, date_str), lines) in enumerate(grouped.items(), start=1):
        patient_id = patient_lookup.get(opdno)
        if not patient_id:
            missing_patients += 1
            continue

        bill_date = _parse_iso_date(date_str) or date.today()
        created_at = datetime(bill_date.year, bill_date.month, bill_date.day)

        # Unique, readable bill_no preserving year + BILLNO + IPDNO (uppercase, <= 30 chars)
        raw_bill_no = f"IPD-{bill_date.year}-{billno or idx}-{ipdno or 0}".upper()[:30]
        if raw_bill_no in existing_bill_nos:
            skipped_existing += 1
            continue
        existing_bill_nos.add(raw_bill_no)

        # Optional admission enrichment from IPDMAST
        adm_info = ipdmast_by_bill.get((opdno, ipdno, billno))
        if not adm_info and (opdno, ipdno) in ipdmast_by_opd_ipd:
            candidates = [
                c
                for c in ipdmast_by_opd_ipd[(opdno, ipdno)]
                if c["admission_date"] and c["admission_date"] <= bill_date
                and (bill_date - c["admission_date"]).days <= 180
            ]
            if candidates:
                candidates.sort(key=lambda c: c["admission_date"], reverse=True)
                adm_info = candidates[0]

        adm_date = (adm_info["admission_date"] if adm_info and adm_info["admission_date"] else bill_date)
        dis_date = (adm_info["discharge_date"] if adm_info and adm_info["discharge_date"] else bill_date)
        if dis_date < adm_date:
            dis_date = adm_date
        stay_days = max((dis_date - adm_date).days + 1, 1)
        bed_no = (adm_info["bed_no"][:30] if adm_info and adm_info["bed_no"] else None)

        # Unique admission_no per migrated IPD bill so IPDNO is visible on IPD Bill Reprint
        base_adm_no = f"IPD-{adm_date.year}-{ipdno or billno or idx}".upper()[:25]
        adm_no = base_adm_no
        if adm_no in existing_adm_nos:
            suffix = 2
            while f"{base_adm_no}-{suffix}"[:30] in existing_adm_nos:
                suffix += 1
            adm_no = f"{base_adm_no}-{suffix}"[:30]
        existing_adm_nos.add(adm_no)

        # Build bill lines (AMT -> rate & amount, qty = 1, CD -> IPD service master)
        gross_amount = Decimal("0.00")
        max_disc = Decimal("0.00")
        max_adv = Decimal("0.00")
        bill_id = str(uuid4())
        adm_id = str(uuid4())

        for sort_order, ln in enumerate(lines):
            cd = _parse_int(_row_get(ln, "CD"), 0)
            amt = _parse_decimal(_row_get(ln, "AMT", "AMNT"), Decimal("0.00"))
            disc = _parse_decimal(_row_get(ln, "DISC"), Decimal("0.00"))
            adv = _parse_decimal(_row_get(ln, "ADVAMT"), Decimal("0.00"))
            if disc > max_disc:
                max_disc = disc
            if adv > max_adv:
                max_adv = adv

            svc = ipd_services.get(cd)
            if svc:
                service_id = svc["id"]
                service_code = svc["code"][:30]
                service_name = svc["name"][:200]
                category_name = svc.get("category_name")
                sub_category_name = svc.get("sub_category_name")
            else:
                unmatched_cds.add(cd)
                service_id = None
                service_code = f"BL_IPD_{cd}"[:30]
                service_name = (mdb_service_names.get(cd) or f"IPD Service {cd}")[:200]
                category_name = "IPD SERVICES"
                sub_category_name = None

            gross_amount += amt
            line_batch.append(
                {
                    "id": str(uuid4()),
                    "bill_id": bill_id,
                    "service_id": service_id,
                    "service_code": service_code,
                    "service_name": service_name,
                    "category_name": category_name,
                    "sub_category_name": sub_category_name,
                    "rate": amt,
                    "amount": amt,
                    "original_rate": amt,
                    "hospital_amount": amt,
                    "sort_order": sort_order,
                    "created_at": created_at,
                }
            )
            imported_lines += 1

        scheme_discount = max(max_disc, Decimal("0.00"))
        adjust_advance = max(max_adv, Decimal("0.00"))
        net_amount = max(gross_amount - scheme_discount - adjust_advance, Decimal("0.00"))

        remark_parts = [f"Migrated from MDB (IPDNO: {ipdno}, BILLNO: {billno})"]
        if adm_info and adm_info.get("remarks"):
            remark_parts.append(str(adm_info["remarks"]))
        remarks = " | ".join(remark_parts)

        adm_batch.append(
            {
                "id": adm_id,
                "admission_no": adm_no,
                "admission_date": adm_date,
                "patient_id": patient_id,
                "bed_no": bed_no,
                "advance_amount": adjust_advance,
                "remarks": remarks,
                "discharge_date": dis_date,
                "created_at": created_at,
            }
        )

        bill_batch.append(
            {
                "id": bill_id,
                "bill_no": raw_bill_no,
                "bill_date": bill_date,
                "admission_id": adm_id,
                "patient_id": patient_id,
                "bed_no": bed_no,
                "admission_date": adm_date,
                "discharge_date": dis_date,
                "stay_days": stay_days,
                "payment_mode_id": cash_mode_id,
                "scheme_discount": scheme_discount,
                "adjust_advance": adjust_advance,
                "gross_amount": gross_amount,
                "net_amount": net_amount,
                "remarks": remarks,
                "created_at": created_at,
            }
        )

        if cash_mode_id:
            pay_batch.append(
                {
                    "id": str(uuid4()),
                    "bill_id": bill_id,
                    "payment_mode_id": cash_mode_id,
                    "amount": net_amount,
                    "created_at": created_at,
                }
            )

        imported_bills += 1

        if len(bill_batch) >= batch_bills:
            await flush_bill_batches()
            pct = pct_start + 2 + int(((pct_end - pct_start - 2) * idx) / max(total_bills, 1))
            await _emit(
                progress,
                percent=pct,
                message=f"IPD Bill: {idx:,} / {total_bills:,} bills ({imported_bills:,} imported, {imported_lines:,} lines)",
            )

    await flush_bill_batches()
    extra_warn = (
        f" Unmatched CD codes (saved with fallback name): {sorted(unmatched_cds)}."
        if unmatched_cds
        else ""
    )
    done_msg = (
        f"IPD Bill done: {imported_bills:,} bills ({imported_lines:,} lines) imported as Cash, "
        f"{skipped_existing:,} already existed, {missing_patients:,} skipped (missing patient)."
        f"{extra_warn}"
    )
    await _emit(progress, percent=pct_end, message=done_msg, log_line=done_msg)
    return {
        "source_lines": total_lines,
        "source_bills": total_bills,
        "imported_bills": imported_bills,
        "imported_lines": imported_lines,
        "skipped_existing": skipped_existing,
        "skipped_deleted": skipped_deleted,
        "missing_patients": missing_patients,
        "unmatched_service_codes": sorted(unmatched_cds),
    }


async def run_mdb_migration(
    *,
    mdb_path: str,
    mdb_password: str,
    selected_keys: list[str],
    replace_existing: bool,
    dry_run: bool,
    app_session: AsyncSession,
    progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    ordered = [k for k in MIGRATE_ORDER if k in set(selected_keys)]
    if not ordered:
        raise ValueError("Select at least one table to migrate (patients or ipd_bills).")

    await _emit(
        progress,
        percent=3,
        message="Inspecting MDB tables…",
        log_line=f"Opening MDB: {os.path.basename(mdb_path)} ({'DRY RUN' if dry_run else 'LIVE'})",
    )
    info = await asyncio.to_thread(inspect_mdb_sync, mdb_path, mdb_password)
    available = {t.upper(): t for t in (info.get("tables") or [])}

    queries: dict[str, str] = {}
    if "patients" in ordered:
        tbl = available.get("OPDMAST")
        if not tbl:
            raise ValueError("Table OPDMAST was not found in the selected MDB file.")
        queries["opdmast"] = f"SELECT * FROM [{tbl}] ORDER BY mkey"
    if "ipd_bills" in ordered:
        tbl = available.get("IPDBILL")
        if not tbl:
            raise ValueError("Table IPDBILL was not found in the selected MDB file.")
        queries["ipdbill"] = f"SELECT * FROM [{tbl}] ORDER BY MKEY"
        if "IPDMAST" in available:
            queries["ipdmast"] = f"SELECT * FROM [{available['IPDMAST']}]"
        if "ALLCODES" in available:
            queries["allcodes"] = f"SELECT CD, NAME FROM [{available['ALLCODES']}] WHERE SW = 'BL'"

    tmp_dir = tempfile.mkdtemp(prefix="hms_mdb_export_")
    try:
        await _emit(
            progress,
            percent=8,
            message="Extracting rows from MDB…",
            log_line=f"Extracting {', '.join(queries.keys()).upper()} via {info.get('driver')}…",
        )
        csv_files = await asyncio.to_thread(
            export_mdb_tables_to_csv_sync,
            mdb_path,
            mdb_password,
            queries,
            tmp_dir,
        )

        # Ensure hospital + core schemas are on search_path
        await app_session.execute(text("SET search_path TO hospital, core, public"))

        results: dict[str, Any] = {}
        if "patients" in ordered and "ipd_bills" in ordered:
            p_range, b_range = (15, 58), (60, 98)
        elif "patients" in ordered:
            p_range, b_range = (15, 98), (98, 98)
        else:
            p_range, b_range = (15, 15), (15, 98)

        dry_run_opdnos: set[str] | None = None
        if "patients" in ordered:
            p_res = await _migrate_patients_from_csv(
                app_session,
                csv_files["opdmast"],
                replace_existing=replace_existing,
                dry_run=dry_run,
                progress=progress,
                pct_start=p_range[0],
                pct_end=p_range[1],
            )
            dry_run_opdnos = p_res.pop("_dry_run_opdnos", None)
            results["patients"] = p_res

        if "ipd_bills" in ordered:
            results["ipd_bills"] = await _migrate_ipd_bills_from_csv(
                app_session,
                csv_files["ipdbill"],
                ipdmast_csv=csv_files.get("ipdmast"),
                allcodes_csv=csv_files.get("allcodes"),
                replace_existing=replace_existing,
                dry_run=dry_run,
                progress=progress,
                pct_start=b_range[0],
                pct_end=b_range[1],
                extra_dry_run_patients=dry_run_opdnos,
            )

        summary_msg = "MDB dry run completed." if dry_run else "MDB migration completed successfully."
        _update_job(
            percent=100,
            message=summary_msg,
            log_line=summary_msg,
            done=True,
            running=False,
            summary=results,
        )
        if progress is not None:
            await progress({"type": "complete", "percent": 100, "message": summary_msg, "results": results})
        return {"ok": True, "dry_run": dry_run, "message": summary_msg, "results": results}
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
