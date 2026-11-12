from typing import Literal
from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str
    password: str


class RoleBrief(BaseModel):
    id: UUID
    name: str

    model_config = {"from_attributes": True}


class UserInfo(BaseModel):
    id: UUID
    username: str
    email: str
    full_name: str
    is_active: bool = True
    roles: list[RoleBrief] = []
    menus: list[str] = []

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo
    idle_timeout_minutes: int = 30


class UserIn(BaseModel):
    username: str
    email: str
    full_name: str = ""
    password: str = ""
    is_active: bool = True
    role_ids: list[UUID] = []


class TransliterateRequest(BaseModel):
    text: str = ""
    mode: str = Field(default="english", description="english | nudi")


class TransliterateResponse(BaseModel):
    text: str


class CategoryIn(BaseModel):
    code: str
    name_en: str
    name_kn: str = ""
    is_default: bool = False


class CategoryOut(BaseModel):
    id: UUID
    code: str
    name_en: str
    name_kn: str = ""
    is_default: bool = False

    model_config = {"from_attributes": True}


class ShareTypeIn(BaseModel):
    code: int
    prefix: str = ""
    name: str
    legacy_code: int | None = None
    is_active: bool = True


class ShareTypeOut(BaseModel):
    id: UUID
    code: int
    prefix: str = ""
    name: str
    legacy_code: int | None = None
    is_active: bool = True

    model_config = {"from_attributes": True}


class CompanyIn(BaseModel):
    name_en: str = "Kramcop"
    name_kn: str = ""
    address_en: str = ""
    address_kn: str = ""
    village: str = ""
    taluk: str = ""
    district: str = ""
    state: str = "Karnataka"
    pin: str = ""
    phone: str = ""
    mobile: str = ""
    email: str = ""
    website: str = ""
    reg_no: str = ""
    gstin: str = ""
    pan: str = ""
    financial_year: str = ""


class CompanyOut(CompanyIn):
    id: UUID | None = None
    member_count: int = 0

    model_config = {"from_attributes": True}


class RoleMenuIn(BaseModel):
    menu_key: str
    can_view: bool = True
    can_add: bool = False
    can_edit: bool = False
    can_delete: bool = False


class RoleIn(BaseModel):
    name: str
    description: str = ""
    menus: list[RoleMenuIn] = []


class RoleOut(BaseModel):
    id: UUID
    name: str
    description: str = ""
    menus: list[RoleMenuIn] = []

    model_config = {"from_attributes": True}


class MemberIn(BaseModel):
    acno: int
    shac: str = ""
    first_en: str = ""
    first_kn: str = ""
    second_en: str = ""
    second_kn: str = ""
    third_en: str = ""
    third_kn: str = ""
    village_en: str = ""
    village_kn: str = ""
    post_en: str = ""
    post_kn: str = ""
    taluk_en: str = ""
    taluk_kn: str = ""
    dist_en: str = ""
    dist_kn: str = ""
    pin: str = ""
    category: str = "G"
    sex: str = ""
    mobile: str = ""
    phone: str = ""
    closed: bool = False
    share_type_code: int = 4
    auto_kannada: bool = True


class MemberOut(BaseModel):
    id: UUID
    acno: int
    shac: str = ""
    share_nos: str = ""
    first_en: str
    first_kn: str
    second_en: str
    second_kn: str
    third_en: str
    third_kn: str
    village_en: str
    village_kn: str
    post_en: str
    post_kn: str
    taluk_en: str
    taluk_kn: str
    dist_en: str
    dist_kn: str
    pin: str
    category: str
    sex: str
    mobile: str
    phone: str
    closed: bool
    share_type_code: int = 4
    has_photo: bool = False
    has_sign: bool = False
    name_kn: str = ""
    name_en: str = ""
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class MemberListResponse(BaseModel):
    items: list[MemberOut]
    total: int
    page: int
    page_size: int
    next_acno: int = 1


class LabelMember(BaseModel):
    acno: int
    acno_display: str
    share_no: str
    name_kn: str
    name_en: str = ""
    village_kn: str
    village_en: str = ""
    post_kn: str
    post_en: str = ""
    taluk_kn: str
    taluk_en: str = ""
    dist_kn: str
    dist_en: str = ""
    pin: str = ""


class LabelSheetResponse(BaseModel):
    prefix: str
    items: list[LabelMember]


class TransactionIn(BaseModel):
    acno: int
    kind: Literal["share_addition", "share_deletion"]
    txn_date: date
    rno: str = ""
    amount: float = 0
    narration: str = ""
    board_meeting: str = ""
    share_count: int = 1
    share_type_code: int = 4
    payment_mode: Literal["cash", "adjustment"] = "cash"
    shac: str = ""


class TransactionOut(BaseModel):
    id: UUID
    acno: int
    typ: int | None
    astyp: str
    txn_date: date | None
    rno: str
    amount: float
    drcr: int | None
    kind: str = "other"
    kind_label: str = "Other"
    narration: str = ""
    board_meeting: str = ""
    share_count: int = 1
    running_balance: float = 0

    model_config = {"from_attributes": True}


class LedgerOut(BaseModel):
    member: MemberOut
    items: list[TransactionOut]
    addition_amount: float
    deletion_amount: float
    balance: float
    share_nos: str
    next_rno: str = ""


class ScheduleRow(BaseModel):
    acno: int
    name_en: str
    name_kn: str
    mobile: str
    category: str
    share_nos: str
    addition_amount: float
    deletion_amount: float
    balance: float


class ScheduleList(BaseModel):
    items: list[ScheduleRow]
    total: int
    page: int
    page_size: int


class SummaryRow(BaseModel):
    acno: int
    name_en: str
    name_kn: str
    balance: float
    share_nos: str = ""


class SummaryList(BaseModel):
    society_name: str
    as_on: date
    language: str
    items: list[SummaryRow]
    total: int


class AuditOut(BaseModel):
    id: UUID
    username: str
    action: str
    entity: str
    entity_id: str
    detail: str
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class SettingsOut(BaseModel):
    society_name: str
    acno_prefix: str
    member_count: int


class SettingsIn(BaseModel):
    society_name: str = "Kramcop"
    acno_prefix: str = "D-"
