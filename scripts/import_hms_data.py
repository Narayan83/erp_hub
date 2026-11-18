"""Copy hospital data from the standalone HMS database into erp_platform.

Shared login, menu, and role rows stay as they are. The HMS admin user id is
rewritten to the hospital admin already in this database. Ledger codes that
already exist here are reused instead of inserted again.

Usage (API venv, from the repo root):
    python scripts/import_hms_data.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path

import asyncpg

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO), str(REPO / "core"), str(REPO / "apps" / "api")]

SRC = "postgresql://postgres:postpass@127.0.0.1:5432/hms"
DST = "postgresql://postgres:postpass@127.0.0.1:5432/erp_platform"

# HMS Super Admin -> hospital login in this app.
USER_REMAP = {
    uuid.UUID("e7d2e9d9-39f3-4e9b-9e50-88f7e88c50dc"): uuid.UUID(
        "18d15168-a99b-4a9b-9a60-4ee2a6d7f901"
    )
}
USER_COLUMNS = {"user_id", "created_by_user_id", "scanned_by_user_id", "created_by"}

# Do not replace these. Other products share them.
SKIP = {
    "users",
    "menus",
    "roles",
    "role_menu_permissions",
    "user_role_mappings",
    "user_types",
    "alembic_version",
    "parties",
}
# Insert alongside existing rows. Colliding business codes are remapped.
MERGE = {"ledgers", "payment_modes", "print_configs"}
# Insert after parents exist. Destination is empty.
APPEND = {"cashbook_vouchers", "cashbook_voucher_lines"}


async def table_names(conn: asyncpg.Connection) -> set[str]:
    rows = await conn.fetch(
        """
        SELECT c.relname AS name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        """
    )
    return {r["name"] for r in rows}


async def columns(conn: asyncpg.Connection, table: str) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        SELECT column_name, udt_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
        """,
        table,
    )


def q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


async def main() -> None:
    src = await asyncpg.connect(SRC)
    dst = await asyncpg.connect(DST)
    try:
        common = await table_names(src) & await table_names(dst)
        counts: dict[str, int] = {}
        for name in sorted(common):
            counts[name] = await src.fetchval(f"SELECT count(*) FROM {q(name)}")

        replace = sorted(
            name
            for name, count in counts.items()
            if count and name not in SKIP and name not in MERGE and name not in APPEND
        )
        # Child tables that point at a replaced table must be emptied too,
        # otherwise a replaced parent id would be left dangling.
        fk_rows = await dst.fetch(
            """
            SELECT tc.table_name, ccu.table_name AS foreign_table
            FROM information_schema.table_constraints tc
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
            """
        )
        clear = set(replace)
        changed = True
        while changed:
            changed = False
            for row in fk_rows:
                child, parent = row["table_name"], row["foreign_table"]
                if parent in clear and child not in clear and child not in SKIP and child not in MERGE:
                    clear.add(child)
                    changed = True

        ledger_remap = await _ledger_plan(src, dst)
        mode_remap = await _mode_plan(src, dst)

        print(f"Replacing {len(replace)} hospital tables, clearing {len(clear)} tables")
        print(f"Ledger ids reused: {len(ledger_remap)}")
        print(f"Payment mode ids reused: {len(mode_remap)}")

        async with dst.transaction():
            await dst.execute("SET LOCAL session_replication_role = 'replica'")
            for name in sorted(clear):
                deleted = await dst.execute(f"DELETE FROM {q(name)}")
                print(f"  cleared {name}: {deleted}")

            for name in ("ledgers", "payment_modes", "print_configs"):
                copied = await _copy_merge(src, dst, name, ledger_remap, mode_remap)
                print(f"  merged {name}: {copied}")

            for name in replace:
                if name == "patients":
                    copied = await _copy_patients(src, dst)
                else:
                    copied = await _copy_table(src, dst, name, ledger_remap, mode_remap)
                print(f"  copied {name}: {copied}")

            for name in ("cashbook_vouchers", "cashbook_voucher_lines"):
                copied = await _copy_table(src, dst, name, ledger_remap, mode_remap)
                print(f"  copied {name}: {copied}")

        span = await dst.fetchrow(
            "SELECT min(voucher_date) AS first, max(voucher_date) AS last, count(*) AS n FROM cashbook_vouchers"
        )
        patients = await dst.fetchval("SELECT count(*) FROM patients")
        print(
            f"Done. patients={patients} cashbook={span['n']} "
            f"from {span['first']} to {span['last']}"
        )
    finally:
        await src.close()
        await dst.close()


async def _ledger_plan(src, dst) -> dict:
    src_rows = await src.fetch("SELECT id, code FROM ledgers")
    dst_rows = await dst.fetch("SELECT id, code FROM ledgers")
    by_code = {r["code"]: r["id"] for r in dst_rows}
    remap = {}
    for row in src_rows:
        existing = by_code.get(row["code"])
        if existing is not None and existing != row["id"]:
            remap[row["id"]] = existing
    return remap


