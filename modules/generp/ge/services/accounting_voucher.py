from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.models.cashbook import CashbookVoucher, CashbookVoucherLine
from modules.generp.ge.models.masters import Ledger, Party
from modules.generp.ge.schemas.accounting import (
    AccountingVoucherRead,
    AdvanceCollectionCreate,
    ContraEntryCreate,
    JournalVoucherListItem,
    JournalVoucherRead,
    JournalVoucherWrite,
    JournalLineRead,
    LedgerBalanceRead,
    PartyDepositBalanceRead,
    PaymentVoucherCreate,
)
from modules.generp.ge.services.cashbook_posting import (
    CashbookPostingService,
    dump_cashbook_trace,
    next_accounting_voucher_no,
    signed_opening_balance,
)
from modules.generp.ge.services.party_codes import find_party_by_code

EDITABLE_SOURCES = ("payment_voucher", "contra_entry")


def _money(value) -> Decimal:
    return Decimal(str(value or 0))


def _infer_kind(voucher: CashbookVoucher) -> str:
    stored = (getattr(voucher, "kind", None) or "").strip().lower()
    if stored:
        return stored
    if voucher.source_type == "contra_entry":
        return "contra"
    if voucher.source_type == "advance_collection":
        return "advance"
    cash_net = Decimal("0")
    for line in voucher.lines or []:
        if not line.is_active:
            continue
        ledger = line.ledger
        if ledger and (ledger.is_cash or ledger.is_bank):
            cash_net += _money(line.debit_amount) - _money(line.credit_amount)
    return "receipt" if cash_net >= 0 else "payment"


def _accounts_label(voucher: CashbookVoucher) -> str:
    names: list[str] = []
    for line in sorted(voucher.lines or [], key=lambda x: x.sort_order or 0):
        ledger = line.ledger
        if ledger and ledger.name:
            names.append(ledger.name)
        if len(names) >= 3:
            break
    return ", ".join(names)


def _to_journal_read(voucher: CashbookVoucher) -> JournalVoucherRead:
    lines: list[JournalLineRead] = []
    total_dr = Decimal("0")
    total_cr = Decimal("0")
    for line in sorted(voucher.lines or [], key=lambda x: x.sort_order or 0):
        debit = _money(line.debit_amount)
        credit = _money(line.credit_amount)
        total_dr += debit
        total_cr += credit
        ledger = line.ledger
        lines.append(
            JournalLineRead(
                id=line.id,
                ledger_id=line.ledger_id,
                ledger_code=ledger.code if ledger else "",
                ledger_name=ledger.name if ledger else "",
                debit_amount=debit,
                credit_amount=credit,
                narration=line.narration,
                sort_order=line.sort_order or 0,
            )
        )
    party = voucher.party
    return JournalVoucherRead(
        id=voucher.id,
        voucher_no=voucher.voucher_no,
        voucher_date=voucher.voucher_date,
        source_type=voucher.source_type,
        source_id=voucher.source_id,
        kind=_infer_kind(voucher),
        party_id=voucher.party_id,
        party_code=voucher.party_code,
        party_name=party.name if party else None,
        narration=voucher.narration,
        is_active=bool(voucher.is_active),
        total_debit=total_dr,
        total_credit=total_cr,
        lines=lines,
    )


def _to_list_item(voucher: CashbookVoucher) -> JournalVoucherListItem:
    total_dr = Decimal("0")
    total_cr = Decimal("0")
    count = 0
    for line in voucher.lines or []:
        total_dr += _money(line.debit_amount)
        total_cr += _money(line.credit_amount)
        count += 1
    party = voucher.party
    return JournalVoucherListItem(
        id=voucher.id,
        voucher_no=voucher.voucher_no,
        voucher_date=voucher.voucher_date,
        source_type=voucher.source_type,
        kind=_infer_kind(voucher),
        party_id=voucher.party_id,
        party_code=voucher.party_code,
        party_name=party.name if party else None,
        narration=voucher.narration,
        is_active=bool(voucher.is_active),
        line_count=count,
        total_debit=total_dr,
        total_credit=total_cr,
        accounts=_accounts_label(voucher),
    )


