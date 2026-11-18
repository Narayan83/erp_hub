from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import User
from modules.generp.ge.models.masters import Party
from modules.generp.ge.models.transactions import Voucher
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.transactions import (
    NextNumberOut,
    PurchaseImportPreview,
    VoucherIn,
    VoucherListItem,
    VoucherOut,
    VoucherPageOut,
)
from modules.generp.ge.services.posting import (
    cancel_posted_voucher,
    create_voucher,
    load_voucher,
    peek_next_voucher_no,
    update_voucher,
)
from modules.generp.ge.models.stock import LotMaster
from modules.generp.ge.services.purchase_import import preview_purchase_import
from modules.generp.ge.services.stock_barcodes import summaries_for_voucher

router = APIRouter()


async def _to_out(session: AsyncSession, v: Voucher) -> VoucherOut:
    paid = sum(
        float(p.amount or 0)
        for p in (v.payments or [])
        if not (p.payment_mode and p.payment_mode.is_credit)
    )
    net = float(v.net_amount or 0)
    summaries = await summaries_for_voucher(session, v.id)
    lot_ids = [it.lot_id for it in v.items if getattr(it, "lot_id", None)]
    lots: dict[str, LotMaster] = {}
    if lot_ids:
        lots = {
            lot.id: lot
            for lot in (
                await session.execute(select(LotMaster).where(LotMaster.id.in_(lot_ids)))
            ).scalars().all()
        }
    return VoucherOut(
        id=v.id,
        voucher_type=v.voucher_type,
        voucher_no=v.voucher_no,
        voucher_date=v.voucher_date,
        party_id=v.party_id,
        party_name=v.party.name if v.party else None,
        party_bill_no=getattr(v, "party_bill_no", None),
        payment_mode_id=v.payment_mode_id,
        is_credit=v.is_credit,
        narration=v.narration,
        gross_amount=float(v.gross_amount or 0),
        discount_amount=float(v.discount_amount or 0),
        tax_amount=float(v.tax_amount or 0),
        adjust_advance=float(getattr(v, "adjust_advance", 0) or 0),
        net_amount=net,
        paid_amount=round(paid, 2),
        credit_amount=round(net - paid, 2),
        is_cancelled=v.is_cancelled,
        is_parked=bool(getattr(v, "is_parked", False)),
        payments=[
            {
                "id": p.id,
                "payment_mode_id": p.payment_mode_id,
                "payment_mode_name": p.payment_mode.name if p.payment_mode else None,
                "amount": float(p.amount or 0),
                "reference": p.reference,
            }
            for p in sorted(v.payments or [], key=lambda x: x.sort_order)
        ],
        items=[
            {
                "id": it.id,
                "product_id": it.product_id,
                "description": it.description,
                "quantity": float(it.quantity or 0),
                "rate": float(it.rate or 0),
                "discount_amount": float(it.discount_amount or 0),
                "gst_id": it.gst_id,
                "gst_rate": float(it.gst_rate or 0),
                "gst_amount": float(it.gst_amount or 0),
                "taxable_amount": float(it.taxable_amount or 0),
                "amount": float(it.amount or 0),
                "product_name": it.product.name if it.product else it.description,
                "product_code": it.product.code if it.product else None,
                "mrp": float(getattr(it, "mrp", 0) or 0),
                "sale_price": float(getattr(it, "sale_price", 0) or 0)
                or (float(it.product.sale_price or 0) if it.product else 0),
                "max_discount_pct": float(getattr(it.product, "max_discount_pct", 0) or 0)
                if it.product
                else 0,
                "profit_pct": float(getattr(it, "profit_pct", 0) or 0),
                "hsn_code": it.product.hsn_code if it.product else None,
                "lot_id": getattr(it, "lot_id", None),
                "lot_name": (
                    f"{lots[it.lot_id].code} {lots[it.lot_id].name}".strip()
                    if getattr(it, "lot_id", None) and it.lot_id in lots
                    else None
                ),
                "stock_barcode_id": getattr(it, "stock_barcode_id", None),
                **(summaries.get(it.id) or {}),
            }
            for it in sorted(v.items, key=lambda x: x.sort_order)
        ],
    )


def _list_item(v: Voucher) -> VoucherListItem:
    return VoucherListItem(
        id=v.id,
        voucher_type=v.voucher_type,
        voucher_no=v.voucher_no,
        voucher_date=v.voucher_date,
        party_name=v.party.name if v.party else None,
        party_code=v.party.code if v.party else None,
        party_phone=v.party.phone if v.party else None,
        party_bill_no=getattr(v, "party_bill_no", None),
        is_credit=v.is_credit,
        net_amount=float(v.net_amount or 0),
        is_cancelled=v.is_cancelled,
        is_parked=bool(getattr(v, "is_parked", False)),
    )


