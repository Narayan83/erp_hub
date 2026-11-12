from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from erp_core.database import Base
from modules.hospital.hms.models.base import TimestampMixin


class HospitalProfile(Base, TimestampMixin):
    """Singleton hospital details used on bills and reports."""

    __tablename__ = "hospital_profile"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, default="MAIN")
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    pathology_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    medical_shop_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
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
    pathology_gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    medical_shop_gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    hospital_registration_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    software_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    backup_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    backup_time: Mapped[str] = mapped_column(String(5), default="22:00", server_default="22:00")
    backup_directory: Mapped[str | None] = mapped_column(String(500), nullable=True)
    backup_keep_days: Mapped[int] = mapped_column(Integer, default=30, server_default="30")
    last_backup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_backup_status: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_backup_file: Mapped[str | None] = mapped_column(String(500), nullable=True)
