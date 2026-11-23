from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.api.deps import get_current_user, get_session
from modules.hospital.hms.models.user import User
from modules.hospital.hms.schemas.service_group import (
    ServiceGroupCreate,
    ServiceGroupRead,
    ServiceGroupUpdate,
)
from modules.hospital.hms.services.service_group import ServiceGroupService

router = APIRouter()


@router.get("", response_model=list[ServiceGroupRead])
async def list_service_groups(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await ServiceGroupService(session).list_groups()


@router.get("/{group_id}", response_model=ServiceGroupRead)
async def get_service_group(
    group_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await ServiceGroupService(session).get_group(group_id)


@router.post("", response_model=ServiceGroupRead, status_code=201)
async def create_service_group(
    data: ServiceGroupCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await ServiceGroupService(session).create_group(data)


@router.patch("/{group_id}", response_model=ServiceGroupRead)
async def update_service_group(
    group_id: str,
    data: ServiceGroupUpdate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await ServiceGroupService(session).update_group(group_id, data)


@router.delete("/{group_id}", response_model=ServiceGroupRead)
async def delete_service_group(
    group_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await ServiceGroupService(session).delete_group(group_id)
