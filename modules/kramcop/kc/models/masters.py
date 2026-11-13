from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from modules.kramcop.kc.core.database import Base


class Category(Base):
    __tablename__ = "kc_categories"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name_en: Mapped[str] = mapped_column(String(80), default="")
    name_kn: Mapped[str] = mapped_column(String(120), default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ShareType(Base):
    __tablename__ = "kc_share_types"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    code: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    prefix: Mapped[str] = mapped_column(String(10), default="")
    legacy_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Company(Base):
    __tablename__ = "kc_company"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name_en: Mapped[str] = mapped_column(String(200), default="Kramcop")
    name_kn: Mapped[str] = mapped_column(String(250), default="")
    address_en: Mapped[str] = mapped_column(String(250), default="")
    address_kn: Mapped[str] = mapped_column(String(250), default="")
    village: Mapped[str] = mapped_column(String(120), default="")
    taluk: Mapped[str] = mapped_column(String(120), default="")
    district: Mapped[str] = mapped_column(String(120), default="")
    state: Mapped[str] = mapped_column(String(80), default="Karnataka")
    pin: Mapped[str] = mapped_column(String(12), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    mobile: Mapped[str] = mapped_column(String(40), default="")
    email: Mapped[str] = mapped_column(String(120), default="")
    website: Mapped[str] = mapped_column(String(160), default="")
    reg_no: Mapped[str] = mapped_column(String(80), default="")
    gstin: Mapped[str] = mapped_column(String(30), default="")
    pan: Mapped[str] = mapped_column(String(20), default="")
    financial_year: Mapped[str] = mapped_column(String(20), default="")


class SocietyRole(Base):
    __tablename__ = "kc_roles"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Alias kept for the copied services. The class name must not be Role — that
# collides with the shared erp_core.models.auth.Role registry.
Role = SocietyRole


class RoleMenu(Base):
    __tablename__ = "kc_role_menus"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    role_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    menu_key: Mapped[str] = mapped_column(String(40), nullable=False)
    can_view: Mapped[bool] = mapped_column(Boolean, default=True)
    can_add: Mapped[bool] = mapped_column(Boolean, default=False)
    can_edit: Mapped[bool] = mapped_column(Boolean, default=False)
    can_delete: Mapped[bool] = mapped_column(Boolean, default=False)


class UserRole(Base):
    __tablename__ = "kc_user_roles"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    role_id: Mapped[UUID] = mapped_column(nullable=False, index=True)


class AuditLog(Base):
    __tablename__ = "kc_audit_logs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(String(36), default="")
    username: Mapped[str] = mapped_column(String(80), default="")
    action: Mapped[str] = mapped_column(String(40), default="")
    entity: Mapped[str] = mapped_column(String(40), default="")
    entity_id: Mapped[str] = mapped_column(String(80), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
