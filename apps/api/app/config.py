from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "ERP Platform"
    app_env: str = "development"
    debug: bool = True
    sql_echo: bool = False
    seed_on_startup: bool = True
    api_v1_prefix: str = "/api/v1"

    # hospital | generp | lodge
    erp_product: str = "hospital"

    database_url: str = "postgresql+asyncpg://postgres:postpass@127.0.0.1:5432/erp_platform"

    backend_host: str = "0.0.0.0"
    backend_port: int = 8030
    secret_key: str = "erp-platform-dev-secret-change-me"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440
    idle_timeout_minutes: int = 30

    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:8030,http://127.0.0.1:8030"
    )

    # Hospital HMS media / report storage (relative to apps/api cwd unless absolute)
    reports_output_dir: Path = Path("./storage/reports")
    doctors_storage_dir: Path = Path("./storage/doctors")
    patients_storage_dir: Path = Path("./storage/patients")
    patient_documents_storage_dir: Path = Path("./storage/patient-documents")

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if not isinstance(value, str):
            return value
        if value.startswith("postgresql://"):
            value = value.replace("postgresql://", "postgresql+asyncpg://", 1)
        value = value.replace("@localhost:", "@127.0.0.1:")
        if "127.0.0.1" in value and "ssl=" not in value:
            sep = "&" if "?" in value else "?"
            value = f"{value}{sep}ssl=disable"
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


def repo_root() -> Path:
    # apps/api/app/config.py → repo root
    return Path(__file__).resolve().parents[3]
