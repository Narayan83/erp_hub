"""Stock voucher posting: update products.current_stock + write stock_movements."""

from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.models.masters import Product
from modules.generp.ge.models.stock import (
    STOCK_VOUCHER_TYPES,
    Branch,
    StockMovement,
    StockVoucher,
    StockVoucherItem,
)
from modules.generp.ge.schemas.stock import StockVoucherIn
from modules.generp.ge.services.document_numbers import next_document_no, peek_document_no
from modules.generp.ge.services.stock_barcodes import reverse_barcode_moves, transfer_out_barcodes
from modules.generp.ge.services.stock_lots import add_lot, consume_fifo, restore_fifo, reverse_source_lots
from modules.generp.ge.services.stock_guard import assert_stock_available, lock_products

# Default stock direction for NORMAL lines by voucher type
NORMAL_SIGN = {
    "INWARD_DC": 1,
    "OUTWARD_DC": -1,
    "INWARD_DC_RETURN": -1,
    "OUTWARD_DC_RETURN": 1,
    "SHORTAGE": -1,
    "EXCESS": 1,
    "WASTAGE": -1,
    "TRANSFER_OUT": -1,
    "TRANSFER_IN": 1,
}


async def _next_stock_no(
    session: AsyncSession,
    vtype: str,
    voucher_date: date | None = None,
    branch_id: str | None = None,
) -> str:
    return await next_document_no(
        session, f"STOCK_{vtype}", voucher_date, branch_id=branch_id
    )


async def peek_next_stock_no(
    session: AsyncSession,
    vtype: str,
    voucher_date: date | None = None,
    branch_id: str | None = None,
) -> tuple[str, str | None]:
    return await peek_document_no(
        session, f"STOCK_{vtype}", voucher_date, branch_id=branch_id
    )


def _line_sign(vtype: str, line_role: str) -> int:
    role = (line_role or "NORMAL").upper()
    if role == "DEBIT":
        return -1
    if role == "CREDIT":
        return 1
    if role == "WASTAGE":
        return -1
    sign = NORMAL_SIGN.get(vtype)
    if sign is None:
        raise HTTPException(status_code=400, detail=f"Invalid stock voucher_type: {vtype}")
    return sign


async def _apply_stock(
    session: AsyncSession,
    *,
    product_id: str,
    qty_delta: float,
    movement_date: date,
    movement_type: str,
    stock_voucher_id: str | None,
    branch_id: str | None,
    ref_no: str | None,
    narration: str | None,
) -> None:
    product = (
        await session.execute(select(Product).where(Product.id == product_id).with_for_update())
    ).scalar_one_or_none()
    if not product or not product.is_active:
        raise HTTPException(status_code=400, detail=f"Product not found: {product_id}")
    if float(qty_delta) < 0:
        await assert_stock_available(session, product, -float(qty_delta))
    new_stock = float(product.current_stock or 0) + float(qty_delta)
    product.current_stock = round(new_stock, 3)
    session.add(
        StockMovement(
            movement_date=movement_date,
            product_id=product_id,
            branch_id=branch_id,
            qty_delta=round(float(qty_delta), 3),
            movement_type=movement_type,
            stock_voucher_id=stock_voucher_id,
            ref_no=ref_no,
            narration=narration,
        )
    )
    if qty_delta > 0:
        await add_lot(
            session,
            product,
            float(qty_delta),
            movement_date,
            source_type=movement_type,
            source_id=stock_voucher_id,
            cost=float(product.purchase_price or 0),
        )
    elif qty_delta < 0:
        await consume_fifo(session, product_id, -float(qty_delta))


def _validate_conversion(data: StockVoucherIn) -> None:
    debits = [i for i in data.items if i.line_role.upper() in ("DEBIT", "WASTAGE")]
    credits = [i for i in data.items if i.line_role.upper() == "CREDIT"]
    if not debits:
        raise HTTPException(status_code=400, detail="Conversion needs at least one DEBIT line")
    if not credits:
        raise HTTPException(status_code=400, detail="Conversion needs at least one CREDIT line")
    # Soft check: debit total should cover credit + header wastage (warn via 400 if credit >> debit)
    debit_qty = sum(float(i.quantity) for i in debits) + float(data.wastage_qty or 0)
    credit_qty = sum(float(i.quantity) for i in credits)
    # Allow processing loss: credit can be less than debit; not greater (beyond tiny epsilon)
    if credit_qty > debit_qty + 0.001:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Conversion credit qty ({credit_qty}) cannot exceed debit+wastage qty ({debit_qty}). "
                "Add more debit input or reduce credit packs."
            ),
        )


