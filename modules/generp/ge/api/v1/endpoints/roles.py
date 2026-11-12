from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import Role
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.user_mgmt import RoleIn, RoleOut

router = APIRouter()


@router.get("", response_model=list[RoleOut])
async def list_roles(_u=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Role).order_by(Role.role_name))
    return list(result.scalars().all())


@router.post("", response_model=RoleOut)
async def create_role(
    data: RoleIn, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = Role(**data.model_dump())
    session.add(obj)
    await session.flush()
    return obj


@router.patch("/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: str,
    data: RoleIn,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (await session.execute(select(Role).where(Role.id == role_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    await session.flush()
    return obj


@router.delete("/{role_id}", response_model=MessageResponse)
async def delete_role(
    role_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = (await session.execute(select(Role).where(Role.id == role_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    obj.is_active = False
    await session.flush()
    return MessageResponse(message="Role deactivated")
