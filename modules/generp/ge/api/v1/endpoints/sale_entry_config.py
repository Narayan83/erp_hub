from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.masters import SaleEntryConfig
from modules.generp.ge.schemas.masters import SaleEntryConfigOut, SaleEntryConfigUpdate

router = APIRouter()


async def _get_or_create(session: AsyncSession) -> SaleEntryConfig:
    cfg = (
        await session.execute(select(SaleEntryConfig).where(SaleEntryConfig.code == "MAIN"))
    ).scalar_one_or_none()
    if cfg is None:
        cfg = SaleEntryConfig(code="MAIN")
        session.add(cfg)
        await session.flush()
    return cfg


@router.get("", response_model=SaleEntryConfigOut)
async def get_config(
    _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    return await _get_or_create(session)


@router.put("", response_model=SaleEntryConfigOut)
async def update_config(
    data: SaleEntryConfigUpdate,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    cfg = await _get_or_create(session)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(cfg, k, v)
    await session.flush()
    return cfg
