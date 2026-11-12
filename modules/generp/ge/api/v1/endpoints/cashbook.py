from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import User
from modules.generp.ge.schemas.accounting import (
    AccountingVoucherRead,
    AdvanceCollectionCreate,
    CashbookDaybookRead,
    CashbookLedgerStatementRead,
    CashbookPartyAccountRead,
    ContraEntryCreate,
    JournalVoucherListItem,
    JournalVoucherRead,
    JournalVoucherWrite,
    LedgerBalanceRead,
    PartyDepositBalanceRead,
    PaymentVoucherCreate,
)
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.services.accounting_voucher import AccountingVoucherService
from modules.generp.ge.services.cashbook import CashbookService

router = APIRouter()


@router.get("/ledger/{ledger_id}", response_model=CashbookLedgerStatementRead)
async def ledger_statement(
    ledger_id: str,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await CashbookService(session).ledger_statement(
        ledger_id, from_date=from_date, to_date=to_date, limit=limit
    )


@router.get("/party-account", response_model=CashbookPartyAccountRead)
async def party_account(
    party_id: str | None = Query(None),
    party_code: str | None = Query(None),
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await CashbookService(session).party_account(
        party_id=party_id,
        party_code=party_code,
        from_date=from_date,
        to_date=to_date,
        limit=limit,
    )


@router.get("/party-deposit", response_model=PartyDepositBalanceRead)
async def party_deposit_balance(
    party_id: str | None = Query(None),
    party_code: str | None = Query(None),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await AccountingVoucherService(session).party_deposit_balance(
        party_id=party_id, party_code=party_code
    )


@router.get("/daybook", response_model=CashbookDaybookRead)
async def daybook(
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    limit: int = Query(2000, ge=1, le=5000),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await CashbookService(session).daybook(
        from_date=from_date, to_date=to_date, limit=limit
    )


@router.get("/cash-book", response_model=CashbookDaybookRead)
async def cash_book(
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    limit: int = Query(2000, ge=1, le=5000),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await CashbookService(session).cash_book(
        from_date=from_date, to_date=to_date, limit=limit
    )


@router.post("/advance", response_model=AccountingVoucherRead, status_code=201)
async def collect_advance(
    data: AdvanceCollectionCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await AccountingVoucherService(session).collect_advance(data)


@router.post("/payment", response_model=AccountingVoucherRead, status_code=201)
async def create_payment_voucher(
    data: PaymentVoucherCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await AccountingVoucherService(session).create_payment_voucher(data)


@router.post("/contra", response_model=AccountingVoucherRead, status_code=201)
async def create_contra_entry(
    data: ContraEntryCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await AccountingVoucherService(session).create_contra_entry(data)


@router.get("/ledger-balances", response_model=list[LedgerBalanceRead])
async def ledger_balances(
    exclude_voucher_id: str | None = Query(None),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await AccountingVoucherService(session).ledger_balances(
        exclude_voucher_id=exclude_voucher_id
    )


@router.get("/vouchers", response_model=list[JournalVoucherListItem])
async def list_accounting_vouchers(
    source_type: str | None = Query(None),
    kind: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    include_inactive: bool = Query(False),
    limit: int = Query(300, ge=1, le=1000),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await AccountingVoucherService(session).list_vouchers(
        source_type=source_type,
        kind=kind,
        date_from=date_from,
        date_to=date_to,
        include_inactive=include_inactive,
        limit=limit,
    )


@router.get("/vouchers/{voucher_id}", response_model=JournalVoucherRead)
async def get_accounting_voucher(
    voucher_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await AccountingVoucherService(session).get_voucher(voucher_id)


@router.put("/vouchers/{voucher_id}", response_model=JournalVoucherRead)
async def update_accounting_voucher(
    voucher_id: str,
    data: JournalVoucherWrite,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await AccountingVoucherService(session).update_voucher(voucher_id, data)


@router.delete("/vouchers/{voucher_id}", response_model=MessageResponse)
async def delete_accounting_voucher(
    voucher_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    snapshot = await AccountingVoucherService(session).delete_voucher(voucher_id)
    return MessageResponse(message=f"Deleted {snapshot.get('voucher_no') or 'entry'}")
