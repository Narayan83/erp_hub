from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from erp_core.database import Base


class CfTransaction(Base):
    __tablename__ = "cf_transactions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("cf_projects.id"), nullable=False, index=True)
    phase_id: Mapped[UUID] = mapped_column(ForeignKey("cf_phases.id"), nullable=False, index=True)
    work_type_id: Mapped[UUID] = mapped_column(ForeignKey("cf_work_types.id"), nullable=False, index=True)
    ledger_id: Mapped[UUID] = mapped_column(ForeignKey("cf_ledgers.id"), nullable=False, index=True)
    payment_mode_id: Mapped[UUID] = mapped_column(ForeignKey("cf_payment_modes.id"), nullable=False)

    # labour | partner | vendor | none
    party_type: Mapped[str] = mapped_column(String(20), default="none")
    labour_id: Mapped[UUID | None] = mapped_column(ForeignKey("cf_labours.id"), nullable=True)
    partner_id: Mapped[UUID | None] = mapped_column(ForeignKey("cf_partners.id"), nullable=True)
    vendor_id: Mapped[UUID | None] = mapped_column(ForeignKey("cf_vendors.id"), nullable=True)

    txn_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    # copied from payment mode at save time
    entry_type: Mapped[str] = mapped_column(String(10), nullable=False)  # credit | debit
    narration: Mapped[str] = mapped_column(Text, default="")
    reference: Mapped[str] = mapped_column(String(120), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
