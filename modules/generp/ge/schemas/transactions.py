from datetime import date

from pydantic import BaseModel

from modules.generp.ge.schemas.common import ORMModel


class VoucherItemIn(BaseModel):
    product_id: str | None = None
    description: str | None = None
    quantity: float = 0
    rate: float = 0
    discount_amount: float = 0
    gst_id: str | None = None
    mrp: float | None = None
    sale_price: float | None = None
    profit_pct: float | None = None
    lot_id: str | None = None
    stock_barcode_id: str | None = None


class VoucherPaymentIn(BaseModel):
    payment_mode_id: str | None = None
    amount: float = 0
    reference: str | None = None


class VoucherIn(BaseModel):
    voucher_type: str  # SALE, PURCHASE, SALE_RETURN, PURCHASE_RETURN, WHOLESALE
    voucher_date: date
    party_id: str | None = None
    payment_mode_id: str | None = None
    is_credit: bool = False
    narration: str | None = None
    party_bill_no: str | None = None
    discount_amount: float = 0
    adjust_advance: float = 0
    items: list[VoucherItemIn] = []
    payments: list[VoucherPaymentIn] = []
    is_parked: bool = False


class VoucherItemOut(ORMModel):
    id: str
    product_id: str | None = None
    description: str | None = None
    quantity: float
    rate: float
    discount_amount: float
    gst_id: str | None = None
    gst_rate: float
    gst_amount: float
    taxable_amount: float
    amount: float
    product_name: str | None = None
    product_code: str | None = None
    mrp: float = 0
    sale_price: float = 0
    profit_pct: float = 0
    hsn_code: str | None = None
    lot_id: str | None = None
    lot_name: str | None = None
    stock_barcode_id: str | None = None
    barcode_from: str | None = None
    barcode_to: str | None = None
    print_copies: int = 0
    barcodes: list[dict] = []


class VoucherPaymentOut(ORMModel):
    id: str
    payment_mode_id: str | None = None
    payment_mode_name: str | None = None
    amount: float
    reference: str | None = None


class VoucherOut(ORMModel):
    id: str
    voucher_type: str
    voucher_no: str
    voucher_date: date
    party_id: str | None = None
    party_name: str | None = None
    party_bill_no: str | None = None
    payment_mode_id: str | None = None
    is_credit: bool
    narration: str | None = None
    gross_amount: float
    discount_amount: float
    tax_amount: float
    adjust_advance: float = 0
    net_amount: float
    paid_amount: float = 0
    credit_amount: float = 0
    is_cancelled: bool
    is_parked: bool = False
    items: list[VoucherItemOut] = []
    payments: list[VoucherPaymentOut] = []


class NextNumberOut(BaseModel):
    voucher_type: str
    next_no: str
    last_no: str | None = None


class VoucherListItem(ORMModel):
    id: str
    voucher_type: str
    voucher_no: str
    voucher_date: date
    party_name: str | None = None
    party_code: str | None = None
    party_phone: str | None = None
    party_bill_no: str | None = None
    is_credit: bool
    net_amount: float
    is_cancelled: bool
    is_parked: bool = False


class VoucherPageOut(BaseModel):
    rows: list[VoucherListItem]
    total: int
    page: int
    page_size: int


# ---------- Report rows ----------
class LedgerEntryRow(BaseModel):
    entry_date: date
    voucher_type: str
    voucher_no: str
    narration: str | None = None
    debit: float
    credit: float
    balance: float


class LedgerDetailsResponse(BaseModel):
    ledger_id: str
    ledger_name: str
    opening_balance: float
    rows: list[LedgerEntryRow]
    closing_balance: float


class PurchaseImportLine(BaseModel):
    product_id: str
    code: str | None = None
    name: str | None = None
    qty: float
    rate: float
    mrp: float = 0
    sale_price: float = 0
    profit_pct: float = 0
    disc_pct: float = 0
    gst_rate: float = 0
    gst_id: str | None = None


class PurchaseImportPreview(BaseModel):
    lines: list[PurchaseImportLine] = []
    errors: list[str] = []
    imported: int = 0
    skipped: int = 0
    message: str = ""


class DebtorRow(BaseModel):
    party_id: str | None = None
    ledger_id: str
    name: str
    debit: float
    credit: float
    balance: float


class DaybookRow(BaseModel):
    voucher_date: date
    voucher_type: str
    voucher_no: str
    party_name: str | None = None
    net_amount: float


class CashbookRow(BaseModel):
    entry_date: date
    voucher_type: str
    voucher_no: str
    narration: str | None = None
    debit: float
    credit: float
    balance: float


class DailyCollectionRow(BaseModel):
    payment_mode: str
    total: float


class DocumentNumberRuleOut(BaseModel):
    id: str
    kind: str
    label: str
    prefix: str = ""
    year_mode: str = "financial_year"
    prefix2: str = "01"
    prefix3: str = "01"
    seq_digits: int = 6
    sample_no: str
    sample_display: str = ""


class DocumentNumberRuleIn(BaseModel):
    kind: str
    prefix: str = ""
    year_mode: str = "financial_year"
    prefix2: str = "01"
    prefix3: str = "01"
    seq_digits: int = 6


class DocumentNumberRulesSave(BaseModel):
    rules: list[DocumentNumberRuleIn]
