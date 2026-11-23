"""Copy a previous-version hospital database into this one.

The previous install (`D:\\fullstack\\others\\hospital`) keeps every table in
`public`. This version splits the same tables across `hospital` and `core`,
and patients require a `core.parties` row. Column names that changed
(`ledgers.is_patient_deposit`, `payment_modes.is_credit`, `users.username`)
are filled in while copying.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Awaitable, Callable
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import unquote, urlparse
from uuid import UUID, uuid4

import asyncpg
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.config import get_settings

_logger = logging.getLogger("hms.previous_migration")

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]

DEFAULT_SOURCE_URL = "postgresql://postgres:postpass@127.0.0.1:5432/hms"
SKIP_TABLES = frozenset({"alembic_version"})
USER_TABLES = frozenset(
    {
        "users",
        "user_types",
        "user_role_mappings",
        "roles",
        "role_menu_permissions",
        "menus",
    }
)
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_BATCH = 400
_CHUNK = 5000

# Latest copy, read by the progress bar. One migration runs at a time.
_job: dict[str, Any] = {
    "running": False,
    "done": False,
    "percent": 0,
    "message": "Idle",
    "label": "",
    "table_index": 0,
    "table_total": 0,
    "processed": 0,
    "total": 0,
    "error": None,
    "imported": 0,
}

# Source column -> target column when the name changed.
_RENAMES: dict[str, tuple[tuple[str, str], ...]] = {
    "ledgers": (("is_patient_deposit", "is_party_deposit"),),
}


def display_postgres_url(database_url: str | None = None) -> str:
    url = database_url or get_settings().database_url
    url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
    url = re.sub(r"[?&]ssl=disable", "", url)
    return url.rstrip("?&")


def _asyncpg_dsn(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        raise ValueError("PostgreSQL connection string is empty.")
    raw = raw.replace("postgresql+asyncpg://", "postgresql://", 1)
    raw = raw.replace("@localhost:", "@127.0.0.1:")
    raw = re.sub(r"[?&]ssl=disable", "", raw).rstrip("?&")
    if not raw.startswith("postgresql://"):
        raise ValueError("Use a postgresql:// connection string for the previous hospital database.")
    return raw


def _q(name: str) -> str:
    if not _IDENT.fullmatch(name or ""):
        raise ValueError(f"Invalid SQL name: {name!r}")
    return '"' + name + '"'


def _label(table: str) -> str:
    return table.replace("_", " ").strip().title()


def _group_for(table: str) -> tuple[str, int, bool]:
    """Return (group name, sort, selected by default)."""
    if table in USER_TABLES:
        return "Users and menus", 40, False
    if table in {"patients", "patient_documents", "patient_document_views"}:
        return "Patients", 20, True
    if table.startswith(
        (
            "opd_",
            "ipd_",
            "cashbook_",
            "pharmacy_sale",
            "pharmacy_purchase",
            "short_bill",
            "single_service",
            "pathology_bill",
            "pathology_order",
            "pathology_result",
        )
    ):
        return "Transactions", 30, True
    if table in {
        "hospital_profile",
        "print_configs",
        "number_sequences",
        "dashboard_shortcuts",
        "notification_setups",
        "patient_no_formats",
    }:
        return "Settings", 10, True
    return "Masters", 15, True


def catalog_item(table: str, *, source_rows: int | None = None) -> dict[str, Any]:
    group, order, selected = _group_for(table)
    item: dict[str, Any] = {
        "key": table,
        "label": _label(table),
        "group": group,
        "group_order": order,
        "default_selected": selected,
        "notes": (
            "Leave off to keep this version's login and menus."
            if table in USER_TABLES
            else ""
        ),
    }
    if source_rows is not None:
        item["source_rows"] = source_rows
    return item


async def test_source(url: str) -> dict[str, Any]:
    dsn = _asyncpg_dsn(url)
    target = _asyncpg_dsn(display_postgres_url())
    if dsn.rstrip("/") == target.rstrip("/"):
        raise ValueError("Source database is the same as this application database.")
    conn = await asyncpg.connect(dsn, timeout=8)
    try:
        version = await conn.fetchval("SELECT version()")
        database = await conn.fetchval("SELECT current_database()")
        rows = await conn.fetch(
            """
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE'
              AND table_schema IN ('public', 'hospital', 'core')
            """
        )
        names = {r["table_name"] for r in rows if r["table_name"] not in SKIP_TABLES}
        return {
            "ok": True,
            "message": f"Connected to {database}. {version}",
            "database": database,
            "version": version,
            "table_count": len(names),
        }
    finally:
        await conn.close()


async def _source_schemas(conn: asyncpg.Connection) -> dict[str, str]:
    rows = await conn.fetch(
        """
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema IN ('public', 'hospital', 'core')
        """
    )
    found: dict[str, str] = {}
    for row in rows:
        name = str(row["table_name"])
        schema = str(row["table_schema"])
        if name in SKIP_TABLES:
            continue
        # A previous-version database stores tables in public.
        # A copy of this version stores them in hospital / core.
        if name not in found or schema != "public":
            found[name] = schema
    return found


async def _target_schemas(session: AsyncSession) -> dict[str, str]:
    result = await session.execute(
        text(
            """
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE'
              AND table_schema IN ('hospital', 'core')
            """
        )
    )
    return {str(name): str(schema) for schema, name in result.all()}


async def list_common_tables(url: str, session: AsyncSession) -> list[dict[str, Any]]:
    conn = await asyncpg.connect(_asyncpg_dsn(url), timeout=8)
    try:
        source = await _source_schemas(conn)
        target = await _target_schemas(session)
        common = sorted(set(source) & set(target), key=lambda name: (_group_for(name)[1], name))
        items: list[dict[str, Any]] = []
        for name in common:
            schema = source[name]
            count = await conn.fetchval(f"SELECT count(*) FROM {_q(schema)}.{_q(name)}")
            items.append(catalog_item(name, source_rows=int(count or 0)))
        return items
    finally:
        await conn.close()


def _json_ready(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (datetime, date)):
        return value
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return value


def _clip(value: Any, length: int | None) -> Any:
    if value is None or not length or not isinstance(value, str):
        return value
    return value[:length]


async def _columns(session_or_conn: Any, schema: str, table: str, *, source: bool) -> list[dict[str, Any]]:
    sql = """
        SELECT column_name, is_nullable, data_type, udt_name,
               character_maximum_length, column_default
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
    """
    if source:
        rows = await session_or_conn.fetch(sql, schema, table)
        return [dict(row) for row in rows]
    result = await session_or_conn.execute(
        text(
            """
            SELECT column_name, is_nullable, data_type, udt_name,
                   character_maximum_length, column_default
            FROM information_schema.columns
            WHERE table_schema = :schema AND table_name = :table
            ORDER BY ordinal_position
            """
        ),
        {"schema": schema, "table": table},
    )
    return [dict(row._mapping) for row in result]


def _fill_missing(table: str, column: str, row: dict[str, Any], used_usernames: set[str]) -> Any:
    if table == "ledgers" and column == "group_name":
        return "General"
    if table == "ledgers" and column == "opening_type":
        return "Dr"
    if table == "ledgers" and column == "is_party_deposit":
        return bool(row.get("is_patient_deposit") or False)
    if table == "payment_modes" and column == "is_credit":
        return False
    if table == "users" and column == "username":
        email = str(row.get("email") or "")
        base = (email.split("@", 1)[0] if email else "user").strip().lower()[:70] or "user"
        candidate = base
        n = 2
        while candidate in used_usernames:
            candidate = f"{base[:68]}{n}"
            n += 1
        used_usernames.add(candidate)
        return candidate
    return None


async def _foreign_keys(session: AsyncSession) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            """
            SELECT
                ns.nspname AS table_schema,
                rel.relname AS table_name,
                att.attname AS column_name,
                fns.nspname AS foreign_schema,
                frel.relname AS foreign_table,
                att.attnotnull AS not_null
            FROM pg_constraint c
            JOIN pg_class rel ON rel.oid = c.conrelid
            JOIN pg_namespace ns ON ns.oid = rel.relnamespace
            JOIN pg_class frel ON frel.oid = c.confrelid
            JOIN pg_namespace fns ON fns.oid = frel.relnamespace
            JOIN LATERAL unnest(c.conkey) AS ck(attnum) ON true
            JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ck.attnum
            WHERE c.contype = 'f'
              AND ns.nspname IN ('hospital', 'core')
            """
        )
    )
    return [dict(row._mapping) for row in result]


def _insert_order(tables: list[str], fks: list[dict[str, Any]]) -> list[str]:
    selected = set(tables)
    deps: dict[str, set[str]] = {name: set() for name in tables}
    for fk in fks:
        child = str(fk["table_name"])
        parent = str(fk["foreign_table"])
        if child in selected and parent in selected and child != parent:
            deps[child].add(parent)
    if "patients" in selected and "cashbook_vouchers" in selected:
        deps["cashbook_vouchers"].add("patients")
    ordered: list[str] = []
    pending = set(tables)
    while pending:
        ready = sorted(name for name in pending if not (deps[name] & pending))
        if not ready:
            ordered.extend(sorted(pending))
            break
        ordered.extend(ready)
        pending.difference_update(ready)
    return ordered


async def _load_ids(session: AsyncSession, schema: str, table: str) -> set[str]:
    result = await session.execute(text(f"SELECT id FROM {_q(schema)}.{_q(table)}"))
    return {str(row[0]) for row in result.all()}


async def _null_external_fks(
    session: AsyncSession,
    selected: set[str],
    target: dict[str, str],
    fks: list[dict[str, Any]],
) -> None:
    for fk in fks:
        child = str(fk["table_name"])
        parent = str(fk["foreign_table"])
        if parent not in selected or child in selected or child == parent:
            continue
        if child not in target:
            continue
        column = str(fk["column_name"])
        if fk["not_null"]:
            raise ValueError(
                f"Also select {_label(child)}. It references {_label(parent)}, "
                f"so {_label(parent)} cannot be replaced on its own."
            )
        await session.execute(
            text(
                f"UPDATE {_q(target[child])}.{_q(child)} "
                f"SET {_q(column)} = NULL WHERE {_q(column)} IS NOT NULL"
            )
        )


async def _delete_unreferenced_parties(session: AsyncSession) -> None:
    await session.execute(
        text(
            """
            DELETE FROM core.parties p
            WHERE p.party_type = 'customer'
              AND NOT EXISTS (SELECT 1 FROM hospital.patients pt WHERE pt.party_id = p.id)
              AND NOT EXISTS (SELECT 1 FROM core.cashbook_vouchers v WHERE v.party_id = p.id)
            """
        )
    )


def _prepare_row(
    table: str,
    source_row: dict[str, Any],
    target_cols: list[dict[str, Any]],
    *,
    used_usernames: set[str],
    self_fk: set[str],
) -> dict[str, Any]:
    source_names = set(source_row)
    renamed_from = {src: dest for src, dest in _RENAMES.get(table, ())}
    out: dict[str, Any] = {}
    for col in target_cols:
        name = str(col["column_name"])
        if name in self_fk:
            out[name] = None
            continue
        value = source_row.get(name) if name in source_names else None
        if value is None:
            for src, dest in renamed_from.items():
                if dest == name and src in source_names:
                    value = source_row.get(src)
                    break
        if value is None and name not in source_names:
            value = _fill_missing(table, name, source_row, used_usernames)
        if value is None:
            continue
        value = _json_ready(value)
        value = _clip(value, col.get("character_maximum_length"))
        if col["udt_name"] in {"json", "jsonb"} and not isinstance(value, str):
            value = json.dumps(value)
        out[name] = value
    missing = []
    for col in target_cols:
        name = str(col["column_name"])
        if name in out or col.get("column_default") is not None:
            continue
        if str(col["is_nullable"]).upper() == "YES":
            continue
        filled = _fill_missing(table, name, source_row, used_usernames)
        if filled is not None:
            out[name] = filled
            continue
        udt = str(col["udt_name"])
        if udt == "bool":
            out[name] = False
        elif udt in {"int2", "int4", "int8", "numeric", "float4", "float8"}:
            out[name] = 0
        elif udt in {"varchar", "text", "bpchar"}:
            out[name] = ""
        else:
            missing.append(name)
    if missing:
        raise ValueError(
            f"{_label(table)} is missing required column(s): {', '.join(missing)}"
        )
    return out


async def _insert_parties(
    session: AsyncSession,
    rows: list[dict[str, Any]],
    party_by_patient: dict[str, str],
) -> None:
    if not rows:
        return
    payload = []
    pending_codes: list[str] = []
    for row in rows:
        patient_id = str(row.get("id") or "")
        code = str(row.get("patient_no") or patient_id)[:40]
        pending_codes.append(code)
    existing: dict[str, str] = {}
    if pending_codes:
        found = await session.execute(
            text(
                """
                SELECT id, code FROM core.parties
                WHERE party_type = 'customer' AND code IN :codes
                """
            ).bindparams(bindparam("codes", expanding=True)),
            {"codes": pending_codes},
        )
        existing = {str(row.code): str(row.id) for row in found}
    payload = []
    for row in rows:
        patient_id = str(row.get("id") or "")
        code = str(row.get("patient_no") or patient_id)[:40]
        if code in existing:
            row["party_id"] = existing[code]
            if patient_id:
                party_by_patient[patient_id] = existing[code]
            continue
        name = " ".join(
            str(row.get(part) or "").strip()
            for part in ("first_name", "middle_name", "last_name")
            if str(row.get(part) or "").strip()
        ) or "Patient"
        party_id = str(uuid4())
        row["party_id"] = party_id
        if patient_id:
            party_by_patient[patient_id] = party_id
        payload.append(
            {
                "id": party_id,
                "code": code,
                "name": name[:200],
                "address_line1": _clip(row.get("contact_address1"), 200),
                "address_line2": _clip(row.get("contact_address2"), 200),
                "address_line3": _clip(row.get("contact_address3"), 200),
                "address_line4": _clip(row.get("contact_address4"), 200),
                "pin_code": _clip(row.get("contact_address5"), 20),
                "phone": _clip(row.get("phone"), 30),
                "mobile": _clip(row.get("mobile"), 30),
                "email": _clip(row.get("email"), 255),
                "is_active": bool(row.get("is_active") if row.get("is_active") is not None else True),
            }
        )
    if not payload:
        return
    await session.execute(
        text(
            """
            INSERT INTO core.parties (
                id, party_type, code, name,
                address_line1, address_line2, address_line3, address_line4, pin_code,
                phone, mobile, email,
                opening_balance, opening_type, same_as_billing, is_active,
                created_at, updated_at
            ) VALUES (
                :id, 'customer', :code, :name,
                :address_line1, :address_line2, :address_line3, :address_line4, :pin_code,
                :phone, :mobile, :email,
                0, 'Dr', true, :is_active,
                NOW(), NOW()
            )
            """
        ),
        payload,
    )


def _bind_sql(schema: str, table: str, columns: list[str], casts: dict[str, str]) -> str:
    cols = ", ".join(_q(name) for name in columns)
    values = ", ".join(
        f"CAST(:{name} AS {casts[name]})" if name in casts else f":{name}" for name in columns
    )
    return f"INSERT INTO {_q(schema)}.{_q(table)} ({cols}) VALUES ({values})"


async def _sync_company_profile(session: AsyncSession) -> None:
    result = await session.execute(
        text(
            """
            SELECT name, address_line1, address_line2, address_line3, address_line4,
                   city, state, pin_code, phone, mobile, email, website, gstin, software_id
            FROM hospital.hospital_profile
            ORDER BY code
            LIMIT 1
            """
        )
    )
    row = result.mappings().first()
    if not row:
        return
    data = dict(row)
    existing = await session.execute(
        text("SELECT id FROM core.company_profile WHERE code = 'MAIN' LIMIT 1")
    )
    company_id = existing.scalar()
    if company_id:
        data["id"] = str(company_id)
        await session.execute(
            text(
                """
                UPDATE core.company_profile SET
                    name = :name,
                    address_line1 = :address_line1,
                    address_line2 = :address_line2,
                    address_line3 = :address_line3,
                    address_line4 = :address_line4,
                    city = :city,
                    state = :state,
                    pin_code = :pin_code,
                    phone = :phone,
                    mobile = :mobile,
                    email = :email,
                    website = :website,
                    gstin = :gstin,
                    software_id = :software_id,
                    updated_at = NOW()
                WHERE id = :id
                """
            ),
            data,
        )
        return
    data["id"] = str(uuid4())
    await session.execute(
        text(
            """
            INSERT INTO core.company_profile (
                id, code, name, address_line1, address_line2, address_line3, address_line4,
                city, state, pin_code, phone, mobile, email, website, gstin, software_id,
                sale_tax_mode, wholesale_tax_mode, purchase_tax_mode, sale_rate_source,
                allow_negative_stock, purchase_bill_parking, unique_barcode_stock, lot_enabled,
                created_at, updated_at
            ) VALUES (
                :id, 'MAIN', :name, :address_line1, :address_line2, :address_line3, :address_line4,
                :city, :state, :pin_code, :phone, :mobile, :email, :website, :gstin, :software_id,
                'inclusive', 'exclusive', 'exclusive', 'product_master',
                true, false, false, false,
                NOW(), NOW()
            )
            """
        ),
        data,
    )


def job_status() -> dict[str, Any]:
    return dict(_job)


def mark_started() -> None:
    _job.update(
        running=True,
        done=False,
        percent=0,
        message="Starting migration…",
        label="",
        table_index=0,
        table_total=0,
        processed=0,
        total=0,
        error=None,
        imported=0,
    )


def public_error(exc: BaseException) -> str:
    """Short error text safe to show. Connection strings stay out of the page."""
    best = ""
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        text_value = str(getattr(current, "orig", "") or "") or str(current)
        if text_value and "password" not in text_value.lower():
            best = text_value
            break
        current = current.__cause__ or current.__context__
    if not best:
        best = "Migration failed."
    best = re.sub(r"password='[^']*'", "password='***'", best)
    return best[:800]


def mark_failed(message: str) -> None:
    _job.update(running=False, done=True, error=message, message=message)


def _remember(event: dict[str, Any]) -> None:
    kind = event.get("type")
    if kind == "progress":
        _job.update(
            running=True,
            done=False,
            percent=int(event.get("percent") or 0),
            message=str(event.get("message") or ""),
            label=str(event.get("label") or ""),
            table_index=int(event.get("table_index") or 0),
            table_total=int(event.get("table_total") or 0),
            processed=int(event.get("processed") or 0),
            total=int(event.get("total") or 0),
            error=None,
        )
    elif kind == "complete":
        _job.update(
            running=False,
            done=True,
            percent=100,
            message=str(event.get("message") or "Migration finished."),
            error=None,
            imported=int(event.get("imported") or 0),
        )
    elif kind == "error":
        mark_failed(str(event.get("message") or "Migration failed."))


async def _emit(progress: ProgressCallback | None, event: dict[str, Any]) -> None:
    _remember(event)
    if progress is not None:
        await progress(event)


def _libpq_conninfo(url: str) -> str:
    parsed = urlparse(_asyncpg_dsn(url))
    database = unquote((parsed.path or "").lstrip("/"))

    def quote(value: str) -> str:
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"

    parts = [
        f"host={quote(parsed.hostname or '127.0.0.1')}",
        f"port={parsed.port or 5432}",
        f"dbname={quote(database)}",
        f"user={quote(unquote(parsed.username or 'postgres'))}",
    ]
    if parsed.password is not None:
        parts.append(f"password={quote(unquote(parsed.password))}")
    return " ".join(parts)


def _sql_type(col: dict[str, Any]) -> str:
    udt = str(col.get("udt_name") or "text")
    if udt == "varchar":
        length = col.get("character_maximum_length")
        return f"varchar({int(length)})" if length else "text"
    if udt == "bpchar":
        length = col.get("character_maximum_length")
        return f"char({int(length)})" if length else "text"
    if udt.startswith("_"):
        inner = _sql_type({**col, "udt_name": udt[1:]})
        return f"{inner}[]"
    mapped = {
        "uuid": "uuid",
        "text": "text",
        "int2": "smallint",
        "int4": "integer",
        "int8": "bigint",
        "bool": "boolean",
        "numeric": "numeric",
        "date": "date",
        "timestamp": "timestamp",
        "timestamptz": "timestamptz",
        "time": "time",
        "timetz": "timetz",
        "interval": "interval",
        "json": "json",
        "jsonb": "jsonb",
        "float4": "real",
        "float8": "double precision",
        "bytea": "bytea",
    }.get(udt)
    if mapped:
        return mapped
    if _IDENT.fullmatch(udt):
        return _q(udt)
    return "text"


def _sql_literal(table: str, column: str, udt: str) -> str | None:
    if table == "ledgers" and column == "group_name":
        return "'General'"
    if table == "ledgers" and column == "opening_type":
        return "'Dr'"
    if table == "payment_modes" and column == "is_credit":
        return "false"
    if udt == "bool":
        return "false"
    if udt in {"int2", "int4", "int8", "numeric", "float4", "float8"}:
        return "0"
    if udt in {"varchar", "text", "bpchar"}:
        return "''"
    return None


async def _ensure_dblink(session: AsyncSession) -> None:
    await session.execute(text("CREATE EXTENSION IF NOT EXISTS dblink"))


async def _remote_count(session: AsyncSession, conninfo: str, schema: str, table: str) -> int:
    query = f"SELECT count(*) FROM {_q(schema)}.{_q(table)}"
    value = await session.execute(
        text("SELECT c FROM dblink(:conn, :query) AS t(c bigint)"),
        {"conn": conninfo, "query": query},
    )
    return int(value.scalar() or 0)


def _source_expr(source_col: dict[str, Any], target_col: dict[str, Any]) -> str:
    ref = f"s.{_q(str(source_col['column_name']))}"
    target_len = target_col.get("character_maximum_length")
    source_len = source_col.get("character_maximum_length")
    target_type = _sql_type(target_col)
    if target_len and (not source_len or int(source_len) > int(target_len)):
        return f"CAST(left(CAST({ref} AS text), {int(target_len)}) AS {target_type})"
    if str(source_col.get("udt_name")) != str(target_col.get("udt_name")):
        return f"CAST({ref} AS {target_type})"
    return ref


async def _copy_chunks(
    session: AsyncSession,
    *,
    conninfo: str,
    source_schema: str,
    table: str,
    remote_cols: list[dict[str, Any]],
    insert_sql: str,
    total: int,
    on_chunk: Callable[[int], Awaitable[None]],
    chunk_size: int = _CHUNK,
) -> int:
    """Insert one table in chunks. insert_sql uses :conn and :query."""
    if total <= 0 or not remote_cols:
        await on_chunk(0)
        return 0
    order_col = "id" if any(str(col["column_name"]) == "id" for col in remote_cols) else "ctid"
    remote_list = ", ".join(_q(str(col["column_name"])) for col in remote_cols)
    defs = ", ".join(
        f"{_q(str(col['column_name']))} {_sql_type(col)}" for col in remote_cols
    )
    statement = insert_sql.replace("__DEFS__", defs)
    step = max(int(chunk_size), 1)
    copied = 0
    offset = 0
    while copied < total:
        limit = min(step, total - copied)
        remote_sql = (
            f"SELECT {remote_list} FROM {_q(source_schema)}.{_q(table)} "
            f"ORDER BY {_q(order_col)} OFFSET {offset} LIMIT {limit}"
        )
        count = await session.execute(
            text(statement),
            {"conn": conninfo, "query": remote_sql},
        )
        got = int(count.scalar() or 0)
        if got <= 0:
            break
        copied += got
        offset += got
        await on_chunk(copied)
        if got < limit:
            break
    return copied


def _fast_plan(
    table: str,
    target_schema: str,
    source_cols: list[dict[str, Any]],
    target_cols: list[dict[str, Any]],
    null_columns: set[str],
) -> tuple[list[dict[str, Any]], str]:
    """Build a set-based INSERT. The SQL contains __DEFS__ and uses :conn, :query."""
    source_by = {str(col["column_name"]): col for col in source_cols}
    renames = {dest: src for src, dest in _RENAMES.get(table, ())}
    remote: list[dict[str, Any]] = []
    seen: set[str] = set()
    insert_cols: list[str] = []
    exprs: list[str] = []

    def take(source_name: str) -> None:
        if source_name not in seen:
            remote.append(source_by[source_name])
            seen.add(source_name)

    for col in target_cols:
        name = str(col["column_name"])
        if name in null_columns:
            insert_cols.append(name)
            exprs.append(f"CAST(NULL AS {_sql_type(col)})")
            continue
        if table == "patients" and name == "party_id":
            insert_cols.append(name)
            exprs.append("np.id")
            continue
        if table == "cashbook_vouchers" and name == "party_id" and name not in source_by:
            insert_cols.append(name)
            exprs.append("pt.party_id")
            continue
        if table == "users" and name == "username" and name not in source_by and "email" in source_by:
            take("email")
            insert_cols.append(name)
            exprs.append("left(split_part(CAST(s.email AS text), '@', 1), 80)")
            continue
        source_name = name if name in source_by else renames.get(name)
        if source_name and source_name in source_by:
            take(source_name)
            expr = _source_expr(source_by[source_name], col)
            if name == "is_party_deposit":
                expr = f"COALESCE({expr}, false)"
            insert_cols.append(name)
            exprs.append(expr)
            continue
        if col.get("column_default") or str(col.get("is_nullable") or "").upper() == "YES":
            continue
        literal = _sql_literal(table, name, str(col.get("udt_name") or ""))
        if literal is None:
            raise ValueError(f"{_label(table)} is missing required column {name}.")
        insert_cols.append(name)
        exprs.append(literal)

    if not remote:
        raise ValueError(f"{_label(table)} has no columns to copy.")

    col_sql = ", ".join(_q(name) for name in insert_cols)
    expr_sql = ", ".join(exprs)
    target_sql = f"{_q(target_schema)}.{_q(table)}"
    if table == "patients":
        def src(column: str, length: int | None = None) -> str:
            if column not in seen:
                return "NULL"
            value = f"CAST(s.{_q(column)} AS text)"
            return f"left({value}, {length})" if length else value

        code_sql = f"left(coalesce({src('patient_no')}, {src('id')}), 40)"
        active_sql = "coalesce(s.is_active, true)" if "is_active" in seen else "true"
        statement = f"""
            WITH src AS (
                SELECT * FROM dblink(:conn, :query) AS s(__DEFS__)
            ),
            np AS (
                INSERT INTO core.parties (
                    id, party_type, code, name,
                    address_line1, address_line2, address_line3, address_line4, pin_code,
                    phone, mobile, email,
                    opening_balance, opening_type, same_as_billing, is_active,
                    created_at, updated_at
                )
                SELECT
                    gen_random_uuid(),
                    'customer',
                    {code_sql},
                    left(coalesce(nullif(trim(concat_ws(' ', {src("first_name")}, {src("middle_name")}, {src("last_name")})), ''), 'Patient'), 200),
                    {src("contact_address1", 200)},
                    {src("contact_address2", 200)},
                    {src("contact_address3", 200)},
                    {src("contact_address4", 200)},
                    {src("contact_address5", 20)},
                    {src("phone", 30)},
                    {src("mobile", 30)},
                    {src("email", 255)},
                    0, 'Dr', true, {active_sql},
                    now(), now()
                FROM src s
                WHERE NOT EXISTS (
                    SELECT 1 FROM core.parties existing
                    WHERE existing.party_type IN ('customer', 'both')
                      AND existing.code = {code_sql}
                )
                RETURNING id, code
            ),
            linked AS (
                SELECT id, code FROM np
                UNION
                SELECT existing.id, existing.code
                FROM core.parties existing
                JOIN src s
                  ON existing.party_type IN ('customer', 'both')
                 AND existing.code = {code_sql}
            ),
            ins AS (
                INSERT INTO {target_sql} ({col_sql})
                SELECT {expr_sql}
                FROM src s
                JOIN linked np ON np.code = {code_sql}
                RETURNING 1
            )
            SELECT count(*) FROM ins
        """
        return remote, statement

    join = ""
    if table == "cashbook_vouchers" and "patient_id" in seen:
        join = "LEFT JOIN hospital.patients pt ON pt.id = s.patient_id"
    statement = f"""
        WITH src AS (
            SELECT * FROM dblink(:conn, :query) AS s(__DEFS__)
        ),
        ins AS (
            INSERT INTO {target_sql} ({col_sql})
            SELECT {expr_sql}
            FROM src s
            {join}
            RETURNING 1
        )
        SELECT count(*) FROM ins
    """
    return remote, statement


async def _restore_self_fks(
    session: AsyncSession,
    *,
    conninfo: str,
    source_schema: str,
    table: str,
    target_schema: str,
    source_cols: list[dict[str, Any]],
    columns: list[str],
) -> None:
    """Put self-references back after the rows exist. Skip ids that were not copied."""
    by_name = {str(col["column_name"]): col for col in source_cols}
    usable = [name for name in columns if name in by_name and "id" in by_name]
    if not usable:
        return
    defs = ", ".join(f"{_q(name)} {_sql_type(by_name[name])}" for name in usable)
    listed = ", ".join(_q(name) for name in usable)
    filled = " OR ".join(f"{_q(name)} IS NOT NULL" for name in usable)
    remote = (
        f"SELECT {_q('id')}, {listed} FROM {_q(source_schema)}.{_q(table)} "
        f"WHERE {filled}"
    )
    joins = " ".join(
        f"LEFT JOIN {_q(target_schema)}.{_q(table)} parent_{index} "
        f"ON parent_{index}.id = s.{_q(name)}"
        for index, name in enumerate(usable)
    )
    # One parent alias is enough when each column is checked on its own.
    assignments = ", ".join(
        f"{_q(name)} = CASE WHEN parent_{index}.id IS NULL THEN NULL ELSE s.{_q(name)} END"
        for index, name in enumerate(usable)
    )
    await session.execute(
        text(
            f"""
            UPDATE {_q(target_schema)}.{_q(table)} AS t
            SET {assignments}
            FROM dblink(:conn, :query) AS s({_q("id")} {_sql_type(by_name["id"])}, {defs})
            {joins}
            WHERE t.id = s.id
            """
        ),
        {"conn": conninfo, "query": remote},
    )


async def _bump_id_sequence(
    session: AsyncSession,
    schema: str,
    table: str,
    target_cols: list[dict[str, Any]],
) -> None:
    id_col = next((col for col in target_cols if str(col["column_name"]) == "id"), None)
    default = str((id_col or {}).get("column_default") or "")
    if "nextval" not in default:
        return
    await session.execute(
        text(
            """
            SELECT CASE
                WHEN pg_get_serial_sequence(:regclass, 'id') IS NULL THEN NULL
                ELSE setval(
                    pg_get_serial_sequence(:regclass, 'id'),
                    COALESCE((SELECT MAX(id) FROM """
            + f"{_q(schema)}.{_q(table)}"
            + """), 1)
                )
            END
            """
        ),
        {"regclass": f"{schema}.{table}"},
    )


async def run_migration(
    *,
    source_url: str,
    selected_keys: list[str],
    replace_existing: bool,
    dry_run: bool,
    app_session: AsyncSession,
    progress: ProgressCallback | None = None,
    commit: bool = True,
    row_limit: int | None = None,
    before_finish: Callable[[AsyncSession, dict[str, Any]], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    if not selected_keys:
        raise ValueError("Select at least one table to copy.")
    dsn = _asyncpg_dsn(source_url)
    if dsn.rstrip("/") == _asyncpg_dsn(display_postgres_url()).rstrip("/"):
        raise ValueError("Source database is the same as this application database.")

    target = await _target_schemas(app_session)
    fks = await _foreign_keys(app_session)
    selected = [key for key in selected_keys if key in target and key not in SKIP_TABLES]
    unknown = [key for key in selected_keys if key not in target]
    if unknown:
        raise ValueError("Unknown table(s): " + ", ".join(unknown))
    if not selected:
        raise ValueError("None of the selected tables exist in this database.")

    order = _insert_order(selected, fks)
    await _emit(
        progress,
        {
            "type": "progress",
            "percent": 1,
            "message": "Reading the previous database…",
            "table_index": 0,
            "table_total": len(order),
            "processed": 0,
            "total": 0,
        },
    )

    source = await asyncpg.connect(dsn, timeout=12)
    results: dict[str, Any] = {}
    try:
        source_schemas = await _source_schemas(source)
        missing_source = [name for name in order if name not in source_schemas]
        if missing_source:
            raise ValueError(
                "Not in the previous database: " + ", ".join(missing_source)
            )

        blocked: set[str] = set()
        for name in list(order):
            for fk in fks:
                parent = str(fk["foreign_table"])
                if parent == "parties" and name == "patients":
                    # Each patient creates its own party during the copy.
                    continue
                if (
                    str(fk["table_name"]) == name
                    and fk["not_null"]
                    and parent != name
                    and parent not in order
                ):
                    blocked.add(name)
                    message = f"Skipped {_label(name)}. It requires {_label(parent)}, which is not selected."
                    results[name] = {
                        "ok": True,
                        "skipped": True,
                        "label": _label(name),
                        "message": message,
                    }
                    await _emit(
                        progress,
                        {
                            "type": "progress",
                            "percent": 0,
                            "message": message,
                            "label": _label(name),
                            "table_index": 0,
                            "table_total": len(order),
                            "processed": 0,
                            "total": 0,
                        },
                    )
                    break
        if blocked:
            order = [name for name in order if name not in blocked]

        await app_session.execute(text("SET LOCAL statement_timeout = 0"))
        if not dry_run and replace_existing:
            await app_session.execute(text("SET LOCAL lock_timeout = '20s'"))
            await _emit(
                progress,
                {
                    "type": "progress",
                    "percent": 0,
                    "message": "Clearing selected tables…",
                    "table_index": 0,
                    "table_total": len(order),
                    "processed": 0,
                    "total": 0,
                },
            )
            await _null_external_fks(app_session, set(order), target, fks)
            selected_set = set(order)
            for fk in fks:
                child = str(fk["table_name"])
                parent = str(fk["foreign_table"])
                if child in selected_set and parent == child:
                    column = str(fk["column_name"])
                    await app_session.execute(
                        text(
                            f"UPDATE {_q(target[child])}.{_q(child)} "
                            f"SET {_q(column)} = NULL WHERE {_q(column)} IS NOT NULL"
                        )
                    )
            for index, name in enumerate(reversed(order), start=1):
                await _emit(
                    progress,
                    {
                        "type": "progress",
                        "percent": 0,
                        "message": f"Clearing {_label(name)}…",
                        "label": _label(name),
                        "table_index": index,
                        "table_total": len(order),
                        "processed": 0,
                        "total": 0,
                    },
                )
                await app_session.execute(
                    text(f"DELETE FROM {_q(target[name])}.{_q(name)}")
                )
            if "patients" in order:
                await _delete_unreferenced_parties(app_session)

        null_columns: dict[str, set[str]] = {}
        for fk in fks:
            child = str(fk["table_name"])
            parent = str(fk["foreign_table"])
            column = str(fk["column_name"])
            if child == "patients" and column == "party_id":
                continue
            if child == "cashbook_vouchers" and column == "party_id" and "patients" in order:
                continue
            if child in order and parent not in order and parent != child and not fk["not_null"]:
                null_columns.setdefault(child, set()).add(column)

        await _ensure_dblink(app_session)
        conninfo = _libpq_conninfo(source_url)
        counts: dict[str, int] = {}
        for index, name in enumerate(order, start=1):
            counts[name] = await _remote_count(
                app_session, conninfo, source_schemas[name], name
            )
            if row_limit:
                counts[name] = min(counts[name], int(row_limit))
            await _emit(
                progress,
                {
                    "type": "progress",
                    "percent": 0,
                    "message": f"Counting {_label(name)}…",
                    "label": _label(name),
                    "table_index": index,
                    "table_total": len(order),
                    "processed": 0,
                    "total": sum(counts.values()),
                },
            )
        grand = sum(counts.values()) or 1
        finished = 0

        for index, name in enumerate(order, start=1):
            info = {
                "key": name,
                "label": _label(name),
                "table_index": index,
                "table_total": len(order),
            }
            total = counts[name]

            async def on_chunk(done_in_table: int, _finished: int = finished, _total: int = total, _name: str = name) -> None:
                processed = _finished + done_in_table
                percent = int(processed * 100 / grand)
                await _emit(
                    progress,
                    {
                        "type": "progress",
                        "percent": min(percent, 99),
                        "message": f"Copying {_label(_name)} ({done_in_table:,} / {_total:,})",
                        "label": _label(name),
                        "table_index": index,
                        "table_total": len(order),
                        "processed": processed,
                        "total": grand,
                    },
                )

            imported = 0
            if not dry_run and total:
                source_cols = await _columns(source, source_schemas[name], name, source=True)
                target_cols = await _columns(app_session, target[name], name, source=False)
                self_fks = [
                    fk
                    for fk in fks
                    if str(fk["table_name"]) == name and str(fk["foreign_table"]) == name
                ]
                nullable_self = [str(fk["column_name"]) for fk in self_fks if not fk["not_null"]]
                required_self = any(fk["not_null"] for fk in self_fks)
                remote_cols, insert_sql = _fast_plan(
                    name,
                    target[name],
                    source_cols,
                    target_cols,
                    set(null_columns.get(name, set())) | set(nullable_self),
                )
                imported = await _copy_chunks(
                    app_session,
                    conninfo=conninfo,
                    source_schema=source_schemas[name],
                    table=name,
                    remote_cols=remote_cols,
                    insert_sql=insert_sql,
                    total=total,
                    on_chunk=on_chunk,
                    chunk_size=total if required_self else _CHUNK,
                )
                if nullable_self:
                    await _restore_self_fks(
                        app_session,
                        conninfo=conninfo,
                        source_schema=source_schemas[name],
                        table=name,
                        target_schema=target[name],
                        source_cols=source_cols,
                        columns=nullable_self,
                    )
                await _bump_id_sequence(app_session, target[name], name, target_cols)
            else:
                await on_chunk(0)
            finished += total
            results[name] = {
                "ok": True,
                "label": _label(name),
                "source_rows": total,
                "imported": imported,
                "dry_run": dry_run,
            }
            await _emit(progress, {"type": "table_done", "ok": True, **info, **results[name]})

        if not dry_run and "hospital_profile" in order:
            await _sync_company_profile(app_session)

        imported_rows = sum(int(item.get("imported") or 0) for item in results.values())
        skipped = [str(item.get("message") or "") for item in results.values() if item.get("skipped")]
        if dry_run:
            message = "Dry run finished. Nothing was saved."
        else:
            message = f"Copy finished. {imported_rows:,} rows saved."
        if skipped:
            message = f"{message} {' '.join(skipped)}"
        summary = {
            "ok": True,
            "dry_run": dry_run,
            "replace_existing": replace_existing,
            "tables": results,
            "imported": imported_rows,
            "message": message,
        }
        if before_finish is not None:
            await before_finish(app_session, summary)
        if dry_run or not commit:
            await app_session.rollback()
            if not dry_run and not commit:
                summary["message"] = "Copy checked and rolled back."
        else:
            await app_session.commit()
        await _emit(progress, {"type": "complete", **summary})
        return summary
    except Exception as exc:
        await app_session.rollback()
        detail = public_error(exc)
        mark_failed(detail)
        _logger.error("Previous-version copy failed: %s", detail)
        raise
    finally:
        await source.close()
