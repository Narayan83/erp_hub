"""Shared auth tables live in erp_core. GenERP code imports them from here."""

from erp_core.models.auth import (
    Menu,
    NotificationSetup,
    Role,
    RoleMenuPermission,
    User,
    UserRoleMapping,
    UserType,
)

__all__ = [
    "Menu",
    "NotificationSetup",
    "Role",
    "RoleMenuPermission",
    "User",
    "UserRoleMapping",
    "UserType",
]
