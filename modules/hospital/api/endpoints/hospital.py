from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.api.deps import get_current_user, get_session
from erp_core.models.auth import User
from modules.hospital.models.clinical import Department, Doctor
from modules.hospital.schemas.clinical import (
    DepartmentCreate,
    DepartmentOut,
    DoctorCreate,
    DoctorOut,
    OpdBillCreate,
    OpdBillOut,
    PatientCreate,
    PatientOut,
)
from modules.hospital.services.opd import OpdBillService
from modules.hospital.services.patients import PatientService

router = APIRouter()


@router.get("/patients", response_model=list[PatientOut])
async def list_patients(
    q: str | None = None,
    limit: int = Query(50, le=200),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await PatientService(session).list(q=q, limit=limit)


@router.post("/patients", response_model=PatientOut)
async def create_patient(
    data: PatientCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await PatientService(session).create(data)


@router.get("/departments", response_model=list[DepartmentOut])
async def list_departments(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return (
        await session.execute(
            select(Department).where(Department.is_active.is_(True)).order_by(Department.code)
        )
    ).scalars().all()


@router.post("/departments", response_model=DepartmentOut)
async def create_department(
    data: DepartmentCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = Department(**data.model_dump())
    session.add(row)
    await session.flush()
    return row


@router.get("/doctors", response_model=list[DoctorOut])
async def list_doctors(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return (
        await session.execute(select(Doctor).where(Doctor.is_active.is_(True)).order_by(Doctor.code))
    ).scalars().all()


@router.post("/doctors", response_model=DoctorOut)
async def create_doctor(
    data: DoctorCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = Doctor(**data.model_dump())
    session.add(row)
    await session.flush()
    return row


@router.get("/opd-bills", response_model=list[OpdBillOut])
async def list_opd_bills(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = await OpdBillService(session).list()
    return [OpdBillOut.model_validate(r) for r in rows]


@router.post("/opd-bills", response_model=OpdBillOut)
async def create_opd_bill(
    data: OpdBillCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await OpdBillService(session).create(data)
