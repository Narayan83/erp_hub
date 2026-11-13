"""Sales / purchase order service + convert to trading voucher."""

from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.models.masters import GstRate, Product
from modules.generp.ge.models.orders import ORDER_TYPES, Order, OrderItem
from modules.generp.ge.schemas.stock import OrderIn
from modules.generp.ge.schemas.transactions import VoucherIn, VoucherItemIn
from modules.generp.ge.services.document_numbers import next_document_no, peek_document_no
from modules.generp.ge.services.posting import create_voucher


async def _next_order_no(
    session: AsyncSession, order_type: str, order_date: date | None = None
) -> str:
    return await next_document_no(session, f"ORDER_{order_type}", order_date)


async def peek_next_order_no(
    session: AsyncSession, order_type: str, order_date: date | None = None
) -> tuple[str, str | None]:
    return await peek_document_no(session, f"ORDER_{order_type}", order_date)


async def create_order(session: AsyncSession, data: OrderIn, user_id: str | None) -> Order:
    otype = data.order_type.upper().strip()
    if otype not in ORDER_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid order_type. Allowed: {ORDER_TYPES}")
    if not data.items:
        raise HTTPException(status_code=400, detail="Add at least one item")
    if not data.party_id:
        raise HTTPException(status_code=400, detail="Party is required for orders")

    order_no = await _next_order_no(session, otype, data.order_date)
    order = Order(
        order_type=otype,
        order_no=order_no,
        order_date=data.order_date,
        party_id=data.party_id,
        status="CONFIRMED",
        narration=data.narration,
        discount_scheme_id=data.discount_scheme_id,
        discount_amount=float(data.discount_amount or 0),
        created_by=user_id,
    )
    session.add(order)
    await session.flush()

    gross = 0.0
    tax = 0.0
    for idx, it in enumerate(data.items):
        product = await session.get(Product, it.product_id)
        if not product:
            raise HTTPException(status_code=400, detail=f"Product not found: {it.product_id}")
        gst_rate = 0.0
        if it.gst_id:
            gst = await session.get(GstRate, it.gst_id)
            gst_rate = float(gst.rate or 0) if gst else 0.0
        elif product.gst_id:
            gst = await session.get(GstRate, product.gst_id)
            gst_rate = float(gst.rate or 0) if gst else 0.0
            it.gst_id = product.gst_id

        line_gross = float(it.quantity) * float(it.rate or 0)
        disc = float(it.discount_amount or 0)
        taxable = max(line_gross - disc, 0)
        gst_amt = round(taxable * gst_rate / 100.0, 2)
        amount = round(taxable + gst_amt, 2)
        gross += taxable
        tax += gst_amt
        session.add(
            OrderItem(
                order_id=order.id,
                product_id=it.product_id,
                quantity=float(it.quantity),
                rate=float(it.rate or 0),
                discount_amount=disc,
                gst_id=it.gst_id,
                gst_rate=gst_rate,
                gst_amount=gst_amt,
                taxable_amount=round(taxable, 2),
                amount=amount,
                sort_order=idx,
            )
        )

    bill_disc = float(data.discount_amount or 0)
    order.gross_amount = round(gross, 2)
    order.tax_amount = round(tax, 2)
    order.discount_amount = bill_disc
    order.net_amount = round(max(gross + tax - bill_disc, 0), 2)
    await session.flush()
    return await load_order(session, order.id)


async def load_order(session: AsyncSession, order_id: str) -> Order:
    o = (
        await session.execute(
            select(Order)
            .options(
                selectinload(Order.items).selectinload(OrderItem.product),
                selectinload(Order.party),
            )
            .where(Order.id == order_id)
        )
    ).scalar_one_or_none()
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    return o


