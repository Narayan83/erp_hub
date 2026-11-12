from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import User
from modules.generp.ge.models.orders import Order
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.stock import (
    ConvertOrderOut,
    NextStockNoOut,
    OrderIn,
    OrderListItem,
    OrderOut,
)
from modules.generp.ge.services.orders import (
    cancel_order,
    convert_order_to_voucher,
    create_order,
    list_orders,
    load_order,
    peek_next_order_no,
    update_order,
)

router = APIRouter()


class ConvertOrderIn(BaseModel):
    voucher_date: date | None = None
    voucher_type: str | None = None


def _to_out(o: Order) -> OrderOut:
    return OrderOut(
        id=o.id,
        order_type=o.order_type,
        order_no=o.order_no,
        order_date=o.order_date,
        party_id=o.party_id,
        party_name=o.party.name if o.party else None,
        status=o.status,
        narration=o.narration,
        discount_scheme_id=o.discount_scheme_id,
        discount_amount=float(o.discount_amount or 0),
        gross_amount=float(o.gross_amount or 0),
        tax_amount=float(o.tax_amount or 0),
        net_amount=float(o.net_amount or 0),
        is_cancelled=o.is_cancelled,
        converted_voucher_id=o.converted_voucher_id,
        items=[
            {
                "id": it.id,
                "product_id": it.product_id,
                "product_code": it.product.code if it.product else None,
                "product_name": it.product.name if it.product else None,
                "quantity": float(it.quantity or 0),
                "qty_fulfilled": float(it.qty_fulfilled or 0),
                "rate": float(it.rate or 0),
                "discount_amount": float(it.discount_amount or 0),
                "gst_id": it.gst_id,
                "gst_rate": float(it.gst_rate or 0),
                "gst_amount": float(it.gst_amount or 0),
                "taxable_amount": float(it.taxable_amount or 0),
                "amount": float(it.amount or 0),
            }
            for it in sorted(o.items, key=lambda x: x.sort_order)
        ],
    )


@router.get("/next-no", response_model=NextStockNoOut)
async def next_order_no(
    order_type: str = "SALES_ORDER",
    order_date: date | None = None,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    next_no, last_no = await peek_next_order_no(session, order_type.upper(), order_date)
    return NextStockNoOut(next_no=next_no, last_no=last_no)


@router.get("", response_model=list[OrderListItem])
async def list_all(
    order_type: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = await list_orders(
        session, order_type=order_type, status=status, date_from=date_from, date_to=date_to
    )
    return [
        OrderListItem(
            id=o.id,
            order_type=o.order_type,
            order_no=o.order_no,
            order_date=o.order_date,
            party_name=o.party.name if o.party else None,
            status=o.status,
            net_amount=float(o.net_amount or 0),
            is_cancelled=o.is_cancelled,
        )
        for o in rows
    ]


@router.get("/{order_id}", response_model=OrderOut)
async def get_one(
    order_id: str,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    o = await load_order(session, order_id)
    return _to_out(o)


@router.post("", response_model=OrderOut)
async def create(
    data: OrderIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    o = await create_order(session, data, user.id)
    return _to_out(o)


@router.put("/{order_id}", response_model=OrderOut)
async def update(
    order_id: str,
    data: OrderIn,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    o = await update_order(session, order_id, data)
    return _to_out(o)


@router.delete("/{order_id}", response_model=MessageResponse)
async def cancel(
    order_id: str,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await cancel_order(session, order_id)
    return MessageResponse(message="Order cancelled")


@router.post("/{order_id}/convert", response_model=ConvertOrderOut)
async def convert(
    order_id: str,
    body: ConvertOrderIn | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    payload = body or ConvertOrderIn()
    o, voucher = await convert_order_to_voucher(
        session,
        order_id,
        user_id=user.id,
        voucher_date=payload.voucher_date,
        voucher_type_override=payload.voucher_type,
    )
    return ConvertOrderOut(
        order_id=o.id,
        voucher_id=voucher.id,
        voucher_no=voucher.voucher_no,
        voucher_type=voucher.voucher_type,
    )
