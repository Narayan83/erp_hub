"""Hospital imports keep working. The table itself lives in core so every product shares it."""

from erp_core.models.dashboard_shortcut import DashboardShortcut

__all__ = ["DashboardShortcut"]
