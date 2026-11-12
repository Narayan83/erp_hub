"""One-shot rewrite of vendored hospital HMS package imports for erp_hub."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HMS = ROOT / "hms"
SHARED = ROOT / "shared"

# Models that live in erp_core — replace hospital copies with shims
CORE_MODEL_SHIMS = {
    "base.py": '''from erp_core.models.base import TimestampMixin\n\n__all__ = ["TimestampMixin"]\n''',
    "user.py": '''from erp_core.models.auth import User\n\n__all__ = ["User"]\n''',
    "user_type.py": '''from erp_core.models.auth import UserType\n\n__all__ = ["UserType"]\n''',
    "role.py": '''from erp_core.models.auth import Role\n\n__all__ = ["Role"]\n''',
    "role_menu_permission.py": '''from erp_core.models.auth import RoleMenuPermission\n\n__all__ = ["RoleMenuPermission"]\n''',
    "user_role_mapping.py": '''from erp_core.models.auth import UserRoleMapping\n\n__all__ = ["UserRoleMapping"]\n''',
    "menu.py": '''from erp_core.models.auth import Menu\n\n__all__ = ["Menu"]\n''',
    "notification_setup.py": '''from erp_core.models.auth import NotificationSetup\n\n__all__ = ["NotificationSetup"]\n''',
    "ledger.py": '''from erp_core.models.masters import Ledger\n\n__all__ = ["Ledger"]\n''',
    "payment_mode.py": '''from erp_core.models.masters import PaymentMode\n\n__all__ = ["PaymentMode"]\n''',
    "print_config.py": '''from erp_core.models.masters import PrintConfig\n\n__all__ = ["PrintConfig"]\n''',
    "cashbook.py": '''"""Hospital cashbook uses core vouchers + optional patient linkage fields."""\nfrom erp_core.models.cashbook import CashbookVoucher, CashbookVoucherLine\n\n__all__ = ["CashbookVoucher", "CashbookVoucherLine"]\n''',
}

# Rewrite rules applied to every .py under hms/
REPLACEMENTS: list[tuple[str, str]] = [
    (r"from app\.core\.database import", "from erp_core.database import"),
    (r"from app\.core\.security import", "from erp_core.security import"),
    (r"from app\.core\.config import", "from modules.hospital.hms.compat_config import"),
    (r"import app\.core\.config as", "import modules.hospital.hms.compat_config as"),
    (r"from app\.core\.", "from modules.hospital.hms.compat_core."),
    (r"from app\.", "from modules.hospital.hms."),
    (r"import app\.", "import modules.hospital.hms."),
    (r"from shared\.", "from modules.hospital.shared."),
    (r"import shared\.", "import modules.hospital.shared."),
]


def rewrite_text(text: str) -> str:
    for pat, repl in REPLACEMENTS:
        text = re.sub(pat, repl, text)
    return text


def main() -> None:
    # Package markers
    (HMS / "__init__.py").write_text(
        '"""Vendored Hospital HMS domain (ported from D:\\\\fullstack\\\\others\\\\hospital)."""\n',
        encoding="utf-8",
    )
    (SHARED / "__init__.py").write_text(
        '"""Shared hospital helpers (ported)."""\n', encoding="utf-8"
    )

    # Compat shims
    compat_core = HMS / "compat_core"
    compat_core.mkdir(exist_ok=True)
    (compat_core / "__init__.py").write_text("", encoding="utf-8")

    # settings/config shim — map hospital settings to erp_hub Settings
    (HMS / "compat_config.py").write_text(
        '''"""Map hospital `settings` usage onto erp_hub Settings."""
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
''',
        encoding="utf-8",
    )

    # Rewrite all python files under hms (except we overwrite shims after)
    for path in HMS.rglob("*.py"):
        if path.name == "compat_config.py":
            continue
        if "compat_core" in path.parts:
            continue
        original = path.read_text(encoding="utf-8")
        updated = rewrite_text(original)
        if updated != original:
            path.write_text(updated, encoding="utf-8")

    # Overwrite core-overlap model files with shims
    models_dir = HMS / "models"
    for name, content in CORE_MODEL_SHIMS.items():
        (models_dir / name).write_text(content, encoding="utf-8")

    # Patch Patient model: add party_id while keeping full hospital fields
    patient_path = models_dir / "patient.py"
    patient_src = patient_path.read_text(encoding="utf-8")
    if "party_id" not in patient_src:
        patient_src = patient_src.replace(
            "patient_no: Mapped[str] = mapped_column(String(20), unique=True, index=True)",
            "party_id: Mapped[str] = mapped_column(\n"
            "        UUID(as_uuid=False), ForeignKey(\"parties.id\"), unique=True, index=True\n"
            "    )\n"
            "    patient_no: Mapped[str] = mapped_column(String(20), unique=True, index=True)",
        )
        patient_path.write_text(patient_src, encoding="utf-8")

    # Patch erp-facing deps
    deps_path = HMS / "api" / "deps.py"
    deps_path.write_text(
        '''from collections.abc import AsyncGenerator

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.api.deps import get_current_user, get_session
from erp_core.database import get_db
from erp_core.models.auth import User
from modules.hospital.hms.services.doctor import DoctorService
from modules.hospital.hms.services.patient import PatientService
from modules.hospital.hms.services.reports import ReportService

__all__ = [
    "get_db",
    "get_session",
    "get_current_user",
    "User",
    "get_patient_service",
    "get_doctor_service",
    "get_report_service",
    "Depends",
    "AsyncGenerator",
    "AsyncSession",
]


def get_patient_service(session: AsyncSession) -> PatientService:
    return PatientService(session)


def get_doctor_service(session: AsyncSession) -> DoctorService:
    return DoctorService(session)


def get_report_service() -> ReportService:
    return ReportService()
''',
        encoding="utf-8",
    )

    # Ensure api package inits exist
    (HMS / "api" / "__init__.py").write_text("", encoding="utf-8")
    (HMS / "api" / "v1" / "__init__.py").write_text("", encoding="utf-8")
    endpoints_init = HMS / "api" / "v1" / "endpoints" / "__init__.py"
    if not endpoints_init.exists():
        # hospital had endpoints under api/v1/endpoints — verify layout
        pass

    print("Rewrite complete.")
    print("hms py files:", len(list(HMS.rglob("*.py"))))


if __name__ == "__main__":
    main()
