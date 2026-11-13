from datetime import date
from uuid import uuid4

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from modules.generp.ge.core.database import Base
from modules.generp.ge.models.base import TimestampMixin


def _pk() -> Mapped[str]:
    return mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))


# voucher_type values:
#   SALE, WHOLESALE, PURCHASE, SALE_RETURN, PURCHASE_RETURN
class Voucher(Base, TimestampMixin):
    __tablename__ = "vouchers"

    id: Mapped[str] = _pk()
    voucher_type: Mapped[str] = mapped_column(String(20), index=True)
    voucher_no: Mapped[str] = mapped_column(String(80), index=True)
    voucher_date: Mapped[date] = mapped_column(Date, index=True)
    party_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("parties.id"), nullable=True, index=True
    )
    payment_mode_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("payment_modes.id"), nullable=True
    )
    is_credit: Mapped[bool] = mapped_column(Boolean, default=False)
    narration: Mapped[str | None] = mapped_column(Text, nullable=True)
    party_bill_no: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    gross_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    discount_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    tax_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    adjust_advance: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    net_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    is_cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Parked purchase: qty received, rates not yet entered — no stock/ledger posting
    is_parked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )

    party: Mapped["Party | None"] = relationship("Party")
    payment_mode: Mapped["PaymentMode | None"] = relationship("PaymentMode")
    items: Mapped[list["VoucherItem"]] = relationship(
        back_populates="voucher", cascade="all, delete-orphan"
    )
    entries: Mapped[list["VoucherEntry"]] = relationship(
        back_populates="voucher", cascade="all, delete-orphan"
    )
    payments: Mapped[list["VoucherPayment"]] = relationship(
        back_populates="voucher", cascade="all, delete-orphan"
    )


class VoucherItem(Base, TimestampMixin):
    __tablename__ = "voucher_items"

    id: Mapped[str] = _pk()
    voucher_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("vouchers.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("products.id"), nullable=True
    )
    description: Mapped[str | None] = mapped_column(String(200), nullable=True)
    quantity: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    rate: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    discount_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    gst_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("gst_rates.id"), nullable=True
    )
    gst_rate: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    gst_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    taxable_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    mrp: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    sale_price: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    profit_pct: Mapped[float] = mapped_column(Numeric(8, 2), default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    voucher: Mapped["Voucher"] = relationship(back_populates="items")
    product: Mapped["Product | None"] = relationship("Product")


class VoucherPayment(Base, TimestampMixin):
    """A single tender line on a bill (split payment). Many per voucher."""

    __tablename__ = "voucher_payments"

    id: Mapped[str] = _pk()
    voucher_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("vouchers.id", ondelete="CASCADE"), index=True
    )
    payment_mode_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("payment_modes.id"), nullable=True
    )
    amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    voucher: Mapped["Voucher"] = relationship(back_populates="payments")
    payment_mode: Mapped["PaymentMode | None"] = relationship("PaymentMode")


class DocumentSequence(Base, TimestampMixin):
    """Atomic FY/branch/dept counter so concurrent terminals never reuse a number."""

    __tablename__ = "document_sequences"

    id: Mapped[str] = _pk()
    name: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    prefix: Mapped[str] = mapped_column(String(80), default="VCH")
    last_number: Mapped[int] = mapped_column(Integer, default=0)


class DocumentNumberRule(Base, TimestampMixin):
    """Per-document numbering rule. Sequence is consumed only on save."""

    __tablename__ = "document_number_rules"

    id: Mapped[str] = _pk()
    kind: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    prefix: Mapped[str] = mapped_column(String(20), default="")  # free-text prefix
    year_mode: Mapped[str] = mapped_column(String(20), default="financial_year")
    prefix2: Mapped[str] = mapped_column(String(12), default="01")
    prefix3: Mapped[str] = mapped_column(String(12), default="01")
    seq_digits: Mapped[int] = mapped_column(Integer, default=6)


class VoucherEntry(Base, TimestampMixin):
    """Double-entry ledger posting. Powers ledger details, cashbook, daybook, debtors."""

    __tablename__ = "voucher_entries"

    id: Mapped[str] = _pk()
    voucher_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("vouchers.id", ondelete="CASCADE"), index=True
    )
    ledger_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("ledgers.id"), index=True
    )
    entry_date: Mapped[date] = mapped_column(Date, index=True)
    debit: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    credit: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    narration: Mapped[str | None] = mapped_column(String(255), nullable=True)

    voucher: Mapped["Voucher"] = relationship(back_populates="entries")
    ledger: Mapped["Ledger"] = relationship("Ledger")
