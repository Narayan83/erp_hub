from datetime import date
from uuid import uuid4

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from erp_core.database import Base
from modules.hospital.hms.models.base import TimestampMixin


class SingleServiceOpdOption(Base, TimestampMixin):
    """Setup row. Each active option becomes a menu under Transactions → Billing."""

    __tablename__ = "single_service_opd_options"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    menu_code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    # Primary/summary service kept for reports and older clients.
    service_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("patient_service_masters.id"), nullable=False
    )
    service_name: Mapped[str] = mapped_column(String(200), nullable=False)
    use_patient_id: Mapped[bool] = mapped_column(Boolean, default=False)
    default_rate: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    doctor_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("doctors.id"), nullable=True, index=True
    )
    bill_prefix: Mapped[str] = mapped_column(String(10), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    service: Mapped["PatientServiceMaster"] = relationship("PatientServiceMaster")
    doctor: Mapped["Doctor | None"] = relationship("Doctor")
    services: Mapped[list["SingleServiceOpdOptionService"]] = relationship(
        "SingleServiceOpdOptionService",
        back_populates="option",
        cascade="all, delete-orphan",
        order_by="SingleServiceOpdOptionService.sort_order",
    )


class SingleServiceOpdOptionService(Base, TimestampMixin):
    """Services available under one Single Service OPD billing option."""

    __tablename__ = "single_service_opd_option_services"
    __table_args__ = (
        UniqueConstraint("option_id", "service_id", name="uq_sso_option_service"),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    option_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("single_service_opd_options.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    service_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("patient_service_masters.id"),
        nullable=False,
        index=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    option: Mapped["SingleServiceOpdOption"] = relationship(
        "SingleServiceOpdOption", back_populates="services"
    )
    service: Mapped["PatientServiceMaster"] = relationship("PatientServiceMaster")


class SingleServiceOpdBill(Base, TimestampMixin):
    """One-service OPD bill. Number series is separate and restarts each financial year."""

    __tablename__ = "single_service_opd_bills"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    bill_no: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    bill_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    option_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("single_service_opd_options.id"),
        nullable=False,
        index=True,
    )
    patient_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("patients.id"), nullable=True, index=True
    )
    patient_no: Mapped[str | None] = mapped_column(String(30), nullable=True)
    patient_name: Mapped[str] = mapped_column(String(200), nullable=False)
    doctor_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("doctors.id"), nullable=True, index=True
    )
    service_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("patient_service_masters.id"), nullable=True
    )
    service_name: Mapped[str] = mapped_column(String(200), nullable=False)
    rate: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    payment_mode_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("payment_modes.id"), nullable=True
    )
    payment_mode_name: Mapped[str] = mapped_column(String(150), default="Cash")
    created_by_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    option: Mapped["SingleServiceOpdOption"] = relationship("SingleServiceOpdOption")
    patient: Mapped["Patient | None"] = relationship("Patient")
    doctor: Mapped["Doctor | None"] = relationship("Doctor")
    lines: Mapped[list["SingleServiceOpdBillLine"]] = relationship(
        "SingleServiceOpdBillLine",
        back_populates="bill",
        cascade="all, delete-orphan",
        order_by="SingleServiceOpdBillLine.sort_order",
    )


class SingleServiceOpdBillLine(Base, TimestampMixin):
    """Services actually included on one single-service OPD bill."""

    __tablename__ = "single_service_opd_bill_lines"
    __table_args__ = (
        UniqueConstraint("bill_id", "service_id", name="uq_sso_bill_line_service"),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    bill_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("single_service_opd_bills.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    service_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("patient_service_masters.id"),
        nullable=False,
        index=True,
    )
    service_name: Mapped[str] = mapped_column(String(200), nullable=False)
    rate: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    bill: Mapped["SingleServiceOpdBill"] = relationship(
        "SingleServiceOpdBill", back_populates="lines"
    )
    service: Mapped["PatientServiceMaster"] = relationship("PatientServiceMaster")
