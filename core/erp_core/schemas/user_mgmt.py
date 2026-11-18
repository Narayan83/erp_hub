from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class MessageResponse(BaseModel):
    message: str = "ok"


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
