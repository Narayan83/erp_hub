"""Add GenERP columns that create_all will not alter onto an existing database.

The platform app creates tables once. Later model fields (multi_barcode,
barcode_piece_qty, and the same generation of stock columns) must be applied
here. modules/generp/ge/main.py is not the process that serves this product.
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

SCHEMA = "generp"

# (table, column, ddl) — identifiers are fixed literals, not request data.
_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("products", "own_barcode", "BOOLEAN DEFAULT FALSE"),
    ("products", "multi_barcode", "BOOLEAN DEFAULT FALSE"),
    ("products", "barcode_piece_qty", "NUMERIC(14, 3) DEFAULT 1"),
    ("products", "max_discount_pct", "NUMERIC(6, 2) DEFAULT 0"),
    ("products", "moq", "NUMERIC(14, 3) DEFAULT 0"),
    ("product_barcodes", "mrp", "NUMERIC(14, 2)"),
    ("product_barcodes", "kind", "VARCHAR(20) DEFAULT 'company'"),
    ("vouchers", "is_parked", "BOOLEAN DEFAULT FALSE"),
    ("voucher_items", "mrp", "NUMERIC(14, 2) DEFAULT 0"),
    ("voucher_items", "sale_price", "NUMERIC(14, 2) DEFAULT 0"),
    ("voucher_items", "profit_pct", "NUMERIC(8, 2) DEFAULT 0"),
    ("voucher_items", "lot_id", "UUID"),
    ("voucher_items", "stock_barcode_id", "UUID"),
    ("stock_voucher_items", "lot_id", "UUID"),
)


async def ensure_generp_columns(conn: AsyncConnection) -> None:
    present = {
        row[0]
        for row in (
            await conn.execute(
                text(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = :schema
                    """
                ),
                {"schema": SCHEMA},
            )
        ).all()
    }
    for table, column, ddl in _COLUMNS:
        if table not in present:
            continue
        await conn.execute(
            text(f'ALTER TABLE "{SCHEMA}"."{table}" ADD COLUMN IF NOT EXISTS {column} {ddl}')
        )

    if "products" in present:
        await conn.execute(
            text(f'UPDATE "{SCHEMA}".products SET own_barcode = FALSE WHERE own_barcode IS NULL')
        )
        await conn.execute(
            text(
                f'UPDATE "{SCHEMA}".products SET multi_barcode = FALSE WHERE multi_barcode IS NULL'
            )
        )
        await conn.execute(
            text(
                f'UPDATE "{SCHEMA}".products SET barcode_piece_qty = 1 '
                f"WHERE barcode_piece_qty IS NULL OR barcode_piece_qty <= 0"
            )
        )
        await conn.execute(
            text(
                f'UPDATE "{SCHEMA}".products SET max_discount_pct = 0 WHERE max_discount_pct IS NULL'
            )
        )
        await conn.execute(text(f'UPDATE "{SCHEMA}".products SET moq = 0 WHERE moq IS NULL'))
    if "product_barcodes" in present:
        await conn.execute(
            text(
                f"UPDATE \"{SCHEMA}\".product_barcodes SET kind = 'company' "
                "WHERE kind IS NULL OR kind = ''"
            )
        )
    if "vouchers" in present:
        await conn.execute(
            text(f'UPDATE "{SCHEMA}".vouchers SET is_parked = FALSE WHERE is_parked IS NULL')
        )
