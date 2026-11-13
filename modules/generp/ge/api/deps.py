from collections.abc import AsyncGenerator

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.core.database import get_db
from modules.generp.ge.core.security import decode_access_token
from modules.generp.ge.models.auth import Menu, RoleMenuPermission, User, UserRoleMapping
from modules.generp.ge.services.menu import SUPER_ADMIN_ROLE

bearer_scheme = HTTPBearer(auto_error=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db():
        yield session


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    user_id = decode_access_token(credentials.credentials)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await session.execute(
        select(User)
        .options(selectinload(User.role_mappings).selectinload(UserRoleMapping.role), selectinload(User.user_type))
        .where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive"
        )
    return user


def user_is_super_admin(user: User) -> bool:
    return any(
        mapping.role and mapping.role.is_active and mapping.role.role_name == SUPER_ADMIN_ROLE
        for mapping in (user.role_mappings or [])
    )


async def require_print_layout_editor(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Super Admin, or any role granted Update on Print Template Designer."""
    if user_is_super_admin(user):
        return user
    menu = (
        await session.execute(select(Menu).where(Menu.code == "print_template_designer"))
    ).scalar_one_or_none()
    if not menu:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can change print templates",
        )
    role_ids = [
        mapping.role_id
        for mapping in (user.role_mappings or [])
        if mapping.role and mapping.role.is_active
    ]
    if not role_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can change print templates",
        )
    allowed = (
        await session.execute(
            select(RoleMenuPermission.id).where(
                RoleMenuPermission.role_id.in_(role_ids),
                RoleMenuPermission.menu_id == menu.id,
                RoleMenuPermission.can_update.is_(True),
            )
        )
    ).first()
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can change print templates",
        )
    return user
