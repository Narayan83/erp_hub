from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import User
from modules.generp.ge.models.masters import Product
from modules.generp.ge.models.stock import STOCK_VOUCHER_TYPES, Branch, LotMaster, StockMovement, StockVoucher
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.stock import (
    BranchIn,
    BranchOut,
    NextStockNoOut,
    StockBalanceOut,
    StockLedgerRow,
    BarcodeStockReport,
    ItemStockRow,
    LotIn,
    LotOut,
    MovementStockRow,
    StockBarcodeHit,
    StockVoucherIn,
    StockVoucherListItem,
    StockVoucherOut,
)
from modules.generp.ge.services.stock_barcodes import (
    barcode_stock_report,
    item_stock_report,
    lookup_barcode,
    movement_stock_report,
)
from modules.generp.ge.services.stock_posting import (
    cancel_stock_voucher,
    create_stock_voucher,
    ensure_main_branch,
    list_stock_vouchers,
    load_stock_voucher,
    peek_next_stock_no,
)

router = APIRouter()


def _to_out(v: StockVoucher) -> StockVoucherOut:
    return StockVoucherOut(
        id=v.id,
        voucher_type=v.voucher_type,
        voucher_no=v.voucher_no,
        voucher_date=v.voucher_date,
        branch_id=v.branch_id,
        branch_name=v.branch.name if v.branch else None,
        counterparty_branch_id=v.counterparty_branch_id,
        counterparty_branch_name=v.counterparty_branch.name if v.counterparty_branch else None,
        party_id=v.party_id,
        reference_no=v.reference_no,
        narration=v.narration,
        wastage_qty=float(v.wastage_qty or 0),
        is_cancelled=v.is_cancelled,
        items=[
            {
                "id": it.id,
                "product_id": it.product_id,
                "product_code": it.product.code if it.product else None,
                "product_name": it.product.name if it.product else None,
                "line_role": it.line_role,
                "quantity": float(it.quantity or 0),
                "unit": it.unit,
                "rate": float(it.rate or 0),
                "amount": float(it.amount or 0),
                "narration": it.narration,
            }
            for it in sorted(v.items, key=lambda x: x.sort_order)
        ],
    )


# --- Branches ---


@router.get("/branches", response_model=list[BranchOut])
async def list_branches(
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(Branch).where(Branch.is_active.is_(True)).order_by(Branch.code))
    branches = list(result.scalars().all())
    if not branches:
        branches = [await ensure_main_branch(session)]
    return branches


