from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.models.cashbook import CashbookVoucher, CashbookVoucherLine
from modules.generp.ge.models.masters import Ledger, PaymentMode
from modules.generp.ge.services.document_numbers import next_document_no
from modules.generp.ge.services.ledger_codes import ledger_by_key

INCOME_LEDGER_CODES = {
    "sale_bill": "SALES",
    "wholesale_bill": "SALES",
    "shop_sale": "SALES",
}

PARTY_ACCOUNT_LEDGER_CODE = "PARTY-ACCOUNT"
CUST_DEPOSIT_LEDGER_CODE = "CUST-DEPOSIT"

LEDGER_TYPE_OPENING = {
    "ASSET": "Dr",
    "EXPENSE": "Dr",
    "LIABILITY": "Cr",
    "INCOME": "Cr",
}


def signed_opening_balance(ledger: Ledger) -> Decimal:
    """Debit-positive opening used in cashbook / ledger statements."""
    amount = abs(Decimal(str(ledger.opening_balance or 0)))
    ltype = (ledger.ledger_type or "").upper()
    if ltype in ("LIABILITY", "INCOME") or (ledger.opening_type or "").upper() == "CR":
        if ltype in ("LIABILITY", "INCOME"):
            return -amount
        if (ledger.opening_type or "").upper() == "CR":
            return -amount
    return amount


def opening_type_for(ledger_type: str) -> str:
    return LEDGER_TYPE_OPENING.get((ledger_type or "ASSET").upper(), "Dr")


async def next_accounting_voucher_no(
    session: AsyncSession, kind: str, voucher_date: date | None = None
) -> str:
    return await next_document_no(
        session, f"accounting_{(kind or 'voucher').lower()}", voucher_date
    )


