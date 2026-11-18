"""Load a Kramcop pg_dump into the shared ERP database (kc_* tables).

Usage (from repo root, API venv):
    python scripts/import_kramcop_dump.py
    python scripts/import_kramcop_dump.py D:\\databases\\krampcop.sql
"""

from __future__ import annotations

import asyncio
import sys
from datetime import date, datetime
from pathlib import Path

import asyncpg

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO), str(REPO / "core"), str(REPO / "apps" / "api")]

DEFAULT_DUMP = Path(r"D:\databases\krampcop.sql")
DATABASE = "postgresql://postgres:postpass@127.0.0.1:5432/erp_platform"

# Dump table -> hub table. Users stay on the shared users table.
TABLE_MAP = {
    "app_settings": "kc_app_settings",
    "audit_logs": "kc_audit_logs",
    "categories": "kc_categories",
    "company": "kc_company",
    "members": "kc_members",
    "role_menus": "kc_role_menus",
    "roles": "kc_roles",
    "share_types": "kc_share_types",
    "transactions": "kc_transactions",
    "user_roles": "kc_user_roles",
    "users": "users",
}

# Original sidebar keys -> hub menu codes.
MENU_KEY_MAP = {
    "dashboard": "dashboard",
    "customers": "customer_master",
    "categories": "category_master",
    "share-types": "share_type_master",
    "transactions": "share_entry",
    "schedule": "share_schedule",
    "share-summary": "share_summary",
    "labels": "address_labels",
    "category-members": "category_members",
    "users": "user_addition_modification",
    "roles": "kc_roles",
    "audit": "kc_audit",
    "settings": "society_profile",
}

INSERT_ORDER = [
    "categories",
    "share_types",
    "company",
    "app_settings",
    "roles",
    "members",
    "transactions",
    "role_menus",
    "users",
    "user_roles",
    "audit_logs",
]

BOOL = {
    "is_default",
    "is_active",
    "closed",
    "can_view",
    "can_add",
    "can_edit",
    "can_delete",
}
INT_BY_TABLE = {
    "members": {"acno", "share_type_code"},
    "share_types": {"code", "legacy_code"},
    "transactions": {"acno", "typ", "drcr", "share_count"},
}
FLOAT = {"amount"}
DATE = {"txn_date"}
TS = {"created_at", "updated_at"}


def unescape_field(raw: str):
    if raw == r"\N":
        return None
    out: list[str] = []
    i = 0
    while i < len(raw):
        ch = raw[i]
        if ch != "\\":
            out.append(ch)
            i += 1
            continue
        if i + 1 >= len(raw):
            out.append("\\")
            break
        nxt = raw[i + 1]
        mapped = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "\\": "\\", "v": "\v"}
        if nxt in mapped:
            out.append(mapped[nxt])
            i += 2
            continue
        if nxt.isdigit():
            octal = nxt
            j = i + 2
            while j < len(raw) and len(octal) < 3 and raw[j].isdigit():
                octal += raw[j]
                j += 1
            out.append(chr(int(octal, 8)))
            i = j
            continue
        out.append(nxt)
        i += 2
    return "".join(out)


def parse_copy_blocks(path: Path) -> dict[str, tuple[list[str], list[list]]]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    blocks: dict[str, tuple[list[str], list[list]]] = {}
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.startswith("COPY public."):
            i += 1
            continue
        head = line[len("COPY public.") :]
        table, rest = head.split(" (", 1)
        cols = rest.split(")", 1)[0].split(", ")
        rows: list[list] = []
        i += 1
        buf = ""
        while i < len(lines):
            piece = lines[i]
            i += 1
            buf = piece if not buf else buf + "\n" + piece
            if _copy_record_complete(buf):
                if buf == r"\.":
                    break
                rows.append([unescape_field(part) for part in buf.split("\t")])
                buf = ""
        blocks[table] = (cols, rows)
    return blocks


def _copy_record_complete(buf: str) -> bool:
    """A COPY text row ends on a newline that is not backslash-escaped."""
    if buf == r"\.":
        return True
    escapes = 0
    for ch in reversed(buf):
        if ch == "\\":
            escapes += 1
        else:
            break
    return escapes % 2 == 0


def coerce(table: str, column: str, value):
    if value is None:
        return None
    if column in BOOL:
        return value in ("t", "true", "True", "1")
    if column in INT_BY_TABLE.get(table, set()):
        if value == "":
            return None
        return int(value)
    if column in FLOAT:
        if value == "":
            return 0.0
        return float(value)
    if column in DATE:
        if value == "":
            return None
        return date.fromisoformat(value[:10])
    if column in TS:
        if value == "":
            return None
        raw = value.replace(" ", "T")
        if raw.endswith("+05:30"):
            raw = raw[:-6] + "+05:30"
        return datetime.fromisoformat(raw)
    if column == "user_id" and value == "":
        return ""
    return value


