"""Paths only. The database and login belong to the platform."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from modules.kramcop.kc.kramcop_env import resolve_storage_root


@dataclass
class Settings:
    app_name: str = "Kramcop"
    idle_timeout_minutes: int = 30

    @property
    def reports_output_dir(self) -> Path:
        path = resolve_storage_root() / "reports"
        path.mkdir(parents=True, exist_ok=True)
        return path


def get_settings() -> Settings:
    return Settings()
