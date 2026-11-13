from datetime import datetime

from pydantic import BaseModel, Field

from modules.hospital.hms.schemas.common import OptionalCode, ORMModel


class AuthorityCreate(BaseModel):
    code: OptionalCode = None
    name: str = Field(..., min_length=2, max_length=150)
    sort_order: int = 0
    is_active: bool = True


class AuthorityUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=150)
    sort_order: int | None = None
    is_active: bool | None = None


class AuthorityRead(ORMModel):
    id: str
    code: str
    name: str
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
