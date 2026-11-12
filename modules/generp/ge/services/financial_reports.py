"""Financial statements from cashbook: Trial Balance, P&L, Balance Sheet, Receipt & Payment."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.models.cashbook import CashbookVoucher, CashbookVoucherLine
from modules.generp.ge.models.masters import Ledger
from modules.generp.ge.services.cashbook_posting import signed_opening_balance


def _d(v: Any) -> Decimal:
    return Decimal(str(v or 0))


def _fy_start(d: date) -> date:
    """Indian FY start (1 Apr)."""
    year = d.year if d.month >= 4 else d.year - 1
    return date(year, 4, 1)


def _split_dr_cr(balance: Decimal) -> tuple[Decimal, Decimal]:
    """Debit-positive balance → (debit_col, credit_col)."""
    if balance >= 0:
        return balance, Decimal("0")
    return Decimal("0"), abs(balance)


class FinancialReportsService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def _active_ledgers(self) -> list[Ledger]:
        rows = (
            await self.session.execute(
                select(Ledger).where(Ledger.is_active.is_(True)).order_by(Ledger.sort_order, Ledger.code)
            )
        ).scalars().all()
        return list(rows)

    async def _movement(
        self,
        ledger_id: str,
        *,
        from_date: date | None,
        to_date: date | None,
        before: bool = False,
    ) -> tuple[Decimal, Decimal]:
        """Sum debit/credit for ledger. If before=True, only voucher_date < from_date."""
        stmt = (
            select(CashbookVoucherLine, CashbookVoucher)
            .join(CashbookVoucher, CashbookVoucherLine.voucher_id == CashbookVoucher.id)
            .where(CashbookVoucherLine.ledger_id == ledger_id)
            .where(CashbookVoucherLine.is_active.is_(True))
            .where(CashbookVoucher.is_active.is_(True))
        )
        if before:
            if not from_date:
                return Decimal("0"), Decimal("0")
            stmt = stmt.where(CashbookVoucher.voucher_date < from_date)
        else:
            if from_date:
                stmt = stmt.where(CashbookVoucher.voucher_date >= from_date)
            if to_date:
                stmt = stmt.where(CashbookVoucher.voucher_date <= to_date)
        result = await self.session.execute(stmt)
        debit = Decimal("0")
        credit = Decimal("0")
        for line, _v in result.all():
            debit += _d(line.debit_amount)
            credit += _d(line.credit_amount)
        return debit, credit

    async def _ledger_balances(
        self,
        ledger: Ledger,
        *,
        from_date: date | None,
        to_date: date | None,
    ) -> dict[str, Any]:
        open_move_dr, open_move_cr = await self._movement(
            ledger.id, from_date=from_date, to_date=None, before=True
        )
        opening = signed_opening_balance(ledger) + open_move_dr - open_move_cr
        period_dr, period_cr = await self._movement(
            ledger.id, from_date=from_date, to_date=to_date, before=False
        )
        closing = opening + period_dr - period_cr
        open_dr, open_cr = _split_dr_cr(opening)
        close_dr, close_cr = _split_dr_cr(closing)
        return {
            "ledger_id": ledger.id,
            "ledger_code": ledger.code,
            "ledger_name": ledger.name,
            "group_name": ledger.group_name or "General",
            "ledger_type": (ledger.ledger_type or "ASSET").upper(),
            "opening": opening,
            "opening_debit": open_dr,
            "opening_credit": open_cr,
            "period_debit": period_dr,
            "period_credit": period_cr,
            "closing": closing,
            "closing_debit": close_dr,
            "closing_credit": close_cr,
        }

    async def trial_balance(
        self,
        *,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> dict[str, Any]:
        to_date = to_date or date.today()
        from_date = from_date or _fy_start(to_date)
        rows = []
        totals = {
            "opening_debit": Decimal("0"),
            "opening_credit": Decimal("0"),
            "period_debit": Decimal("0"),
            "period_credit": Decimal("0"),
            "closing_debit": Decimal("0"),
            "closing_credit": Decimal("0"),
        }
        for ledger in await self._active_ledgers():
            bal = await self._ledger_balances(ledger, from_date=from_date, to_date=to_date)
            # Skip zero-activity / zero-balance noise
            if (
                bal["opening"] == 0
                and bal["period_debit"] == 0
                and bal["period_credit"] == 0
                and bal["closing"] == 0
            ):
                continue
            rows.append(bal)
            for k in totals:
                totals[k] += bal[k]
        return {
            "from_date": from_date,
            "to_date": to_date,
            "rows": rows,
            "totals": totals,
        }

    async def profit_and_loss(
        self,
        *,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> dict[str, Any]:
        to_date = to_date or date.today()
        from_date = from_date or _fy_start(to_date)
        income_rows: list[dict] = []
        expense_rows: list[dict] = []
        total_income = Decimal("0")
        total_expense = Decimal("0")

        for ledger in await self._active_ledgers():
            ltype = (ledger.ledger_type or "").upper()
            if ltype not in ("INCOME", "EXPENSE"):
                continue
            period_dr, period_cr = await self._movement(
                ledger.id, from_date=from_date, to_date=to_date, before=False
            )
            if period_dr == 0 and period_cr == 0:
                continue
            if ltype == "INCOME":
                amount = period_cr - period_dr
                if amount == 0:
                    continue
                total_income += amount
                income_rows.append(
                    {
                        "ledger_id": ledger.id,
                        "ledger_code": ledger.code,
                        "ledger_name": ledger.name,
                        "group_name": ledger.group_name or "Income",
                        "amount": amount,
                        "period_debit": period_dr,
                        "period_credit": period_cr,
                    }
                )
            else:
                amount = period_dr - period_cr
                if amount == 0:
                    continue
                total_expense += amount
                expense_rows.append(
                    {
                        "ledger_id": ledger.id,
                        "ledger_code": ledger.code,
                        "ledger_name": ledger.name,
                        "group_name": ledger.group_name or "Expense",
                        "amount": amount,
                        "period_debit": period_dr,
                        "period_credit": period_cr,
                    }
                )

        net = total_income - total_expense
        return {
            "from_date": from_date,
            "to_date": to_date,
            "income": income_rows,
            "expense": expense_rows,
            "total_income": total_income,
            "total_expense": total_expense,
            "net_profit": net if net >= 0 else Decimal("0"),
            "net_loss": abs(net) if net < 0 else Decimal("0"),
            "net": net,
        }

    async def balance_sheet(self, *, as_of: date | None = None) -> dict[str, Any]:
        as_of = as_of or date.today()
        fy_from = _fy_start(as_of)
        assets: list[dict] = []
        liabilities: list[dict] = []
        total_assets = Decimal("0")
        total_liabilities = Decimal("0")

        for ledger in await self._active_ledgers():
            ltype = (ledger.ledger_type or "").upper()
            if ltype not in ("ASSET", "LIABILITY"):
                continue
            bal = await self._ledger_balances(ledger, from_date=None, to_date=as_of)
            closing = bal["closing"]
            if closing == 0:
                continue
            if ltype == "ASSET":
                amount = closing  # debit-positive
                if amount < 0:
                    # unusual credit asset → show under liabilities-ish, but keep as negative asset
                    amount = closing
                total_assets += amount
                assets.append(
                    {
                        "ledger_id": ledger.id,
                        "ledger_code": ledger.code,
                        "ledger_name": ledger.name,
                        "group_name": ledger.group_name or "Assets",
                        "amount": amount,
                        "closing": closing,
                    }
                )
            else:
                amount = -closing  # liability credit balance → positive display
                if amount == 0 and closing == 0:
                    continue
                total_liabilities += amount
                liabilities.append(
                    {
                        "ledger_id": ledger.id,
                        "ledger_code": ledger.code,
                        "ledger_name": ledger.name,
                        "group_name": ledger.group_name or "Liabilities",
                        "amount": amount,
                        "closing": closing,
                    }
                )

        pl = await self.profit_and_loss(from_date=fy_from, to_date=as_of)
        net = _d(pl["net"])
        # Equity plug so BS balances
        if net >= 0:
            liabilities.append(
                {
                    "ledger_id": None,
                    "ledger_code": "P&L",
                    "ledger_name": "Profit & Loss (Current Year)",
                    "group_name": "Equity",
                    "amount": net,
                    "closing": -net,
                    "is_pl_plug": True,
                }
            )
            total_liabilities += net
        else:
            assets.append(
                {
                    "ledger_id": None,
                    "ledger_code": "P&L",
                    "ledger_name": "Profit & Loss (Current Year Loss)",
                    "group_name": "Equity",
                    "amount": abs(net),
                    "closing": abs(net),
                    "is_pl_plug": True,
                }
            )
            total_assets += abs(net)

        return {
            "as_of": as_of,
            "fy_from": fy_from,
            "assets": assets,
            "liabilities": liabilities,
            "total_assets": total_assets,
            "total_liabilities": total_liabilities,
            "net_profit": pl["net_profit"],
            "net_loss": pl["net_loss"],
        }

    async def receipt_payment(
        self,
        *,
        from_date: date | None = None,
        to_date: date | None = None,
        entry_type: str = "all",
        limit: int = 2000,
    ) -> dict[str, Any]:
        """Cash/Bank movements: debit = receipt, credit = payment."""
        to_date = to_date or date.today()
        from_date = from_date or _fy_start(to_date)
        entry_type = (entry_type or "all").lower()

        stmt = (
            select(CashbookVoucherLine, CashbookVoucher, Ledger)
            .join(CashbookVoucher, CashbookVoucherLine.voucher_id == CashbookVoucher.id)
            .join(Ledger, CashbookVoucherLine.ledger_id == Ledger.id)
            .options(selectinload(CashbookVoucher.party))
            .where(CashbookVoucherLine.is_active.is_(True))
            .where(CashbookVoucher.is_active.is_(True))
            .where((Ledger.is_cash.is_(True)) | (Ledger.is_bank.is_(True)))
            .where(CashbookVoucher.voucher_date >= from_date)
            .where(CashbookVoucher.voucher_date <= to_date)
            .order_by(
                CashbookVoucher.voucher_date,
                CashbookVoucher.created_at,
                CashbookVoucherLine.sort_order,
            )
            .limit(limit)
        )
        rows = list((await self.session.execute(stmt)).all())
        entries = []
        total_receipt = Decimal("0")
        total_payment = Decimal("0")
        for line, voucher, ledger in rows:
            debit = _d(line.debit_amount)
            credit = _d(line.credit_amount)
            if debit > 0:
                kind = "receipt"
                amount = debit
                total_receipt += debit
            elif credit > 0:
                kind = "payment"
                amount = credit
                total_payment += credit
            else:
                continue
            if entry_type not in ("all", kind):
                continue
            party = voucher.party
            entries.append(
                {
                    "id": line.id,
                    "voucher_id": voucher.id,
                    "voucher_no": voucher.voucher_no,
                    "voucher_date": voucher.voucher_date,
                    "source_type": voucher.source_type,
                    "entry_type": kind,
                    "ledger_id": ledger.id,
                    "ledger_code": ledger.code,
                    "ledger_name": ledger.name,
                    "party_id": voucher.party_id,
                    "party_code": voucher.party_code,
                    "party_name": party.name if party else None,
                    "narration": getattr(line, "narration", None) or voucher.narration,
                    "amount": amount,
                    "debit_amount": debit,
                    "credit_amount": credit,
                }
            )
        return {
            "from_date": from_date,
            "to_date": to_date,
            "entry_type": entry_type,
            "entries": entries,
            "total_receipt": total_receipt,
            "total_payment": total_payment,
            "net": total_receipt - total_payment,
        }

    async def voucher_detail(self, voucher_id: str) -> dict[str, Any]:
        voucher = (
            await self.session.execute(
                select(CashbookVoucher)
                .options(
                    selectinload(CashbookVoucher.lines).selectinload(CashbookVoucherLine.ledger),
                    selectinload(CashbookVoucher.party),
                )
                .where(CashbookVoucher.id == voucher_id)
            )
        ).scalar_one_or_none()
        if not voucher or not voucher.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voucher not found")
        party = voucher.party
        lines = []
        for line in sorted(voucher.lines or [], key=lambda x: x.sort_order or 0):
            if not line.is_active:
                continue
            led = line.ledger
            lines.append(
                {
                    "id": line.id,
                    "ledger_id": line.ledger_id,
                    "ledger_code": led.code if led else "",
                    "ledger_name": led.name if led else "",
                    "debit_amount": _d(line.debit_amount),
                    "credit_amount": _d(line.credit_amount),
                    "narration": getattr(line, "narration", None),
                    "sort_order": line.sort_order,
                }
            )
        return {
            "id": voucher.id,
            "voucher_no": voucher.voucher_no,
            "voucher_date": voucher.voucher_date,
            "source_type": voucher.source_type,
            "source_id": voucher.source_id,
            "party_id": voucher.party_id,
            "party_code": voucher.party_code,
            "party_name": party.name if party else None,
            "narration": voucher.narration,
            "lines": lines,
        }
