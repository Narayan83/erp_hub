from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.masters import Ledger
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.masters import LedgerIn, LedgerOut, LedgerUpdate
from modules.generp.ge.services.cashbook_posting import opening_type_for
from modules.generp.ge.services.ledger_codes import next_ledger_code, parse_ledger_n, normalize_ledger_code

router = APIRouter()

VALID_TYPES = {"ASSET", "LIABILITY", "INCOME", "EXPENSE"}


def _validate_flags(is_cash: bool, is_bank: bool, ledger_type: str | None = None) -> None:
    if is_cash and is_bank:
        raise HTTPException(status_code=400, detail="Ledger cannot be both Cash and Bank")
    if ledger_type is not None and ledger_type.upper() not in VALID_TYPES:
        raise HTTPException(
            status_code=400,
            detail="ledger_type must be ASSET, LIABILITY, INCOME, or EXPENSE",
        )


@router.get("", response_model=list[LedgerOut])
async def list_ledgers(_u=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Ledger).where(Ledger.is_active.is_(True)))
    rows = list(result.scalars().all())

    def _ledger_sort(row: Ledger) -> tuple:
        n = parse_ledger_n(row.code)
        if n:
            return (0, n, row.code or "")
        return (1, 0, row.code or "")

    rows.sort(key=_ledger_sort)
    return rows


@router.get("/next-code")
async def peek_next_ledger_code(
    _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    return {"next_code": await next_ledger_code(session)}


@router.post("", response_model=LedgerOut)
async def create_ledger(
    data: LedgerIn, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    _validate_flags(data.is_cash, data.is_bank, data.ledger_type)
    payload = data.model_dump()
    payload["ledger_type"] = (payload.get("ledger_type") or "ASSET").upper()
    payload["opening_type"] = opening_type_for(payload["ledger_type"])
    payload["opening_balance"] = abs(float(payload.get("opening_balance") or 0))

    raw_code = (payload.get("code") or "").strip()
    if raw_code:
        payload["code"] = normalize_ledger_code(raw_code)
        existing = (
            await session.execute(select(Ledger).where(Ledger.code == payload["code"]))
        ).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=400, detail=f"Ledger code '{payload['code']}' already exists")
    else:
        try:
            payload["code"] = await next_ledger_code(session)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    obj = Ledger(**payload)
    session.add(obj)
    await session.flush()
    return obj


@router.patch("/{ledger_id}", response_model=LedgerOut)
async def update_ledger(
    ledger_id: str,
    data: LedgerUpdate,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (await session.execute(select(Ledger).where(Ledger.id == ledger_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    updates = data.model_dump(exclude_unset=True)
    is_cash = updates.get("is_cash", obj.is_cash)
    is_bank = updates.get("is_bank", obj.is_bank)
    ledger_type = updates.get("ledger_type", obj.ledger_type)
    _validate_flags(bool(is_cash), bool(is_bank), ledger_type)
    if "ledger_type" in updates:
        updates["ledger_type"] = updates["ledger_type"].upper()
        updates["opening_type"] = opening_type_for(updates["ledger_type"])
    if "opening_balance" in updates and updates["opening_balance"] is not None:
        updates["opening_balance"] = abs(float(updates["opening_balance"]))
    for k, v in updates.items():
        setattr(obj, k, v)
    await session.flush()
    return obj


@router.delete("/{ledger_id}", response_model=MessageResponse)
async def delete_ledger(
    ledger_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = (await session.execute(select(Ledger).where(Ledger.id == ledger_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    obj.is_active = False
    await session.flush()
    return MessageResponse(message="Ledger deactivated")
