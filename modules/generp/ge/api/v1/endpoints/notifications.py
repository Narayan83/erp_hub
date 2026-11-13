from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import NotificationSetup, User
from modules.generp.ge.schemas.user_mgmt import NotificationSetupBulk
from modules.generp.ge.services.notification import NotificationService

router = APIRouter()


@router.get("")
async def list_setups(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(NotificationSetup).where(NotificationSetup.user_id == user.id)
    )
    return [
        {"id": r.id, "event_code": r.event_code, "is_enabled": r.is_enabled}
        for r in result.scalars().all()
    ]


@router.get("/setup")
async def get_notification_setup(
    event_code: str = Query(...),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await NotificationService(session).get_setup(event_code)


@router.put("/setup")
async def save_notification_setup(
    data: NotificationSetupBulk,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    recipients = [item.model_dump() for item in data.recipients]
    return await NotificationService(session).save_setup(data.event_code, recipients)
