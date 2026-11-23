"""Add columns that create_all will not alter onto an existing database."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from erp_core.pg_schema import SCHEMA_CORE

# (table, column, ddl) — tables live in the core schema
_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("menus", "module", "VARCHAR(40) NOT NULL DEFAULT 'core'"),
    ("print_configs", "product", "VARCHAR(40) NOT NULL DEFAULT 'hospital'"),
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


_GENERP_ONLY_PRINT_CODES: tuple[str, ...] = (
    "SALE_BILL",
    "WHOLESALE_BILL",
    "BARCODE_LABEL",
    "PURCHASE_BILL",
    "SALES_RETURN",
    "PURCHASE_RETURN",
    "LEDGER_REPORT",
    "DEBTORS_REPORT",
    "DAILY_COLLECTION_REPORT",
    "TAXWISE_BILL_SUMMARY",
    "TAXWISE_SUMMARY",
)


def _qualified(table: str) -> str:
    return f'"{SCHEMA_CORE}"."{table}"'


async def ensure_added_columns(conn: AsyncConnection) -> None:
    had_print_product = bool(
        (
            await conn.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = :schema
                      AND table_name = 'print_configs'
                      AND column_name = 'product'
                    """
                ),
                {"schema": SCHEMA_CORE},
            )
        ).scalar()
    )

    for table, column, ddl in _COLUMNS:
        await conn.execute(
            text(f"ALTER TABLE {_qualified(table)} ADD COLUMN IF NOT EXISTS {column} {ddl}")
        )
    await conn.execute(
        text(
            f'CREATE INDEX IF NOT EXISTS ix_menus_module ON {_qualified("menus")} (module)'
        )
    )
    # Product-scoped print configs: widen code to match Menu.code (80), tag legacy rows,
    # replace global unique(code) with unique(product, code).
    await conn.execute(
        text(f'ALTER TABLE {_qualified("print_configs")} ALTER COLUMN code TYPE VARCHAR(80)')
    )
    await conn.execute(
        text(
            """
            DO $$
            DECLARE
                r RECORD;
            BEGIN
                FOR r IN
                    SELECT c.conname
                    FROM pg_constraint c
                    JOIN pg_class t ON t.oid = c.conrelid
                    JOIN pg_namespace n ON n.oid = t.relnamespace
                    WHERE n.nspname = 'core'
                      AND t.relname = 'print_configs'
                      AND c.contype = 'u'
                      AND (
                          SELECT array_agg(a.attname::text ORDER BY k.ord)
                          FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                      ) = ARRAY['code']
                LOOP
                    EXECUTE format('ALTER TABLE "core"."print_configs" DROP CONSTRAINT IF EXISTS %I', r.conname);
                END LOOP;

                FOR r IN
                    SELECT i.relname AS idxname
                    FROM pg_index ix
                    JOIN pg_class t ON t.oid = ix.indrelid
                    JOIN pg_class i ON i.oid = ix.indexrelid
                    JOIN pg_namespace n ON n.oid = t.relnamespace
                    WHERE n.nspname = 'core'
                      AND t.relname = 'print_configs'
                      AND ix.indisunique
                      AND NOT ix.indisprimary
                      AND (
                          SELECT array_agg(a.attname::text ORDER BY k.ord)
                          FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
                          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                      ) = ARRAY['code']
                LOOP
                    EXECUTE format('DROP INDEX IF EXISTS "core".%I', r.idxname);
                END LOOP;
            END $$;
            """
        )
    )
    if not had_print_product:
        codes_sql = ", ".join(f"'{c}'" for c in _GENERP_ONLY_PRINT_CODES)
        await conn.execute(
            text(
                f"""
                UPDATE {_qualified("print_configs")}
                SET product = 'generp'
                WHERE product = 'hospital' AND code IN ({codes_sql})
                """
            )
        )
    await conn.execute(
        text(
            f'CREATE INDEX IF NOT EXISTS ix_print_configs_product ON {_qualified("print_configs")} (product)'
        )
    )
    await conn.execute(
        text(
            f'CREATE INDEX IF NOT EXISTS ix_print_configs_code ON {_qualified("print_configs")} (code)'
        )
    )
    await conn.execute(
        text(
            f'CREATE UNIQUE INDEX IF NOT EXISTS uq_print_configs_product_code '
            f'ON {_qualified("print_configs")} (product, code)'
        )
    )
