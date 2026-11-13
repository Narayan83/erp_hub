from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.models.cashbook import CashbookVoucher, CashbookVoucherLine
from modules.generp.ge.models.masters import Ledger, Party
from modules.generp.ge.schemas.accounting import (
    CashbookDaybookRead,
    CashbookEntryRead,
    CashbookLedgerStatementRead,
    CashbookPartyAccountRead,
)
from modules.generp.ge.services.cashbook_posting import CashbookPostingService, signed_opening_balance
from modules.generp.ge.services.party_codes import find_party_by_code


def _line_to_entry(
    line: CashbookVoucherLine,
    voucher: CashbookVoucher,
    *,
    running_balance: Decimal | None = None,
) -> CashbookEntryRead:
    ledger = line.ledger
    party = voucher.party
    return CashbookEntryRead(
        id=line.id,
        voucher_id=voucher.id,
        voucher_no=voucher.voucher_no,
        voucher_date=voucher.voucher_date,
        source_type=voucher.source_type,
        source_id=voucher.source_id,
        ledger_id=line.ledger_id,
        ledger_code=ledger.code if ledger else "",
        ledger_name=ledger.name if ledger else "",
        party_id=voucher.party_id,
        party_code=voucher.party_code,
        party_name=party.name if party else None,
        narration=voucher.narration,
        line_narration=getattr(line, "narration", None),
        debit_amount=Decimal(str(line.debit_amount or 0)),
        credit_amount=Decimal(str(line.credit_amount or 0)),
        running_balance=running_balance,
        created_at=line.created_at,
    )


