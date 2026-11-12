"""Hospital clinical models — Patient extends core Party; OPD bill is first migrated flow."""

from datetime import date
from uuid import uuid4

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from erp_core.database import Base
from erp_core.models.base import TimestampMixin


def _pk() -> Mapped[str]:
    return mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))


class Department(Base, TimestampMixin):
    __tablename__ = "departments"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Doctor(Base, TimestampMixin):
    __tablename__ = "doctors"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    department_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("departments.id"), nullable=True
    )
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    department: Mapped["Department | None"] = relationship("Department")


class Patient(Base, TimestampMixin):
    """Hospital patient demographics; linked 1:1 to core Party for accounts."""

    __tablename__ = "patients"

    id: Mapped[str] = _pk()
    party_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("parties.id"), unique=True, index=True
    )
    patient_no: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    title: Mapped[str | None] = mapped_column(String(10), nullable=True)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    middle_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    age: Mapped[str | None] = mapped_column(String(20), nullable=True)
    gender: Mapped[str] = mapped_column(String(10), nullable=False, default="Other")
    blood_group: Mapped[str | None] = mapped_column(String(10), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    mobile: Mapped[str | None] = mapped_column(String(20), nullable=True)
    scheme: Mapped[str | None] = mapped_column(String(100), nullable=True)
    aadhar_no: Mapped[str | None] = mapped_column(String(20), nullable=True)
    address_line1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    @property
    def full_name(self) -> str:
        parts = [self.first_name, self.middle_name, self.last_name]
        return " ".join(p for p in parts if p)


class OpdBill(Base, TimestampMixin):
    __tablename__ = "opd_bills"

    id: Mapped[str] = _pk()
    bill_no: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    bill_date: Mapped[date] = mapped_column(Date, nullable=False)
    patient_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("patients.id"), nullable=False, index=True
    )
    patient_no: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    doctor_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("doctors.id"), nullable=True
    )
    department_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("departments.id"), nullable=True
    )
    payment_mode_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("payment_modes.id"), nullable=True
    )
    gross_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    net_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="saved")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    patient: Mapped["Patient"] = relationship("Patient")
    doctor: Mapped["Doctor | None"] = relationship("Doctor")
    lines: Mapped[list["OpdBillLine"]] = relationship(
        "OpdBillLine", back_populates="bill", cascade="all, delete-orphan"
    )


class OpdBillLine(Base, TimestampMixin):
    __tablename__ = "opd_bill_lines"

    id: Mapped[str] = _pk()
    bill_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("opd_bills.id", ondelete="CASCADE"), index=True
    )
    service_code: Mapped[str] = mapped_column(String(30), nullable=False)
    service_name: Mapped[str] = mapped_column(String(200), nullable=False)
    rate: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    bill: Mapped["OpdBill"] = relationship("OpdBill", back_populates="lines")
