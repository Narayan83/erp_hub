from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class BranchIn(BaseModel):
    code: str
    name: str
    address: str | None = None
    is_main: bool = False
    is_active: bool = True


class BranchOut(BranchIn):
    id: str


class StockVoucherItemIn(BaseModel):
    product_id: str
    line_role: str = "NORMAL"  # NORMAL | DEBIT | CREDIT | WASTAGE
    quantity: float = Field(..., gt=0)
    unit: str | None = None
    rate: float = 0
    narration: str | None = None


class StockVoucherIn(BaseModel):
    voucher_type: str
    voucher_date: date
    branch_id: str | None = None
    counterparty_branch_id: str | None = None
    party_id: str | None = None
    reference_no: str | None = None
    narration: str | None = None
    wastage_qty: float = 0
    items: list[StockVoucherItemIn]


class StockVoucherItemOut(BaseModel):
    id: str
    product_id: str
    product_code: str | None = None
    product_name: str | None = None
    line_role: str
    quantity: float
    unit: str | None = None
    rate: float
    amount: float
    narration: str | None = None


class StockVoucherOut(BaseModel):
    id: str
    voucher_type: str
    voucher_no: str
    voucher_date: date
    branch_id: str | None = None
    branch_name: str | None = None
    counterparty_branch_id: str | None = None
    counterparty_branch_name: str | None = None
    party_id: str | None = None
    reference_no: str | None = None
    narration: str | None = None
    wastage_qty: float
    is_cancelled: bool
    items: list[StockVoucherItemOut] = []


class StockVoucherListItem(BaseModel):
    id: str
    voucher_type: str
    voucher_no: str
    voucher_date: date
    narration: str | None = None
    is_cancelled: bool
    item_count: int = 0


class StockLedgerRow(BaseModel):
    id: str
    movement_date: date
    product_id: str
    product_code: str | None = None
    product_name: str | None = None
    qty_delta: float
    movement_type: str
    ref_no: str | None = None
    narration: str | None = None
    running_balance: float | None = None


class StockBalanceOut(BaseModel):
    product_id: str
    product_code: str | None = None
    product_name: str | None = None
    current_stock: float
    unit: str | None = None


class NextStockNoOut(BaseModel):
    next_no: str
    last_no: str | None = None


# --- Orders ---


class OrderItemIn(BaseModel):
    product_id: str
    quantity: float = Field(..., gt=0)
    rate: float = 0
    discount_amount: float = 0
    gst_id: str | None = None


class OrderIn(BaseModel):
    order_type: str
    order_date: date
    party_id: str | None = None
    narration: str | None = None
    discount_scheme_id: str | None = None
    discount_amount: float = 0
    items: list[OrderItemIn]


class OrderItemOut(BaseModel):
    id: str
    product_id: str
    product_code: str | None = None
    product_name: str | None = None
    quantity: float
    qty_fulfilled: float
    rate: float
    discount_amount: float
    gst_id: str | None = None
    gst_rate: float
    gst_amount: float
    taxable_amount: float
    amount: float


class OrderOut(BaseModel):
    id: str
    order_type: str
    order_no: str
    order_date: date
    party_id: str | None = None
    party_name: str | None = None
    status: str
    narration: str | None = None
    discount_scheme_id: str | None = None
    discount_amount: float
    gross_amount: float
    tax_amount: float
    net_amount: float
    is_cancelled: bool
    converted_voucher_id: str | None = None
    items: list[OrderItemOut] = []


class OrderListItem(BaseModel):
    id: str
    order_type: str
    order_no: str
    order_date: date
    party_name: str | None = None
    status: str
    net_amount: float
    is_cancelled: bool


class ConvertOrderOut(BaseModel):
    order_id: str
    voucher_id: str
    voucher_no: str | None = None
    voucher_type: str


# --- Discounts ---


class DiscountSchemeIn(BaseModel):
    code: str
    name: str
    scope: str = "BILL"
    discount_type: str = "PCT"
    value: float = 0
    min_bill_amount: float = 0
    max_discount_amount: float | None = None
    product_id: str | None = None
    category_id: str | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    applies_to: str = "ALL"
    narration: str | None = None
    is_active: bool = True


class DiscountSchemeOut(DiscountSchemeIn):
    id: str


class DiscountApplyIn(BaseModel):
    scheme_id: str | None = None
    voucher_type: str = "SALE"
    bill_amount: float = 0
    product_id: str | None = None
    category_id: str | None = None
    line_amount: float | None = None


class DiscountApplyOut(BaseModel):
    scheme_id: str | None = None
    scheme_code: str | None = None
    scheme_name: str | None = None
    discount_amount: float
    discount_pct: float = 0
