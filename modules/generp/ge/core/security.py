"""Password helpers and tokens that use the hub auth secret."""

from datetime import timedelta

from erp_core.api.deps import current_auth_settings
from erp_core.security import (
    create_access_token as _create,
    decode_access_token as _decode,
    get_password_hash as _hash,
    verify_password,
)

__all__ = [
    "verify_password",
    "get_password_hash",
    "create_access_token",
    "decode_access_token",
]


def get_password_hash(password: str) -> str:
    return _hash(password)


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    secret_key, algorithm = current_auth_settings()
    minutes = 1440
    if expires_delta is not None:
        minutes = max(1, int(expires_delta.total_seconds() // 60))
    return _create(
        subject,
        secret_key=secret_key,
        algorithm=algorithm,
        expires_minutes=minutes,
    )


def decode_access_token(token: str) -> str | None:
    secret_key, algorithm = current_auth_settings()
    return _decode(token, secret_key=secret_key, algorithm=algorithm)
