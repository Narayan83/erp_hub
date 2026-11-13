from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from erp_core.api.deps import get_current_user, get_session
from erp_core.models.auth import User
from erp_core.models.cashbook import CashbookVoucher, CashbookVoucherLine
from erp_core.models.masters import Ledger, Party, PaymentMode
from erp_core.schemas.masters import (
    CashbookVoucherCreate,
    CashbookVoucherOut,
    LedgerCreate,
    LedgerOut,
    PaymentModeOut,
)

router = APIRouter()


@router.get("/ledgers", response_model=list[LedgerOut])
async def list_ledgers(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return (
        await session.execute(
            select(Ledger).where(Ledger.is_active.is_(True)).order_by(Ledger.sort_order, Ledger.code)
        )
    ).scalars().all()


@router.post("/ledgers", response_model=LedgerOut)
async def create_ledger(
    data: LedgerCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = Ledger(**data.model_dump())
    session.add(row)
    await session.flush()
    return row


@router.get("/payment-modes", response_model=list[PaymentModeOut])
async def list_payment_modes(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return (
        await session.execute(
            select(PaymentMode)
            .where(PaymentMode.is_active.is_(True))
            .order_by(PaymentMode.sort_order)
        )
    ).scalars().all()


@router.get("/cashbook", response_model=list[CashbookVoucherOut])
async def list_cashbook(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (
        await session.execute(
            select(CashbookVoucher)
            .options(selectinload(CashbookVoucher.lines))
            .where(CashbookVoucher.is_active.is_(True))
            .order_by(CashbookVoucher.voucher_date.desc())
            .limit(100)
        )
    ).scalars().all()
    out: list[CashbookVoucherOut] = []
    for v in rows:
        amount = sum(float(l.debit_amount or 0) for l in v.lines)
        out.append(
            CashbookVoucherOut(
                id=v.id,
                voucher_no=v.voucher_no,
                voucher_date=v.voucher_date.isoformat(),
                source_type=v.source_type,
                kind=v.kind,
                party_id=v.party_id,
                party_code=v.party_code,
                narration=v.narration,
                amount=amount,
            )
        )
    return out


@router.post("/cashbook", response_model=CashbookVoucherOut)
async def create_cashbook_voucher(
    data: CashbookVoucherCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if data.kind not in {"advance", "payment", "contra", "receipt"}:
        raise HTTPException(status_code=400, detail="kind must be advance|payment|contra|receipt")

    party_code = None
    if data.party_id:
        party = (
            await session.execute(select(Party).where(Party.id == data.party_id))
        ).scalar_one_or_none()
        if not party:
            raise HTTPException(status_code=404, detail="Party not found")
        party_code = party.code

    source_id = str(uuid4())
    voucher = CashbookVoucher(
        voucher_no=f"{data.kind.upper()[:3]}-{source_id[:8].upper()}",
        voucher_date=date.fromisoformat(data.voucher_date),
        source_type=f"{data.kind}_voucher",
        source_id=source_id,
        party_id=data.party_id,
        party_code=party_code,
        narration=data.narration,
        kind=data.kind,
        lines=[
            CashbookVoucherLine(
                ledger_id=data.debit_ledger_id,
                debit_amount=data.amount,
                credit_amount=0,
                sort_order=1,
            ),
            CashbookVoucherLine(
                ledger_id=data.credit_ledger_id,
                debit_amount=0,
                credit_amount=data.amount,
                sort_order=2,
            ),
        ],
    )
    session.add(voucher)
    await session.flush()
    return CashbookVoucherOut(
        id=voucher.id,
        voucher_no=voucher.voucher_no,
        voucher_date=voucher.voucher_date.isoformat(),
        source_type=voucher.source_type,
        kind=voucher.kind,
        party_id=voucher.party_id,
        party_code=voucher.party_code,
        narration=voucher.narration,
        amount=data.amount,
    )


@router.get("/balance-sheet")
async def balance_sheet_stub(_: User = Depends(get_current_user)):
    """Stub — full TB/P&L/BS migrates from GenERP financial_reports next."""
    return {
        "status": "stub",
        "message": "Balance sheet will reuse GenERP financial_reports service",
        "assets": [],
        "liabilities": [],
    }
