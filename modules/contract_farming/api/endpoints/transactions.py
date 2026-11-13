from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.api.deps import get_current_user, get_session
from erp_core.models.auth import User
from modules.contract_farming.models.masters import (
    CfLabour,
    CfLedger,
    CfPartner,
    CfPaymentMode,
    CfPhase,
    CfVendor,
    CfWorkType,
)
from modules.contract_farming.models.project import CfProject
from modules.contract_farming.models.transaction import CfTransaction
from modules.contract_farming.schemas import BalanceOut, TransactionIn, TransactionOut
from modules.contract_farming.services.balances import (
    labour_balance,
    ledger_balance,
    partner_balance,
    vendor_balance,
)

router = APIRouter(tags=["cf-transactions"])


async def _party_name(session: AsyncSession, txn: CfTransaction) -> str | None:
    if txn.party_type == "partner" and txn.partner_id:
        row = (await session.execute(select(CfPartner).where(CfPartner.id == txn.partner_id))).scalar_one_or_none()
        return row.name if row else None
    if txn.party_type == "labour" and txn.labour_id:
        row = (await session.execute(select(CfLabour).where(CfLabour.id == txn.labour_id))).scalar_one_or_none()
        return row.name if row else None
    if txn.party_type == "vendor" and txn.vendor_id:
        row = (await session.execute(select(CfVendor).where(CfVendor.id == txn.vendor_id))).scalar_one_or_none()
        return row.name if row else None
    return None


async def _to_out(session: AsyncSession, txn: CfTransaction) -> TransactionOut:
    project = (await session.execute(select(CfProject).where(CfProject.id == txn.project_id))).scalar_one_or_none()
    phase = (await session.execute(select(CfPhase).where(CfPhase.id == txn.phase_id))).scalar_one_or_none()
    work = (await session.execute(select(CfWorkType).where(CfWorkType.id == txn.work_type_id))).scalar_one_or_none()
    ledger = (await session.execute(select(CfLedger).where(CfLedger.id == txn.ledger_id))).scalar_one_or_none()
    mode = (
        await session.execute(select(CfPaymentMode).where(CfPaymentMode.id == txn.payment_mode_id))
    ).scalar_one_or_none()
    return TransactionOut(
        id=txn.id,
        project_id=txn.project_id,
        project_name=project.name if project else None,
        phase_id=txn.phase_id,
        phase_name=phase.name if phase else None,
        work_type_id=txn.work_type_id,
        work_type_name=work.name if work else None,
        ledger_id=txn.ledger_id,
        ledger_name=ledger.name if ledger else None,
        payment_mode_id=txn.payment_mode_id,
        payment_mode_name=mode.name if mode else None,
        party_type=txn.party_type,
        labour_id=txn.labour_id,
        partner_id=txn.partner_id,
        vendor_id=txn.vendor_id,
        party_name=await _party_name(session, txn),
        txn_date=txn.txn_date,
        amount=txn.amount,
        entry_type=txn.entry_type,
        narration=txn.narration or "",
        reference=txn.reference or "",
        created_at=txn.created_at,
    )


