from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.masters import Category
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.masters import CategoryIn, CategoryOut, CategoryUpdate

router = APIRouter()


# ---------------- Categories ----------------
@router.get("", response_model=list[CategoryOut])
async def list_categories(_u=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(Category).where(Category.is_active.is_(True)).order_by(Category.name)
    )
    return list(result.scalars().all())


@router.post("", response_model=CategoryOut)
async def create_category(
    data: CategoryIn, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = Category(**data.model_dump())
    session.add(obj)
    await session.flush()
    return obj


@router.patch("/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: str,
    data: CategoryUpdate,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (await session.execute(select(Category).where(Category.id == category_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    await session.flush()
    return obj


@router.delete("/{category_id}", response_model=MessageResponse)
async def delete_category(
    category_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = (await session.execute(select(Category).where(Category.id == category_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    obj.is_active = False
    await session.flush()
    return MessageResponse(message="Category deactivated")
