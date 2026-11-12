from datetime import datetime

from pydantic import BaseModel, Field

from modules.hospital.hms.schemas.common import OptionalCode, ORMModel


class ServiceCategoryBase(BaseModel):
    code: OptionalCode = None
    name: str = Field(..., min_length=1, max_length=150)
    sort_order: int = 0


class ServiceCategoryCreate(ServiceCategoryBase):
    pass


class ServiceCategoryUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=150)
    sort_order: int | None = None


class ServiceCategoryRead(ORMModel):
    id: str
    code: str
    name: str
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
