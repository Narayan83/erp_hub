from pathlib import Path

from pydantic import BaseModel, Field, computed_field, field_validator

from modules.generp.ge.schemas.common import ORMModel


# ---------- Company Profile (Settings) ----------
class CompanyResetIn(BaseModel):
    password: str = Field(min_length=1, max_length=80)


class CompanyProfileUpdate(BaseModel):
    name: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    address_line3: str | None = None
    address_line4: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    phone: str | None = None
    mobile: str | None = None
    email: str | None = None
    website: str | None = None
    gstin: str | None = None
    software_id: str | None = None
    sale_tax_mode: str | None = None
    wholesale_tax_mode: str | None = None
    purchase_tax_mode: str | None = None
    sale_rate_source: str | None = None
    allow_negative_stock: bool | None = None
    purchase_bill_parking: bool | None = None

    @field_validator("sale_rate_source")
    @classmethod
    def _sale_rate_source(cls, v: str | None) -> str | None:
        if v is None or str(v).strip() == "":
            return None
        raw = str(v).strip().lower()
        if raw not in ("product_master", "fifo"):
            raise ValueError("sale_rate_source must be product_master or fifo")
        return raw


class CompanyProfileOut(ORMModel):
    id: str
    code: str
    name: str
    address_line1: str | None = None
    address_line2: str | None = None
    address_line3: str | None = None
    address_line4: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    phone: str | None = None
    mobile: str | None = None
    email: str | None = None
    website: str | None = None
    gstin: str | None = None
    software_id: str | None = None
    sale_tax_mode: str = "inclusive"
    wholesale_tax_mode: str = "exclusive"
    purchase_tax_mode: str = "exclusive"
    sale_rate_source: str = "product_master"
    allow_negative_stock: bool = True
    purchase_bill_parking: bool = False
    logo_path: str | None = None

    @computed_field
    @property
    def logo_url(self) -> str | None:
        if not self.logo_path:
            return None
        return f"/media/company-logo/{Path(self.logo_path).name}"


# ---------- Sale Entry Config (Sale Bill settings) ----------
class SaleEntryConfigUpdate(BaseModel):
    enable_qty: bool | None = None
    enable_rate: bool | None = None
    enable_discount: bool | None = None
    enable_mrp: bool | None = None
    default_qty: float | None = None
    allow_negative_stock: bool | None = None


class SaleEntryConfigOut(ORMModel):
    id: str
    code: str
    enable_qty: bool
    enable_rate: bool
    enable_discount: bool
    enable_mrp: bool
    default_qty: float
    allow_negative_stock: bool


# ---------- Ledger ----------
class LedgerIn(BaseModel):
    code: str | None = None  # blank / omitted → auto 1, 2, 3, …
    name: str
    group_name: str = "General"
    ledger_type: str = "ASSET"
    opening_balance: float = 0
    opening_type: str = "Dr"
    is_cash: bool = False
    is_bank: bool = False
    is_party_deposit: bool = False
    sort_order: int = 0
    is_active: bool = True


class LedgerUpdate(BaseModel):
    name: str | None = None
    group_name: str | None = None
    ledger_type: str | None = None
    opening_balance: float | None = None
    opening_type: str | None = None
    is_cash: bool | None = None
    is_bank: bool | None = None
    is_party_deposit: bool | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class LedgerOut(ORMModel):
    id: str
    code: str
    name: str
    group_name: str
    ledger_type: str
    opening_balance: float
    opening_type: str
    is_cash: bool
    is_bank: bool
    is_party_deposit: bool
    sort_order: int
    is_active: bool


# ---------- Payment Mode ----------
class PaymentModeIn(BaseModel):
    code: str
    name: str
    is_cash: bool = False
    is_credit: bool = False
    ledger_id: str | None = None
    sort_order: int = 0
    is_active: bool = True


class PaymentModeUpdate(BaseModel):
    name: str | None = None
    is_cash: bool | None = None
    is_credit: bool | None = None
    ledger_id: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class PaymentModeOut(ORMModel):
    id: str
    code: str
    name: str
    is_cash: bool
    is_credit: bool
    ledger_id: str | None = None
    sort_order: int
    is_active: bool


# ---------- GST ----------
class GstIn(BaseModel):
    code: str
    name: str
    rate: float = 0
    cgst: float = 0
    sgst: float = 0
    igst: float = 0
    sort_order: int = 0
    is_active: bool = True


