"""Resolve sale/MRP: scanned barcode first, else company FIFO or product master."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.models.masters import CompanyProfile, ProductBarcode
from modules.generp.ge.schemas.masters import ProductOut
from modules.generp.ge.services.stock_lots import peek_fifo

SALE_RATE_MASTER = "product_master"
SALE_RATE_FIFO = "fifo"
SALE_RATE_SOURCES = (SALE_RATE_MASTER, SALE_RATE_FIFO)


async def company_sale_rate_source(session: AsyncSession) -> str:
    profile = (
        await session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
    ).scalar_one_or_none()
    raw = (getattr(profile, "sale_rate_source", None) or SALE_RATE_MASTER).strip().lower()
    return raw if raw in SALE_RATE_SOURCES else SALE_RATE_MASTER


def apply_barcode_rates(
    out: ProductOut,
    alt: ProductBarcode | None,
    decoded_mrp: float | None,
) -> set[str]:
    """Overlay rates from a barcode row / encoded MRP. Returns fields that were set."""
    set_fields: set[str] = set()
    if alt:
        if alt.sale_rate is not None:
            out.sale_price = float(alt.sale_rate)
            set_fields.add("sale_price")
        if alt.ws_rate is not None:
            out.wholesale_price = float(alt.ws_rate)
            set_fields.add("wholesale_price")
        if alt.mrp is not None:
            out.mrp = float(alt.mrp)
            set_fields.add("mrp")
        kind = (getattr(alt, "kind", None) or "company").lower()
        if kind == "own" and "sale_price" not in set_fields:
            # Shop sticker price is the printed MRP unless a separate sale rate was saved.
            price = float(alt.mrp if alt.mrp is not None else decoded_mrp or 0)
            if price > 0:
                out.sale_price = price
                set_fields.add("sale_price")
            if "mrp" not in set_fields and price > 0:
                out.mrp = price
                set_fields.add("mrp")
    if decoded_mrp is not None:
        if "mrp" not in set_fields:
            out.mrp = float(decoded_mrp)
            set_fields.add("mrp")
        if "sale_price" not in set_fields:
            out.sale_price = float(decoded_mrp)
            set_fields.add("sale_price")
    return set_fields


async def apply_fallback_rates(
    session: AsyncSession, out: ProductOut, set_fields: set[str]
) -> ProductOut:
    source = await company_sale_rate_source(session)
    if source != SALE_RATE_FIFO:
        return out
    lot = await peek_fifo(session, out.id)
    if not lot:
        return out
    if "sale_price" not in set_fields and float(lot.sale_rate or 0) > 0:
        out.sale_price = float(lot.sale_rate)
    if "wholesale_price" not in set_fields and float(lot.wholesale_rate or 0) > 0:
        out.wholesale_price = float(lot.wholesale_rate)
    if "mrp" not in set_fields and float(lot.mrp or 0) > 0:
        out.mrp = float(lot.mrp)
    return out
