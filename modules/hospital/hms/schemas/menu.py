import re

from pydantic import BaseModel, Field, field_validator

from modules.hospital.hms.schemas.common import ORMModel

_CODE_RE = re.compile(r"^[a-z][a-z0-9_]{1,79}$")


class MenuPermissions(BaseModel):
    can_view: bool = True
    can_create: bool = False
    can_update: bool = False
    can_delete: bool = False


class MenuTreeNode(ORMModel):
    id: str
    code: str
    label: str
    icon: str | None = None
    sort_order: int
    legacy_mcode: int | None = None
    legacy_form: str | None = None
    parameters: str | None = None
    permissions: MenuPermissions
    children: list["MenuTreeNode"] = []


class MenuRead(ORMModel):
    id: str
    code: str
    label: str
    parent_id: str | None
    icon: str | None
    sort_order: int
    legacy_mcode: int | None
    legacy_form: str | None
    parameters: str | None
    is_active: bool


class MenuCreate(BaseModel):
    """Code is optional — blank/omitted values are generated from the label on save."""

    code: str | None = Field(default=None, max_length=80)
    label: str = Field(..., min_length=1, max_length=150)
    parent_id: str | None = None
    icon: str | None = Field(default=None, max_length=50)
    sort_order: int = 0
    legacy_mcode: int | None = None
    legacy_form: str | None = Field(default=None, max_length=80)
    parameters: str | None = Field(default=None, max_length=50)
    is_active: bool = True

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value: object) -> object:
        if value is None:
            return None
        if not isinstance(value, str):
            return value
        code = value.strip().lower().replace(" ", "_").replace("-", "_")
        code = re.sub(r"[^a-z0-9_]", "", code)
        return code or None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not _CODE_RE.match(value):
            raise ValueError(
                "Code must be lowercase, start with a letter, and use only letters, numbers, underscores"
            )
        return value

    @field_validator("label", mode="before")
    @classmethod
    def strip_label(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("icon", "legacy_form", "parameters", mode="before")
    @classmethod
    def blank_to_none_optional(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value


class MenuUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=150)
    parent_id: str | None = None
    icon: str | None = Field(default=None, max_length=50)
    sort_order: int | None = None
    legacy_mcode: int | None = None
    legacy_form: str | None = Field(default=None, max_length=80)
    parameters: str | None = Field(default=None, max_length=50)
    is_active: bool | None = None

    @field_validator("label", "icon", "legacy_form", "parameters", mode="before")
    @classmethod
    def strip_strings(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value


MenuTreeNode.model_rebuild()
