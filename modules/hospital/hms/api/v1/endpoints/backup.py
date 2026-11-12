from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.api.deps import get_session
from modules.hospital.hms.api.v1.endpoints.admin import require_admin
from modules.hospital.hms.models.user import User
from modules.hospital.hms.schemas.backup import BackupSettingsRead, BackupSettingsUpdate
from modules.hospital.hms.services.db_backup import DatabaseBackupService

router = APIRouter()


@router.get("", response_model=BackupSettingsRead)
async def get_backup_settings(
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    return await DatabaseBackupService(session).get_settings()


@router.put("", response_model=BackupSettingsRead)
async def update_backup_settings(
    data: BackupSettingsUpdate,
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        return await DatabaseBackupService(session).update_settings(data)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not use that backup folder: {exc}",
        ) from exc


@router.post("/run", response_model=BackupSettingsRead)
async def run_backup_now(
    _: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        return await DatabaseBackupService(session).run_now()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
