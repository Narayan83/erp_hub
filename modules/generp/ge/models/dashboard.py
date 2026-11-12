"""User-configurable menu shortcut buttons (per signed-in user)."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from modules.generp.ge.core.database import Base
from modules.generp.ge.models.base import TimestampMixin


def _pk() -> Mapped[str]:
    return mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))


class DashboardShortcut(Base, TimestampMixin):
    """Maps a menu code to a quick-access button for one user."""

    __tablename__ = "generp_dashboard_shortcuts"
    __table_args__ = (
        Index(
            "uq_dashboard_shortcut_user_host_menu",
            "user_id",
            "host_code",
            "menu_code",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
        ),
    )

    id: Mapped[str] = _pk()
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    host_code: Mapped[str] = mapped_column(String(80), default="dashboard", index=True)
    menu_code: Mapped[str] = mapped_column(String(80), index=True)
    button_label: Mapped[str] = mapped_column(String(80))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
