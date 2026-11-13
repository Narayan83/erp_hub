from datetime import date

from pydantic import BaseModel, Field


class DepartmentOut(BaseModel):
    id: str
    code: str
    name: str
    is_active: bool

    model_config = {"from_attributes": True}


class DepartmentCreate(BaseModel):
    code: str
    name: str


class DoctorOut(BaseModel):
    id: str
    code: str
    name: str
    department_id: str | None = None
    phone: str | None = None
    is_active: bool

    model_config = {"from_attributes": True}


class DoctorCreate(BaseModel):
    code: str
    name: str
    department_id: str | None = None
    phone: str | None = None


class PatientOut(BaseModel):
    id: str
    party_id: str
    patient_no: str
    first_name: str
    middle_name: str | None = None
    last_name: str | None = None
    full_name: str = ""
    gender: str
    age: str | None = None
    mobile: str | None = None
    phone: str | None = None
    scheme: str | None = None
    city: str | None = None
    is_active: bool

    model_config = {"from_attributes": True}


class PatientCreate(BaseModel):
    patient_no: str | None = None
    first_name: str = Field(min_length=1)
    middle_name: str | None = None
    last_name: str | None = None
    gender: str = "Other"
    age: str | None = None
    date_of_birth: date | None = None
    mobile: str | None = None
    phone: str | None = None
    scheme: str | None = None
    address_line1: str | None = None
    city: str | None = None
    aadhar_no: str | None = None


class OpdBillLineIn(BaseModel):
    service_code: str
    service_name: str
    rate: float
    quantity: int = 1


class OpdBillCreate(BaseModel):
    bill_date: date
    patient_id: str
    doctor_id: str | None = None
    department_id: str | None = None
    payment_mode_id: str | None = None
    remarks: str | None = None
    lines: list[OpdBillLineIn] = Field(min_length=1)


class OpdBillLineOut(BaseModel):
    id: str
    service_code: str
    service_name: str
    rate: float
    quantity: int
    amount: float

    model_config = {"from_attributes": True}


class OpdBillOut(BaseModel):
    id: str
    bill_no: str
    bill_date: date
    patient_id: str
    patient_no: str
    doctor_id: str | None = None
    department_id: str | None = None
    gross_amount: float
    net_amount: float
    status: str
    lines: list[OpdBillLineOut] = []

    model_config = {"from_attributes": True}