def _apply_voucher_filters(
    q,
    *,
    voucher_type: str | None,
    date_from: date | None,
    date_to: date | None,
    voucher_no: str | None,
    party_name: str | None,
    party_phone: str | None,
    party_code: str | None,
    party_bill_no: str | None,
    include_cancelled: bool,
    parked_only: bool = False,
):
    needs_party = bool(
        (party_name and party_name.strip())
        or (party_phone and party_phone.strip())
        or (party_code and party_code.strip())
    )
    if needs_party:
        q = q.outerjoin(Party, Voucher.party_id == Party.id)
    if voucher_type:
        q = q.where(Voucher.voucher_type == voucher_type)
    if not include_cancelled:
        q = q.where(Voucher.is_cancelled.is_(False))
    if date_from:
        q = q.where(Voucher.voucher_date >= date_from)
    if date_to:
        q = q.where(Voucher.voucher_date <= date_to)
    if voucher_no and voucher_no.strip():
        q = q.where(Voucher.voucher_no.ilike(f"%{voucher_no.strip()}%"))
    if party_bill_no and party_bill_no.strip():
        q = q.where(Voucher.party_bill_no.ilike(f"%{party_bill_no.strip()}%"))
    if party_name and party_name.strip():
        q = q.where(Party.name.ilike(f"%{party_name.strip()}%"))
    if party_phone and party_phone.strip():
        digits = "".join(ch for ch in party_phone if ch.isdigit())
        term = digits or party_phone.strip()
        q = q.where(func.coalesce(Party.phone, "").ilike(f"%{term}%"))
    if party_code and party_code.strip():
        q = q.where(Party.code.ilike(f"%{party_code.strip()}%"))
    if parked_only:
        q = q.where(Voucher.is_parked.is_(True))
    return q


@router.get("", response_model=list[VoucherListItem])
async def list_vouchers(
    voucher_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    voucher_no: str | None = Query(None),
    party_name: str | None = Query(None),
    party_phone: str | None = Query(None),
    party_code: str | None = Query(None),
    party_bill_no: str | None = Query(None),
    limit: int | None = Query(None, ge=1, le=200),
    include_cancelled: bool = True,
    parked_only: bool = False,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    q = select(Voucher).options(selectinload(Voucher.party))
    q = _apply_voucher_filters(
        q,
        voucher_type=voucher_type,
        date_from=date_from,
        date_to=date_to,
        voucher_no=voucher_no,
        party_name=party_name,
        party_phone=party_phone,
        party_code=party_code,
        party_bill_no=party_bill_no,
        include_cancelled=include_cancelled,
        parked_only=parked_only,
    )
    q = q.order_by(Voucher.created_at.desc(), Voucher.voucher_no.desc())
    if limit:
        q = q.limit(limit)
    result = await session.execute(q)
    return [_list_item(v) for v in result.scalars().all()]


@router.get("/paged", response_model=VoucherPageOut)
async def list_vouchers_paged(
    voucher_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    voucher_no: str | None = Query(None),
    party_name: str | None = Query(None),
    party_phone: str | None = Query(None),
    party_code: str | None = Query(None),
    party_bill_no: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    include_cancelled: bool = True,
    parked_only: bool = False,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    kwargs = dict(
        voucher_type=voucher_type,
        date_from=date_from,
        date_to=date_to,
        voucher_no=voucher_no,
        party_name=party_name,
        party_phone=party_phone,
        party_code=party_code,
        party_bill_no=party_bill_no,
        include_cancelled=include_cancelled,
        parked_only=parked_only,
    )
    count_q = _apply_voucher_filters(select(func.count(Voucher.id)), **kwargs)
    total = int((await session.execute(count_q)).scalar_one() or 0)
    q = _apply_voucher_filters(
        select(Voucher).options(selectinload(Voucher.party)),
        **kwargs,
    )
    q = q.order_by(Voucher.created_at.desc(), Voucher.voucher_no.desc())
    q = q.offset((page - 1) * page_size).limit(page_size)
    rows = [_list_item(v) for v in (await session.execute(q)).scalars().all()]
    return VoucherPageOut(rows=rows, total=total, page=page, page_size=page_size)


@router.post("/purchase-import-preview", response_model=PurchaseImportPreview)
async def purchase_import_preview(
    file: UploadFile = File(...),
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    name = file.filename or "purchase.xlsx"
    return await preview_purchase_import(session, raw, name)


@router.get("/next-no", response_model=NextNumberOut)
async def next_number(
    voucher_type: str = "SALE",
    voucher_date: date | None = None,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    next_no, last_no = await peek_next_voucher_no(session, voucher_type, voucher_date)
    return NextNumberOut(voucher_type=voucher_type, next_no=next_no, last_no=last_no)


@router.get("/by-no/{voucher_no}", response_model=VoucherOut)
async def get_voucher_by_no(
    voucher_no: str,
    voucher_type: str = "SALE",
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    v = (
        await session.execute(
            select(Voucher).where(Voucher.voucher_no == voucher_no, Voucher.voucher_type == voucher_type)
        )
    ).scalar_one_or_none()
    if not v:
        raise HTTPException(status_code=404, detail="Not found")
    loaded = await load_voucher(session, v.id)
    if not loaded:
        raise HTTPException(status_code=404, detail="Not found")
    return await _to_out(session, loaded)


@router.get("/{voucher_id}", response_model=VoucherOut)
async def get_voucher(
    voucher_id: str, _u: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    v = await load_voucher(session, voucher_id)
    if not v:
        raise HTTPException(status_code=404, detail="Not found")
    return await _to_out(session, v)


@router.post("", response_model=VoucherOut)
async def create(
    data: VoucherIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    voucher = await create_voucher(session, data, user.id)
    v = await load_voucher(session, voucher.id)
    return await _to_out(session, v)


@router.put("/{voucher_id}", response_model=VoucherOut)
async def update(
    voucher_id: str,
    data: VoucherIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    voucher = await update_voucher(session, voucher_id, data, user.id)
    v = await load_voucher(session, voucher.id)
    return await _to_out(session, v)


@router.delete("/{voucher_id}", response_model=MessageResponse)
async def cancel_voucher(
    voucher_id: str, _u: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    await cancel_posted_voucher(session, voucher_id)
    return MessageResponse(message="Voucher cancelled")
