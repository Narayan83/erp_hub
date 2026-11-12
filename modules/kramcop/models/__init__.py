"""Register Kramcop tables on the shared metadata."""

from modules.kramcop.kc.models.masters import (  # noqa: F401
    AuditLog,
    Category,
    Company,
    Role,
    RoleMenu,
    ShareType,
    UserRole,
)
from modules.kramcop.kc.models.member import Member, Transaction  # noqa: F401
from modules.kramcop.kc.models.settings import AppSetting  # noqa: F401