class GstUpdate(BaseModel):
    name: str | None = None
    rate: float | None = None
    cgst: float | None = None
    sgst: float | None = None
    igst: float | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class GstOut(ORMModel):
    id: str
    code: str
    name: str
    rate: float
    cgst: float
    sgst: float
    igst: float
    sort_order: int
    is_active: bool


# ---------- Category ----------
class CategoryIn(BaseModel):
    code: str
    name: str
    sort_order: int = 0
    is_active: bool = True


class CategoryUpdate(BaseModel):
    name: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class CategoryOut(ORMModel):
    id: str
    code: str
    name: str
    sort_order: int
    is_active: bool


# ---------- Sub Category ----------
class SubCategoryIn(BaseModel):
    category_id: str
    code: str
    name: str
    sort_order: int = 0
    is_active: bool = True


class SubCategoryUpdate(BaseModel):
    category_id: str | None = None
    name: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class SubCategoryOut(ORMModel):
    id: str
    category_id: str
    code: str
    name: str
    sort_order: int
    is_active: bool
    category_name: str | None = None


# ---------- Product ----------
def _normalize_item_type(value: str | None) -> str:
    raw = str(value or "goods").strip().lower()
    if raw in ("service", "services"):
        return "service"
    return "goods"


class ProductIn(BaseModel):
    # Omit code to auto-assign next integer (1, 2, …). Barcode becomes zero-padded 6 digits.
    code: str | None = None
    name: str
    category_id: str | None = None
    sub_category_id: str | None = None
    gst_id: str | None = None
    tax_slabs: list[dict] | None = None
    unit: str = "NOS"
    hsn_code: str | None = None
    item_type: str = "goods"
    purchase_price: float = 0
    sale_price: float = 0
    wholesale_price: float = 0
    mrp: float = 0
    max_discount_pct: float = 0
    moq: float = 0
    opening_stock: float = 0
    is_active: bool = True
    is_in_shop: bool = False
    own_barcode: bool = False
    parent_id: str | None = None

    @field_validator("item_type", mode="before")
    @classmethod
    def _item_type(cls, v: str | None) -> str:
        return _normalize_item_type(v)


class ProductUpdate(BaseModel):
    name: str | None = None
    category_id: str | None = None
    sub_category_id: str | None = None
    gst_id: str | None = None
    tax_slabs: list[dict] | None = None
    unit: str | None = None
    hsn_code: str | None = None
    item_type: str | None = None
    purchase_price: float | None = None
    sale_price: float | None = None
    wholesale_price: float | None = None
    mrp: float | None = None
    max_discount_pct: float | None = None
    moq: float | None = None
    opening_stock: float | None = None
    is_active: bool | None = None
    is_in_shop: bool | None = None
    own_barcode: bool | None = None
    parent_id: str | None = None

    @field_validator("item_type", mode="before")
    @classmethod
    def _item_type(cls, v: str | None) -> str | None:
        if v is None or str(v).strip() == "":
            return None
        return _normalize_item_type(v)


class ProductImageOut(ORMModel):
    id: str
    product_id: str
    file_path: str
    image_url: str
    is_primary: bool
    sort_order: int


class ProductImageUpdate(BaseModel):
    is_primary: bool | None = None
    sort_order: int | None = None


class ProductOut(ORMModel):
    id: str
    code: str
    barcode: str
    name: str
    category_id: str | None = None
    sub_category_id: str | None = None
    gst_id: str | None = None
    tax_slabs: list[dict] | None = None
    unit: str
    hsn_code: str | None = None
    item_type: str = "goods"
    purchase_price: float
    sale_price: float
    wholesale_price: float
    mrp: float
    max_discount_pct: float = 0
    moq: float = 0
    opening_stock: float
    current_stock: float
    is_active: bool
    is_in_shop: bool = False
    own_barcode: bool = False
    category_name: str | None = None
    sub_category_name: str | None = None
    gst_name: str | None = None
    gst_rate: float | None = None
    image_path: str | None = None
    image_url: str | None = None
    parent_id: str | None = None
    images: list[ProductImageOut] = Field(default_factory=list)


class ProductPageOut(BaseModel):
    items: list[ProductOut]
    total: int
    skip: int
    limit: int


class ProductImportResult(BaseModel):
    created: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)
    message: str = ""


