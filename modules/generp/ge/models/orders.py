"""Sales / purchase orders."""

from __future__ import annotations

from datetime import date
from uuid import uuid4

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from modules.generp.ge.core.database import Base
from modules.generp.ge.models.base import TimestampMixin


def _pk() -> Mapped[str]:
    return mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))


ORDER_TYPES = ("SALES_ORDER", "PURCHASE_ORDER")
ORDER_STATUSES = ("DRAFT", "CONFIRMED", "PARTIAL", "FULFILLED", "CANCELLED")


class Order(Base, TimestampMixin):
    __tablename__ = "orders"

    id: Mapped[str] = _pk()
    order_type: Mapped[str] = mapped_column(String(20), index=True)
    order_no: Mapped[str] = mapped_column(String(80), index=True)
    order_date: Mapped[date] = mapped_column(Date, index=True)
    party_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("parties.id"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(20), default="CONFIRMED", index=True)
    narration: Mapped[str | None] = mapped_column(Text, nullable=True)
    discount_scheme_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("discount_schemes.id"), nullable=True
    )
    discount_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    gross_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    tax_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    net_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    is_cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    converted_voucher_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("vouchers.id"), nullable=True
    )

    party: Mapped["Party | None"] = relationship("Party")
    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class OrderItem(Base, TimestampMixin):
    __tablename__ = "order_items"

    id: Mapped[str] = _pk()
    order_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("products.id"), index=True
    )
    quantity: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    qty_fulfilled: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    rate: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    discount_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    gst_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("gst_rates.id"), nullable=True
    )
    gst_rate: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    gst_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    taxable_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    order: Mapped["Order"] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship("Product")
