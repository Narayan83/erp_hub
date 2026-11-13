from __future__ import annotations

from pydantic import BaseModel, Field


class DashboardShortcutIn(BaseModel):
    menu_code: str = Field(..., min_length=1, max_length=80)
    button_label: str = Field(..., min_length=1, max_length=80)
    sort_order: int = 0
    is_active: bool = True
    host_code: str = Field(default="dashboard", min_length=1, max_length=80)


class DashboardShortcutOut(BaseModel):
    id: str
    host_code: str = "dashboard"
    menu_code: str
    button_label: str
    sort_order: int
    is_active: bool
    menu_label: str | None = None


class DashboardShortcutBulkIn(BaseModel):
    """Replace shortcuts for one host menu with this ordered list."""

    host_code: str = Field(default="dashboard", min_length=1, max_length=80)
    items: list[DashboardShortcutIn]
