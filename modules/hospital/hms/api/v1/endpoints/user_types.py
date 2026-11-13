from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.api.deps import get_current_user, get_session
from modules.hospital.hms.models.user import User
from modules.hospital.hms.schemas.user_type import UserTypeCreate, UserTypeRead, UserTypeUpdate
from modules.hospital.hms.services.user_type import UserTypeService

router = APIRouter()


@router.get("", response_model=list[UserTypeRead])
async def list_user_types(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await UserTypeService(session).list_user_types()


@router.post("", response_model=UserTypeRead, status_code=201)
async def create_user_type(
    data: UserTypeCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await UserTypeService(session).create_user_type(data)


@router.patch("/{user_type_id}", response_model=UserTypeRead)
async def update_user_type(
    user_type_id: str,
    data: UserTypeUpdate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await UserTypeService(session).update_user_type(user_type_id, data)
