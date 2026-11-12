"""Trial Balance, P&L, Balance Sheet, Receipt & Payment reports."""
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import User
from modules.generp.ge.services.financial_reports import FinancialReportsService

router = APIRouter()


def _json_safe(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_safe(v) for v in obj]
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    try:
        from decimal import Decimal

        if isinstance(obj, Decimal):
            return str(obj)
    except Exception:
        pass
    return obj


@router.get("/trial-balance")
async def trial_balance(
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await FinancialReportsService(session).trial_balance(
        from_date=from_date, to_date=to_date
    )
    return _json_safe(data)


@router.get("/profit-and-loss")
async def profit_and_loss(
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await FinancialReportsService(session).profit_and_loss(
        from_date=from_date, to_date=to_date
    )
    return _json_safe(data)


@router.get("/balance-sheet")
async def balance_sheet(
    as_of: date | None = Query(None),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await FinancialReportsService(session).balance_sheet(as_of=as_of)
    return _json_safe(data)


@router.get("/receipt-payment")
async def receipt_payment(
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    entry_type: str = Query("all", pattern="^(all|receipt|payment)$"),
    limit: int = Query(2000, ge=1, le=5000),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await FinancialReportsService(session).receipt_payment(
        from_date=from_date,
        to_date=to_date,
        entry_type=entry_type,
        limit=limit,
    )
    return _json_safe(data)


@router.get("/voucher/{voucher_id}")
async def voucher_detail(
    voucher_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await FinancialReportsService(session).voucher_detail(voucher_id)
    return _json_safe(data)
