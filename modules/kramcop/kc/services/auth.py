from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.kramcop.kc.core.security import get_password_hash
from modules.kramcop.kc.models.auth import User
from modules.kramcop.kc.models.masters import Role
from modules.kramcop.kc.models.settings import AppSetting
from modules.kramcop.kc.schemas import UserInfo, UserIn
from modules.kramcop.kc.services.access import set_user_roles, user_menus, user_role_ids


async def get_setting(session: AsyncSession, key: str, default: str = "") -> str:
    result = await session.execute(select(AppSetting).where(AppSetting.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else default


async def set_setting(session: AsyncSession, key: str, value: str) -> None:
    result = await session.execute(select(AppSetting).where(AppSetting.key == key))
    row = result.scalar_one_or_none()
    if row:
        row.value = value
        row.updated_at = datetime.now(UTC)
    else:
        session.add(AppSetting(key=key, value=value))


async def ensure_admin(session: AsyncSession) -> None:
    result = await session.execute(select(User).limit(1))
    if result.scalar_one_or_none():
        return
    session.add(
        User(
            username="admin",
            email="admin@admin.com",
            full_name="Administrator",
            hashed_password=get_password_hash("admin123"),
        )
    )
    await set_setting(session, "society_name", "Kramcop")
    await set_setting(session, "acno_prefix", "D-")


async def to_user_info(session: AsyncSession, user: User) -> UserInfo:
    role_ids = await user_role_ids(session, user.id)
    role_rows = []
    if role_ids:
        role_rows = list(
            (await session.execute(select(Role).where(Role.id.in_(role_ids)).order_by(Role.name))).scalars().all()
        )
    return UserInfo(
        id=user.id,
        username=user.username or "",
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        roles=[{"id": row.id, "name": row.name} for row in role_rows],
        menus=await user_menus(session, user.id),
    )


async def list_users(session: AsyncSession) -> list[User]:
    return list((await session.execute(select(User).order_by(User.username))).scalars().all())


async def create_user(session: AsyncSession, data: UserIn) -> User:
    from fastapi import HTTPException

    username = data.username.strip().lower()
    email = data.email.strip().lower()
    if not username or not email or not data.password:
        raise HTTPException(status_code=400, detail="Username, email and password are required")
    exists = (
        await session.execute(
            select(User).where(or_(func.lower(User.username) == username, func.lower(User.email) == email))
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail="Username or email already exists")
    user = User(
        username=username,
        email=email,
        full_name=data.full_name.strip() or username,
        hashed_password=get_password_hash(data.password),
        is_active=data.is_active,
    )
    session.add(user)
    await session.flush()
    await _ensure_platform_access(session, user.id)
    if data.role_ids:
        await set_user_roles(session, user.id, list(data.role_ids))
    return user


async def _ensure_platform_access(session: AsyncSession, user_id: str) -> None:
    """New society users sign in through the shared ERP role, not a second user table."""
    from erp_core.models.auth import Role as PlatformRole
    from erp_core.models.auth import UserRoleMapping
    from erp_core.services.menu import SUPER_ADMIN_ROLE

    role = (
        await session.execute(select(PlatformRole).where(PlatformRole.role_name == SUPER_ADMIN_ROLE))
    ).scalar_one_or_none()
    if role is None:
        return
    mapped = (
        await session.execute(
            select(UserRoleMapping).where(
                UserRoleMapping.user_id == user_id,
                UserRoleMapping.role_id == role.id,
            )
        )
    ).scalars().first()
    if mapped is None:
        session.add(UserRoleMapping(user_id=user_id, role_id=role.id, priority=1))


async def update_user(session: AsyncSession, user: User, data: UserIn) -> User:
    from fastapi import HTTPException

    username = data.username.strip().lower()
    email = data.email.strip().lower()
    other = (
        await session.execute(
            select(User).where(
                User.id != user.id,
                or_(func.lower(User.username) == username, func.lower(User.email) == email),
            )
        )
    ).scalar_one_or_none()
    if other:
        raise HTTPException(status_code=400, detail="Username or email already exists")
    user.username = username
    user.email = email
    user.full_name = data.full_name.strip() or username
    user.is_active = data.is_active
    if data.password.strip():
        user.hashed_password = get_password_hash(data.password)
    await set_user_roles(session, user.id, list(data.role_ids))
    await session.flush()
    return user
