"""Standalone CLI script to migrate Patient Master (OPDMAST) and IPD Bills (IPDBILL)
from an MS Access (.mdb / .accdb) file into the Hospital PostgreSQL database.

Uses the exact same migration engine as Settings -> Database Migration -> Migrate from MDB.

Examples:
    # Dry run (read-only verification):
    .\\apps\\api\\.venv\\Scripts\\python.exe scripts\\migrate_mdb.py ^
        --mdb "C:\\Users\\Administrator\\Desktop\\KAUMUDI.mdb" ^
        --mdb-password n1y2t3 --password 2015 --dry-run

    # Live migration (append / skip existing):
    .\\apps\\api\\.venv\\Scripts\\python.exe scripts\\migrate_mdb.py ^
        --mdb "C:\\Users\\Administrator\\Desktop\\KAUMUDI.mdb" ^
        --mdb-password n1y2t3 --password 2015

    # Replace existing patients and IPD bills:
    .\\apps\\api\\.venv\\Scripts\\python.exe scripts\\migrate_mdb.py ^
        --mdb "C:\\Users\\Administrator\\Desktop\\KAUMUDI.mdb" ^
        --mdb-password n1y2t3 --password 2015 --replace
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO), str(REPO / "core"), str(REPO / "apps" / "api")]

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import get_settings as get_api_settings
from modules.hospital.hms.api.v1.endpoints.admin import CLEAR_DB_PASSWORD
from modules.hospital.hms.services import mdb_migration as mdb


def _normalize_pg_url(raw: str) -> str:
    url = raw.strip()
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate Patient Master (OPDMAST) and IPD Bill (IPDBILL) from an MS Access MDB file."
    )
    parser.add_argument(
        "--mdb",
        required=True,
        help="Path to the .mdb / .accdb file (e.g. C:\\Users\\Administrator\\Desktop\\KAUMUDI.mdb)",
    )
    parser.add_argument(
        "--mdb-password",
        default=None,
        help="Password of the MS Access MDB file (prompted if omitted)",
    )
    parser.add_argument(
        "--password",
        default=None,
        help="Maintenance migration password (2015; prompted if omitted)",
    )
    parser.add_argument(
        "--tables",
        nargs="+",
        choices=["patients", "ipd_bills"],
        default=["patients", "ipd_bills"],
        help="Tables to migrate (default: patients ipd_bills)",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Truncate/replace existing rows in the selected target tables before importing",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read-only dry run — inspects and counts rows without modifying PostgreSQL",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Target PostgreSQL URL (defaults to DATABASE_URL from apps/api/.env)",
    )
    return parser.parse_args()


async def _run(args: argparse.Namespace) -> int:
    maint_pwd = args.password if args.password is not None else getpass.getpass("Migration password: ")
    if maint_pwd != CLEAR_DB_PASSWORD:
        print("ERROR: Incorrect maintenance migration password.", file=sys.stderr)
        return 1

    mdb_pwd = args.mdb_password if args.mdb_password is not None else getpass.getpass("MDB file password (blank if none): ")
    mdb_path = mdb.resolve_mdb_path(mdb_path=args.mdb)

    db_url = _normalize_pg_url(args.database_url or get_api_settings().database_url)
    print(f"MDB source : {mdb_path}")
    print(f"PostgreSQL : {mdb.display_postgres_url(db_url)}")
    print(f"Tables     : {', '.join(args.tables)}")
    print(f"Mode       : {'DRY RUN' if args.dry_run else ('REPLACE EXISTING' if args.replace else 'APPEND / SKIP EXISTING')}")
    print("-" * 70)

    engine = create_async_engine(db_url, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    last_msg = ""

    async def on_progress(event: dict[str, Any]) -> None:
        nonlocal last_msg
        msg = str(event.get("message") or "")
        pct = event.get("percent")
        if msg and msg != last_msg:
            last_msg = msg
            prefix = f"[{pct:3d}%] " if isinstance(pct, int) else ""
            print(f"{prefix}{msg}", flush=True)

    try:
        async with session_factory() as session:
            await session.execute(text("SET search_path TO hospital, core, public"))
            result = await mdb.run_mdb_migration(
                mdb_path=mdb_path,
                mdb_password=mdb_pwd,
                selected_keys=args.tables,
                replace_existing=args.replace,
                dry_run=args.dry_run,
                app_session=session,
                progress=on_progress,
            )
        print("-" * 70)
        print(json.dumps(result, indent=2, default=str))
        return 0
    finally:
        await engine.dispose()


def main() -> None:
    args = _parse_args()
    code = asyncio.run(_run(args))
    sys.exit(code)


if __name__ == "__main__":
    main()