class VariantAxisIn(BaseModel):
    name: str
    values: list[str]


class GenerateVariantsIn(BaseModel):
    """Create SKUs from cartesian product of attribute values (copied from base product)."""

    product_id: str
    axes: list[VariantAxisIn]


class ProductBarcodeIn(BaseModel):
    barcode: str
    sale_rate: float | None = None
    ws_rate: float | None = None
    mrp: float | None = None
    kind: str | None = None
    is_active: bool = True


class ProductBarcodeUpdate(BaseModel):
    barcode: str | None = None
    sale_rate: float | None = None
    ws_rate: float | None = None
    mrp: float | None = None
    is_active: bool | None = None


class ProductBarcodeOut(ORMModel):
    id: str
    product_id: str
    barcode: str
    sale_rate: float | None = None
    ws_rate: float | None = None
    mrp: float | None = None
    kind: str = "company"
    is_active: bool


class OwnBarcodeIn(BaseModel):
    mrp: float
    sale_rate: float | None = None
    ws_rate: float | None = None


# ---------- Party (Vendor / Customer) ----------
class PartyIn(BaseModel):
    party_type: str
    code: str | None = None
    name: str
    contact_person: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    address_line3: str | None = None
    address_line4: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    shipping_address_line1: str | None = None
    shipping_address_line2: str | None = None
    shipping_address_line3: str | None = None
    shipping_address_line4: str | None = None
    shipping_city: str | None = None
    shipping_state: str | None = None
    shipping_pin_code: str | None = None
    same_as_billing: bool = True
    phone: str | None = None
    email: str | None = None
    gstin: str | None = None
    opening_balance: float = 0
    opening_type: str = "Dr"
    is_active: bool = True


class PartyUpdate(BaseModel):
    party_type: str | None = None
    name: str | None = None
    contact_person: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    address_line3: str | None = None
    address_line4: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    shipping_address_line1: str | None = None
    shipping_address_line2: str | None = None
    shipping_address_line3: str | None = None
    shipping_address_line4: str | None = None
    shipping_city: str | None = None
    shipping_state: str | None = None
    shipping_pin_code: str | None = None
    same_as_billing: bool | None = None
    phone: str | None = None
    email: str | None = None
    gstin: str | None = None
    opening_balance: float | None = None
    opening_type: str | None = None
    is_active: bool | None = None


class PartyOut(ORMModel):
    id: str
    party_type: str
    code: str
    name: str
    contact_person: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    address_line3: str | None = None
    address_line4: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    shipping_address_line1: str | None = None
    shipping_address_line2: str | None = None
    shipping_address_line3: str | None = None
    shipping_address_line4: str | None = None
    shipping_city: str | None = None
    shipping_state: str | None = None
    shipping_pin_code: str | None = None
    same_as_billing: bool = True
    phone: str | None = None
    email: str | None = None
    gstin: str | None = None
    image_path: str | None = None
    opening_balance: float
    opening_type: str
    ledger_id: str | None = None
    is_active: bool

    @field_validator("same_as_billing", mode="before")
    @classmethod
    def _same_as_billing(cls, value: object) -> bool:
        return True if value is None else bool(value)

    @computed_field
    @property
    def image_url(self) -> str | None:
        if not self.image_path:
            return None
        return f"/media/parties/{Path(self.image_path).name}"


# ---------- Print Config ----------
class PrintConfigUpdate(BaseModel):
    printer_name: str | None = None
    bill_format: str | None = None
    paper_size: str | None = None
    custom_width_mm: float | None = None
    custom_height_mm: float | None = None
    orientation: str | None = None
    print_mode: str | None = None
    margin_top_mm: float | None = None
    margin_right_mm: float | None = None
    margin_bottom_mm: float | None = None
    margin_left_mm: float | None = None
    copies: int | None = None
    layout_options: dict | None = None


class PrintConfigOut(ORMModel):
    id: str
    code: str
    name: str
    printer_name: str | None = None
    bill_format: str = "A4"
    paper_size: str
    custom_width_mm: float | None = None
    custom_height_mm: float | None = None
    orientation: str
    print_mode: str
    margin_top_mm: float
    margin_right_mm: float
    margin_bottom_mm: float
    margin_left_mm: float
    copies: int
    layout_options: dict | None = None
    sort_order: int
    is_active: bool
