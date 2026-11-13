from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.masters import GstRate
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.masters import GstIn, GstOut, GstUpdate

router = APIRouter()


def _validate_rate(rate: float) -> float:
    value = float(rate or 0)
    if value < 0 or value > 100:
        raise HTTPException(status_code=400, detail="GST rate must be between 0 and 100")
    return value


def _split_from_rate(rate: float) -> tuple[float, float, float]:
    return rate / 2, rate / 2, rate


@router.get("", response_model=list[GstOut])
async def list_gst(
    include_inactive: bool = Query(False),
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(GstRate)
    if not include_inactive:
        stmt = stmt.where(GstRate.is_active.is_(True))
    result = await session.execute(stmt.order_by(GstRate.sort_order, GstRate.code))
    return list(result.scalars().all())


@router.post("", response_model=GstOut)
async def create_gst(
    data: GstIn, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    payload = data.model_dump()
    payload["code"] = (payload.get("code") or "").strip().upper()
    payload["name"] = (payload.get("name") or "").strip()
    if not payload["code"]:
        raise HTTPException(status_code=400, detail="GST code is required")
    if not payload["name"]:
        raise HTTPException(status_code=400, detail="GST name is required")
    payload["rate"] = _validate_rate(payload.get("rate") or 0)
    existing = (
        await session.execute(select(GstRate).where(GstRate.code == payload["code"]))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"GST code '{payload['code']}' already exists")
    if not payload.get("cgst") and not payload.get("sgst") and payload["rate"]:
        payload["cgst"], payload["sgst"], payload["igst"] = _split_from_rate(payload["rate"])
    obj = GstRate(**payload)
    session.add(obj)
    await session.flush()
    return obj


@router.patch("/{gst_id}", response_model=GstOut)
async def update_gst(
    gst_id: str,
    data: GstUpdate,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (await session.execute(select(GstRate).where(GstRate.id == gst_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    updates = data.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"] is not None:
        updates["name"] = str(updates["name"]).strip()
        if not updates["name"]:
            raise HTTPException(status_code=400, detail="GST name is required")
    if "rate" in updates and updates["rate"] is not None:
        updates["rate"] = _validate_rate(updates["rate"])
        if "cgst" not in updates and "sgst" not in updates:
            updates["cgst"], updates["sgst"], igst = _split_from_rate(updates["rate"])
            if "igst" not in updates:
                updates["igst"] = igst
    for k, v in updates.items():
        setattr(obj, k, v)
    await session.flush()
    return obj


@router.delete("/{gst_id}", response_model=MessageResponse)
async def delete_gst(
    gst_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = (await session.execute(select(GstRate).where(GstRate.id == gst_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    obj.is_active = False
    await session.flush()
    return MessageResponse(message="GST deactivated")
