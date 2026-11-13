from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.api.deps import get_current_user, get_session
from modules.hospital.hms.models.user import User
from modules.hospital.hms.schemas.ward import WardCreate, WardRead, WardUpdate
from modules.hospital.hms.services.ward import WardService

router = APIRouter()


@router.get("", response_model=list[WardRead])
async def list_wards(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await WardService(session).list_wards()


@router.get("/{ward_id}", response_model=WardRead)
async def get_ward(
    ward_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await WardService(session).get_ward(ward_id)


@router.post("", response_model=WardRead, status_code=201)
async def create_ward(
    data: WardCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await WardService(session).create_ward(data)


@router.patch("/{ward_id}", response_model=WardRead)
async def update_ward(
    ward_id: str,
    data: WardUpdate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await WardService(session).update_ward(ward_id, data)


@router.delete("/{ward_id}", response_model=WardRead)
async def delete_ward(
    ward_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await WardService(session).delete_ward(ward_id)
