from datetime import datetime

from pydantic import BaseModel, Field

from modules.generp.ge.schemas.common import ORMModel


class UserCreate(BaseModel):
    username: str | None = None
    email: str | None = None
    password: str
    full_name: str
    phone: str | None = None
    user_type_id: str | None = None
    is_active: bool = True


class UserUpdate(BaseModel):
    username: str | None = None
    email: str | None = None
    password: str | None = None
    full_name: str | None = None
    phone: str | None = None
    user_type_id: str | None = None
    is_active: bool | None = None


class RoleRef(ORMModel):
    id: str
    role_name: str


class UserOut(ORMModel):
    id: str
    username: str | None = None
    email: str
    full_name: str
    phone: str | None = None
    user_type_id: str | None = None
    user_type_name: str | None = None
    is_active: bool
    updated_at: datetime | None = None


class UserTypeIn(BaseModel):
    code: str
    name: str
    sort_order: int = 0
    is_active: bool = True


class UserTypeOut(ORMModel):
    id: str
    code: str
    name: str
    sort_order: int
    is_active: bool


class RoleIn(BaseModel):
    role_name: str
    description: str | None = None
    is_active: bool = True


class RoleOut(ORMModel):
    id: str
    role_name: str
    description: str | None = None
    is_active: bool


class UserRoleMappingIn(BaseModel):
    user_id: str
    role_id: str
    priority: int = 1


class UserRoleMappingOut(ORMModel):
    id: str
    user_id: str
    role_id: str
    role_name: str | None = None
    priority: int


class NotificationSetupItem(BaseModel):
    user_id: str
    is_enabled: bool = True


class NotificationSetupBulk(BaseModel):
    event_code: str = Field(..., min_length=2, max_length=80)
    recipients: list[NotificationSetupItem]