async def create_stock_voucher(
    session: AsyncSession, data: StockVoucherIn, user_id: str | None
) -> StockVoucher:
    vtype = data.voucher_type.upper().strip()
    if vtype not in STOCK_VOUCHER_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid voucher_type. Allowed: {STOCK_VOUCHER_TYPES}")
    if not data.items:
        raise HTTPException(status_code=400, detail="Add at least one item")

    if vtype in ("CONVERSION", "EXCHANGE"):
        for it in data.items:
            if it.line_role.upper() not in ("DEBIT", "CREDIT", "WASTAGE"):
                raise HTTPException(
                    status_code=400,
                    detail="CONVERSION/EXCHANGE lines must use line_role DEBIT, CREDIT, or WASTAGE",
                )
        if vtype == "CONVERSION":
            _validate_conversion(data)
    else:
        for it in data.items:
            if it.line_role.upper() not in ("NORMAL", ""):
                # allow explicit NORMAL only
                if it.line_role.upper() not in ("NORMAL",):
                    raise HTTPException(
                        status_code=400,
                        detail=f"{vtype} lines should use line_role NORMAL",
                    )

    if vtype in ("TRANSFER_OUT", "TRANSFER_IN") and not data.counterparty_branch_id:
        raise HTTPException(status_code=400, detail="Branch transfer requires counterparty_branch_id")

    await lock_products(session, [it.product_id for it in data.items])

    voucher_no = await _next_stock_no(session, vtype, data.voucher_date, data.branch_id)
    voucher = StockVoucher(
        voucher_type=vtype,
        voucher_no=voucher_no,
        voucher_date=data.voucher_date,
        branch_id=data.branch_id,
        counterparty_branch_id=data.counterparty_branch_id,
        party_id=data.party_id,
        reference_no=data.reference_no,
        narration=data.narration,
        wastage_qty=float(data.wastage_qty or 0),
        created_by=user_id,
    )
    session.add(voucher)
    await session.flush()

    for idx, it in enumerate(data.items):
        role = (it.line_role or "NORMAL").upper()
        amount = round(float(it.quantity) * float(it.rate or 0), 2)
        session.add(
            StockVoucherItem(
                voucher_id=voucher.id,
                product_id=it.product_id,
                line_role=role,
                quantity=float(it.quantity),
                unit=it.unit,
                rate=float(it.rate or 0),
                amount=amount,
                narration=it.narration,
                lot_id=getattr(it, "lot_id", None) or None,
                sort_order=idx,
            )
        )
        sign = _line_sign(vtype, role)
        if vtype == "TRANSFER_OUT" and sign < 0:
            await transfer_out_barcodes(
                session,
                product_id=it.product_id,
                qty=float(it.quantity),
                stock_voucher_id=voucher.id,
            )
        await _apply_stock(
            session,
            product_id=it.product_id,
            qty_delta=sign * float(it.quantity),
            movement_date=data.voucher_date,
            movement_type=vtype if role == "NORMAL" else f"{vtype}_{role}",
            stock_voucher_id=voucher.id,
            branch_id=data.branch_id,
            ref_no=voucher_no,
            narration=it.narration or data.narration,
        )

    # Header-level wastage on conversion: if set and no WASTAGE lines, apply to first DEBIT product
    if vtype == "CONVERSION" and float(data.wastage_qty or 0) > 0:
        has_wastage_line = any(i.line_role.upper() == "WASTAGE" for i in data.items)
        if not has_wastage_line:
            first_debit = next(i for i in data.items if i.line_role.upper() == "DEBIT")
            await _apply_stock(
                session,
                product_id=first_debit.product_id,
                qty_delta=-float(data.wastage_qty),
                movement_date=data.voucher_date,
                movement_type="CONVERSION_WASTAGE",
                stock_voucher_id=voucher.id,
                branch_id=data.branch_id,
                ref_no=voucher_no,
                narration=data.narration or "Process wastage",
            )

    await session.flush()
    return await load_stock_voucher(session, voucher.id)


async def load_stock_voucher(session: AsyncSession, voucher_id: str) -> StockVoucher:
    v = (
        await session.execute(
            select(StockVoucher)
            .options(
                selectinload(StockVoucher.items).selectinload(StockVoucherItem.product),
                selectinload(StockVoucher.branch),
                selectinload(StockVoucher.counterparty_branch),
            )
            .where(StockVoucher.id == voucher_id)
        )
    ).scalar_one_or_none()
    if not v:
        raise HTTPException(status_code=404, detail="Stock voucher not found")
    return v


async def cancel_stock_voucher(session: AsyncSession, voucher_id: str) -> StockVoucher:
    v = await load_stock_voucher(session, voucher_id)
    if v.is_cancelled:
        raise HTTPException(status_code=400, detail="Already cancelled")
    # Reverse movements
    moves = (
        await session.execute(
            select(StockMovement).where(StockMovement.stock_voucher_id == voucher_id)
        )
    ).scalars().all()
    await lock_products(session, [m.product_id for m in moves])
    for m in moves:
        product = (
            await session.execute(
                select(Product).where(Product.id == m.product_id).with_for_update()
            )
        ).scalar_one_or_none()
        if product:
            product.current_stock = round(float(product.current_stock or 0) - float(m.qty_delta), 3)
        if float(m.qty_delta or 0) > 0:
            await reverse_source_lots(session, m.stock_voucher_id, m.product_id, float(m.qty_delta))
        elif float(m.qty_delta or 0) < 0:
            await restore_fifo(session, m.product_id, -float(m.qty_delta))
        await session.delete(m)
    await reverse_barcode_moves(session, stock_voucher_id=voucher_id)
    v.is_cancelled = True
    await session.flush()
    return v


async def list_stock_vouchers(
    session: AsyncSession,
    *,
    voucher_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[StockVoucher]:
    q = select(StockVoucher).options(selectinload(StockVoucher.items)).order_by(
        StockVoucher.voucher_date.desc(), StockVoucher.voucher_no.desc()
    )
    if voucher_type:
        q = q.where(StockVoucher.voucher_type == voucher_type.upper())
    if date_from:
        q = q.where(StockVoucher.voucher_date >= date_from)
    if date_to:
        q = q.where(StockVoucher.voucher_date <= date_to)
    return list((await session.execute(q)).scalars().all())


async def ensure_main_branch(session: AsyncSession) -> Branch:
    existing = (
        await session.execute(select(Branch).where(Branch.is_main.is_(True)))
    ).scalar_one_or_none()
    if existing:
        return existing
    any_b = (await session.execute(select(Branch).limit(1))).scalar_one_or_none()
    if any_b:
        return any_b
    b = Branch(code="001", name="Main Branch", is_main=True)
    session.add(b)
    await session.flush()
    return b
