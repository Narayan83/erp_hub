"""Block outbound stock when company profile disallows negative stock."""

from __future__ import annotations

from collections.abc import Iterable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.models.masters import CompanyProfile, Product


async def lock_products(session: AsyncSession, product_ids: Iterable[str | None]) -> dict[str, Product]:
    """Lock product rows in a stable order so concurrent bills/modifies cannot lose stock updates."""
    ids = sorted({str(pid) for pid in product_ids if pid})
    if not ids:
        return {}
    rows = (
        await session.execute(
            select(Product).where(Product.id.in_(ids)).order_by(Product.id).with_for_update()
        )
    ).scalars().all()
    return {p.id: p for p in rows}


async def allow_negative_stock(session: AsyncSession) -> bool:
    profile = (
        await session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
    ).scalar_one_or_none()
    if profile is None:
        return True
    return bool(getattr(profile, "allow_negative_stock", True))


async def assert_stock_available(
    session: AsyncSession,
    product: Product,
    qty_out: float,
) -> None:
    qty = float(qty_out or 0)
    if qty <= 0.001:
        return
    if await allow_negative_stock(session):
        return
    available = float(product.current_stock or 0)
    if available + 1e-9 < qty:
        code = (product.code or "").strip()
        name = (product.name or "product").strip()
        label = f"{code} {name}".strip()
        raise HTTPException(
            status_code=400,
            detail=(
                f"Insufficient stock for {label}. Available {available:g}, required {qty:g}. "
                "Negative stock is not allowed (Software Setup)."
            ),
        )
