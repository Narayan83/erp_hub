"""Per-user shortcut buttons. Shared by every product, including ones added later."""

from uuid import uuid4

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from erp_core.database import Base
from erp_core.models.base import TimestampMixin


class DashboardShortcut(Base, TimestampMixin):
    __tablename__ = "dashboard_shortcuts"
    __table_args__ = (
        Index(
            "uq_core_shortcut_user_host_menu",
            "user_id",
            "host_code",
            "module_code",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    host_code: Mapped[str] = mapped_column(String(100), nullable=False, default="dashboard", index=True)
    module_code: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    button_label: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