async def _validate_and_apply(session: AsyncSession, data: TransactionIn, row: CfTransaction | None = None) -> CfTransaction:
    if data.amount is None or data.amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be greater than zero")

    project = (await session.execute(select(CfProject).where(CfProject.id == data.project_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=400, detail="Invalid project")
    phase = (await session.execute(select(CfPhase).where(CfPhase.id == data.phase_id))).scalar_one_or_none()
    if not phase:
        raise HTTPException(status_code=400, detail="Invalid phase")
    work = (await session.execute(select(CfWorkType).where(CfWorkType.id == data.work_type_id))).scalar_one_or_none()
    if not work:
        raise HTTPException(status_code=400, detail="Invalid work type")
    ledger = (await session.execute(select(CfLedger).where(CfLedger.id == data.ledger_id))).scalar_one_or_none()
    if not ledger:
        raise HTTPException(status_code=400, detail="Invalid ledger")
    mode = (
        await session.execute(select(CfPaymentMode).where(CfPaymentMode.id == data.payment_mode_id))
    ).scalar_one_or_none()
    if not mode:
        raise HTTPException(status_code=400, detail="Invalid payment mode")

    party_type = (data.party_type or "none").strip().lower()
    if party_type not in ("none", "labour", "partner", "vendor"):
        raise HTTPException(status_code=400, detail="party_type must be none, labour, partner, or vendor")

    labour_id = partner_id = vendor_id = None
    if party_type == "labour":
        if not data.labour_id:
            raise HTTPException(status_code=400, detail="labour_id required")
        if not (await session.execute(select(CfLabour).where(CfLabour.id == data.labour_id))).scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Invalid labour")
        labour_id = data.labour_id
    elif party_type == "partner":
        if not data.partner_id:
            raise HTTPException(status_code=400, detail="partner_id required")
        if not (await session.execute(select(CfPartner).where(CfPartner.id == data.partner_id))).scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Invalid partner")
        partner_id = data.partner_id
    elif party_type == "vendor":
        if not data.vendor_id:
            raise HTTPException(status_code=400, detail="vendor_id required")
        if not (await session.execute(select(CfVendor).where(CfVendor.id == data.vendor_id))).scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Invalid vendor")
        vendor_id = data.vendor_id

    if row is None:
        row = CfTransaction(
            project_id=data.project_id,
            phase_id=data.phase_id,
            work_type_id=data.work_type_id,
            ledger_id=data.ledger_id,
            payment_mode_id=data.payment_mode_id,
            party_type=party_type,
            labour_id=labour_id,
            partner_id=partner_id,
            vendor_id=vendor_id,
            txn_date=data.txn_date,
            amount=data.amount,
            entry_type=mode.entry_type,
            narration=data.narration or "",
            reference=data.reference or "",
        )
        session.add(row)
    else:
        row.project_id = data.project_id
        row.phase_id = data.phase_id
        row.work_type_id = data.work_type_id
        row.ledger_id = data.ledger_id
        row.payment_mode_id = data.payment_mode_id
        row.party_type = party_type
        row.labour_id = labour_id
        row.partner_id = partner_id
        row.vendor_id = vendor_id
        row.txn_date = data.txn_date
        row.amount = data.amount
        row.entry_type = mode.entry_type
        row.narration = data.narration or ""
        row.reference = data.reference or ""
    await session.flush()
    return row


@router.get("/transactions", response_model=list[TransactionOut])
async def list_transactions(
    project_id: UUID | None = None,
    phase_id: UUID | None = None,
    ledger_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    q = select(CfTransaction).order_by(CfTransaction.txn_date.desc(), CfTransaction.created_at.desc())
    if project_id:
        q = q.where(CfTransaction.project_id == project_id)
    if phase_id:
        q = q.where(CfTransaction.phase_id == phase_id)
    if ledger_id:
        q = q.where(CfTransaction.ledger_id == ledger_id)
    rows = list((await session.execute(q)).scalars().all())
    return [await _to_out(session, r) for r in rows]


@router.post("/transactions", response_model=TransactionOut, status_code=201)
async def create_transaction(
    data: TransactionIn,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    row = await _validate_and_apply(session, data)
    return await _to_out(session, row)


@router.put("/transactions/{txn_id}", response_model=TransactionOut)
async def update_transaction(
    txn_id: UUID,
    data: TransactionIn,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    row = (await session.execute(select(CfTransaction).where(CfTransaction.id == txn_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found")
    row = await _validate_and_apply(session, data, row)
    return await _to_out(session, row)


@router.delete("/transactions/{txn_id}")
async def delete_transaction(
    txn_id: UUID,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    row = (await session.execute(select(CfTransaction).where(CfTransaction.id == txn_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found")
    await session.delete(row)
    return {"ok": True}


@router.get("/balances/ledger/{ledger_id}", response_model=BalanceOut)
async def get_ledger_balance(
    ledger_id: UUID,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    return await ledger_balance(session, ledger_id)


@router.get("/balances/partner/{partner_id}", response_model=BalanceOut)
async def get_partner_balance(
    partner_id: UUID,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    return await partner_balance(session, partner_id)


@router.get("/balances/labour/{labour_id}", response_model=BalanceOut)
async def get_labour_balance(
    labour_id: UUID,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    return await labour_balance(session, labour_id)


@router.get("/balances/vendor/{vendor_id}", response_model=BalanceOut)
async def get_vendor_balance(
    vendor_id: UUID,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    return await vendor_balance(session, vendor_id)


@router.get("/balances/lookup", response_model=BalanceOut)
async def lookup_balance(
    ledger_id: UUID | None = Query(None),
    partner_id: UUID | None = Query(None),
    labour_id: UUID | None = Query(None),
    vendor_id: UUID | None = Query(None),
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    if ledger_id:
        return await ledger_balance(session, ledger_id)
    if partner_id:
        return await partner_balance(session, partner_id)
    if labour_id:
        return await labour_balance(session, labour_id)
    if vendor_id:
        return await vendor_balance(session, vendor_id)
    raise HTTPException(status_code=400, detail="Provide ledger_id, partner_id, labour_id, or vendor_id")
