from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.config import get_settings
from modules.generp.ge.core.security import create_access_token, verify_password
from modules.generp.ge.models.auth import User, UserRoleMapping
from modules.generp.ge.schemas.auth import LoginRequest, LoginResponse, UserInfo
from modules.generp.ge.services.app_data import AppDataService
from modules.generp.ge.services.menu import MenuService


class AuthService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def _load_user_by_ident(self, ident: str) -> User | None:
        result = await self.session.execute(
            select(User)
            .options(
                selectinload(User.role_mappings).selectinload(UserRoleMapping.role),
                selectinload(User.user_type),
            )
            .where(
                or_(
                    func.lower(User.username) == ident,
                    func.lower(User.email) == ident,
                )
            )
        )
        return result.scalars().first()

    async def issue_session(self, user: User) -> LoginResponse:
        roles = [m.role.role_name for m in user.role_mappings if m.role and m.role.is_active]
        token = create_access_token(user.id)
        menu_tree = await MenuService(self.session).get_user_menu_tree(user.id)
        app_data = await AppDataService(self.session).get_app_data(include_catalog=False)
        settings = get_settings()
        return LoginResponse(
            access_token=token,
            user=UserInfo(
                id=user.id,
                username=user.username,
                email=user.email,
                full_name=user.full_name,
                phone=user.phone,
                roles=roles,
                user_type_sort_order=user.user_type.sort_order if user.user_type else None,
            ),
            menus=menu_tree,
            app_data=app_data,
            idle_timeout_minutes=max(1, int(settings.idle_timeout_minutes or 5)),
        )

    async def login(self, data: LoginRequest) -> LoginResponse:
        ident = (data.email or "").strip().lower()
        if not ident:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user ID or password"
            )
        user = await self._load_user_by_ident(ident)
        if not user or not verify_password(data.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user ID or password"
            )
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="User account is inactive"
            )
        return await self.issue_session(user)