async def update_order(session: AsyncSession, order_id: str, data: OrderIn) -> Order:
    o = await load_order(session, order_id)
    if o.is_cancelled:
        raise HTTPException(status_code=400, detail="Cancelled order cannot be updated")
    if o.status in ("FULFILLED", "CANCELLED"):
        raise HTTPException(status_code=400, detail=f"Cannot update order in status {o.status}")
    if o.converted_voucher_id:
        raise HTTPException(status_code=400, detail="Order already converted to voucher")

    # Replace items
    for it in list(o.items):
        await session.delete(it)
    await session.flush()

    o.order_date = data.order_date
    o.party_id = data.party_id
    o.narration = data.narration
    o.discount_scheme_id = data.discount_scheme_id
    o.discount_amount = float(data.discount_amount or 0)

    gross = 0.0
    tax = 0.0
    for idx, it in enumerate(data.items):
        product = await session.get(Product, it.product_id)
        if not product:
            raise HTTPException(status_code=400, detail=f"Product not found: {it.product_id}")
        gst_rate = 0.0
        gst_id = it.gst_id or product.gst_id
        if gst_id:
            gst = await session.get(GstRate, gst_id)
            gst_rate = float(gst.rate or 0) if gst else 0.0
        line_gross = float(it.quantity) * float(it.rate or 0)
        disc = float(it.discount_amount or 0)
        taxable = max(line_gross - disc, 0)
        gst_amt = round(taxable * gst_rate / 100.0, 2)
        amount = round(taxable + gst_amt, 2)
        gross += taxable
        tax += gst_amt
        session.add(
            OrderItem(
                order_id=o.id,
                product_id=it.product_id,
                quantity=float(it.quantity),
                rate=float(it.rate or 0),
                discount_amount=disc,
                gst_id=gst_id,
                gst_rate=gst_rate,
                gst_amount=gst_amt,
                taxable_amount=round(taxable, 2),
                amount=amount,
                sort_order=idx,
            )
        )
    bill_disc = float(data.discount_amount or 0)
    o.gross_amount = round(gross, 2)
    o.tax_amount = round(tax, 2)
    o.discount_amount = bill_disc
    o.net_amount = round(max(gross + tax - bill_disc, 0), 2)
    await session.flush()
    return await load_order(session, o.id)


async def cancel_order(session: AsyncSession, order_id: str) -> Order:
    o = await load_order(session, order_id)
    if o.is_cancelled:
        return o
    if o.converted_voucher_id:
        raise HTTPException(status_code=400, detail="Converted order cannot be cancelled")
    o.is_cancelled = True
    o.status = "CANCELLED"
    await session.flush()
    return o


async def list_orders(
    session: AsyncSession,
    *,
    order_type: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[Order]:
    q = (
        select(Order)
        .options(selectinload(Order.party))
        .order_by(Order.order_date.desc(), Order.order_no.desc())
    )
    if order_type:
        q = q.where(Order.order_type == order_type.upper())
    if status:
        q = q.where(Order.status == status.upper())
    if date_from:
        q = q.where(Order.order_date >= date_from)
    if date_to:
        q = q.where(Order.order_date <= date_to)
    return list((await session.execute(q)).scalars().all())


async def convert_order_to_voucher(
    session: AsyncSession,
    order_id: str,
    *,
    user_id: str | None,
    voucher_date: date | None = None,
    voucher_type_override: str | None = None,
) -> tuple[Order, object]:
    """Create SALE/PURCHASE voucher from order and mark order fulfilled."""
    o = await load_order(session, order_id)
    if o.is_cancelled:
        raise HTTPException(status_code=400, detail="Cancelled order")
    if o.converted_voucher_id:
        raise HTTPException(status_code=400, detail="Order already converted")
    if o.status == "FULFILLED":
        raise HTTPException(status_code=400, detail="Order already fulfilled")

    if voucher_type_override:
        vtype = voucher_type_override.upper()
    elif o.order_type == "SALES_ORDER":
        vtype = "SALE"
    else:
        vtype = "PURCHASE"

    payload = VoucherIn(
        voucher_type=vtype,
        voucher_date=voucher_date or o.order_date,
        party_id=o.party_id,
        narration=o.narration or f"From order {o.order_no}",
        discount_amount=float(o.discount_amount or 0),
        items=[
            VoucherItemIn(
                product_id=it.product_id,
                quantity=float(it.quantity),
                rate=float(it.rate),
                discount_amount=float(it.discount_amount or 0),
                gst_id=it.gst_id,
            )
            for it in o.items
        ],
        payments=[],
    )
    voucher = await create_voucher(session, payload, user_id)
    for it in o.items:
        it.qty_fulfilled = float(it.quantity)
    o.status = "FULFILLED"
    o.converted_voucher_id = voucher.id
    await session.flush()
    return o, voucher
