from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.api.deps import get_current_user, get_session
from modules.hospital.hms.models.user import User
from modules.hospital.hms.schemas.dashboard import DashboardStats
from modules.hospital.hms.services.dashboard import DashboardService

router = APIRouter()


@router.get("/stats", response_model=DashboardStats)
async def dashboard_stats(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await DashboardService(session).get_stats()
