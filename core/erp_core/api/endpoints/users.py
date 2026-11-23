from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from erp_core.api.deps import get_current_user, get_session
from erp_core.models.auth import Menu, Role, User, UserRoleMapping, UserType
from erp_core.product_config import load_product_config
from erp_core.schemas.user_mgmt import MessageResponse, UserCreate, UserOut, UserUpdate
from erp_core.security import get_password_hash
from erp_core.services.menu import SUPER_ADMIN_ROLE
from erp_core.services.user_ids import normalize_user_ids

router = APIRouter()


def _base_query():
    return select(User).options(
        selectinload(User.role_mappings).selectinload(UserRoleMapping.role),
        selectinload(User.user_type),
    )


def _to_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        phone=user.phone,
        user_type_id=user.user_type_id,
        user_type_name=user.user_type.name if user.user_type else None,
        is_active=user.is_active,
        roles=[
            m.role.role_name
            for m in (user.role_mappings or [])
            if m.role and m.role.is_active
        ],
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def _protected(user: User) -> bool:
    admin = load_product_config().get("default_admin") or {}
    names = {"admin"}
    emails = {"admin@admin.com"}
    username = str(admin.get("username") or "").strip().lower()
    email = str(admin.get("email") or "").strip().lower()
    if username:
        names.add(username)
    if email:
        emails.add(email)
    return (user.username or "").lower() in names or (user.email or "").lower() in emails


async def _ids_taken(
    session: AsyncSession, username: str, email: str, *, exclude_id: str | None = None
) -> User | None:
    stmt = select(User).where(
        or_(
            func.lower(User.username) == username,
            func.lower(User.email) == username,
            func.lower(User.username) == email,
            func.lower(User.email) == email,
        )
    )
    if exclude_id:
        stmt = stmt.where(User.id != exclude_id)
    return (await session.execute(stmt)).scalars().first()


async def _grant_super_admin(session: AsyncSession, user_id: str) -> None:
    """Products without a role-mapping screen still need a new user who can sign in."""
    has_role_screen = (
        await session.execute(
            select(Menu.id).where(Menu.code == "user_role_mapping", Menu.is_active.is_(True))
        )
    ).scalar_one_or_none()
    if has_role_screen:
        return
    role = (
        await session.execute(select(Role).where(Role.role_name == SUPER_ADMIN_ROLE))
    ).scalar_one_or_none()
    if role is None:
        return
    exists = (
        await session.execute(
            select(UserRoleMapping).where(
                UserRoleMapping.user_id == user_id,
                UserRoleMapping.role_id == role.id,
            )
        )
    ).scalars().first()
    if exists is None:
        session.add(UserRoleMapping(user_id=user_id, role_id=role.id, priority=1))


@router.get("", response_model=list[UserOut])
async def list_users(
    _u: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    result = await session.execute(_base_query().order_by(User.full_name))
    return [_to_out(u) for u in result.scalars().all()]


@router.post("", response_model=UserOut)
async def create_user(
    data: UserCreate,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if not (data.password or "").strip():
        raise HTTPException(status_code=400, detail="Password is required for a new user")
    try:
        username, email = normalize_user_ids(data.username, data.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    exists = await _ids_taken(session, username, email)
    if exists:
        raise HTTPException(status_code=400, detail="User ID or email already registered")
    if data.user_type_id:
        user_type = await session.get(UserType, data.user_type_id)
        if user_type is None or not user_type.is_active:
            raise HTTPException(status_code=400, detail="Invalid user type")
    user = User(
        username=username,
        email=email,
        hashed_password=get_password_hash(data.password),
        full_name=data.full_name.strip(),
        phone=(data.phone or "").strip() or None,
        user_type_id=data.user_type_id or None,
        is_active=data.is_active,
    )
    session.add(user)
    await session.flush()
    await _grant_super_admin(session, user.id)
    await session.flush()
    result = await session.execute(_base_query().where(User.id == user.id))
    return _to_out(result.scalar_one())


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    data: UserUpdate,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    payload = data.model_dump(exclude_unset=True)
    password = payload.pop("password", None)
    if _protected(user) and payload.get("is_active") is False:
        raise HTTPException(status_code=400, detail="Cannot deactivate the default admin user")
    if "username" in payload or "email" in payload:
        try:
            username, email = normalize_user_ids(
                payload.get("username", user.username),
                payload.get("email", user.email),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        taken = await _ids_taken(session, username, email, exclude_id=user.id)
        if taken:
            raise HTTPException(status_code=400, detail="User ID or email already registered")
        payload["username"] = username
        payload["email"] = email
    if payload.get("user_type_id"):
        user_type = await session.get(UserType, payload["user_type_id"])
        if user_type is None or not user_type.is_active:
            raise HTTPException(status_code=400, detail="Invalid user type")
    if "full_name" in payload and isinstance(payload["full_name"], str):
        payload["full_name"] = payload["full_name"].strip()
    if "phone" in payload:
        payload["phone"] = (payload["phone"] or "").strip() or None
    for field, value in payload.items():
        setattr(user, field, value)
    if password:
        user.hashed_password = get_password_hash(password)
    await session.flush()
    result = await session.execute(_base_query().where(User.id == user.id))
    return _to_out(result.scalar_one())


@router.delete("/{user_id}", response_model=MessageResponse)
async def deactivate_user(
    user_id: str,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if _protected(user):
        raise HTTPException(status_code=400, detail="Cannot deactivate the default admin user")
    user.is_active = False
    await session.flush()
    return MessageResponse(message="User deactivated")
