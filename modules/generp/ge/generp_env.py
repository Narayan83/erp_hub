"""Resolve GenERP install paths and external config (customer deployment)."""
from __future__ import annotations

import os
import sys
from pathlib import Path


def resolve_frozen_install_root() -> Path:
    """Install root for a frozen onedir layout.

    EXE lives at ``{InstallRoot}/backend/GenERP Backend.exe``.  If the parent
    folder looks like an install (has ``config/`` or ``web/``), use that parent
    so config/logs land under ``D:\\GenERP`` rather than ``D:\\GenERP\\backend``.
    """
    exe_dir = Path(sys.executable).resolve().parent
    if exe_dir.name.lower() == "backend":
        parent = exe_dir.parent
        if (parent / "config").is_dir() or (parent / "web").is_dir():
            return parent
    return exe_dir


def resolve_app_root() -> Path | None:
    explicit = os.environ.get("GENERP_ROOT", "").strip()
    if explicit:
        return Path(explicit)
    if getattr(sys, "frozen", False):
        return resolve_frozen_install_root()
    return None


def resolve_config_file() -> Path | None:
    explicit = os.environ.get("GENERP_CONFIG_FILE", "").strip()
    if explicit:
        path = Path(explicit)
        if path.is_file():
            return path
    root = resolve_app_root()
    if root is not None:
        candidate = root / "config" / "generp.env"
        if candidate.is_file():
            return candidate
    return None


def resolve_env_files() -> tuple[str, ...]:
    """Env files in load order (later overrides earlier in pydantic)."""
    files: list[str] = []
    config = resolve_config_file()
    if config is not None:
        files.append(str(config))
    dev_env = Path(".env")
    if dev_env.is_file():
        files.append(str(dev_env))
    return tuple(files)


def resolve_storage_root() -> Path:
    root = resolve_app_root()
    if root is not None:
        return root / "data" / "storage"
    return Path("./storage")


def resolve_web_dist() -> Path | None:
    """Vite production build (index.html + assets) for serving inside the backend EXE."""
    explicit = os.environ.get("GENERP_WEB_DIST", "").strip()
    if explicit:
        path = Path(explicit)
        if (path / "index.html").is_file():
            return path

    candidates: list[Path] = []
    install_root = os.environ.get("GENERP_ROOT", "").strip()
    if install_root:
        candidates.append(Path(install_root) / "web")

    app_root = resolve_app_root()
    if app_root is not None:
        # Install layout: D:\GenERP\web  (exe lives in D:\GenERP\backend)
        candidates.append(app_root / "web")
        candidates.append(app_root.parent / "web")
        if getattr(sys, "frozen", False):
            meipass = getattr(sys, "_MEIPASS", None)
            if meipass:
                candidates.append(Path(meipass) / "web")

    # Dev / CI: repo web/dist next to backend/
    here = Path(__file__).resolve().parent
    candidates.append(here.parent.parent / "web" / "dist")
    candidates.append(Path.cwd() / "web" / "dist")

    for path in candidates:
        if (path / "index.html").is_file():
            return path
    return None


def read_env_value(key: str, default: str | None = None) -> str | None:
    config = resolve_config_file()
    if config is not None:
        for line in config.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip()

    dev_env = Path(".env")
    if dev_env.is_file():
        for line in dev_env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip()
    return default
