from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import UserType
from modules.generp.ge.schemas.user_mgmt import UserTypeIn, UserTypeOut

router = APIRouter()


@router.get("", response_model=list[UserTypeOut])
async def list_user_types(_u=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(UserType).order_by(UserType.sort_order))
    return list(result.scalars().all())


@router.post("", response_model=UserTypeOut)
async def create_user_type(
    data: UserTypeIn, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = UserType(**data.model_dump())
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
    for k, v in data.model_dump().items():
        setattr(obj, k, v)
    await session.flush()
    return obj
