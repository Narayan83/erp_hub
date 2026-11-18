"""PostgreSQL schema layout: core + one schema per product.

Tables are assigned by the model class module path:
  erp_core.models.*          -> schema "core"
  modules.<product>.*        -> schema "<product>"

Call apply_postgres_schemas() after all models are imported and before create_all.
"""
from __future__ import annotations

import logging
from typing import Iterable

from sqlalchemy import MetaData, Table, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import DeclarativeBase

logger = logging.getLogger(__name__)

SCHEMA_CORE = "core"
PRODUCT_SCHEMAS: tuple[str, ...] = (
    "hospital",
    "generp",
    "lodge",
    "kramcop",
    "contract_farming",
)
ALL_SCHEMAS: tuple[str, ...] = (SCHEMA_CORE, *PRODUCT_SCHEMAS)


def schema_for_module(module_name: str) -> str | None:
    if module_name.startswith("erp_core.models"):
        return SCHEMA_CORE
    for product in PRODUCT_SCHEMAS:
        if module_name.startswith(f"modules.{product}"):
            return product
    return None


def schemas_for_enabled_modules(module_names: Iterable[str]) -> list[str]:
    """Schemas to CREATE for this install (always includes core)."""
    wanted = {SCHEMA_CORE}
    for name in module_names:
        if name == "core":
            continue
        if name in PRODUCT_SCHEMAS:
            wanted.add(name)
    return [s for s in ALL_SCHEMAS if s in wanted]


def _rebind_table(metadata: MetaData, table: Table, schema: str) -> None:
    if table.schema == schema:
        return
    if table.key in metadata.tables:
        metadata.remove(table)
    table.schema = schema
    metadata._add_table(table.name, schema, table)


def _rewrite_foreign_keys(metadata: MetaData) -> None:
    """Point bare ForeignKey targets at the table's assigned schema."""
    from sqlalchemy.sql.schema import ForeignKeyTarget

    by_name: dict[str, Table] = {}
    for table in metadata.tables.values():
        # Last wins if duplicate names ever appear; product installs import one product.
        by_name[table.name] = table

    for table in metadata.tables.values():
        for fk in table.foreign_keys:
            tokens = getattr(fk, "_given_tokens", None)
            if tokens is None:
                continue
            schema = getattr(tokens, "schema", None)
            ref_table_name = getattr(tokens, "table_name", None)
            ref_col = getattr(tokens, "column_name", None)
            if not ref_table_name or not ref_col:
                continue
            if schema:
                continue
            ref_table = by_name.get(ref_table_name)
            if ref_table is None or not ref_table.schema:
                continue
            fk._given_tokens = ForeignKeyTarget(
                schema=ref_table.schema,
                table_name=ref_table_name,
                column_name=ref_col,
            )
            # Clear any cached resolution so DDL uses the new target.
            if hasattr(fk, "_column"):
                fk.__dict__.pop("_column", None)


def apply_postgres_schemas(base: type[DeclarativeBase]) -> dict[str, str]:
    """Assign schema on each mapped table; return {table_name: schema}."""
    owned: dict[int, str] = {}
    for mapper in base.registry.mappers:
        cls = mapper.class_
        schema = schema_for_module(cls.__module__ or "")
        if not schema:
            continue
        local = mapper.local_table
        if local is None:
            continue
        owned[id(local)] = schema

    assigned: dict[str, str] = {}
    metadata = base.metadata
    for table in list(metadata.tables.values()):
        schema = owned.get(id(table))
        if not schema:
            continue
        _rebind_table(metadata, table, schema)
        assigned[table.name] = schema

    _rewrite_foreign_keys(metadata)

    by_schema: dict[str, list[str]] = {}
    for name, schema in sorted(assigned.items()):
        by_schema.setdefault(schema, []).append(name)
    for schema, names in sorted(by_schema.items()):
        logger.info("Schema %s: %d tables (%s)", schema, len(names), ", ".join(names[:8]) + ("..." if len(names) > 8 else ""))

    return assigned


def create_schemas(connection: Connection, schemas: Iterable[str]) -> None:
    for schema in schemas:
        connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
        logger.info("Ensured schema %s", schema)


# Known product tables (for moving leftovers when that product is not imported).
_ORPHAN_TABLE_SCHEMA: dict[str, str] = {
    # generp
    "sale_entry_config": "generp",
    "gst_rates": "generp",
    "categories": "generp",
    "sub_categories": "generp",
    "products": "generp",
    "product_images": "generp",
    "shop_banners": "generp",
    "product_barcodes": "generp",
    "branches": "generp",
    "stock_vouchers": "generp",
    "stock_voucher_items": "generp",
    "lot_masters": "generp",
    "stock_barcodes": "generp",
    "stock_barcode_moves": "generp",
    "stock_lots": "generp",
    "stock_movements": "generp",
    "vouchers": "generp",
    "voucher_items": "generp",
    "voucher_payments": "generp",
    "document_sequences": "generp",
    "document_number_rules": "generp",
    "voucher_entries": "generp",
    "orders": "generp",
    "order_items": "generp",
    "discount_schemes": "generp",
    "generp_dashboard_shortcuts": "generp",
    "audit_logs": "generp",
}


def _schema_for_orphan_table(table_name: str) -> str | None:
    if table_name in _ORPHAN_TABLE_SCHEMA:
        return _ORPHAN_TABLE_SCHEMA[table_name]
    if table_name.startswith("cf_"):
        return "contract_farming"
    if table_name.startswith("kc_"):
        return "kramcop"
    return None


def _move_public_table(connection: Connection, table_name: str, schema: str) -> None:
    exists_public = connection.execute(
        text(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = :table_name
            """
        ),
        {"table_name": table_name},
    ).scalar()
    if not exists_public:
        return

    exists_target = connection.execute(
        text(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = :schema AND table_name = :table_name
            """
        ),
        {"schema": schema, "table_name": table_name},
    ).scalar()
    if exists_target:
        logger.warning(
            "Skip move public.%s -> %s.%s (target already exists)",
            table_name,
            schema,
            table_name,
        )
        return

    connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
    connection.execute(text(f'ALTER TABLE public."{table_name}" SET SCHEMA "{schema}"'))
    logger.info("Moved public.%s -> %s.%s", table_name, schema, table_name)


def migrate_public_tables_to_schemas(
    connection: Connection,
    table_schemas: dict[str, str],
) -> None:
    """Move leftover public.<table> into the target schema (existing installs)."""
    planned = dict(table_schemas)
    # Also sweep known orphans left by other products in public.
    public_rows = connection.execute(
        text(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            """
        )
    ).fetchall()
    for row in public_rows:
        name = row[0]
        if name in planned:
            continue
        orphan_schema = _schema_for_orphan_table(name)
        if orphan_schema:
            planned[name] = orphan_schema

    for table_name, schema in sorted(planned.items()):
        if schema == "public":
            continue
        _move_public_table(connection, table_name, schema)
