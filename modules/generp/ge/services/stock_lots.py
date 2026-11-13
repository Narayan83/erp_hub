"""FIFO stock lots: snapshot MRP/sale rates on inward, consume oldest first."""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.models.masters import Product
from modules.generp.ge.models.stock import StockLot


async def add_lot(
    session: AsyncSession,
    product: Product,
    qty: float,
    lot_date: date | None = None,
    *,
    source_type: str = "OPENING",
    source_id: str | None = None,
    cost: float | None = None,
    sale_rate: float | None = None,
    wholesale_rate: float | None = None,
    mrp: float | None = None,
) -> StockLot | None:
    qty = round(float(qty or 0), 3)
    if qty <= 0:
        return None
    lot = StockLot(
        product_id=product.id,
        lot_date=lot_date or date.today(),
        qty_in=qty,
        qty_remaining=qty,
        cost=float(cost if cost is not None else product.purchase_price or 0),
        sale_rate=float(sale_rate if sale_rate is not None else product.sale_price or 0),
        wholesale_rate=float(
            wholesale_rate if wholesale_rate is not None else product.wholesale_price or 0
        ),
        mrp=float(mrp if mrp is not None else product.mrp or 0),
        source_type=source_type,
        source_id=source_id,
    )
    session.add(lot)
    await session.flush()
    return lot


async def peek_fifo(session: AsyncSession, product_id: str) -> StockLot | None:
    return (
        await session.execute(
            select(StockLot)
            .where(StockLot.product_id == product_id, StockLot.qty_remaining > 0)
            .order_by(StockLot.lot_date.asc(), StockLot.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def consume_fifo(session: AsyncSession, product_id: str, qty: float) -> None:
    remaining = round(float(qty or 0), 3)
    if remaining <= 0:
        return
    lots = (
        await session.execute(
            select(StockLot)
            .where(StockLot.product_id == product_id, StockLot.qty_remaining > 0)
            .order_by(StockLot.lot_date.asc(), StockLot.created_at.asc(), StockLot.id.asc())
            .with_for_update()
        )
    ).scalars().all()
    for lot in lots:
        take = min(float(lot.qty_remaining or 0), remaining)
        if take <= 0:
            continue
        lot.qty_remaining = round(float(lot.qty_remaining or 0) - take, 3)
        remaining = round(remaining - take, 3)
        if remaining <= 0:
            return


async def restore_fifo(session: AsyncSession, product_id: str, qty: float) -> None:
    """Put qty back onto the newest lots that still have room (qty_remaining < qty_in)."""
    remaining = round(float(qty or 0), 3)
    if remaining <= 0:
        return
    lots = (
        await session.execute(
            select(StockLot)
            .where(StockLot.product_id == product_id)
            .order_by(StockLot.lot_date.desc(), StockLot.created_at.desc(), StockLot.id.desc())
            .with_for_update()
        )
    ).scalars().all()
    for lot in lots:
        room = round(float(lot.qty_in or 0) - float(lot.qty_remaining or 0), 3)
        if room <= 0:
            continue
        take = min(room, remaining)
        lot.qty_remaining = round(float(lot.qty_remaining or 0) + take, 3)
        remaining = round(remaining - take, 3)
        if remaining <= 0:
            return
    if remaining > 0:
        product = await session.get(Product, product_id)
        if product:
            await add_lot(session, product, remaining, date.today(), source_type="RESTORE")


async def reverse_source_lots(
    session: AsyncSession, source_id: str | None, product_id: str, qty: float
) -> None:
    """Undo an inbound lot for a cancelled voucher (reduce remaining, then qty_in)."""
    if not source_id:
        await consume_fifo(session, product_id, qty)
        return
    remaining = round(float(qty or 0), 3)
    if remaining <= 0:
        return
    lots = (
        await session.execute(
            select(StockLot)
            .where(StockLot.source_id == source_id, StockLot.product_id == product_id)
            .order_by(StockLot.lot_date.desc(), StockLot.created_at.desc(), StockLot.id.desc())
            .with_for_update()
        )
    ).scalars().all()
    for lot in lots:
        take = min(float(lot.qty_remaining or 0), remaining)
        lot.qty_remaining = round(float(lot.qty_remaining or 0) - take, 3)
        remaining = round(remaining - take, 3)
        if remaining <= 0:
            return
    if remaining > 0:
        await consume_fifo(session, product_id, remaining)


async def seed_missing_opening_lots(session: AsyncSession) -> int:
    """When FIFO is first enabled, snapshot current stock at current master rates."""
    products = (
        await session.execute(select(Product).where(Product.is_active.is_(True)))
    ).scalars().all()
    created = 0
    for product in products:
        stock = float(product.current_stock or 0)
        if stock <= 0.001:
            continue
        qty_rows = (
            await session.execute(
                select(StockLot.qty_remaining).where(StockLot.product_id == product.id)
            )
        ).scalars().all()
        already = sum(float(q or 0) for q in qty_rows)
        gap = round(stock - already, 3)
        if gap > 0.001:
            await add_lot(session, product, gap, date.today(), source_type="OPENING")
            created += 1
    return created
