import hashlib
import hmac
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session, user_is_super_admin
from modules.generp.ge.config import get_settings
from modules.generp.ge.models.auth import User
from modules.generp.ge.models.masters import CompanyProfile, SaleEntryConfig
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.masters import CompanyProfileOut, CompanyProfileUpdate, CompanyResetIn
from modules.generp.ge.services.company_reset import reset_company_data
from modules.generp.ge.services.menu import PACKAGE_LOCKED_CODES, MenuService
from modules.generp.ge.services.sale_pricing import SALE_RATE_FIFO
from modules.generp.ge.services.stock_lots import seed_missing_opening_lots

router = APIRouter()

ALLOWED_LOGO_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_LOGO_BYTES = 5 * 1024 * 1024


def _logo_dir() -> Path:
    path = get_settings().company_logo_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def _delete_logo_file(logo_path: str | None) -> None:
    if not logo_path:
        return
    full = _logo_dir() / Path(logo_path).name
    if full.exists():
        full.unlink()


async def _get_or_create(session: AsyncSession) -> CompanyProfile:
    obj = (
        await session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
    ).scalar_one_or_none()
    if not obj:
        obj = CompanyProfile(code="MAIN", name="GenERP Company")
        session.add(obj)
        await session.flush()
    return obj


@router.get("", response_model=CompanyProfileOut)
async def get_profile(_u=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await _get_or_create(session)


@router.put("", response_model=CompanyProfileOut)
async def update_profile(
    data: CompanyProfileUpdate,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = await _get_or_create(session)
    updates = data.model_dump(exclude_unset=True)
    prev_source = (getattr(obj, "sale_rate_source", None) or "product_master").strip().lower()
    for k, v in updates.items():
        setattr(obj, k, v)
    await session.flush()
    if "allow_negative_stock" in updates:
        cfg = (
            await session.execute(select(SaleEntryConfig).where(SaleEntryConfig.code == "MAIN"))
        ).scalar_one_or_none()
        if cfg is None:
            cfg = SaleEntryConfig(code="MAIN")
            session.add(cfg)
        cfg.allow_negative_stock = bool(obj.allow_negative_stock)
        await session.flush()
    new_source = (getattr(obj, "sale_rate_source", None) or "product_master").strip().lower()
    if new_source == SALE_RATE_FIFO and prev_source != SALE_RATE_FIFO:
        await seed_missing_opening_lots(session)
    return obj


@router.post("/logo", response_model=CompanyProfileOut)
async def upload_logo(
    file: UploadFile = File(...),
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = await _get_or_create(session)
    content_type = (file.content_type or "").lower()
    ext = ALLOWED_LOGO_TYPES.get(content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="Image must be JPEG, PNG, or WebP")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 5 MB)")
    _delete_logo_file(obj.logo_path)
    filename = f"logo_{uuid.uuid4().hex[:12]}{ext}"
    dest = _logo_dir() / filename
    dest.write_bytes(data)
    obj.logo_path = filename
    await session.flush()
    return obj


@router.delete("/logo", response_model=CompanyProfileOut)
async def delete_logo(_u=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    obj = await _get_or_create(session)
    _delete_logo_file(obj.logo_path)
    obj.logo_path = None
    await session.flush()
    return obj


def _reset_password_ok(given: str, expected: str) -> bool:
    left = hashlib.sha256((given or "").encode("utf-8")).digest()
    right = hashlib.sha256((expected or "").encode("utf-8")).digest()
    return hmac.compare_digest(left, right)


@router.post("/reset-company", response_model=MessageResponse)
async def reset_company(
    data: CompanyResetIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if not user_is_super_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    expected = get_settings().company_reset_password or ""
    if not _reset_password_ok(data.password.strip(), expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    await reset_company_data(session)
    return MessageResponse(message="Company data cleared. Users, ledgers and payment modes were kept.")


class PackageMenuRow(BaseModel):
    id: str
    code: str
    label: str
    parent_id: str | None = None
    sort_order: int = 0
    enabled: bool = True


class PackageMenusOut(BaseModel):
    configured: bool
    menus: list[PackageMenuRow]


class PackageMenusIn(BaseModel):
    menu_ids: list[str] = Field(default_factory=list)


@router.get("/package-menus", response_model=PackageMenusOut)
async def get_package_menus(
    _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    service = MenuService(session)
    codes = await service.package_codes()
    menus = await service.list_all_active()
    rows = [
        PackageMenuRow(
            id=menu.id,
            code=menu.code,
            label=menu.label,
            parent_id=menu.parent_id,
            sort_order=menu.sort_order,
            enabled=True if codes is None else menu.code in codes,
        )
        for menu in menus
    ]
    rows.sort(key=lambda row: row.sort_order)
    return PackageMenusOut(configured=codes is not None, menus=rows)


@router.put("/package-menus", response_model=PackageMenusOut)
async def save_package_menus(
    data: PackageMenusIn,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    service = MenuService(session)
    menus = await service.list_all_active()
    by_id = {menu.id: menu for menu in menus}
    chosen = {by_id[menu_id].code for menu_id in data.menu_ids if menu_id in by_id}
    chosen.update(PACKAGE_LOCKED_CODES)
    profile = await _get_or_create(session)
    profile.package_menu_codes = sorted(chosen)
    await session.flush()
    return await get_package_menus(_u, session)
