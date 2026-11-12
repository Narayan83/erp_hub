"""Map hospital `settings` usage onto erp_hub Settings."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from app.config import get_settings as _get_erp_settings


class _HospitalSettingsProxy:
    def __init__(self) -> None:
        self._s = _get_erp_settings()

    def __getattr__(self, name: str):
        s = self._s
        # Common hospital aliases
        aliases = {
            "DATABASE_URL": "database_url",
            "SECRET_KEY": "secret_key",
            "ALGORITHM": "algorithm",
            "ACCESS_TOKEN_EXPIRE_MINUTES": "idle_timeout_minutes",
            "CORS_ORIGINS": "cors_origins",
            "UPLOAD_DIR": "upload_dir",
            "REPORT_DIR": "report_dir",
        }
        if name in aliases:
            return getattr(s, aliases[name], None)
        if hasattr(s, name):
            return getattr(s, name)
        if hasattr(s, name.lower()):
            return getattr(s, name.lower())
        # Sensible defaults for optional hospital-only knobs
        defaults = {
            "BACKUP_DIR": str(Path("backups").resolve()),
            "MEDIA_ROOT": str(Path("media").resolve()),
            "SQL_ECHO": False,
            "SEED_ON_STARTUP": True,
        }
        if name in defaults:
            return defaults[name]
        raise AttributeError(name)


@lru_cache
def get_settings():
    return _HospitalSettingsProxy()


settings = get_settings()
