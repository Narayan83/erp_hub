from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.api.deps import get_current_user, get_session
from erp_core.models.auth import User
from erp_core.models.masters import Party
from erp_core.schemas.masters import PartyCreate, PartyOut, PartyUpdate

router = APIRouter()


@router.get("", response_model=list[PartyOut])
async def list_parties(
    q: str | None = None,
    party_type: str | None = None,
    limit: int = Query(50, le=200),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Party).where(Party.is_active.is_(True))
    if party_type:
        stmt = stmt.where(Party.party_type == party_type)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(Party.name.ilike(like), Party.code.ilike(like), Party.mobile.ilike(like))
        )
    rows = (await session.execute(stmt.order_by(Party.code).limit(limit))).scalars().all()
    return rows


@router.post("", response_model=PartyOut)
async def create_party(
    data: PartyCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    code = data.code
    if not code:
        count = (
            await session.execute(
                select(func.count()).select_from(Party).where(Party.party_type == data.party_type)
            )
        ).scalar_one()
        code = str(int(count) + 1)
    row = Party(**{**data.model_dump(exclude={"code"}), "code": code})
    session.add(row)
    await session.flush()
    return row


@router.get("/{party_id}", response_model=PartyOut)
async def get_party(
    party_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = (await session.execute(select(Party).where(Party.id == party_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Party not found")
    return row


@router.patch("/{party_id}", response_model=PartyOut)
async def update_party(
    party_id: str,
    data: PartyUpdate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = (await session.execute(select(Party).where(Party.id == party_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Party not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    await session.flush()
    return row
