from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.api.deps import get_current_user, get_session
from erp_core.models.auth import User
from erp_core.models.masters import CompanyProfile
from erp_core.schemas.masters import CompanyProfileOut, CompanyProfileUpdate

router = APIRouter()


@router.get("", response_model=CompanyProfileOut)
async def get_company(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = (
        await session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Company profile not found")
    return row


@router.put("", response_model=CompanyProfileOut)
async def update_company(
    data: CompanyProfileUpdate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = (
        await session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Company profile not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    await session.flush()
    return row
