from pydantic import BaseModel, Field

from erp_core.schemas.print_configs import PrintConfigCreate, PrintConfigRead  # noqa: F401


class CompanyProfileOut(BaseModel):
    id: str
    code: str
    name: str
    address_line1: str | None = None
    address_line2: str | None = None
    address_line3: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    phone: str | None = None
    mobile: str | None = None
    email: str | None = None
    website: str | None = None
    gstin: str | None = None
    logo_path: str | None = None
    extra: dict | None = None

    model_config = {"from_attributes": True}


class CompanyProfileUpdate(BaseModel):
    name: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    address_line3: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    phone: str | None = None
    mobile: str | None = None
    email: str | None = None
    website: str | None = None
    gstin: str | None = None
    extra: dict | None = None


# Print config schemas live in erp_core.schemas.print_configs; aliases kept for compatibility.
PrintConfigOut = PrintConfigRead

class PartyOut(BaseModel):
    id: str
    party_type: str
    code: str
    name: str
    phone: str | None = None
    mobile: str | None = None
    email: str | None = None
    city: str | None = None
    gstin: str | None = None
    is_active: bool

    model_config = {"from_attributes": True}


class PartyCreate(BaseModel):
    party_type: str = "customer"
    code: str | None = None
    name: str = Field(min_length=1)
    phone: str | None = None
    mobile: str | None = None
    email: str | None = None
    address_line1: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    gstin: str | None = None


class PartyUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    mobile: str | None = None
    email: str | None = None
    address_line1: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    gstin: str | None = None
    is_active: bool | None = None


class LedgerOut(BaseModel):
    id: str
    code: str
    system_key: str | None = None
    name: str
    group_name: str
    ledger_type: str
    is_cash: bool
    is_bank: bool
    is_party_deposit: bool
    is_active: bool

    model_config = {"from_attributes": True}


class LedgerCreate(BaseModel):
    code: str
    name: str
    group_name: str = "General"
    ledger_type: str = "ASSET"
    system_key: str | None = None
    is_cash: bool = False
    is_bank: bool = False
    is_party_deposit: bool = False


class PaymentModeOut(BaseModel):
    id: str
    code: str
    name: str
    is_cash: bool
    is_credit: bool
    ledger_id: str | None = None
    is_active: bool

    model_config = {"from_attributes": True}


class CashbookVoucherCreate(BaseModel):
    voucher_date: str
    kind: str  # advance | payment | contra | receipt
    party_id: str | None = None
    narration: str | None = None
    debit_ledger_id: str
    credit_ledger_id: str
    amount: float = Field(gt=0)


class CashbookVoucherOut(BaseModel):
    id: str
    voucher_no: str
    voucher_date: str
    source_type: str
    kind: str | None
    party_id: str | None
    party_code: str | None
    narration: str | None
    amount: float = 0

    model_config = {"from_attributes": True}
