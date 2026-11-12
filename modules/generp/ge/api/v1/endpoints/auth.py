from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import User
from modules.generp.ge.schemas.auth import LoginRequest, LoginResponse, TokenRefreshResponse, UserInfo
from modules.generp.ge.services.app_data import AppDataService
from modules.generp.ge.services.auth import AuthService
from modules.generp.ge.services.menu import MenuService
from modules.generp.ge.config import get_settings
from modules.generp.ge.core.security import create_access_token

router = APIRouter()


@router.post("/login", response_model=LoginResponse)
async def login(data: LoginRequest, session: AsyncSession = Depends(get_session)):
    return await AuthService(session).login(data)


@router.post("/refresh", response_model=TokenRefreshResponse)
async def refresh(user: User = Depends(get_current_user)):
    """Issue a new token while the user is actively using the app."""
    settings = get_settings()
    return TokenRefreshResponse(
        access_token=create_access_token(user.id),
        idle_timeout_minutes=max(1, int(settings.idle_timeout_minutes or 5)),
    )


@router.get("/me", response_model=UserInfo)
async def me(user: User = Depends(get_current_user)):
    roles = [m.role.role_name for m in user.role_mappings if m.role and m.role.is_active]
    return UserInfo(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        phone=user.phone,
        roles=roles,
        user_type_sort_order=user.user_type.sort_order if user.user_type else None,
    )


@router.get("/my-menus")
async def my_menus(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    return await MenuService(session).get_user_menu_tree(user.id)


@router.get("/app-data")
async def app_data(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    return await AppDataService(session).get_app_data()
