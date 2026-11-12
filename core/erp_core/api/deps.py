from collections.abc import AsyncGenerator

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from erp_core.database import get_db
from erp_core.models.auth import User, UserRoleMapping
from erp_core.security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)

_secret_key: str = "change-me"
_algorithm: str = "HS256"


def configure_auth(*, secret_key: str, algorithm: str = "HS256") -> None:
    global _secret_key, _algorithm
    _secret_key = secret_key
    _algorithm = algorithm


def current_auth_settings() -> tuple[str, str]:
    return _secret_key, _algorithm


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db():
        yield session


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    user_id = decode_access_token(
        credentials.credentials, secret_key=_secret_key, algorithm=_algorithm
    )
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await session.execute(
        select(User)
        .options(
            selectinload(User.role_mappings).selectinload(UserRoleMapping.role),
            selectinload(User.user_type),
        )
        .where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive"
        )
    return user
