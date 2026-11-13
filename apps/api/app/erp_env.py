"""Resolve install paths for packaged (PyInstaller) and dev runs."""
from __future__ import annotations

import os
import sys
from pathlib import Path


def resolve_frozen_install_root() -> Path:
    """Folder that holds config/, logs/, data/ next to the EXE."""
    exe_dir = Path(sys.executable).resolve().parent
    if exe_dir.name.lower() == "backend":
        parent = exe_dir.parent
        if (parent / "config").is_dir() or (parent / "web").is_dir():
            return parent
    return exe_dir


def resolve_bundle_root() -> Path:
    """PyInstaller extract dir, or monorepo root in development."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS"))
    # apps/api/app/erp_env.py → repo root
    return Path(__file__).resolve().parents[3]


def resolve_app_root() -> Path | None:
    explicit = os.environ.get("ERP_ROOT", "").strip()
    if explicit:
        return Path(explicit)
    if getattr(sys, "frozen", False):
        return resolve_frozen_install_root()
    return None


def resolve_config_file() -> Path | None:
    explicit = os.environ.get("ERP_CONFIG_FILE", "").strip()
    if explicit:
        path = Path(explicit)
        if path.is_file():
            return path
    root = resolve_app_root()
    if root is not None:
        candidate = root / "config" / "kramcop.env"
        if candidate.is_file():
            return candidate
    return None


def resolve_env_files() -> tuple[str, ...]:
    files: list[str] = []
    config = resolve_config_file()
    if config is not None:
        files.append(str(config))
    # Dev: apps/api/.env (cwd when running from apps/api)
    for candidate in (Path(".env"), Path(__file__).resolve().parents[1] / ".env"):
        if candidate.is_file():
            files.append(str(candidate.resolve()))
            break
    return tuple(files)


def resolve_storage_root() -> Path:
    root = resolve_app_root()
    if root is not None:
        path = root / "data" / "storage"
        path.mkdir(parents=True, exist_ok=True)
        return path
    path = Path("./storage")
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve_web_dist() -> Path | None:
    """Vite production build (index.html + assets) served by the backend EXE."""
    explicit = os.environ.get("ERP_WEB_DIST", "").strip()
    if explicit:
        path = Path(explicit)
        if (path / "index.html").is_file():
            return path

    candidates: list[Path] = []
    install_root = os.environ.get("ERP_ROOT", "").strip()
    if install_root:
        candidates.append(Path(install_root) / "web")

    app_root = resolve_app_root()
    if app_root is not None:
        candidates.append(app_root / "web")
        if getattr(sys, "frozen", False):
            meipass = getattr(sys, "_MEIPASS", None)
            if meipass:
                candidates.append(Path(meipass) / "web")

    # Dev: apps/web/dist
    repo = resolve_bundle_root()
    candidates.append(repo / "apps" / "web" / "dist")
    candidates.append(repo / "web" / "dist")
    candidates.append(Path.cwd() / "apps" / "web" / "dist")

    for path in candidates:
        if (path / "index.html").is_file():
            return path
    return None


def apply_env_file(path: Path) -> None:
    """Load KEY=VALUE lines into os.environ (does not override existing)."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
