from datetime import datetime

from modules.generp.ge.schemas.common import ORMModel


class AuditLogOut(ORMModel):
    id: str
    occurred_at: datetime
    user_id: str | None = None
    user_name: str | None = None
    user_email: str | None = None
    menu_code: str | None = None
    menu_label: str | None = None
    action: str
    entity_type: str | None = None
    entity_id: str | None = None
    ref_no: str | None = None
    summary: str | None = None
    details: dict | None = None
    ip_address: str | None = None


class AuditFilterUser(ORMModel):
    id: str
    name: str
    email: str | None = None


class AuditFilterMenu(ORMModel):
    code: str
    label: str


class AuditFiltersOut(ORMModel):
    users: list[AuditFilterUser]
    menus: list[AuditFilterMenu]
    actions: list[str]
