from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from modules.generp.ge.schemas.common import ORMModel


class AdvanceCollectionCreate(BaseModel):
    party_id: str
    voucher_date: date | None = None
    payment_mode_id: str
    amount: Decimal = Field(..., gt=Decimal("0"))
    narration: str | None = None


class JournalLineIn(BaseModel):
    ledger_id: str
    debit_amount: Decimal = Decimal("0")
    credit_amount: Decimal = Decimal("0")
    narration: str | None = None

    @model_validator(mode="after")
    def _one_side(self):
        dr = Decimal(str(self.debit_amount or 0))
        cr = Decimal(str(self.credit_amount or 0))
        if dr < 0 or cr < 0:
            raise ValueError("Amounts cannot be negative")
        if dr > 0 and cr > 0:
            raise ValueError("A line cannot have both debit and credit")
        if dr == 0 and cr == 0:
            raise ValueError("Line amount is required")
        self.debit_amount = dr
        self.credit_amount = cr
        return self


class PaymentVoucherCreate(BaseModel):
    voucher_date: date | None = None
    ledger_id: str | None = None
    counter_ledger_id: str | None = None
    party_id: str | None = None
    amount: Decimal | None = Field(None, gt=Decimal("0"))
    entry_type: Literal["receipt", "payment"] = "receipt"
    narration: str | None = None
    lines: list[JournalLineIn] | None = None

    @model_validator(mode="after")
    def _legacy_or_lines(self):
        if self.lines:
            if len(self.lines) < 2:
                raise ValueError("At least two journal lines are required")
            return self
        if self.ledger_id and self.counter_ledger_id and self.amount is not None:
            return self
        raise ValueError("Provide lines, or ledger_id / counter_ledger_id / amount")


class ContraPairCreate(BaseModel):
    """One balanced transfer: debit To ledger, credit From ledger."""

    from_ledger_id: str  # credit side
    to_ledger_id: str  # debit side
    amount: Decimal = Field(..., gt=Decimal("0"))
    debit_narration: str | None = None
    credit_narration: str | None = None

    @model_validator(mode="after")
    def _validate_ledgers(self):
        if self.from_ledger_id == self.to_ledger_id:
            raise ValueError("From and To ledgers must be different")
        return self


class ContraEntryCreate(BaseModel):
    voucher_date: date | None = None
    party_id: str | None = None
    narration: str | None = None
    # Legacy single-pair fields (kept for desktop / older clients)
    from_ledger_id: str | None = None
    to_ledger_id: str | None = None
    amount: Decimal | None = Field(None, gt=Decimal("0"))
    debit_narration: str | None = None
    credit_narration: str | None = None
    # Preferred: one or more debit/credit pairs in a single voucher
    pairs: list[ContraPairCreate] | None = None
    # Journal-style lines (account / debit / credit / narration)
    lines: list[JournalLineIn] | None = None

    @model_validator(mode="after")
    def _normalize_pairs(self):
        if self.lines:
            if len(self.lines) < 2:
                raise ValueError("At least two journal lines are required")
            return self
        if self.pairs:
            if len(self.pairs) < 1:
                raise ValueError("At least one contra pair is required")
            return self
        if self.from_ledger_id and self.to_ledger_id and self.amount is not None:
            self.pairs = [
                ContraPairCreate(
                    from_ledger_id=self.from_ledger_id,
                    to_ledger_id=self.to_ledger_id,
                    amount=self.amount,
                    debit_narration=self.debit_narration,
                    credit_narration=self.credit_narration,
                )
            ]
            return self
        raise ValueError("Provide lines, pairs, or from_ledger_id / to_ledger_id / amount")


class AccountingVoucherRead(ORMModel):
    id: str
    voucher_no: str
    voucher_date: date
    source_type: str
    source_id: str
    party_id: str | None = None
    party_code: str | None = None
    narration: str | None = None
    kind: str | None = None
    is_active: bool = True


class JournalLineRead(BaseModel):
    id: str
    ledger_id: str
    ledger_code: str = ""
    ledger_name: str = ""
    debit_amount: Decimal
    credit_amount: Decimal
    narration: str | None = None
    sort_order: int = 0


class JournalVoucherWrite(BaseModel):
    voucher_date: date | None = None
    party_id: str | None = None
    narration: str | None = None
    kind: Literal["receipt", "payment", "contra"]
    voucher_no: str | None = None
    lines: list[JournalLineIn] = Field(min_length=2)


class JournalVoucherRead(ORMModel):
    id: str
    voucher_no: str
    voucher_date: date
    source_type: str
    source_id: str
    kind: str
    party_id: str | None = None
    party_code: str | None = None
    party_name: str | None = None
    narration: str | None = None
    is_active: bool = True
    total_debit: Decimal = Decimal("0")
    total_credit: Decimal = Decimal("0")
    lines: list[JournalLineRead] = Field(default_factory=list)


class JournalVoucherListItem(BaseModel):
    id: str
    voucher_no: str
    voucher_date: date
    source_type: str
    kind: str
    party_id: str | None = None
    party_code: str | None = None
    party_name: str | None = None
    narration: str | None = None
    is_active: bool = True
    line_count: int = 0
    total_debit: Decimal = Decimal("0")
    total_credit: Decimal = Decimal("0")
    accounts: str = ""


class LedgerBalanceRead(BaseModel):
    ledger_id: str
    balance: Decimal
    side: str


class PartyDepositBalanceRead(BaseModel):
    party_id: str
    party_code: str
    party_name: str | None = None
    balance: Decimal


class CashbookEntryRead(BaseModel):
    id: str
    voucher_id: str
    voucher_no: str
    voucher_date: date
    source_type: str
    source_id: str
    ledger_id: str
    ledger_code: str
    ledger_name: str
    party_id: str | None = None
    party_code: str | None = None
    party_name: str | None = None
    narration: str | None = None
    line_narration: str | None = None
    debit_amount: Decimal
    credit_amount: Decimal
    running_balance: Decimal | None = None
    created_at: datetime | None = None


class CashbookLedgerStatementRead(BaseModel):
    ledger_id: str
    ledger_code: str
    ledger_name: str
    from_date: date | None = None
    to_date: date | None = None
    opening_balance: Decimal
    total_debit: Decimal
    total_credit: Decimal
    closing_balance: Decimal
    entries: list[CashbookEntryRead]


class CashbookPartyAccountRead(BaseModel):
    party_id: str
    party_code: str
    party_name: str | None = None
    from_date: date | None = None
    to_date: date | None = None
    total_debit: Decimal
    total_credit: Decimal
    balance: Decimal
    deposit_balance: Decimal | None = None
    entries: list[CashbookEntryRead]


class CashbookDaybookRead(BaseModel):
    from_date: date | None = None
    to_date: date | None = None
    total_debit: Decimal
    total_credit: Decimal
    entries: list[CashbookEntryRead]
