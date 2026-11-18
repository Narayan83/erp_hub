from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.api.deps import get_current_user, get_session
from erp_core.models.auth import UserType
from erp_core.schemas.user_mgmt import UserTypeIn, UserTypeOut

router = APIRouter()


@router.get("", response_model=list[UserTypeOut])
async def list_user_types(_u=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(UserType).order_by(UserType.sort_order, UserType.name))
    return list(result.scalars().all())


@router.post("", response_model=UserTypeOut)
async def create_user_type(
    data: UserTypeIn, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    code = data.code.strip().lower()
    if not code or not data.name.strip():
        raise HTTPException(status_code=400, detail="Code and name are required")
    taken = (
        await session.execute(select(UserType).where(UserType.code == code))
    ).scalar_one_or_none()
    if taken:
        raise HTTPException(status_code=400, detail="User type code already exists")
    obj = UserType(code=code, name=data.name.strip(), sort_order=data.sort_order, is_active=data.is_active)
    session.add(obj)
    await session.flush()
    return obj


@router.patch("/{type_id}", response_model=UserTypeOut)
async def update_user_type(
    type_id: str,
    data: UserTypeIn,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (await session.execute(select(UserType).where(UserType.id == type_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    code = data.code.strip().lower()
    if not code or not data.name.strip():
        raise HTTPException(status_code=400, detail="Code and name are required")
    taken = (
        await session.execute(select(UserType).where(UserType.code == code, UserType.id != type_id))
    ).scalar_one_or_none()
    if taken:
        raise HTTPException(status_code=400, detail="User type code already exists")
    obj.code = code
    obj.name = data.name.strip()
    obj.sort_order = data.sort_order
    obj.is_active = data.is_active
    await session.flush()
    return obj
