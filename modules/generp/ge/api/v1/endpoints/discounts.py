from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import User
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.stock import DiscountApplyIn, DiscountApplyOut, DiscountSchemeIn, DiscountSchemeOut
from modules.generp.ge.services.discounts import (
    apply_discount,
    create_scheme,
    delete_scheme,
    get_scheme,
    list_schemes,
    update_scheme,
)

router = APIRouter()


@router.get("/discount-schemes", response_model=list[DiscountSchemeOut])
async def list_all(
    active_only: bool = False,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await list_schemes(session, active_only=active_only)


@router.post("/discount-schemes/apply", response_model=DiscountApplyOut)
async def apply(
    data: DiscountApplyIn,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await apply_discount(session, data)


@router.get("/discount-schemes/{scheme_id}", response_model=DiscountSchemeOut)
async def get_one(
    scheme_id: str,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await get_scheme(session, scheme_id)


@router.post("/discount-schemes", response_model=DiscountSchemeOut)
async def create(
    data: DiscountSchemeIn,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await create_scheme(session, data)


@router.put("/discount-schemes/{scheme_id}", response_model=DiscountSchemeOut)
async def update(
    scheme_id: str,
    data: DiscountSchemeIn,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await update_scheme(session, scheme_id, data)


@router.delete("/discount-schemes/{scheme_id}", response_model=MessageResponse)
async def delete(
    scheme_id: str,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await delete_scheme(session, scheme_id)
    return MessageResponse(message="Discount scheme deactivated")
