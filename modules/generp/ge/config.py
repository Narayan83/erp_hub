"""Storage paths and the company-reset password for the vendored GenERP API."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO = Path(__file__).resolve().parents[3]
_STORAGE = _REPO / "apps" / "api" / "storage"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    company_reset_password: str = "2015"
    secret_key: str = "erp-platform-dev-secret-change-me"
    algorithm: str = "HS256"
    app_env: str = "development"
    app_name: str = "GenERP"
    reports_output_dir: Path = _STORAGE / "reports"
    product_images_dir: Path = _STORAGE / "product_images"
    party_images_dir: Path = _STORAGE / "party_images"
    shop_banners_dir: Path = _STORAGE / "shop_banners"
    company_logo_dir: Path = _STORAGE / "company_logo"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    try:
        from app.config import get_settings as hub_settings

        hub = hub_settings()
        settings.secret_key = hub.secret_key
        settings.algorithm = hub.algorithm
        settings.app_env = hub.app_env
    except Exception:
        pass
    for folder in (
        settings.reports_output_dir,
        settings.product_images_dir,
        settings.party_images_dir,
        settings.shop_banners_dir,
        settings.company_logo_dir,
    ):
        folder.mkdir(parents=True, exist_ok=True)
    return settings