class CashbookPostingService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def _require_ledger(self, code: str) -> Ledger:
        ledger = await ledger_by_key(self.session, code)
        if not ledger or not ledger.is_active:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Required ledger '{code}' is not configured",
            )
        return ledger

    async def _require_ledger_by_id(self, ledger_id: str) -> Ledger:
        ledger = (
            await self.session.execute(select(Ledger).where(Ledger.id == ledger_id))
        ).scalar_one_or_none()
        if not ledger or not ledger.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ledger not found")
        return ledger

    async def deactivate_by_source(self, source_type: str, source_id: str) -> None:
        result = await self.session.execute(
            select(CashbookVoucher)
            .options(selectinload(CashbookVoucher.lines))
            .where(CashbookVoucher.source_type == source_type)
            .where(CashbookVoucher.source_id == source_id)
            .where(CashbookVoucher.is_active.is_(True))
        )
        for voucher in result.scalars().all():
            voucher.is_active = False
            for line in voucher.lines:
                line.is_active = False

    async def sum_party_deposit_balance(
        self, party_id: str, exclude_voucher_id: str | None = None
    ) -> Decimal:
        deposit = await self._require_ledger(CUST_DEPOSIT_LEDGER_CODE)
        stmt = (
            select(CashbookVoucherLine, CashbookVoucher)
            .join(CashbookVoucher, CashbookVoucherLine.voucher_id == CashbookVoucher.id)
            .where(CashbookVoucherLine.ledger_id == deposit.id)
            .where(CashbookVoucher.party_id == party_id)
            .where(CashbookVoucherLine.is_active.is_(True))
            .where(CashbookVoucher.is_active.is_(True))
        )
        if exclude_voucher_id:
            stmt = stmt.where(CashbookVoucher.id != exclude_voucher_id)
        result = await self.session.execute(stmt)
        total_debit = Decimal("0")
        total_credit = Decimal("0")
        for line, _v in result.all():
            total_debit += Decimal(str(line.debit_amount or 0))
            total_credit += Decimal(str(line.credit_amount or 0))
        return total_credit - total_debit

    async def get_party_deposit_balance(
        self, party_id: str, exclude_voucher_id: str | None = None
    ) -> Decimal:
        return await self.sum_party_deposit_balance(party_id, exclude_voucher_id)

    async def post_bill(
        self,
        *,
        source_type: str,
        source_id: str,
        bill_no: str,
        bill_date: date,
        party_id: str | None,
        party_code: str | None,
        payment_entries: list[tuple[str, Decimal]],
        gross_amount: Decimal,
        net_amount: Decimal,
        adjust_advance: Decimal = Decimal("0"),
    ) -> CashbookVoucher:
        if source_type not in INCOME_LEDGER_CODES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported cashbook source type: {source_type}",
            )

        adjust = max(Decimal("0"), Decimal(str(adjust_advance or 0)))
        net = max(Decimal("0"), Decimal(str(net_amount or 0)))
        bill_value = net + adjust
        if bill_value <= 0 and Decimal(str(gross_amount or 0)) > 0:
            bill_value = max(Decimal("0"), Decimal(str(gross_amount or 0)))

        pay_total = sum((Decimal(str(a or 0)) for _m, a in payment_entries), Decimal("0"))
        if abs(pay_total - net) > Decimal("0.01"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payment total {pay_total:.2f} must equal net {net:.2f}",
            )

        if adjust > 0:
            if not party_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Customer is required when adjusting advance",
                )
            available = await self.get_party_deposit_balance(party_id)
            if adjust > available + Decimal("0.01"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Insufficient customer advance balance. Available: {available:.2f}, "
                        f"requested adjustment: {adjust:.2f}"
                    ),
                )

        await self.deactivate_by_source(source_type, source_id)

        income_ledger = await self._require_ledger(INCOME_LEDGER_CODES[source_type])
        party_account_ledger = await self._require_ledger(PARTY_ACCOUNT_LEDGER_CODE)

        bill_label = {
            "sale_bill": "Sale",
            "wholesale_bill": "Wholesale",
            "shop_sale": "Shop",
        }.get(source_type, "Sale")
        narration = f"{bill_label} Bill {bill_no}"
        if adjust > 0:
            narration = f"{narration} (Advance adjusted {adjust:.2f})"

        voucher = CashbookVoucher(
            voucher_no=bill_no,
            voucher_date=bill_date,
            source_type=source_type,
            source_id=source_id,
            party_id=party_id,
            party_code=party_code,
            narration=narration,
            is_active=True,
            lines=[],
        )
        self.session.add(voucher)
        await self.session.flush()

        sort_order = 0
        for mode_id, amount in payment_entries:
            amt = Decimal(str(amount or 0))
            if amt <= 0:
                continue
            mode = (
                await self.session.execute(select(PaymentMode).where(PaymentMode.id == mode_id))
            ).scalar_one_or_none()
            if not mode or not mode.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Payment mode not found: {mode_id}",
                )
            if mode.is_credit:
                continue
            if not mode.ledger_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Payment mode '{mode.name}' has no ledger mapped. "
                        "Configure the ledger in Payment Mode Creation."
                    ),
                )
            voucher.lines.append(
                CashbookVoucherLine(
                    ledger_id=mode.ledger_id,
                    debit_amount=amt,
                    credit_amount=Decimal("0"),
                    sort_order=sort_order,
                    is_active=True,
                )
            )
            sort_order += 1

        if adjust > 0:
            deposit_ledger = await self._require_ledger(CUST_DEPOSIT_LEDGER_CODE)
            voucher.lines.append(
                CashbookVoucherLine(
                    ledger_id=deposit_ledger.id,
                    debit_amount=adjust,
                    credit_amount=Decimal("0"),
                    sort_order=sort_order,
                    is_active=True,
                )
            )
            sort_order += 1

        voucher.lines.append(
            CashbookVoucherLine(
                ledger_id=income_ledger.id,
                debit_amount=Decimal("0"),
                credit_amount=bill_value,
                sort_order=sort_order,
                is_active=True,
            )
        )
        sort_order += 1

        # PARTY-ACCOUNT wash: credit bill value, debit each payment + adjust
        voucher.lines.append(
            CashbookVoucherLine(
                ledger_id=party_account_ledger.id,
                debit_amount=Decimal("0"),
                credit_amount=bill_value,
                sort_order=sort_order,
                is_active=True,
            )
        )
        sort_order += 1

        for mode_id, amount in payment_entries:
            amt = Decimal(str(amount or 0))
            if amt <= 0:
                continue
            mode = (
                await self.session.execute(select(PaymentMode).where(PaymentMode.id == mode_id))
            ).scalar_one_or_none()
            if mode and mode.is_credit:
                continue
            voucher.lines.append(
                CashbookVoucherLine(
                    ledger_id=party_account_ledger.id,
                    debit_amount=amt,
                    credit_amount=Decimal("0"),
                    sort_order=sort_order,
                    is_active=True,
                )
            )
            sort_order += 1

        if adjust > 0:
            voucher.lines.append(
                CashbookVoucherLine(
                    ledger_id=party_account_ledger.id,
                    debit_amount=adjust,
                    credit_amount=Decimal("0"),
                    sort_order=sort_order,
                    is_active=True,
                )
            )

        await self.session.flush()
        return voucher

    async def post_advance_collection(
        self,
        *,
        voucher_id: str,
        voucher_no: str,
        voucher_date: date,
        party_id: str,
        party_code: str,
        payment_mode_id: str,
        amount: Decimal,
        narration: str | None,
    ) -> CashbookVoucher:
        amount = Decimal(str(amount))
        mode = (
            await self.session.execute(select(PaymentMode).where(PaymentMode.id == payment_mode_id))
        ).scalar_one_or_none()
        if not mode or not mode.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment mode not found")
        if not mode.ledger_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payment mode '{mode.name}' has no ledger mapped",
            )

        deposit_ledger = await self._require_ledger(CUST_DEPOSIT_LEDGER_CODE)
        voucher = CashbookVoucher(
            id=str(uuid4()),
            voucher_no=voucher_no,
            voucher_date=voucher_date,
            source_type="advance_collection",
            source_id=voucher_id,
            party_id=party_id,
            party_code=party_code,
            narration=narration or f"Advance collection — {party_code}",
            is_active=True,
            lines=[
                CashbookVoucherLine(
                    ledger_id=mode.ledger_id,
                    debit_amount=amount,
                    credit_amount=Decimal("0"),
                    sort_order=0,
                    is_active=True,
                ),
                CashbookVoucherLine(
                    ledger_id=deposit_ledger.id,
                    debit_amount=Decimal("0"),
                    credit_amount=amount,
                    sort_order=1,
                    is_active=True,
                ),
            ],
        )
        self.session.add(voucher)
        await self.session.flush()
        return voucher

    async def post_payment_voucher(
        self,
        *,
        voucher_id: str,
        voucher_no: str,
        voucher_date: date,
        ledger_id: str,
        counter_ledger_id: str,
        party_id: str | None,
        party_code: str | None,
        amount: Decimal,
        entry_type: str,
        narration: str | None,
    ) -> CashbookVoucher:
        amount = Decimal(str(amount))
        ledger = await self._require_ledger_by_id(ledger_id)
        counter = await self._require_ledger_by_id(counter_ledger_id)
        entry = (entry_type or "receipt").strip().lower()

        if ledger.is_party_deposit and not party_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Customer is required when using a party deposit ledger",
            )

        if entry == "receipt":
            debit_ledger_id = counter.id
            credit_ledger_id = ledger.id
        else:
            debit_ledger_id = ledger.id
            credit_ledger_id = counter.id

        voucher = CashbookVoucher(
            id=str(uuid4()),
            voucher_no=voucher_no,
            voucher_date=voucher_date,
            source_type="payment_voucher",
            source_id=voucher_id,
            party_id=party_id,
            party_code=party_code,
            narration=narration or f"Payment voucher {voucher_no}",
            kind=entry if entry in ("receipt", "payment") else "payment",
            is_active=True,
            lines=[
                CashbookVoucherLine(
                    ledger_id=debit_ledger_id,
                    debit_amount=amount,
                    credit_amount=Decimal("0"),
                    sort_order=0,
                    is_active=True,
                ),
                CashbookVoucherLine(
                    ledger_id=credit_ledger_id,
                    debit_amount=Decimal("0"),
                    credit_amount=amount,
                    sort_order=1,
                    is_active=True,
                ),
            ],
        )
        self.session.add(voucher)
        await self.session.flush()
        return voucher

    async def post_contra_entry(
        self,
        *,
        voucher_id: str,
        voucher_no: str,
        voucher_date: date,
        narration: str | None,
        pairs: list[dict],
        party_id: str | None = None,
        party_code: str | None = None,
    ) -> CashbookVoucher:
        if not pairs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one contra pair is required",
            )

        lines: list[CashbookVoucherLine] = []
        labels: list[str] = []
        sort_order = 0
        for pair in pairs:
            amount = Decimal(str(pair["amount"]))
            from_ledger = await self._require_ledger_by_id(pair["from_ledger_id"])
            to_ledger = await self._require_ledger_by_id(pair["to_ledger_id"])
            if from_ledger.id == to_ledger.id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="From and To ledgers must be different",
                )
            labels.append(f"{from_ledger.code} → {to_ledger.code}")
            debit_narration = pair.get("debit_narration")
            credit_narration = pair.get("credit_narration")
            pair_label = f"Contra {from_ledger.code} → {to_ledger.code}"
            lines.append(
                CashbookVoucherLine(
                    ledger_id=to_ledger.id,
                    debit_amount=amount,
                    credit_amount=Decimal("0"),
                    narration=debit_narration or pair_label,
                    sort_order=sort_order,
                    is_active=True,
                )
            )
            sort_order += 1
            lines.append(
                CashbookVoucherLine(
                    ledger_id=from_ledger.id,
                    debit_amount=Decimal("0"),
                    credit_amount=amount,
                    narration=credit_narration or pair_label,
                    sort_order=sort_order,
                    is_active=True,
                )
            )
            sort_order += 1

        header = narration or ("Contra " + "; ".join(labels[:3]))
        if party_code:
            header = f"{header} ({party_code})"

        voucher = CashbookVoucher(
            id=str(uuid4()),
            voucher_no=voucher_no,
            voucher_date=voucher_date,
            source_type="contra_entry",
            source_id=voucher_id,
            party_id=party_id,
            party_code=party_code,
            narration=header,
            kind="contra",
            is_active=True,
            lines=lines,
        )
        self.session.add(voucher)
        await self.session.flush()
        return voucher

    async def post_journal_voucher(
        self,
        *,
        voucher_id: str,
        voucher_no: str,
        voucher_date: date,
        source_type: str,
        kind: str,
        party_id: str | None,
        party_code: str | None,
        narration: str | None,
        lines: list[dict],
    ) -> CashbookVoucher:
        built = await self._build_journal_lines(kind=kind, party_id=party_id, lines=lines)
        voucher = CashbookVoucher(
            id=str(uuid4()),
            voucher_no=voucher_no,
            voucher_date=voucher_date,
            source_type=source_type,
            source_id=voucher_id,
            party_id=party_id,
            party_code=party_code,
            narration=narration or f"{kind.title()} {voucher_no}",
            kind=kind,
            is_active=True,
            lines=built,
        )
        self.session.add(voucher)
        await self.session.flush()
        return voucher

    async def replace_journal_lines(
        self,
        voucher: CashbookVoucher,
        *,
        voucher_date: date,
        kind: str,
        party_id: str | None,
        party_code: str | None,
        narration: str | None,
        lines: list[dict],
    ) -> CashbookVoucher:
        built = await self._build_journal_lines(
            kind=kind, party_id=party_id, lines=lines, exclude_voucher_id=voucher.id
        )
        voucher.voucher_date = voucher_date
        voucher.kind = kind
        voucher.party_id = party_id
        voucher.party_code = party_code
        voucher.narration = narration or voucher.narration
        voucher.is_active = True
        voucher.lines.clear()
        await self.session.flush()
        voucher.lines.extend(built)
        await self.session.flush()
        return voucher

    async def deactivate_voucher(self, voucher: CashbookVoucher) -> None:
        voucher.is_active = False
        for line in voucher.lines:
            line.is_active = False
        await self.session.flush()

    async def reactivate_voucher(self, voucher: CashbookVoucher) -> None:
        voucher.is_active = True
        for line in voucher.lines:
            line.is_active = True
        await self.session.flush()

    async def _build_journal_lines(
        self,
        *,
        kind: str,
        party_id: str | None,
        lines: list[dict],
        exclude_voucher_id: str | None = None,
    ) -> list[CashbookVoucherLine]:
        if len(lines) < 2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least two journal lines are required",
            )

        built: list[CashbookVoucherLine] = []
        total_dr = Decimal("0")
        total_cr = Decimal("0")
        cash_net = Decimal("0")
        uses_deposit = False
        all_cash_bank = True
        deposit_out = Decimal("0")

        for i, raw in enumerate(lines):
            ledger = await self._require_ledger_by_id(str(raw["ledger_id"]))
            debit = Decimal(str(raw.get("debit_amount") or 0))
            credit = Decimal(str(raw.get("credit_amount") or 0))
            if debit < 0 or credit < 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Amounts cannot be negative",
                )
            if debit > 0 and credit > 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="A line cannot have both debit and credit",
                )
            if debit == 0 and credit == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Each line needs a debit or credit amount",
                )
            if ledger.is_party_deposit:
                uses_deposit = True
                deposit_out += debit
            if not (ledger.is_cash or ledger.is_bank):
                all_cash_bank = False
            if ledger.is_cash or ledger.is_bank:
                cash_net += debit - credit
            total_dr += debit
            total_cr += credit
            built.append(
                CashbookVoucherLine(
                    ledger_id=ledger.id,
                    debit_amount=debit,
                    credit_amount=credit,
                    narration=(str(raw["narration"]).strip() if raw.get("narration") else None),
                    sort_order=i,
                    is_active=True,
                )
            )

        if abs(total_dr - total_cr) > Decimal("0.01"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Total debit and credit amount must be equal",
            )
        if total_dr <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Enter debit and credit amounts",
            )
        if uses_deposit and not party_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Customer is required when using a party deposit ledger",
            )

        kind_l = (kind or "").strip().lower()
        if kind_l == "receipt" and cash_net <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Receipt must debit a cash or bank ledger",
            )
        if kind_l == "payment" and cash_net >= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment must credit a cash or bank ledger",
            )
        if kind_l == "contra" and not all_cash_bank:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Contra lines must use cash or bank ledgers only",
            )

        if kind_l == "payment" and deposit_out > 0 and party_id:
            available = await self.get_party_deposit_balance(party_id, exclude_voucher_id)
            if deposit_out > available + Decimal("0.01"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Insufficient customer advance balance. Available: {available:.2f}",
                )

        return built


def dump_cashbook_trace(v: CashbookVoucher) -> dict:
    """JSON snapshot for audit trail / restore of accounting vouchers."""
    return {
        "id": v.id,
        "voucher_no": v.voucher_no,
        "voucher_date": v.voucher_date.isoformat() if v.voucher_date else None,
        "source_type": v.source_type,
        "source_id": v.source_id,
        "kind": getattr(v, "kind", None),
        "party_id": v.party_id,
        "party_code": v.party_code,
        "party_name": v.party.name if v.party else None,
        "narration": v.narration,
        "is_active": v.is_active,
        "lines": [
            {
                "id": ln.id,
                "ledger_id": ln.ledger_id,
                "ledger_code": ln.ledger.code if ln.ledger else None,
                "ledger_name": ln.ledger.name if ln.ledger else None,
                "debit_amount": float(ln.debit_amount or 0),
                "credit_amount": float(ln.credit_amount or 0),
                "narration": ln.narration,
                "sort_order": ln.sort_order,
                "is_active": ln.is_active,
            }
            for ln in (v.lines or [])
        ],
    }
