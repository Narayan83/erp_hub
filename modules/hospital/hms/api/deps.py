from collections.abc import AsyncGenerator

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.api.deps import get_current_user, get_session
from erp_core.database import get_db
from erp_core.models.auth import User
from modules.hospital.hms.services.doctor import DoctorService
from modules.hospital.hms.services.patient import PatientService
from modules.hospital.hms.services.reports import ReportService

__all__ = [
    "get_db",
    "get_session",
    "get_current_user",
    "User",
    "get_patient_service",
    "get_doctor_service",
    "get_report_service",
    "Depends",
    "AsyncGenerator",
    "AsyncSession",
]


def get_patient_service(session: AsyncSession) -> PatientService:
    return PatientService(session)


def get_doctor_service(session: AsyncSession) -> DoctorService:
    return DoctorService(session)


def get_report_service() -> ReportService:
    return ReportService()