def prepare_rows(table: str, cols: list[str], rows: list[list]) -> list[tuple]:
    prepared = []
    key_idx = cols.index("menu_key") if table == "role_menus" and "menu_key" in cols else None
    for row in rows:
        if len(row) != len(cols):
            raise SystemExit(f"{table}: expected {len(cols)} fields, got {len(row)}")
        values = []
        for col, raw in zip(cols, row):
            if key_idx is not None and col == "menu_key" and raw:
                raw = MENU_KEY_MAP.get(raw, raw)
            values.append(coerce(table, col, raw))
        prepared.append(tuple(values))
    return prepared


async def ensure_tables(conn: asyncpg.Connection) -> None:
    exists = await conn.fetchval("SELECT to_regclass('public.kc_members')")
    if exists:
        return
    from erp_core.database import Base, get_engine, init_engine

    import erp_core.models  # noqa: F401
    import modules.kramcop.models  # noqa: F401

    init_engine(DATABASE.replace("postgresql://", "postgresql+asyncpg://", 1))
    engine = get_engine()
    async with engine.begin() as sa_conn:
        await sa_conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    # asyncpg connection is outside that engine; tables are committed.


async def insert_users(conn: asyncpg.Connection, cols: list[str], rows: list[tuple]) -> int:
    inserted = 0
    for row in rows:
        rec = dict(zip(cols, row))
        email = (rec.get("email") or "").lower()
        username = (rec.get("username") or "").strip()
        taken = await conn.fetchval(
            "SELECT 1 FROM users WHERE id = $1 OR lower(email) = lower($2) OR lower(coalesce(username, '')) = lower($3)",
            str(rec["id"]),
            email,
            username,
        )
        if taken:
            continue
        await conn.execute(
            """
            INSERT INTO users (id, username, email, full_name, hashed_password, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()), COALESCE($7, now()))
            """,
            str(rec["id"]),
            username or None,
            email,
            rec.get("full_name") or username or "Administrator",
            rec.get("hashed_password") or "",
            bool(rec.get("is_active", True)),
            rec.get("created_at"),
        )
        inserted += 1
    return inserted


async def load(path: Path) -> None:
    blocks = parse_copy_blocks(path)
    missing = [name for name in INSERT_ORDER if name not in blocks]
    if missing:
        raise SystemExit(f"Dump is missing COPY blocks: {', '.join(missing)}")

    conn = await asyncpg.connect(DATABASE)
    try:
        await ensure_tables(conn)
        await conn.execute(
            """
            TRUNCATE
                kc_transactions,
                kc_members,
                kc_role_menus,
                kc_user_roles,
                kc_audit_logs,
                kc_categories,
                kc_share_types,
                kc_roles,
                kc_company,
                kc_app_settings
            RESTART IDENTITY CASCADE
            """
        )
        counts: dict[str, int] = {}
        async with conn.transaction():
            for name in INSERT_ORDER:
                cols, raw_rows = blocks[name]
                rows = prepare_rows(name, cols, raw_rows)
                if name == "users":
                    counts[name] = await insert_users(conn, cols, rows)
                    continue
                if not rows:
                    counts[name] = 0
                    continue
                target = TABLE_MAP[name]
                await conn.copy_records_to_table(
                    target,
                    records=rows,
                    columns=cols,
                )
                counts[name] = len(rows)
            await conn.execute(
                """
                UPDATE kc_transactions SET kind = CASE
                    WHEN typ IN (85, 86, 87, 88) AND drcr IN (3, 4) THEN 'share_deletion'
                    WHEN typ IN (85, 86, 87, 88) THEN 'share_addition'
                    ELSE kind
                END
                WHERE COALESCE(kind, '') IN ('', 'other') AND typ IN (85, 86, 87, 88)
                """
            )
            await conn.execute(
                """
                UPDATE kc_members SET shac = share_no
                WHERE COALESCE(shac, '') = '' AND COALESCE(share_no, '') <> ''
                """
            )
            await conn.execute("UPDATE kc_members SET category = 'G' WHERE COALESCE(category, '') = ''")
        print("Imported from", path)
        for name in INSERT_ORDER:
            print(f"  {TABLE_MAP[name]}: {counts[name]}")
        members = await conn.fetchval("SELECT count(*) FROM kc_members")
        txns = await conn.fetchval("SELECT count(*) FROM kc_transactions")
        adds = await conn.fetchval(
            "SELECT count(*) FROM kc_transactions WHERE kind = 'share_addition'"
        )
        dels = await conn.fetchval(
            "SELECT count(*) FROM kc_transactions WHERE kind = 'share_deletion'"
        )
        print(f"check members={members} transactions={txns} additions={adds} deletions={dels}")
    finally:
        await conn.close()


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DUMP
    if not path.is_file():
        raise SystemExit(f"Dump not found: {path}")
    asyncio.run(load(path))


if __name__ == "__main__":
    main()
