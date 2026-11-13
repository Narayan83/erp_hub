from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from erp_core.models.auth import User, UserRoleMapping
from erp_core.product_config import get_product_name, label, load_product_config
from erp_core.schemas.auth import LoginRequest, LoginResponse, MenuNode, UserInfo
from erp_core.security import create_access_token, verify_password
from erp_core.services.menu import MenuService


class AuthService:
    def __init__(self, session: AsyncSession, *, secret_key: str, idle_minutes: int = 5):
        self.session = session
        self.secret_key = secret_key
        self.idle_minutes = idle_minutes

    async def login(self, data: LoginRequest) -> LoginResponse:
        result = await self.session.execute(
            select(User)
            .options(
                selectinload(User.role_mappings).selectinload(UserRoleMapping.role),
                selectinload(User.user_type),
            )
            .where(User.email == data.email.lower().strip())
        )
        user = result.scalar_one_or_none()
        if not user or not user.is_active or not verify_password(data.password, user.hashed_password):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        roles = [m.role.role_name for m in user.role_mappings if m.role and m.role.is_active]
        menus_raw = await MenuService(self.session).get_user_menu_tree(user.id)
        menus = [MenuNode.model_validate(m) for m in menus_raw]
        cfg = load_product_config()
        return LoginResponse(
            access_token=create_access_token(user.id, secret_key=self.secret_key),
            user=UserInfo(
                id=user.id,
                username=user.username,
                email=user.email,
                full_name=user.full_name,
                phone=user.phone,
                roles=roles,
            ),
            menus=menus,
            product=get_product_name(),
            display_name=str(cfg.get("display_name") or get_product_name()),
            labels={
                "party": label("party", "Party"),
                "party_plural": label("party_plural", "Parties"),
                "party_code": label("party_code", "Code"),
                "company": label("company", "Company"),
                "deposit": label("deposit", "Deposit"),
            },
            idle_timeout_minutes=self.idle_minutes,
        )
