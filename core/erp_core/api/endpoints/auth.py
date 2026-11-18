from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.api.deps import get_current_user, get_session
from erp_core.models.auth import User
from erp_core.product_config import get_product_name, load_product_config, present_user_full_name
from erp_core.schemas.auth import LoginRequest, LoginResponse, TokenRefreshResponse, UserInfo
from erp_core.security import create_access_token
from erp_core.services.auth import AuthService
from erp_core.services.menu import MenuService

router = APIRouter()

_secret_key = "change-me"
_idle = 5


def configure_auth_routes(*, secret_key: str, idle_minutes: int = 5) -> None:
    global _secret_key, _idle
    _secret_key = secret_key
    _idle = idle_minutes


@router.post("/login", response_model=LoginResponse)
async def login(data: LoginRequest, session: AsyncSession = Depends(get_session)):
    return await AuthService(session, secret_key=_secret_key, idle_minutes=_idle).login(data)


@router.post("/refresh", response_model=TokenRefreshResponse)
async def refresh(user: User = Depends(get_current_user)):
    return TokenRefreshResponse(
        access_token=create_access_token(user.id, secret_key=_secret_key),
        idle_timeout_minutes=_idle,
    )


@router.get("/me", response_model=UserInfo)
async def me(user: User = Depends(get_current_user)):
    roles = [m.role.role_name for m in user.role_mappings if m.role and m.role.is_active]
    return UserInfo(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=present_user_full_name(user.full_name),
        phone=user.phone,
        roles=roles,
    )


@router.get("/my-menus")
async def my_menus(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    return await MenuService(session).get_user_menu_tree(user.id)


@router.get("/product")
async def product_info():
    cfg = load_product_config()
    product = get_product_name()
    admin = cfg.get("default_admin") or {}
    default_email = str(admin.get("email") or f"admin@{product}.example.com").lower()
    default_username = str(admin.get("username") or product).strip().lower() or product
    return {
        "product": product,
        "display_name": cfg.get("display_name"),
        "modules": cfg.get("modules"),
        "labels": cfg.get("labels"),
        "default_admin_email": default_email,
        "default_admin_username": default_username,
    }
