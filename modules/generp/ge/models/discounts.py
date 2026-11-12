"""Discount scheme master."""

from __future__ import annotations

from datetime import date
from uuid import uuid4

from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from modules.generp.ge.core.database import Base
from modules.generp.ge.models.base import TimestampMixin


def _pk() -> Mapped[str]:
    return mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))


# scope: BILL | LINE | PRODUCT | CATEGORY
# discount_type: PCT | AMT
class DiscountScheme(Base, TimestampMixin):
    __tablename__ = "discount_schemes"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    scope: Mapped[str] = mapped_column(String(20), default="BILL")
    discount_type: Mapped[str] = mapped_column(String(10), default="PCT")
    value: Mapped[float] = mapped_column(Numeric(14, 4), default=0)
    min_bill_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    max_discount_amount: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    product_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("products.id"), nullable=True
    )
    category_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("categories.id"), nullable=True
    )
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    applies_to: Mapped[str] = mapped_column(String(20), default="ALL")  # SALE | WHOLESALE | ALL
    narration: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
