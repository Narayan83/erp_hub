from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.core.security import get_password_hash
from modules.generp.ge.models.auth import User, UserRoleMapping
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.user_mgmt import UserCreate, UserOut, UserUpdate
from modules.generp.ge.services.user_ids import normalize_user_ids

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
        updated_at=user.updated_at,
    )


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
    try:
        username, email = normalize_user_ids(data.username, data.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    exists = await _ids_taken(session, username, email)
    if exists:
        raise HTTPException(status_code=400, detail="User ID or email already registered")
    user = User(
        username=username,
        email=email,
        hashed_password=get_password_hash(data.password),
        full_name=data.full_name,
        phone=data.phone,
        user_type_id=data.user_type_id,
        is_active=data.is_active,
    )
    session.add(user)
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
    if (user.email or "").lower() == "admin@admin.com" or (user.username or "").lower() == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete super admin user")
    user.is_active = False
    await session.flush()
    return MessageResponse(message="User deactivated")
