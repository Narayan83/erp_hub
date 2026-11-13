from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.masters import SubCategory
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.masters import SubCategoryIn, SubCategoryOut, SubCategoryUpdate

router = APIRouter()


def _to_out(obj: SubCategory) -> SubCategoryOut:
    return SubCategoryOut(
        id=obj.id,
        category_id=obj.category_id,
        code=obj.code,
        name=obj.name,
        sort_order=obj.sort_order,
        is_active=obj.is_active,
        category_name=obj.category.name if obj.category else None,
    )


@router.get("", response_model=list[SubCategoryOut])
async def list_sub_categories(
    category_id: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    q = select(SubCategory).options(selectinload(SubCategory.category)).where(
        SubCategory.is_active.is_(True)
    )
    if category_id:
        q = q.where(SubCategory.category_id == category_id)
    result = await session.execute(q.order_by(SubCategory.name))
    return [_to_out(o) for o in result.scalars().all()]


@router.post("", response_model=SubCategoryOut)
async def create_sub_category(
    data: SubCategoryIn, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = SubCategory(**data.model_dump())
    session.add(obj)
    await session.flush()
    obj = (
        await session.execute(
            select(SubCategory).options(selectinload(SubCategory.category)).where(SubCategory.id == obj.id)
        )
    ).scalar_one()
    return _to_out(obj)


@router.patch("/{sub_id}", response_model=SubCategoryOut)
async def update_sub_category(
    sub_id: str,
    data: SubCategoryUpdate,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (
        await session.execute(
            select(SubCategory).options(selectinload(SubCategory.category)).where(SubCategory.id == sub_id)
        )
    ).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    await session.flush()
    return _to_out(obj)


@router.delete("/{sub_id}", response_model=MessageResponse)
async def delete_sub_category(
    sub_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = (await session.execute(select(SubCategory).where(SubCategory.id == sub_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    obj.is_active = False
    await session.flush()
    return MessageResponse(message="Sub category deactivated")
