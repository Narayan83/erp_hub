from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.masters import PaymentMode
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.masters import PaymentModeIn, PaymentModeOut, PaymentModeUpdate

router = APIRouter()


@router.get("", response_model=list[PaymentModeOut])
async def list_modes(_u=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(PaymentMode).where(PaymentMode.is_active.is_(True)).order_by(PaymentMode.sort_order)
    )
    return list(result.scalars().all())


@router.post("", response_model=PaymentModeOut)
async def create_mode(
    data: PaymentModeIn, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = PaymentMode(**data.model_dump())
    session.add(obj)
    await session.flush()
    return obj


@router.patch("/{mode_id}", response_model=PaymentModeOut)
async def update_mode(
    mode_id: str,
    data: PaymentModeUpdate,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (await session.execute(select(PaymentMode).where(PaymentMode.id == mode_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    await session.flush()
    return obj


@router.delete("/{mode_id}", response_model=MessageResponse)
async def delete_mode(
    mode_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = (await session.execute(select(PaymentMode).where(PaymentMode.id == mode_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    obj.is_active = False
    await session.flush()
    return MessageResponse(message="Payment mode deactivated")
