from uuid import uuid4

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from erp_core.database import Base
from erp_core.models.base import TimestampMixin


def _pk() -> Mapped[str]:
    return mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))


class UserType(Base, TimestampMixin):
    __tablename__ = "user_types"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    maps_to_doctor: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = _pk()
    username: Mapped[str | None] = mapped_column(String(80), unique=True, index=True, nullable=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    user_type_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("user_types.id"), nullable=True
    )
    # Hospital HMS: optional linked doctor (no FK — doctors table is module-owned)
    doctor_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    user_type: Mapped["UserType | None"] = relationship("UserType")
    role_mappings: Mapped[list["UserRoleMapping"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Role(Base, TimestampMixin):
    __tablename__ = "roles"

    id: Mapped[str] = _pk()
    role_name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    user_mappings: Mapped[list["UserRoleMapping"]] = relationship(back_populates="role")
    menu_permissions: Mapped[list["RoleMenuPermission"]] = relationship(back_populates="role")


class UserRoleMapping(Base, TimestampMixin):
    __tablename__ = "user_role_mappings"

    id: Mapped[str] = _pk()
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("roles.id", ondelete="CASCADE"), index=True
    )
    priority: Mapped[int] = mapped_column(Integer, default=1)

    user: Mapped["User"] = relationship(back_populates="role_mappings")
    role: Mapped["Role"] = relationship(back_populates="user_mappings")


class Menu(Base, TimestampMixin):
    __tablename__ = "menus"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    label: Mapped[str] = mapped_column(String(150), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("menus.id"), nullable=True
    )
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Hospital legacy menu metadata (optional)
    legacy_mcode: Mapped[int | None] = mapped_column(Integer, nullable=True)
    legacy_form: Mapped[str | None] = mapped_column(String(40), nullable=True)
    parameters: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Which product module owns this menu: core | hospital | generp | lodge | ...
    module: Mapped[str] = mapped_column(String(40), default="core", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    children: Mapped[list["Menu"]] = relationship(
        "Menu", back_populates="parent", order_by="Menu.sort_order"
    )
    parent: Mapped["Menu | None"] = relationship(
        "Menu", back_populates="children", remote_side="Menu.id"
    )


class RoleMenuPermission(Base, TimestampMixin):
    __tablename__ = "role_menu_permissions"
    __table_args__ = (UniqueConstraint("role_id", "menu_id", name="uq_role_menu"),)

    id: Mapped[str] = _pk()
    role_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("roles.id", ondelete="CASCADE"), index=True
    )
    menu_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("menus.id", ondelete="CASCADE"), index=True
    )
    can_view: Mapped[bool] = mapped_column(Boolean, default=True)
    can_create: Mapped[bool] = mapped_column(Boolean, default=False)
    can_update: Mapped[bool] = mapped_column(Boolean, default=False)
    can_delete: Mapped[bool] = mapped_column(Boolean, default=False)

    role: Mapped["Role"] = relationship(back_populates="menu_permissions")
    menu: Mapped["Menu"] = relationship()


class NotificationSetup(Base, TimestampMixin):
    __tablename__ = "notification_setups"
    __table_args__ = (UniqueConstraint("event_code", "user_id", name="uq_notification_user"),)

    id: Mapped[str] = _pk()
    event_code: Mapped[str] = mapped_column(String(80), index=True)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
