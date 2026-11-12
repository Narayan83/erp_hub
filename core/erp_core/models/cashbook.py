from datetime import date
from uuid import uuid4

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from erp_core.database import Base
from erp_core.models.base import TimestampMixin


class CashbookVoucher(Base, TimestampMixin):
    """Unified accounting voucher — advance / receipt / payment / contra / bill posts."""

    __tablename__ = "cashbook_vouchers"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    voucher_no: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    voucher_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    source_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    party_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("parties.id"), nullable=True, index=True
    )
    party_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # Hospital HMS cashbook posting links vouchers to patients (no FK — module-optional)
    patient_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    patient_no: Mapped[str | None] = mapped_column(String(40), nullable=True)
    narration: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    created_by_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    party: Mapped["Party | None"] = relationship("Party")  # noqa: F821
    lines: Mapped[list["CashbookVoucherLine"]] = relationship(
        "CashbookVoucherLine", back_populates="voucher", cascade="all, delete-orphan"
    )


class CashbookVoucherLine(Base, TimestampMixin):
    __tablename__ = "cashbook_voucher_lines"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    voucher_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("cashbook_vouchers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    ledger_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("ledgers.id"), nullable=False, index=True
    )
    debit_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    credit_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    narration: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    voucher: Mapped["CashbookVoucher"] = relationship("CashbookVoucher", back_populates="lines")
    ledger: Mapped["Ledger"] = relationship("Ledger")  # noqa: F821
