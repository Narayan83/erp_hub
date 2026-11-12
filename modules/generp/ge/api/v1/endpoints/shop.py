"""Shopping Cart storefront banners."""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.config import get_settings
from modules.generp.ge.models.masters import ShopBanner
from modules.generp.ge.schemas.common import MessageResponse, ORMModel

router = APIRouter()

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_IMAGE_BYTES = 8 * 1024 * 1024


class ShopBannerOut(ORMModel):
    id: str
    title: str
    file_path: str
    image_url: str
    sort_order: int
    is_active: bool


class ShopBannerUpdate(BaseModel):
    title: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


def _banners_dir() -> Path:
    path = get_settings().shop_banners_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def _image_url(file_path: str | None) -> str:
    if not file_path:
        return ""
    return f"/media/shop-banners/{Path(file_path).name}"


def _to_out(row: ShopBanner) -> ShopBannerOut:
    return ShopBannerOut(
        id=row.id,
        title=row.title or "Shop",
        file_path=row.file_path,
        image_url=_image_url(row.file_path),
        sort_order=int(row.sort_order or 0),
        is_active=bool(row.is_active),
    )


@router.get("", response_model=list[ShopBannerOut])
async def list_banners(
    active_only: bool = False,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(ShopBanner).order_by(ShopBanner.sort_order, ShopBanner.created_at)
    if active_only:
        stmt = stmt.where(ShopBanner.is_active.is_(True))
    rows = (await session.execute(stmt)).scalars().all()
    return [_to_out(r) for r in rows]


@router.post("", response_model=ShopBannerOut)
async def upload_banner(
    file: UploadFile = File(...),
    title: str = Form("Shop"),
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    content_type = (file.content_type or "").lower()
    ext = ALLOWED_IMAGE_TYPES.get(content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="Image must be JPEG, PNG, or WebP")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 8 MB)")

    banner_id = str(uuid.uuid4())
    filename = f"{banner_id}{ext}"
    dest = _banners_dir() / filename
    dest.write_bytes(data)

    count = (
        await session.execute(select(ShopBanner).where(ShopBanner.is_active.is_(True)))
    ).scalars().all()
    row = ShopBanner(
        id=banner_id,
        title=(title or "Shop").strip() or "Shop",
        file_path=filename,
        sort_order=len(count),
        is_active=True,
    )
    session.add(row)
    await session.flush()
    return _to_out(row)


@router.patch("/{banner_id}", response_model=ShopBannerOut)
async def update_banner(
    banner_id: str,
    data: ShopBannerUpdate,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = (
        await session.execute(select(ShopBanner).where(ShopBanner.id == banner_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Banner not found")
    if data.title is not None:
        row.title = data.title.strip() or row.title
    if data.sort_order is not None:
        row.sort_order = data.sort_order
    if data.is_active is not None:
        row.is_active = data.is_active
    await session.flush()
    return _to_out(row)


@router.delete("/{banner_id}", response_model=MessageResponse)
async def delete_banner(
    banner_id: str,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = (
        await session.execute(select(ShopBanner).where(ShopBanner.id == banner_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Banner not found")
    full = _banners_dir() / Path(row.file_path).name
    if full.is_file():
        full.unlink(missing_ok=True)
    await session.delete(row)
    await session.flush()
    return MessageResponse(message="Banner deleted")