async def _mode_plan(src, dst) -> dict:
    src_rows = await src.fetch("SELECT id, code FROM payment_modes")
    dst_rows = await dst.fetch("SELECT id, code FROM payment_modes")
    by_code = {r["code"]: r["id"] for r in dst_rows}
    remap = {}
    for row in src_rows:
        existing = by_code.get(row["code"])
        if existing is not None and existing != row["id"]:
            remap[row["id"]] = existing
    return remap


def _adapt(table: str, column: str, value, ledger_remap: dict, mode_remap: dict):
    if column in USER_COLUMNS and value in USER_REMAP:
        return USER_REMAP[value]
    if column == "ledger_id" and value in ledger_remap:
        return ledger_remap[value]
    if column == "payment_mode_id" and value in mode_remap:
        return mode_remap[value]
    if table == "ledgers" and column == "id" and value in ledger_remap:
        return None
    if table == "payment_modes" and column == "id" and value in mode_remap:
        return None
    return value


async def _copy_table(src, dst, table: str, ledger_remap: dict, mode_remap: dict) -> int:
    src_cols = {r["column_name"] for r in await columns(src, table)}
    dst_cols = await columns(dst, table)
    names = [r["column_name"] for r in dst_cols if r["column_name"] in src_cols]
    required_missing = [
        r["column_name"]
        for r in dst_cols
        if r["column_name"] not in src_cols and r["is_nullable"] == "NO" and not r["column_default"]
    ]
    extras = _extra_values(table, required_missing)
    names = names + [name for name in extras if name not in names]

    rows = await src.fetch(f"SELECT * FROM {q(table)}")
    payload = []
    for row in rows:
        item = []
        skip = False
        for name in names:
            if name in extras and name not in src_cols:
                item.append(extras[name](row))
                continue
            value = _adapt(table, name, row[name], ledger_remap, mode_remap)
            if name == "id" and value is None:
                skip = True
                break
            item.append(value)
        if not skip:
            payload.append(tuple(item))
    if not payload:
        return 0
    await dst.copy_records_to_table(table, records=payload, columns=names)
    return len(payload)


def _extra_values(table: str, required_missing: list[str]) -> dict:
    extras: dict = {}
    if table == "ledgers":
        extras["group_name"] = lambda row: "General"
        extras["opening_type"] = lambda row: "Dr"
        extras["is_party_deposit"] = lambda row: bool(row["is_patient_deposit"])
    if table == "payment_modes":
        extras["is_credit"] = lambda row: "credit" in (row["name"] or "").lower() or (row["code"] or "").upper() == "CREDIT"
    unexpected = [name for name in required_missing if name not in extras]
    if unexpected:
        raise SystemExit(f"{table} needs values for {unexpected}")
    return {name: extras[name] for name in extras if name in required_missing or name in extras}


async def _copy_merge(src, dst, table: str, ledger_remap: dict, mode_remap: dict) -> int:
    return await _copy_table(src, dst, table, ledger_remap, mode_remap)


async def _copy_patients(src, dst) -> int:
    rows = await src.fetch("SELECT * FROM patients")
    src_cols = {r["column_name"] for r in await columns(src, "patients")}
    dst_cols = [r["column_name"] for r in await columns(dst, "patients") if r["column_name"] in src_cols or r["column_name"] == "party_id"]
    if "party_id" not in dst_cols:
        dst_cols.append("party_id")

    existing_codes = {r["code"] for r in await dst.fetch("SELECT code FROM parties")}
    party_records = []
    patient_records = []
    for row in rows:
        party_id = uuid.uuid4()
        code = (row["patient_no"] or str(row["id"]))[:40]
        base = code
        n = 2
        while code in existing_codes:
            suffix = f"-{n}"
            code = f"{base[: 40 - len(suffix)]}{suffix}"
            n += 1
        existing_codes.add(code)
        name = " ".join(
            part for part in (row["first_name"], row["middle_name"], row["last_name"]) if part
        ) or code
        party_records.append(
            (
                party_id,
                "customer",
                code,
                name[:200],
                row["phone"],
                row["mobile"],
                row["email"],
                row["contact_address1"],
                True,
                0,
                "Dr",
                True,
            )
        )
        patient_records.append(tuple(row[name] if name != "party_id" else party_id for name in dst_cols))

    await dst.copy_records_to_table(
        "parties",
        records=party_records,
        columns=[
            "id",
            "party_type",
            "code",
            "name",
            "phone",
            "mobile",
            "email",
            "address_line1",
            "same_as_billing",
            "opening_balance",
            "opening_type",
            "is_active",
        ],
    )
    await dst.copy_records_to_table("patients", records=patient_records, columns=dst_cols)
    return len(patient_records)


if __name__ == "__main__":
    asyncio.run(main())
