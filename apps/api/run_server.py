"""Dev + packaged entry point.

Packaged (PyInstaller): one EXE ships API + embedded web UI.
On first run it creates config\\kramcop.env next to the EXE and opens the browser.
"""
from __future__ import annotations

import logging
import os
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
import webbrowser
from logging.handlers import RotatingFileHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "core"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

DEFAULT_KRAMCOP_ENV = """# Kramcop - edit only if your PostgreSQL password is different
ERP_PRODUCT=kramcop
DATABASE_URL=postgresql://postgres:postpass@127.0.0.1:5432/kramcop
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8030
BASE_URL=http://127.0.0.1:8030
SECRET_KEY=change-me-to-a-long-random-string
SEED_ON_STARTUP=true
"""

_LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"
_LOG_DATEFMT = "%Y-%m-%d %H:%M:%S"

logger = logging.getLogger(__name__)


def _install_root() -> Path:
    from app.erp_env import resolve_frozen_install_root

    explicit = os.environ.get("ERP_ROOT", "").strip()
    if explicit:
        return Path(explicit)
    if getattr(sys, "frozen", False):
        return resolve_frozen_install_root()
    return Path.cwd()


def _setup_file_logging(root: Path) -> Path | None:
    log_dir = root / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f"WARNING: cannot create log dir {log_dir}: {exc}", file=sys.stderr)
        return None

    log_path = log_dir / "backend.log"
    root_logger = logging.getLogger()
    for h in root_logger.handlers:
        if isinstance(h, RotatingFileHandler) and getattr(h, "baseFilename", None) == str(log_path):
            return log_path

    root_logger.setLevel(logging.INFO)
    formatter = logging.Formatter(_LOG_FORMAT, datefmt=_LOG_DATEFMT)

    try:
        file_handler = RotatingFileHandler(
            log_path,
            maxBytes=5 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        file_handler.setLevel(logging.INFO)
        root_logger.addHandler(file_handler)
    except OSError as exc:
        print(f"WARNING: cannot open log file {log_path}: {exc}", file=sys.stderr)
        return None

    if not any(
        isinstance(h, logging.StreamHandler) and not isinstance(h, RotatingFileHandler)
        for h in root_logger.handlers
    ):
        console = logging.StreamHandler(sys.stderr)
        console.setFormatter(formatter)
        console.setLevel(logging.INFO)
        root_logger.addHandler(console)

    return log_path


def _ensure_install_env() -> None:
    if not getattr(sys, "frozen", False):
        # Dev: load apps/api/.env early
        env_path = Path(__file__).resolve().parent / ".env"
        if env_path.is_file():
            from app.erp_env import apply_env_file

            apply_env_file(env_path)
        return

    from app.erp_env import apply_env_file

    root = _install_root()
    os.environ.setdefault("ERP_ROOT", str(root))
    os.environ.setdefault("ERP_LISTEN_ALL", "true")
    os.environ.setdefault("ERP_PRODUCT", "kramcop")

    log_path = _setup_file_logging(root)
    if log_path is not None:
        logger.info("Logging to %s", log_path)
        logger.info("Install root: %s", root)

    config_dir = root / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    kramcop_env = config_dir / "kramcop.env"
    if not kramcop_env.is_file():
        kramcop_env.write_text(DEFAULT_KRAMCOP_ENV, encoding="utf-8")
        print(f"Created default config: {kramcop_env}")
        print("Default DB: postgres / postpass  database: kramcop")
        logger.info("Created default config: %s", kramcop_env)

    os.environ.setdefault("ERP_CONFIG_FILE", str(kramcop_env))
    apply_env_file(kramcop_env)
    os.environ.setdefault("ERP_PRODUCT", "kramcop")
    (root / "data" / "storage").mkdir(parents=True, exist_ok=True)
    logger.info("Config file: %s", os.environ.get("ERP_CONFIG_FILE"))


_ensure_install_env()


def _should_open_browser() -> bool:
    if "--no-browser" in sys.argv:
        return False
    flag = os.environ.get("ERP_OPEN_BROWSER", "").strip().lower()
    if flag in ("0", "false", "no", "off"):
        return False
    if flag in ("1", "true", "yes", "on"):
        return True
    return bool(getattr(sys, "frozen", False))


def _open_browser_when_ready(url: str, timeout_sec: float = 90.0) -> None:
    def _worker() -> None:
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(url, timeout=1.5) as resp:
                    if 200 <= getattr(resp, "status", 200) < 500:
                        webbrowser.open(url)
                        print(f"Opened browser: {url}")
                        return
            except (urllib.error.URLError, TimeoutError, OSError):
                time.sleep(0.4)
        print(f"Server started, but browser did not open automatically. Open: {url}")

    threading.Thread(target=_worker, daemon=True, name="kramcop-open-browser").start()


def run_dev() -> int:
    import uvicorn

    port = int(os.environ.get("BACKEND_PORT", "8030"))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        reload_dirs=[
            str(ROOT / "apps" / "api" / "app"),
            str(ROOT / "core"),
            str(ROOT / "modules"),
            str(ROOT / "config"),
        ],
    )
    return 0


def run_packaged() -> int:
    import uvicorn

    from app.config import get_settings
    from app.erp_env import resolve_web_dist
    from app.main import app

    settings = get_settings()
    host = settings.backend_host
    listen_all = (
        os.environ.get("ERP_LISTEN_ALL", "").lower() in ("1", "true", "yes")
        or getattr(sys, "frozen", False)
    )
    if host in ("localhost", "127.0.0.1") and listen_all:
        host = "0.0.0.0"

    web = resolve_web_dist()
    if web is None:
        msg = (
            "ERROR: Web UI not found inside this EXE. "
            "Rebuild with .\\scripts\\build_kramcop_web_exe.ps1"
        )
        print(msg)
        logger.error(msg)
        return 1

    app_url = f"http://127.0.0.1:{settings.backend_port}"
    print(f"Kramcop UI: bundled from {web}")
    print(f"Open on this PC:  {app_url}")
    print(f"Other PCs (LAN):  http://SERVER-IP:{settings.backend_port}")
    logger.info("Web UI: %s", web)
    logger.info("Listening on %s:%s (UI %s)", host, settings.backend_port, app_url)
    if _should_open_browser():
        print("Opening browser automatically when ready...")
        _open_browser_when_ready(app_url)
    else:
        print("Browser auto-open skipped (--no-browser or ERP_OPEN_BROWSER=false)")

    uvicorn.run(app, host=host, port=settings.backend_port, log_level="info")
    return 0


def main() -> int:
    if getattr(sys, "frozen", False):
        return run_packaged()
    return run_dev()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        logging.getLogger(__name__).exception("Kramcop crashed before listen")
        traceback.print_exc()
        raise SystemExit(1)
