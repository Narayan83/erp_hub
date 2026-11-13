from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator, model_validator


class SingleServiceOpdOptionServiceRead(BaseModel):
    service_id: str
    service_code: str | None = None
    service_name: str
    rate: Decimal | None = None
    service_charge: Decimal | None = None
    sort_order: int = 0


class SingleServiceOpdOptionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    service_id: str | None = None
    service_ids: list[str] | None = None
    doctor_id: str
    use_patient_id: bool = False
    default_rate: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    bill_prefix: str | None = Field(None, max_length=10)
    is_active: bool = True

    @field_validator("name", "bill_prefix", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @model_validator(mode="after")
    def require_services(self) -> "SingleServiceOpdOptionCreate":
        ids: list[str] = []
        for raw in self.service_ids or []:
            sid = str(raw or "").strip()
            if sid and sid not in ids:
                ids.append(sid)
        if self.service_id:
            sid = str(self.service_id).strip()
            if sid and sid not in ids:
                ids.insert(0, sid)
        if not ids:
            raise ValueError("At least one service is required")
        self.service_ids = ids
        self.service_id = ids[0]
        return self


class SingleServiceOpdOptionUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=150)
    service_id: str | None = None
    service_ids: list[str] | None = None
    doctor_id: str | None = None
    use_patient_id: bool | None = None
    default_rate: Decimal | None = Field(None, ge=0, decimal_places=2)
    bill_prefix: str | None = Field(None, max_length=10)
    sort_order: int | None = Field(None, ge=0)
    is_active: bool | None = None

    @field_validator("name", "bill_prefix", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @model_validator(mode="after")
    def normalize_services(self) -> "SingleServiceOpdOptionUpdate":
        if self.service_ids is None and self.service_id is None:
            return self
        ids: list[str] = []
        for raw in self.service_ids or []:
            sid = str(raw or "").strip()
            if sid and sid not in ids:
                ids.append(sid)
        if self.service_id:
            sid = str(self.service_id).strip()
            if sid and sid not in ids:
                ids.insert(0, sid)
        if not ids:
            raise ValueError("At least one service is required")
        self.service_ids = ids
        self.service_id = ids[0]
        return self


class SingleServiceOpdOptionRead(BaseModel):
    id: str
    name: str
    menu_code: str
    service_id: str
    service_name: str
    services: list[SingleServiceOpdOptionServiceRead] = Field(default_factory=list)
    doctor_id: str | None = None
    doctor_name: str | None = None
    use_patient_id: bool
    default_rate: Decimal
    bill_prefix: str
    sort_order: int
    is_active: bool

    model_config = {"from_attributes": True}


class SingleServiceOpdOptionReorder(BaseModel):
    """Ordered option ids — first item becomes sort_order 0."""

    option_ids: list[str] = Field(..., min_length=1)

    @model_validator(mode="after")
    def unique_ids(self) -> "SingleServiceOpdOptionReorder":
        ids: list[str] = []
        for raw in self.option_ids:
            oid = str(raw or "").strip()
            if oid and oid not in ids:
                ids.append(oid)
        if not ids:
            raise ValueError("At least one option id is required")
        self.option_ids = ids
        return self


class SingleServiceOpdBillServiceRead(BaseModel):
    service_id: str
    service_name: str
    rate: Decimal
    sort_order: int = 0


class SingleServiceOpdBillLineWrite(BaseModel):
    service_id: str
    rate: Decimal = Field(..., ge=0, decimal_places=2)


class SingleServiceOpdBillCreate(BaseModel):
    option_id: str
    bill_date: date
    doctor_id: str | None = None
    patient_id: str | None = None
    patient_no: str | None = None
    patient_name: str = Field(default="", max_length=200)
    service_id: str | None = None
    service_ids: list[str] | None = None
    lines: list[SingleServiceOpdBillLineWrite] | None = None
    rate: Decimal | None = Field(None, ge=0, decimal_places=2)
    payment_mode_id: str | None = None

    @field_validator("patient_name", "patient_no", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @model_validator(mode="after")
    def rates_from_lines(self) -> "SingleServiceOpdBillCreate":
        if self.lines:
            ids: list[str] = []
            total = Decimal("0")
            for line in self.lines:
                sid = str(line.service_id or "").strip()
                if not sid or sid in ids:
                    continue
                ids.append(sid)
                total += line.rate
            if not ids:
                raise ValueError("Select at least one service")
            self.service_ids = ids
            self.service_id = ids[0]
            self.rate = total
        elif self.rate is None:
            raise ValueError("Rate is required")
        return self


class SingleServiceOpdBillUpdate(BaseModel):
    bill_date: date | None = None
    doctor_id: str | None = None
    patient_id: str | None = None
    patient_no: str | None = None
    patient_name: str | None = Field(None, max_length=200)
    service_id: str | None = None
    service_ids: list[str] | None = None
    lines: list[SingleServiceOpdBillLineWrite] | None = None
    rate: Decimal | None = Field(None, ge=0, decimal_places=2)
    payment_mode_id: str | None = None

    @field_validator("patient_name", "patient_no", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @model_validator(mode="after")
    def rates_from_lines(self) -> "SingleServiceOpdBillUpdate":
        if not self.lines:
            return self
        ids: list[str] = []
        total = Decimal("0")
        kept: list[SingleServiceOpdBillLineWrite] = []
        for line in self.lines:
            sid = str(line.service_id or "").strip()
            if not sid or sid in ids:
                continue
            ids.append(sid)
            total += line.rate
            kept.append(line)
        if not ids:
            raise ValueError("Select at least one service")
        self.lines = kept
        self.service_ids = ids
        self.service_id = ids[0]
        self.rate = total
        return self


class SingleServiceOpdBillRead(BaseModel):
    id: str
    bill_no: str
    bill_date: date
    option_id: str
    option_name: str | None = None
    patient_id: str | None
    patient_no: str | None
    patient_name: str
    doctor_id: str | None = None
    doctor_name: str | None = None
    service_id: str | None
    service_name: str
    services: list[SingleServiceOpdBillServiceRead] = Field(default_factory=list)
    rate: Decimal
    payment_mode_id: str | None = None
    payment_mode_name: str

    model_config = {"from_attributes": True}


class SingleServiceOpdBillReportRow(BaseModel):
    serial_no: int
    bill_id: str
    bill_no: str
    bill_date: date
    patient_name: str
    amount: Decimal = Field(..., decimal_places=2)


class SingleServiceOpdBillReportRead(BaseModel):
    option_id: str
    option_name: str
    from_date: date
    to_date: date
    rows: list[SingleServiceOpdBillReportRow]
    grand_total: Decimal = Field(..., decimal_places=2)
