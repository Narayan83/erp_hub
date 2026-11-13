from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


# ---- shared ----
class IdName(BaseModel):
    id: UUID
    name: str

    model_config = {"from_attributes": True}


# ---- Partner ----
class PartnerIn(BaseModel):
    name: str
    phone: str = ""
    email: str = ""
    address: str = ""
    notes: str = ""
    is_active: bool = True


class PartnerOut(PartnerIn):
    id: UUID
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


# ---- Location ----
class LocationIn(BaseModel):
    name: str
    address: str = ""
    village: str = ""
    taluk: str = ""
    district: str = ""
    state: str = "Karnataka"
    pin: str = ""
    contact_name: str = ""
    contact_number: str = ""
    notes: str = ""
    is_active: bool = True


class LocationOut(LocationIn):
    id: UUID
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


# ---- Phase ----
class PhaseIn(BaseModel):
    code: str
    name: str
    description: str = ""
    start_date: str = ""
    end_date: str = ""
    is_active: bool = True


class PhaseOut(PhaseIn):
    id: UUID
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


# ---- Work type ----
class WorkTypeIn(BaseModel):
    code: str
    name: str
    description: str = ""
    is_active: bool = True


class WorkTypeOut(WorkTypeIn):
    id: UUID
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


# ---- Labour ----
class LabourIn(BaseModel):
    name: str
    phone: str = ""
    address: str = ""
    role: str = ""
    daily_rate: str = ""
    notes: str = ""
    is_active: bool = True


class LabourOut(LabourIn):
    id: UUID
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


# ---- Vendor ----
class VendorIn(BaseModel):
    name: str
    phone: str = ""
    email: str = ""
    address: str = ""
    gstin: str = ""
    notes: str = ""
    is_active: bool = True


class VendorOut(VendorIn):
    id: UUID
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


# ---- Ledger ----
class LedgerIn(BaseModel):
    code: str
    name: str
    group_name: str = ""
    ledger_type: str = "EXPENSE"
    opening_balance: str = "0"
    notes: str = ""
    is_active: bool = True


class LedgerOut(LedgerIn):
    id: UUID
    balance: Decimal | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


# ---- Payment mode ----
class PaymentModeIn(BaseModel):
    code: str
    name: str
    entry_type: str = Field(description="credit or debit")
    notes: str = ""
    is_active: bool = True


class PaymentModeOut(PaymentModeIn):
    id: UUID
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


# ---- Project ----
class ProjectIn(BaseModel):
    name: str
    address: str = ""
    location_id: UUID | None = None
    description: str = ""
    start_date: str = ""
    end_date: str = ""
    is_active: bool = True
    partner_ids: list[UUID] = []


class ProjectOut(BaseModel):
    id: UUID
    name: str
    address: str = ""
    location_id: UUID | None = None
    location_name: str | None = None
    description: str = ""
    start_date: str = ""
    end_date: str = ""
    is_active: bool = True
    partner_ids: list[UUID] = []
    partners: list[IdName] = []
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


# ---- Transaction ----
class TransactionIn(BaseModel):
    project_id: UUID
    phase_id: UUID
    work_type_id: UUID
    ledger_id: UUID
    payment_mode_id: UUID
    party_type: str = "none"  # labour | partner | vendor | none
    labour_id: UUID | None = None
    partner_id: UUID | None = None
    vendor_id: UUID | None = None
    txn_date: date
    amount: Decimal
    narration: str = ""
    reference: str = ""


class TransactionOut(BaseModel):
    id: UUID
    project_id: UUID
    project_name: str | None = None
    phase_id: UUID
    phase_name: str | None = None
    work_type_id: UUID
    work_type_name: str | None = None
    ledger_id: UUID
    ledger_name: str | None = None
    payment_mode_id: UUID
    payment_mode_name: str | None = None
    party_type: str
    labour_id: UUID | None = None
    partner_id: UUID | None = None
    vendor_id: UUID | None = None
    party_name: str | None = None
    txn_date: date
    amount: Decimal
    entry_type: str
    narration: str = ""
    reference: str = ""
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class BalanceOut(BaseModel):
    entity: str
    entity_id: UUID | None = None
    name: str
    credit_total: Decimal
    debit_total: Decimal
    balance: Decimal


class ReportSummary(BaseModel):
    project_id: UUID | None = None
    project_name: str
    phase_id: UUID | None = None
    phase_name: str | None = None
    receipts: Decimal
    payments: Decimal
    balance: Decimal
    txn_count: int


class ChartPoint(BaseModel):
    label: str
    value: Decimal
    series: str = ""


class ChartsOut(BaseModel):
    by_phase: list[ChartPoint]
    by_work_type: list[ChartPoint]
    by_partner: list[ChartPoint]
    receipts_vs_payments: list[ChartPoint]