class AccountingVoucherService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.posting = CashbookPostingService(session)

    async def _resolve_party(self, party_id: str) -> Party:
        party = (
            await self.session.execute(select(Party).where(Party.id == party_id))
        ).scalar_one_or_none()
        if not party or not party.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
        if party.party_type not in ("customer", "both"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Advance / deposit requires a customer party",
            )
        return party

    async def collect_advance(self, data: AdvanceCollectionCreate) -> AccountingVoucherRead:
        party = await self._resolve_party(data.party_id)
        voucher_date = data.voucher_date or date.today()
        voucher_id = str(uuid4())
        voucher_no = await next_accounting_voucher_no(self.session, "advance", voucher_date)
        voucher = await self.posting.post_advance_collection(
            voucher_id=voucher_id,
            voucher_no=voucher_no,
            voucher_date=voucher_date,
            party_id=party.id,
            party_code=party.code,
            payment_mode_id=data.payment_mode_id,
            amount=Decimal(str(data.amount)),
            narration=data.narration,
        )
        return AccountingVoucherRead.model_validate(voucher)

    def _lines_payload(self, rows) -> list[dict]:
        return [
            {
                "ledger_id": row.ledger_id,
                "debit_amount": row.debit_amount,
                "credit_amount": row.credit_amount,
                "narration": row.narration,
            }
            for row in rows
        ]

    async def create_payment_voucher(self, data: PaymentVoucherCreate) -> AccountingVoucherRead:
        party = None
        party_code = None
        if data.party_id:
            party = await self._resolve_party(data.party_id)
            party_code = party.code

        voucher_date = data.voucher_date or date.today()
        voucher_id = str(uuid4())
        voucher_no = await next_accounting_voucher_no(self.session, "payment", voucher_date)
        kind = (data.entry_type or "receipt").strip().lower()
        if kind not in ("receipt", "payment"):
            kind = "receipt"

        if data.lines:
            voucher = await self.posting.post_journal_voucher(
                voucher_id=voucher_id,
                voucher_no=voucher_no,
                voucher_date=voucher_date,
                source_type="payment_voucher",
                kind=kind,
                party_id=party.id if party else None,
                party_code=party_code,
                narration=data.narration,
                lines=self._lines_payload(data.lines),
            )
            return AccountingVoucherRead.model_validate(voucher)

        if not data.ledger_id or not data.counter_ledger_id or data.amount is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provide lines, or ledger_id / counter_ledger_id / amount",
            )

        if data.entry_type == "payment" and data.party_id:
            ledger = await self.posting._require_ledger_by_id(data.ledger_id)
            if ledger.is_party_deposit:
                available = await self.posting.get_party_deposit_balance(data.party_id)
                if Decimal(str(data.amount)) > available + Decimal("0.01"):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Insufficient customer advance balance. Available: {available:.2f}",
                    )

        voucher = await self.posting.post_payment_voucher(
            voucher_id=voucher_id,
            voucher_no=voucher_no,
            voucher_date=voucher_date,
            ledger_id=data.ledger_id,
            counter_ledger_id=data.counter_ledger_id,
            party_id=party.id if party else None,
            party_code=party_code,
            amount=Decimal(str(data.amount)),
            entry_type=kind,
            narration=data.narration,
        )
        return AccountingVoucherRead.model_validate(voucher)

    async def _resolve_any_party(self, party_id: str) -> Party:
        party = (
            await self.session.execute(select(Party).where(Party.id == party_id))
        ).scalar_one_or_none()
        if not party or not party.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Party not found")
        return party

    async def create_contra_entry(self, data: ContraEntryCreate) -> AccountingVoucherRead:
        party = None
        party_code = None
        if data.party_id:
            party = await self._resolve_any_party(data.party_id)
            party_code = party.code

        voucher_date = data.voucher_date or date.today()
        voucher_id = str(uuid4())
        voucher_no = await next_accounting_voucher_no(self.session, "contra", voucher_date)
        if data.lines:
            voucher = await self.posting.post_journal_voucher(
                voucher_id=voucher_id,
                voucher_no=voucher_no,
                voucher_date=voucher_date,
                source_type="contra_entry",
                kind="contra",
                party_id=party.id if party else None,
                party_code=party_code,
                narration=data.narration,
                lines=self._lines_payload(data.lines),
            )
            return AccountingVoucherRead.model_validate(voucher)

        pairs = [
            {
                "from_ledger_id": p.from_ledger_id,
                "to_ledger_id": p.to_ledger_id,
                "amount": Decimal(str(p.amount)),
                "debit_narration": p.debit_narration,
                "credit_narration": p.credit_narration,
            }
            for p in (data.pairs or [])
        ]
        voucher = await self.posting.post_contra_entry(
            voucher_id=voucher_id,
            voucher_no=voucher_no,
            voucher_date=voucher_date,
            narration=data.narration,
            pairs=pairs,
            party_id=party.id if party else None,
            party_code=party_code,
        )
        return AccountingVoucherRead.model_validate(voucher)

    def _voucher_query(self):
        return select(CashbookVoucher).options(
            selectinload(CashbookVoucher.lines).selectinload(CashbookVoucherLine.ledger),
            selectinload(CashbookVoucher.party),
        )

    async def load_voucher(self, voucher_id: str) -> CashbookVoucher:
        voucher = (
            await self.session.execute(self._voucher_query().where(CashbookVoucher.id == voucher_id))
        ).scalar_one_or_none()
        if not voucher:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
        return voucher

    async def get_voucher(self, voucher_id: str) -> JournalVoucherRead:
        return _to_journal_read(await self.load_voucher(voucher_id))

    async def list_vouchers(
        self,
        *,
        source_type: str | None = None,
        kind: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        include_inactive: bool = False,
        limit: int = 300,
    ) -> list[JournalVoucherListItem]:
        stmt = self._voucher_query()
        if source_type:
            stmt = stmt.where(CashbookVoucher.source_type == source_type)
        else:
            stmt = stmt.where(CashbookVoucher.source_type.in_(EDITABLE_SOURCES))
        if not include_inactive:
            stmt = stmt.where(CashbookVoucher.is_active.is_(True))
        if date_from:
            stmt = stmt.where(CashbookVoucher.voucher_date >= date_from)
        if date_to:
            stmt = stmt.where(CashbookVoucher.voucher_date <= date_to)
        stmt = stmt.order_by(
            CashbookVoucher.voucher_date.desc(),
            CashbookVoucher.created_at.desc(),
        ).limit(limit)
        rows = list((await self.session.execute(stmt)).scalars().unique().all())
        items = [_to_list_item(v) for v in rows]
        if kind and kind.strip():
            want = kind.strip().lower()
            items = [x for x in items if x.kind == want]
        return items

    async def update_voucher(self, voucher_id: str, data: JournalVoucherWrite) -> JournalVoucherRead:
        voucher = await self.load_voucher(voucher_id)
        if voucher.source_type not in EDITABLE_SOURCES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This cashbook posting cannot be edited here",
            )
        if not voucher.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This entry is deleted",
            )
        kind = (data.kind or "").strip().lower()
        if voucher.source_type == "contra_entry":
            kind = "contra"
        elif kind not in ("receipt", "payment"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Kind must be receipt or payment",
            )

        party = None
        party_code = None
        if data.party_id:
            if kind == "contra":
                party = await self._resolve_any_party(data.party_id)
            else:
                party = await self._resolve_party(data.party_id)
            party_code = party.code

        await self.posting.replace_journal_lines(
            voucher,
            voucher_date=data.voucher_date or voucher.voucher_date,
            kind=kind,
            party_id=party.id if party else None,
            party_code=party_code,
            narration=data.narration,
            lines=self._lines_payload(data.lines),
        )
        await self.session.refresh(voucher)
        return _to_journal_read(await self.load_voucher(voucher.id))

    async def delete_voucher(self, voucher_id: str) -> dict:
        voucher = await self.load_voucher(voucher_id)
        if voucher.source_type not in EDITABLE_SOURCES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This cashbook posting cannot be deleted here",
            )
        if not voucher.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This entry is already deleted",
            )
        snapshot = dump_cashbook_trace(voucher)
        await self.posting.deactivate_voucher(voucher)
        return snapshot

    async def restore_voucher(self, voucher_id: str) -> JournalVoucherRead:
        voucher = await self.load_voucher(voucher_id)
        if voucher.source_type not in EDITABLE_SOURCES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This cashbook posting cannot be restored here",
            )
        await self.posting.reactivate_voucher(voucher)
        return _to_journal_read(await self.load_voucher(voucher.id))

    async def ledger_balances(
        self, exclude_voucher_id: str | None = None
    ) -> list[LedgerBalanceRead]:
        ledgers = list(
            (
                await self.session.execute(select(Ledger).where(Ledger.is_active.is_(True)))
            ).scalars().all()
        )
        stmt = (
            select(
                CashbookVoucherLine.ledger_id,
                func.coalesce(func.sum(CashbookVoucherLine.debit_amount), 0),
                func.coalesce(func.sum(CashbookVoucherLine.credit_amount), 0),
            )
            .join(CashbookVoucher, CashbookVoucherLine.voucher_id == CashbookVoucher.id)
            .where(CashbookVoucherLine.is_active.is_(True))
            .where(CashbookVoucher.is_active.is_(True))
            .group_by(CashbookVoucherLine.ledger_id)
        )
        if exclude_voucher_id:
            stmt = stmt.where(CashbookVoucher.id != exclude_voucher_id)
        totals = {
            lid: (_money(dr), _money(cr))
            for lid, dr, cr in (await self.session.execute(stmt)).all()
        }
        out: list[LedgerBalanceRead] = []
        for ledger in ledgers:
            dr, cr = totals.get(ledger.id, (Decimal("0"), Decimal("0")))
            signed = signed_opening_balance(ledger) + dr - cr
            out.append(
                LedgerBalanceRead(
                    ledger_id=ledger.id,
                    balance=abs(signed),
                    side="Cr" if signed < 0 else "Dr",
                )
            )
        return out

    async def party_deposit_balance(
        self,
        *,
        party_id: str | None = None,
        party_code: str | None = None,
    ) -> PartyDepositBalanceRead:
        party = None
        if party_id:
            party = await self._resolve_party(party_id)
        elif party_code and party_code.strip():
            party = await find_party_by_code(self.session, party_code, party_type="customer")
            if not party or not party.is_active:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="party_id or party_code is required",
            )

        balance = await self.posting.get_party_deposit_balance(party.id)
        return PartyDepositBalanceRead(
            party_id=party.id,
            party_code=party.code,
            party_name=party.name,
            balance=balance,
        )

