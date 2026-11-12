from datetime import datetime

from pydantic import BaseModel, Field

from modules.hospital.hms.schemas.common import OptionalCode, ORMModel


class PrefixCreate(BaseModel):
    code: OptionalCode = None
    name: str = Field(..., min_length=2, max_length=150)
    prefix_value: str = Field(..., min_length=1, max_length=20)
    sort_order: int = 0
    is_active: bool = True


class PrefixUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=150)
    prefix_value: str | None = Field(None, min_length=1, max_length=20)
    sort_order: int | None = None
    is_active: bool | None = None


class PrefixRead(ORMModel):
    id: str
    code: str
    name: str
    prefix_value: str
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