class CashbookService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.posting = CashbookPostingService(session)

    async def _sum_ledger_before(
        self, ledger_id: str, before_date: date | None
    ) -> tuple[float, float]:
        stmt = (
            select(CashbookVoucherLine, CashbookVoucher)
            .join(CashbookVoucher, CashbookVoucherLine.voucher_id == CashbookVoucher.id)
            .where(CashbookVoucherLine.ledger_id == ledger_id)
            .where(CashbookVoucherLine.is_active.is_(True))
            .where(CashbookVoucher.is_active.is_(True))
        )
        if before_date:
            stmt = stmt.where(CashbookVoucher.voucher_date < before_date)
        result = await self.session.execute(stmt)
        total_debit = 0.0
        total_credit = 0.0
        for line, _v in result.all():
            total_debit += float(line.debit_amount or 0)
            total_credit += float(line.credit_amount or 0)
        return total_debit, total_credit

    async def ledger_statement(
        self,
        ledger_id: str,
        *,
        from_date: date | None = None,
        to_date: date | None = None,
        limit: int = 500,
    ) -> CashbookLedgerStatementRead:
        ledger = (
            await self.session.execute(select(Ledger).where(Ledger.id == ledger_id))
        ).scalar_one_or_none()
        if not ledger or not ledger.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ledger not found")

        opening_debit, opening_credit = await self._sum_ledger_before(ledger_id, from_date)
        opening_balance = (
            signed_opening_balance(ledger)
            + Decimal(str(opening_debit))
            - Decimal(str(opening_credit))
        )

        stmt = (
            select(CashbookVoucherLine, CashbookVoucher)
            .join(CashbookVoucher, CashbookVoucherLine.voucher_id == CashbookVoucher.id)
            .options(
                selectinload(CashbookVoucherLine.ledger),
                selectinload(CashbookVoucher.party),
            )
            .where(CashbookVoucherLine.ledger_id == ledger_id)
            .where(CashbookVoucherLine.is_active.is_(True))
            .where(CashbookVoucher.is_active.is_(True))
        )
        if from_date:
            stmt = stmt.where(CashbookVoucher.voucher_date >= from_date)
        if to_date:
            stmt = stmt.where(CashbookVoucher.voucher_date <= to_date)
        stmt = stmt.order_by(
            CashbookVoucher.voucher_date,
            CashbookVoucher.created_at,
            CashbookVoucherLine.sort_order,
        ).limit(limit)
        rows = list((await self.session.execute(stmt)).all())

        entries: list[CashbookEntryRead] = []
        running = opening_balance
        total_debit = Decimal("0")
        total_credit = Decimal("0")
        for line, voucher in rows:
            debit = Decimal(str(line.debit_amount or 0))
            credit = Decimal(str(line.credit_amount or 0))
            total_debit += debit
            total_credit += credit
            running += debit - credit
            entries.append(_line_to_entry(line, voucher, running_balance=running))

        return CashbookLedgerStatementRead(
            ledger_id=ledger.id,
            ledger_code=ledger.code,
            ledger_name=ledger.name,
            from_date=from_date,
            to_date=to_date,
            opening_balance=opening_balance,
            total_debit=total_debit,
            total_credit=total_credit,
            closing_balance=opening_balance + total_debit - total_credit,
            entries=entries,
        )

    async def party_account(
        self,
        *,
        party_id: str | None = None,
        party_code: str | None = None,
        from_date: date | None = None,
        to_date: date | None = None,
        limit: int = 500,
    ) -> CashbookPartyAccountRead:
        party = None
        if party_id:
            party = (
                await self.session.execute(select(Party).where(Party.id == party_id))
            ).scalar_one_or_none()
        elif party_code and party_code.strip():
            party = await find_party_by_code(self.session, party_code, party_type="customer")
        if not party or not party.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

        stmt = (
            select(CashbookVoucherLine, CashbookVoucher)
            .join(CashbookVoucher, CashbookVoucherLine.voucher_id == CashbookVoucher.id)
            .options(
                selectinload(CashbookVoucherLine.ledger),
                selectinload(CashbookVoucher.party),
            )
            .where(CashbookVoucher.party_id == party.id)
            .where(CashbookVoucherLine.is_active.is_(True))
            .where(CashbookVoucher.is_active.is_(True))
        )
        if from_date:
            stmt = stmt.where(CashbookVoucher.voucher_date >= from_date)
        if to_date:
            stmt = stmt.where(CashbookVoucher.voucher_date <= to_date)
        stmt = stmt.order_by(
            CashbookVoucher.voucher_date,
            CashbookVoucher.created_at,
            CashbookVoucherLine.sort_order,
        ).limit(limit)
        rows = list((await self.session.execute(stmt)).all())

        entries: list[CashbookEntryRead] = []
        total_debit = Decimal("0")
        total_credit = Decimal("0")
        for line, voucher in rows:
            debit = Decimal(str(line.debit_amount or 0))
            credit = Decimal(str(line.credit_amount or 0))
            total_debit += debit
            total_credit += credit
            entries.append(_line_to_entry(line, voucher))

        deposit_balance = await self.posting.get_party_deposit_balance(party.id)
        return CashbookPartyAccountRead(
            party_id=party.id,
            party_code=party.code,
            party_name=party.name,
            from_date=from_date,
            to_date=to_date,
            total_debit=total_debit,
            total_credit=total_credit,
            balance=total_credit - total_debit,
            deposit_balance=deposit_balance,
            entries=entries,
        )

    async def daybook(
        self,
        *,
        from_date: date | None = None,
        to_date: date | None = None,
        limit: int = 2000,
    ) -> CashbookDaybookRead:
        stmt = (
            select(CashbookVoucherLine, CashbookVoucher)
            .join(CashbookVoucher, CashbookVoucherLine.voucher_id == CashbookVoucher.id)
            .options(
                selectinload(CashbookVoucherLine.ledger),
                selectinload(CashbookVoucher.party),
            )
            .where(CashbookVoucherLine.is_active.is_(True))
            .where(CashbookVoucher.is_active.is_(True))
        )
        if from_date:
            stmt = stmt.where(CashbookVoucher.voucher_date >= from_date)
        if to_date:
            stmt = stmt.where(CashbookVoucher.voucher_date <= to_date)
        stmt = stmt.order_by(
            CashbookVoucher.voucher_date,
            CashbookVoucher.created_at,
            CashbookVoucherLine.sort_order,
        ).limit(limit)
        return await self._daybook_from_rows(from_date, to_date, list((await self.session.execute(stmt)).all()))

    async def cash_book(
        self,
        *,
        from_date: date | None = None,
        to_date: date | None = None,
        limit: int = 2000,
    ) -> CashbookDaybookRead:
        stmt = (
            select(CashbookVoucherLine, CashbookVoucher)
            .join(CashbookVoucher, CashbookVoucherLine.voucher_id == CashbookVoucher.id)
            .join(Ledger, CashbookVoucherLine.ledger_id == Ledger.id)
            .options(
                selectinload(CashbookVoucherLine.ledger),
                selectinload(CashbookVoucher.party),
            )
            .where(CashbookVoucherLine.is_active.is_(True))
            .where(CashbookVoucher.is_active.is_(True))
            .where((Ledger.is_cash.is_(True)) | (Ledger.is_bank.is_(True)))
        )
        if from_date:
            stmt = stmt.where(CashbookVoucher.voucher_date >= from_date)
        if to_date:
            stmt = stmt.where(CashbookVoucher.voucher_date <= to_date)
        stmt = stmt.order_by(
            CashbookVoucher.voucher_date,
            CashbookVoucher.created_at,
            CashbookVoucherLine.sort_order,
        ).limit(limit)
        return await self._daybook_from_rows(from_date, to_date, list((await self.session.execute(stmt)).all()))

    async def _daybook_from_rows(
        self,
        from_date: date | None,
        to_date: date | None,
        rows: list,
    ) -> CashbookDaybookRead:
        entries: list[CashbookEntryRead] = []
        total_debit = Decimal("0")
        total_credit = Decimal("0")
        for line, voucher in rows:
            debit = Decimal(str(line.debit_amount or 0))
            credit = Decimal(str(line.credit_amount or 0))
            total_debit += debit
            total_credit += credit
            entries.append(_line_to_entry(line, voucher))
        return CashbookDaybookRead(
            from_date=from_date,
            to_date=to_date,
            total_debit=total_debit,
            total_credit=total_credit,
            entries=entries,
        )
