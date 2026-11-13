from typing import Annotated, Generic, TypeVar

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

T = TypeVar("T")


def blank_to_none(value: object) -> object:
    if isinstance(value, str) and not value.strip():
        return None
    return value


# Master codes are optional on create — blank/omitted values get the next number on save.
OptionalCode = Annotated[
    Annotated[str, Field(max_length=30)] | None, BeforeValidator(blank_to_none)
]


class MessageResponse(BaseModel):
    message: str


class BillCancelRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=500)


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