@router.post("/branches", response_model=BranchOut)
async def create_branch(
    data: BranchIn,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    existing = (
        await session.execute(select(Branch).where(Branch.code == data.code.strip().upper()))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"Branch code {data.code} already exists")
    if data.is_main:
        for b in (await session.execute(select(Branch).where(Branch.is_main.is_(True)))).scalars().all():
            b.is_main = False
    obj = Branch(
        code=data.code.strip().upper(),
        name=data.name.strip(),
        address=data.address,
        is_main=data.is_main,
        is_active=data.is_active,
    )
    session.add(obj)
    await session.flush()
    return obj


@router.put("/branches/{branch_id}", response_model=BranchOut)
async def update_branch(
    branch_id: str,
    data: BranchIn,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (await session.execute(select(Branch).where(Branch.id == branch_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if data.is_main and not obj.is_main:
        for b in (await session.execute(select(Branch).where(Branch.is_main.is_(True)))).scalars().all():
            b.is_main = False
    obj.name = data.name.strip()
    obj.address = data.address
    obj.is_main = data.is_main
    obj.is_active = data.is_active
    await session.flush()
    return obj


# --- Stock vouchers ---


@router.get("/stock-vouchers/types")
async def stock_voucher_types(_u: User = Depends(get_current_user)):
    return {"types": list(STOCK_VOUCHER_TYPES)}


@router.get("/stock-vouchers/next-no", response_model=NextStockNoOut)
async def next_stock_no(
    voucher_type: str = "INWARD_DC",
    voucher_date: date | None = None,
    branch_id: str | None = None,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    next_no, last_no = await peek_next_stock_no(
        session, voucher_type.upper(), voucher_date, branch_id
    )
    return NextStockNoOut(next_no=next_no, last_no=last_no)


@router.get("/stock-vouchers", response_model=list[StockVoucherListItem])
async def list_vouchers(
    voucher_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = await list_stock_vouchers(
        session, voucher_type=voucher_type, date_from=date_from, date_to=date_to
    )
    return [
        StockVoucherListItem(
            id=v.id,
            voucher_type=v.voucher_type,
            voucher_no=v.voucher_no,
            voucher_date=v.voucher_date,
            narration=v.narration,
            is_cancelled=v.is_cancelled,
            item_count=len(v.items or []),
        )
        for v in rows
    ]


@router.get("/stock-vouchers/{voucher_id}", response_model=StockVoucherOut)
async def get_voucher(
    voucher_id: str,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    v = await load_stock_voucher(session, voucher_id)
    return _to_out(v)


@router.post("/stock-vouchers", response_model=StockVoucherOut)
async def create(
    data: StockVoucherIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    v = await create_stock_voucher(session, data, user.id)
    return _to_out(v)


@router.delete("/stock-vouchers/{voucher_id}", response_model=MessageResponse)
async def cancel(
    voucher_id: str,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await cancel_stock_voucher(session, voucher_id)
    return MessageResponse(message="Stock voucher cancelled")


# --- Stock ledger & balances ---


@router.get("/stock-ledger", response_model=list[StockLedgerRow])
async def stock_ledger(
    product_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    q = (
        select(StockMovement, Product)
        .join(Product, Product.id == StockMovement.product_id)
        .order_by(
            StockMovement.movement_date,
            StockMovement.created_at,
            StockMovement.id,
        )
    )
    if product_id:
        q = q.where(StockMovement.product_id == product_id)
    if date_from:
        q = q.where(StockMovement.movement_date >= date_from)
    if date_to:
        q = q.where(StockMovement.movement_date <= date_to)

    rows = (await session.execute(q)).all()
    balances: dict[str, float] = {}
    out: list[StockLedgerRow] = []
    for move, product in rows:
        pid = move.product_id
        balances[pid] = round(balances.get(pid, 0.0) + float(move.qty_delta or 0), 3)
        out.append(
            StockLedgerRow(
                id=move.id,
                movement_date=move.movement_date,
                product_id=pid,
                product_code=product.code,
                product_name=product.name,
                qty_delta=float(move.qty_delta or 0),
                movement_type=move.movement_type,
                ref_no=move.ref_no,
                narration=move.narration,
                running_balance=balances[pid],
            )
        )
    return out


@router.get("/stock-balances", response_model=list[StockBalanceOut])
async def stock_balances(
    q: str | None = None,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Product).where(Product.is_active.is_(True))
    if q and q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(or_(Product.code.ilike(term), Product.name.ilike(term)))
    stmt = stmt.order_by(Product.name)
    products = (await session.execute(stmt)).scalars().all()
    return [
        StockBalanceOut(
            product_id=p.id,
            product_code=p.code,
            product_name=p.name,
            current_stock=float(p.current_stock or 0),
            unit=p.unit,
        )
        for p in products
    ]


def _lot_out(row: LotMaster) -> LotOut:
    return LotOut(
        id=row.id,
        code=row.code,
        name=row.name,
        remarks=row.remarks,
        is_active=bool(row.is_active),
    )


@router.get("/lots", response_model=list[LotOut])
async def list_lots(
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (
        await session.execute(select(LotMaster).order_by(LotMaster.code))
    ).scalars().all()
    return [_lot_out(r) for r in rows]


@router.post("/lots", response_model=LotOut)
async def create_lot(
    data: LotIn,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    code = data.code.strip().upper()
    if not code or not data.name.strip():
        raise HTTPException(status_code=400, detail="Lot code and name are required.")
    exists = (
        await session.execute(select(LotMaster).where(LotMaster.code == code))
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail="Lot code already exists.")
    row = LotMaster(
        code=code,
        name=data.name.strip(),
        remarks=(data.remarks or "").strip() or None,
        is_active=data.is_active,
    )
    session.add(row)
    await session.flush()
    return _lot_out(row)


@router.put("/lots/{lot_id}", response_model=LotOut)
async def update_lot(
    lot_id: str,
    data: LotIn,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = (
        await session.execute(select(LotMaster).where(LotMaster.id == lot_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Lot not found")
    code = data.code.strip().upper()
    if not code or not data.name.strip():
        raise HTTPException(status_code=400, detail="Lot code and name are required.")
    clash = (
        await session.execute(
            select(LotMaster).where(LotMaster.code == code, LotMaster.id != lot_id)
        )
    ).scalar_one_or_none()
    if clash:
        raise HTTPException(status_code=400, detail="Lot code already exists.")
    row.code = code
    row.name = data.name.strip()
    row.remarks = (data.remarks or "").strip() or None
    row.is_active = data.is_active
    await session.flush()
    return _lot_out(row)


@router.delete("/lots/{lot_id}", response_model=MessageResponse)
async def delete_lot(
    lot_id: str,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = (
        await session.execute(select(LotMaster).where(LotMaster.id == lot_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Lot not found")
    await session.delete(row)
    await session.flush()
    return MessageResponse(message="Lot deleted")


@router.get("/barcodes/lookup", response_model=StockBarcodeHit)
async def barcode_lookup(
    q: str = Query(..., min_length=1),
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    hit = await lookup_barcode(session, q)
    if not hit:
        raise HTTPException(status_code=404, detail="Barcode not found")
    return hit


@router.get("/reports/barcode-stock", response_model=BarcodeStockReport)
async def report_barcode_stock(
    date_from: date | None = None,
    date_to: date | None = None,
    status: str = "not_sold",
    barcode: str | None = None,
    hide_sale_rates: bool = False,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await barcode_stock_report(
        session,
        date_from=date_from,
        date_to=date_to,
        status=status,
        barcode=barcode,
        hide_sale_rates=hide_sale_rates,
    )


@router.get("/reports/item-stock", response_model=list[ItemStockRow])
async def report_item_stock(
    product_id: str | None = None,
    q: str | None = None,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await item_stock_report(session, product_id=product_id, q=q)


@router.get("/reports/movement-stock", response_model=list[MovementStockRow])
async def report_movement_stock(
    supplier_id: str | None = None,
    product_id: str | None = None,
    lot_id: str | None = None,
    barcode: str | None = None,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await movement_stock_report(
        session,
        supplier_id=supplier_id,
        product_id=product_id,
        lot_id=lot_id,
        barcode=barcode,
    )
