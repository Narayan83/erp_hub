from __future__ import annotations

from datetime import date as Date
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
    lot_id: str | None = None


class StockVoucherIn(BaseModel):
    voucher_type: str
    voucher_date: Date
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
    voucher_date: Date
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
    voucher_date: Date
    narration: str | None = None
    is_cancelled: bool
    item_count: int = 0


class StockLedgerRow(BaseModel):
    id: str
    movement_date: Date
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
    order_date: Date
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
    order_date: Date
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
    order_date: Date
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
    valid_from: Date | None = None
    valid_to: Date | None = None
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


class LotIn(BaseModel):
    code: str
    name: str
    remarks: str | None = None
    is_active: bool = True


class LotOut(LotIn):
    id: str


class StockBarcodeHit(BaseModel):
    id: str
    barcode: str
    product_id: str
    product_code: str | None = None
    product_name: str | None = None
    qty_remaining: float = 0
    qty_in: float = 0
    ask_qty: bool = False
    sale_rate: float = 0
    mrp: float = 0
    cost_price: float = 0
    status: str = "in_stock"
    lot_id: str | None = None
    lot_name: str | None = None
    multi_barcode: bool = False


class BarcodeStockRow(BaseModel):
    date: Date
    lot_name: str = ""
    product_name: str = ""
    product_code: str = ""
    barcode: str
    cost_price: float = 0
    sale_rate: float | None = None
    disc_pct: float | None = None
    net_sale_rate: float | None = None
    qty: float = 0
    status: str = "in_stock"


class BarcodeStockReport(BaseModel):
    rows: list[BarcodeStockRow] = []
    purchase_value: float = 0
    sales_value: float = 0
    margin: float = 0
    margin_pct: float | None = None


class ItemStockRow(BaseModel):
    product_id: str
    product_code: str = ""
    product_name: str = ""
    barcode_count: int = 0
    qty_in: float = 0
    qty_sold: float = 0
    qty_remaining: float = 0
    purchase_value: float = 0
    sales_value: float = 0
    balance_value: float = 0


class MovementStockRow(BaseModel):
    lot_name: str = ""
    lot_code: str = ""
    date: Date | None = None
    product_code: str = ""
    product_name: str = ""
    p_qty: float = 0
    p_rate: float = 0
    p_amt: float = 0
    pr_qty: float = 0
    pr_rate: float = 0
    pr_amt: float = 0
    s_qty: float = 0
    s_rate: float = 0
    s_amt: float = 0
    sr_qty: float = 0
    sr_rate: float = 0
    sr_amt: float = 0
    ti_qty: float = 0
    ti_rate: float = 0
    ti_amt: float = 0
    to_qty: float = 0
    to_rate: float = 0
    to_amt: float = 0
    bal_qty: float = 0
    bal_rate: float = 0
    bal_amt: float = 0
