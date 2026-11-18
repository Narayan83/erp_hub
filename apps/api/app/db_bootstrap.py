"""Create PostgreSQL database if missing (customer first-run)."""
from __future__ import annotations

import logging
from urllib.parse import urlparse

import asyncpg

logger = logging.getLogger(__name__)


def _parse_database_url(raw_url: str) -> tuple[str, int, str, str, str]:
    normalized = raw_url.replace("postgresql+asyncpg://", "postgresql://")
    parsed = urlparse(normalized)
    host = parsed.hostname or "127.0.0.1"
    if host == "localhost":
        host = "127.0.0.1"
    port = parsed.port or 5432
    user = parsed.username or "postgres"
    password = parsed.password or ""
    db_name = (parsed.path or "/erp_platform").lstrip("/") or "erp_platform"
    return host, port, user, password, db_name


async def ensure_database_exists(database_url: str) -> None:
    """Connect to postgres DB and CREATE DATABASE if it does not exist."""
    host, port, user, password, db_name = _parse_database_url(database_url)
    conn = await asyncpg.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database="postgres",
        ssl=False,
    )
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", db_name)
        if exists:
            logger.info("Database '%s' already exists.", db_name)
            return
        await conn.execute(f'CREATE DATABASE "{db_name}"')
        logger.info("Database '%s' created.", db_name)
    finally:
        await conn.close()
