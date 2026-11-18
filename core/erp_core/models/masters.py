from uuid import uuid4

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, Numeric, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship, synonym

from erp_core.database import Base
from erp_core.models.base import TimestampMixin


def _pk() -> Mapped[str]:
    return mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))


class CompanyProfile(Base, TimestampMixin):
    """Organisation profile (singleton, code='MAIN')."""

    __tablename__ = "company_profile"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, default="MAIN")
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    address_line1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address_line3: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address_line4: Mapped[str | None] = mapped_column(String(200), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    pin_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    mobile: Mapped[str | None] = mapped_column(String(100), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    software_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    logo_path: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Trading tax behaviour (GenERP). Unused products leave the defaults.
    sale_tax_mode: Mapped[str] = mapped_column(String(20), default="inclusive")
    wholesale_tax_mode: Mapped[str] = mapped_column(String(20), default="exclusive")
    purchase_tax_mode: Mapped[str] = mapped_column(String(20), default="exclusive")
    sale_rate_source: Mapped[str] = mapped_column(String(20), default="product_master")
    allow_negative_stock: Mapped[bool] = mapped_column(Boolean, default=True)
    purchase_bill_parking: Mapped[bool] = mapped_column(Boolean, default=False)
    # Each inward piece gets its own stock barcode (garment-style).
    unique_barcode_stock: Mapped[bool] = mapped_column(Boolean, default=False)
    # Named lots (Lot Master) on purchase lines and stock reports.
    lot_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    package_menu_codes: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Product-specific extras (hospital GSTINs, etc.)
    extra: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class PrintConfig(Base, TimestampMixin):
    __tablename__ = "print_configs"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    printer_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    paper_size: Mapped[str] = mapped_column(String(20), nullable=False, default="A4")
    custom_width_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    custom_height_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    orientation: Mapped[str] = mapped_column(String(20), nullable=False, default="portrait")
    print_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="preview")
    margin_top_mm: Mapped[float] = mapped_column(Float, nullable=False, default=12.0)
    margin_right_mm: Mapped[float] = mapped_column(Float, nullable=False, default=12.0)
    margin_bottom_mm: Mapped[float] = mapped_column(Float, nullable=False, default=15.0)
    margin_left_mm: Mapped[float] = mapped_column(Float, nullable=False, default=12.0)
    copies: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    layout_options: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Ledger(Base, TimestampMixin):
    __tablename__ = "ledgers"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    system_key: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    group_name: Mapped[str] = mapped_column(String(80), nullable=False, default="General")
    ledger_type: Mapped[str] = mapped_column(String(20), nullable=False, default="ASSET")
    opening_balance: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    opening_type: Mapped[str] = mapped_column(String(2), default="Dr")
    is_cash: Mapped[bool] = mapped_column(Boolean, default=False)
    is_bank: Mapped[bool] = mapped_column(Boolean, default=False)
    is_party_deposit: Mapped[bool] = mapped_column(Boolean, default=False)
    # Hospital HMS code uses is_patient_deposit — same column
    is_patient_deposit = synonym("is_party_deposit")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class PaymentMode(Base, TimestampMixin):
    __tablename__ = "payment_modes"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    is_cash: Mapped[bool] = mapped_column(Boolean, default=False)
    is_credit: Mapped[bool] = mapped_column(Boolean, default=False)
    ledger_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("ledgers.id"), nullable=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    ledger: Mapped["Ledger | None"] = relationship("Ledger")


class Party(Base, TimestampMixin):
    """Shared counterparty. Hospital: patient; GenERP: customer/vendor; Lodge: guest+AP/AR."""

    __tablename__ = "parties"

    id: Mapped[str] = _pk()
    party_type: Mapped[str] = mapped_column(String(20), index=True)  # customer | vendor | both
    code: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_person: Mapped[str | None] = mapped_column(String(150), nullable=True)
    address_line1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address_line3: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address_line4: Mapped[str | None] = mapped_column(String(200), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    pin_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    shipping_address_line1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    shipping_address_line2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    shipping_address_line3: Mapped[str | None] = mapped_column(String(200), nullable=True)
    shipping_address_line4: Mapped[str | None] = mapped_column(String(200), nullable=True)
    shipping_city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    shipping_state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    shipping_pin_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    same_as_billing: Mapped[bool] = mapped_column(Boolean, default=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    mobile: Mapped[str | None] = mapped_column(String(30), nullable=True)
    image_path: Mapped[str | None] = mapped_column(String(300), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    opening_balance: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    opening_type: Mapped[str] = mapped_column(String(2), default="Dr")
    ledger_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("ledgers.id"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    ledger: Mapped["Ledger | None"] = relationship("Ledger")

    __table_args__ = (
        Index(
            "uq_parties_customer_code",
            "code",
            unique=True,
            postgresql_where=text("party_type IN ('customer', 'both')"),
        ),
        Index(
            "uq_parties_vendor_code",
            "code",
            unique=True,
            postgresql_where=text("party_type IN ('vendor', 'both')"),
        ),
    )
