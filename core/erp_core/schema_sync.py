"""Add columns that create_all will not alter onto an existing database."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from erp_core.pg_schema import SCHEMA_CORE

# (table, column, ddl) — tables live in the core schema
_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("menus", "module", "VARCHAR(40) NOT NULL DEFAULT 'core'"),
    ("company_profile", "address_line4", "VARCHAR(200)"),
    ("company_profile", "software_id", "VARCHAR(50)"),
    ("company_profile", "sale_tax_mode", "VARCHAR(20) DEFAULT 'inclusive'"),
    ("company_profile", "wholesale_tax_mode", "VARCHAR(20) DEFAULT 'exclusive'"),
    ("company_profile", "purchase_tax_mode", "VARCHAR(20) DEFAULT 'exclusive'"),
    ("company_profile", "sale_rate_source", "VARCHAR(20) DEFAULT 'product_master'"),
    ("company_profile", "allow_negative_stock", "BOOLEAN DEFAULT TRUE"),
    ("company_profile", "purchase_bill_parking", "BOOLEAN DEFAULT FALSE"),
    ("company_profile", "unique_barcode_stock", "BOOLEAN DEFAULT FALSE"),
    ("company_profile", "lot_enabled", "BOOLEAN DEFAULT FALSE"),
    ("company_profile", "package_menu_codes", "JSONB"),
    ("parties", "address_line4", "VARCHAR(200)"),
    ("parties", "shipping_address_line1", "VARCHAR(200)"),
    ("parties", "shipping_address_line2", "VARCHAR(200)"),
    ("parties", "shipping_address_line3", "VARCHAR(200)"),
    ("parties", "shipping_address_line4", "VARCHAR(200)"),
    ("parties", "shipping_city", "VARCHAR(100)"),
    ("parties", "shipping_state", "VARCHAR(100)"),
    ("parties", "shipping_pin_code", "VARCHAR(20)"),
    ("parties", "same_as_billing", "BOOLEAN DEFAULT TRUE"),
    ("parties", "image_path", "VARCHAR(300)"),
)


def _qualified(table: str) -> str:
    return f'"{SCHEMA_CORE}"."{table}"'


async def ensure_added_columns(conn: AsyncConnection) -> None:
    for table, column, ddl in _COLUMNS:
        await conn.execute(
            text(f"ALTER TABLE {_qualified(table)} ADD COLUMN IF NOT EXISTS {column} {ddl}")
        )
    await conn.execute(
        text(
            f'CREATE INDEX IF NOT EXISTS ix_menus_module ON {_qualified("menus")} (module)'
        )
    )
