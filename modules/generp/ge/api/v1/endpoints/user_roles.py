from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import UserRoleMapping
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.user_mgmt import UserRoleMappingIn, UserRoleMappingOut

router = APIRouter()


def _mapping_query():
    return select(UserRoleMapping).options(selectinload(UserRoleMapping.role))


def _to_out(mapping: UserRoleMapping) -> UserRoleMappingOut:
    return UserRoleMappingOut(
        id=mapping.id,
        user_id=mapping.user_id,
        role_id=mapping.role_id,
        role_name=mapping.role.role_name if mapping.role else None,
        priority=mapping.priority,
    )


@router.get("", response_model=list[UserRoleMappingOut])
async def list_mappings(
    user_id: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    q = _mapping_query()
    if user_id:
        q = q.where(UserRoleMapping.user_id == user_id)
    result = await session.execute(q)
    return [_to_out(m) for m in result.scalars().all()]


@router.post("", response_model=UserRoleMappingOut)
async def create_mapping(
    data: UserRoleMappingIn,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    exists = (
        await session.execute(
            select(UserRoleMapping).where(
                UserRoleMapping.user_id == data.user_id,
                UserRoleMapping.role_id == data.role_id,
            )
        )
    ).scalar_one_or_none()
    if exists:
        result = await session.execute(_mapping_query().where(UserRoleMapping.id == exists.id))
        return _to_out(result.scalar_one())
    obj = UserRoleMapping(**data.model_dump())
    session.add(obj)
    await session.flush()
    result = await session.execute(_mapping_query().where(UserRoleMapping.id == obj.id))
    return _to_out(result.scalar_one())


@router.delete("/{mapping_id}", response_model=MessageResponse)
async def delete_mapping(
    mapping_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = (
        await session.execute(select(UserRoleMapping).where(UserRoleMapping.id == mapping_id))
    ).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    await session.delete(obj)
    await session.flush()
    return MessageResponse(message="Mapping removed")
