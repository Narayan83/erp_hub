"""Daily PostgreSQL dump on the HMS server PC."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from urllib.parse import unquote, urlparse

from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.config import get_settings
from erp_core.database import get_session_factory
from modules.hospital.hms.hms_env import resolve_hms_root
from modules.hospital.hms.models.hospital_profile import HospitalProfile
from modules.hospital.hms.repositories.hospital_profile import HospitalProfileRepository
from modules.hospital.hms.schemas.backup import BackupSettingsRead, BackupSettingsUpdate

logger = logging.getLogger(__name__)

TASK_NAME = "HMS Database Backup"
STATE_NAME = "hms-backup-state.json"
LOCK_NAME = "hms-backup.lock"
_dump_lock = asyncio.Lock()
_retry_after: datetime | None = None
_last_task_error: str | None = None


@dataclass(frozen=True)
class DatabaseTarget:
    host: str
    port: int
    user: str
    password: str
    database: str


@dataclass(frozen=True)
class DumpOutcome:
    status: str  # ok, skipped, busy, error
    message: str
    file: str | None = None
    ran_at: datetime | None = None


def parse_backup_time(value: str) -> time:
    text = (value or "").strip()
    parts = text.split(":")
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        raise ValueError("Backup time must be HH:MM in 24-hour form, for example 22:00.")
    if len(parts[0]) != 2 or len(parts[1]) != 2:
        raise ValueError("Backup time must be HH:MM in 24-hour form, for example 22:00.")
    hour, minute = int(parts[0]), int(parts[1])
    if hour > 23 or minute > 59:
        raise ValueError("Backup time must be HH:MM in 24-hour form, for example 22:00.")
    return time(hour, minute)


def is_auto_backup_due(now: datetime, backup_time: str, last_success_on: date | None) -> bool:
    """Due at the scheduled time, or on startup when an earlier day was missed."""
    if last_success_on == now.date():
        return False
    scheduled = parse_backup_time(backup_time)
    if (now.hour, now.minute) >= (scheduled.hour, scheduled.minute):
        return True
    if last_success_on is None:
        return False
    return last_success_on < (now.date() - timedelta(days=1))


def database_target_from_url(url: str) -> DatabaseTarget:
    raw = (url or "").strip()
    if raw.startswith("postgresql+asyncpg://"):
        raw = "postgresql://" + raw[len("postgresql+asyncpg://") :]
    parsed = urlparse(raw)
    database = (parsed.path or "").lstrip("/")
    if not parsed.hostname or not database or not parsed.username:
        raise ValueError("DATABASE_URL is not a PostgreSQL connection string.")
    return DatabaseTarget(
        host=parsed.hostname,
        port=parsed.port or 5432,
        user=unquote(parsed.username),
        password=unquote(parsed.password or ""),
        database=database,
    )


def build_pg_dump_command(pg_dump: Path, target: DatabaseTarget, out_file: Path) -> list[str]:
    return [
        str(pg_dump),
        "--host",
        target.host,
        "--port",
        str(target.port),
        "--username",
        target.user,
        "--dbname",
        target.database,
        "--format=custom",
        "--file",
        str(out_file),
        "--no-owner",
        "--no-privileges",
    ]


def prepare_backup_directory(raw: str) -> Path:
    text = (raw or "").strip().strip('"')
    if not text:
        raise ValueError("Choose a backup folder on the server PC.")
    folder = Path(text)
    if not folder.is_absolute():
        raise ValueError("Backup folder must be a full path, for example D:\\HMS-Backups.")
    if folder.exists() and not folder.is_dir():
        raise ValueError("Backup path is a file. Choose a folder.")
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def expired_dump_names(entries: list[tuple[str, float]], now_ts: float, keep_days: int) -> list[str]:
    cutoff = now_ts - (keep_days * 86400)
    expired: list[str] = []
    for name, modified in entries:
        if name.startswith("hms-") and name.endswith(".dump") and modified < cutoff:
            expired.append(name)
    return expired


def _hidden_kwargs() -> dict:
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NO_WINDOW}
    return {}


def find_pg_dump() -> Path:
    found = shutil.which("pg_dump")
    if found:
        return Path(found)
    candidates: list[Path] = []
    root = resolve_hms_root()
    if root is not None:
        candidates.append(root / "postgresql" / "bin" / "pg_dump.exe")
    for base in (
        Path(r"C:\Program Files\PostgreSQL"),
        Path(r"C:\Program Files (x86)\PostgreSQL"),
    ):
        if not base.is_dir():
            continue
        versions = sorted(base.iterdir(), key=lambda item: item.name, reverse=True)
        candidates.extend(version / "bin" / "pg_dump.exe" for version in versions)
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        "pg_dump was not found. Install PostgreSQL and make sure its bin folder is available."
    )


def _state_path(folder: Path) -> Path:
    return folder / STATE_NAME


def read_backup_state(folder: Path) -> dict | None:
    path = _state_path(folder)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def write_backup_state(folder: Path, *, success_on: date, dump_file: Path, ran_at: datetime) -> None:
    payload = {
        "last_success_on": success_on.isoformat(),
        "last_file": str(dump_file),
        "last_at": ran_at.isoformat(timespec="seconds"),
        "last_status": "ok",
    }
    _state_path(folder).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _success_on_from_state(folder: str | None) -> date | None:
    if not folder:
        return None
    path = Path(folder)
    if not path.is_dir():
        return None
    state = read_backup_state(path)
    if not state or state.get("last_status") != "ok":
        return None
    raw = state.get("last_success_on") or ""
    try:
        return date.fromisoformat(str(raw))
    except ValueError:
        return None


def _success_on_from_profile(profile: HospitalProfile) -> date | None:
    if profile.last_backup_status != "ok" or profile.last_backup_at is None:
        return None
    stamp = profile.last_backup_at
    if stamp.tzinfo is not None:
        stamp = stamp.astimezone()
    return stamp.date()


def _sync_profile_from_state(profile: HospitalProfile, now: datetime) -> bool:
    folder = (profile.backup_directory or "").strip()
    if not folder:
        return False
    path = Path(folder)
    state = read_backup_state(path) if path.is_dir() else None
    if not state or state.get("last_status") != "ok":
        return False
    dump_file = state.get("last_file") or None
    if dump_file and dump_file == profile.last_backup_file and profile.last_backup_status == "ok":
        return False
    raw_at = state.get("last_at")
    try:
        ran_at = datetime.fromisoformat(str(raw_at)) if raw_at else now
    except ValueError:
        ran_at = now
    if ran_at.tzinfo is None:
        ran_at = ran_at.astimezone()
    profile.last_backup_status = "ok"
    profile.last_backup_file = str(dump_file) if dump_file else profile.last_backup_file
    profile.last_backup_at = ran_at
    return True


def _apply_outcome(profile: HospitalProfile, outcome: DumpOutcome) -> None:
    profile.last_backup_at = outcome.ran_at or datetime.now().astimezone()
    if outcome.status == "ok":
        profile.last_backup_status = "ok"
        profile.last_backup_file = outcome.file
        return
    message = outcome.message.strip() or "Backup failed."
    profile.last_backup_status = message[:500]


def _pid_running(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        kernel = ctypes.windll.kernel32
        handle = kernel.OpenProcess(0x1000, False, pid)
        if handle:
            kernel.CloseHandle(handle)
            return True
        return kernel.GetLastError() == 5
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _lock_is_stale(lock_path: Path) -> bool:
    try:
        age = datetime.now().timestamp() - lock_path.stat().st_mtime
        pid_text = lock_path.read_text(encoding="utf-8").strip()
    except OSError:
        return True
    if pid_text.isdigit() and _pid_running(int(pid_text)):
        return False
    if pid_text.isdigit():
        return True
    return age > 120


def _acquire_lock(folder: Path) -> int | None:
    lock_path = folder / LOCK_NAME
    try:
        return os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        if not _lock_is_stale(lock_path):
            return None
        lock_path.unlink(missing_ok=True)
        try:
            return os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            return None


def _release_lock(folder: Path, handle: int) -> None:
    try:
        os.close(handle)
    finally:
        (folder / LOCK_NAME).unlink(missing_ok=True)


def _prune_old_dumps(folder: Path, keep_days: int) -> None:
    now_ts = datetime.now().timestamp()
    entries = [(item.name, item.stat().st_mtime) for item in folder.glob("hms-*.dump") if item.is_file()]
    for name in expired_dump_names(entries, now_ts, keep_days):
        try:
            (folder / name).unlink(missing_ok=True)
        except OSError:
            logger.warning("Could not delete old backup %s", folder / name)


def _dump_sync(directory: str, keep_days: int, force: bool) -> DumpOutcome:
    now = datetime.now().astimezone()
    try:
        folder = prepare_backup_directory(directory)
    except OSError as exc:
        return DumpOutcome("error", f"Could not create the backup folder: {exc}", ran_at=now)
    except ValueError as exc:
        return DumpOutcome("error", str(exc), ran_at=now)

    if not force and _success_on_from_state(str(folder)) == now.date():
        state = read_backup_state(folder) or {}
        return DumpOutcome("skipped", "A backup already succeeded today.", file=state.get("last_file"), ran_at=now)

    handle = _acquire_lock(folder)
    if handle is None:
        return DumpOutcome("busy", "A backup is already running.", ran_at=now)
    out_file: Path | None = None
    try:
        os.write(handle, str(os.getpid()).encode())
        target = database_target_from_url(get_settings().database_url)
        pg_dump = find_pg_dump()
        out_file = folder / f"hms-{now.strftime('%Y%m%d-%H%M%S')}.dump"
        command = build_pg_dump_command(pg_dump, target, out_file)
        env = os.environ.copy()
        env["PGPASSWORD"] = target.password
        completed = subprocess.run(
            command,
            env=env,
            capture_output=True,
            text=True,
            timeout=60 * 30,
            check=False,
            **_hidden_kwargs(),
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "pg_dump failed.").strip()
            if out_file.is_file():
                out_file.unlink(missing_ok=True)
            return DumpOutcome("error", detail[-500:], ran_at=now)
        write_backup_state(folder, success_on=now.date(), dump_file=out_file, ran_at=now)
        _prune_old_dumps(folder, keep_days)
        return DumpOutcome("ok", "ok", file=str(out_file), ran_at=now)
    except subprocess.TimeoutExpired:
        if out_file is not None and out_file.is_file():
            out_file.unlink(missing_ok=True)
        return DumpOutcome("error", "The database dump took too long and was stopped.", ran_at=now)
    except (OSError, ValueError, FileNotFoundError) as exc:
        if out_file is not None and out_file.is_file():
            out_file.unlink(missing_ok=True)
        return DumpOutcome("error", str(exc), ran_at=now)
    finally:
        _release_lock(folder, handle)


async def execute_backup(directory: str, keep_days: int, *, force: bool) -> DumpOutcome:
    async with _dump_lock:
        return await asyncio.to_thread(_dump_sync, directory, keep_days, force)


def _write_install_config(data: BackupSettingsUpdate) -> None:
    root = resolve_hms_root()
    if root is None:
        return
    config_dir = root / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "enabled": data.enabled,
        "backup_time": data.backup_time,
        "directory": data.directory or "",
        "keep_days": data.keep_days,
    }
    (config_dir / "backup.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _task_exists() -> bool:
    if os.name != "nt":
        return False
    completed = subprocess.run(
        ["schtasks", "/Query", "/TN", TASK_NAME],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
        **_hidden_kwargs(),
    )
    return completed.returncode == 0


def sync_windows_task(data: BackupSettingsUpdate) -> None:
    """Register a daily task when this process is an HMS install. Failures stay in-app."""
    global _last_task_error
    _last_task_error = None
    if os.name != "nt" or resolve_hms_root() is None:
        return
    script = resolve_hms_root() / "scripts" / "Backup-HMS-Database.ps1"
    if not script.is_file():
        return
    if not data.enabled:
        subprocess.run(
            ["schtasks", "/Delete", "/F", "/TN", TASK_NAME],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
            **_hidden_kwargs(),
        )
        return
    command = (
        'powershell.exe -NoProfile -ExecutionPolicy Bypass -File '
        f'"{script}"'
    )
    completed = subprocess.run(
        [
            "schtasks",
            "/Create",
            "/F",
            "/TN",
            TASK_NAME,
            "/SC",
            "DAILY",
            "/ST",
            data.backup_time,
            "/RL",
            "LIMITED",
            "/TR",
            command,
        ],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
        **_hidden_kwargs(),
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "schtasks failed.").strip()
        _last_task_error = detail[-240:]


def describe_scheduler() -> str:
    if _task_exists():
        return (
            'Windows scheduled task "HMS Database Backup" runs on this server even if '
            "HMS Backend is closed, as long as the PC and PostgreSQL are on. "
            "One successful dump is kept per day."
        )
    if _last_task_error:
        return (
            "Backup runs while HMS Backend is running on the server. "
            f"Windows Task Scheduler was not updated: {_last_task_error}"
        )
    return (
        "Backup runs on the server PC while HMS Backend is running. "
        "If the server starts after the chosen time and today's dump has not run, it runs shortly after startup."
    )


def to_backup_settings(profile: HospitalProfile) -> BackupSettingsRead:
    return BackupSettingsRead(
        enabled=bool(profile.backup_enabled),
        backup_time=profile.backup_time or "22:00",
        directory=profile.backup_directory,
        keep_days=profile.backup_keep_days or 30,
        last_backup_at=profile.last_backup_at,
        last_backup_status=profile.last_backup_status,
        last_backup_file=profile.last_backup_file,
        scheduler_note=describe_scheduler(),
    )


class DatabaseBackupService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = HospitalProfileRepository(session)

    async def get_settings(self) -> BackupSettingsRead:
        profile = await self.repo.get_or_create_default()
        if _sync_profile_from_state(profile, datetime.now().astimezone()):
            await self.session.flush()
        return to_backup_settings(profile)

    async def update_settings(self, data: BackupSettingsUpdate) -> BackupSettingsRead:
        if data.enabled and not data.directory:
            raise ValueError("Choose a backup folder on the server PC.")
        if data.directory:
            prepare_backup_directory(data.directory)
        profile = await self.repo.get_or_create_default()
        profile.backup_enabled = data.enabled
        profile.backup_time = data.backup_time
        profile.backup_directory = data.directory
        profile.backup_keep_days = data.keep_days
        await self.session.flush()
        _write_install_config(data)
        sync_windows_task(data)
        return to_backup_settings(profile)

    async def run_now(self) -> BackupSettingsRead:
        profile = await self.repo.get_or_create_default()
        directory = (profile.backup_directory or "").strip()
        if not directory:
            raise ValueError("Choose a backup folder and save it before running a backup.")
        keep_days = profile.backup_keep_days or 30
        outcome = await execute_backup(directory, keep_days, force=True)
        if outcome.status == "busy":
            raise ValueError(outcome.message)
        fresh = await self.repo.get_or_create_default()
        _apply_outcome(fresh, outcome)
        await self.session.flush()
        return to_backup_settings(fresh)


async def run_scheduled_backup_if_due() -> None:
    global _retry_after
    now = datetime.now().astimezone()
    if _retry_after is not None and now < _retry_after:
        return

    async with get_session_factory()() as session:
        profile = await HospitalProfileRepository(session).get_singleton()
        if profile is None or not profile.backup_enabled:
            return
        directory = (profile.backup_directory or "").strip()
        if not directory:
            return
        if _sync_profile_from_state(profile, now):
            await session.commit()
        success_on = _success_on_from_state(directory) or _success_on_from_profile(profile)
        backup_time = profile.backup_time or "22:00"
        keep_days = profile.backup_keep_days or 30
        if not is_auto_backup_due(now, backup_time, success_on):
            return

    outcome = await execute_backup(directory, keep_days, force=False)
    if outcome.status in {"skipped", "busy"}:
        return

    async with get_session_factory()() as session:
        profile = await HospitalProfileRepository(session).get_or_create_default()
        _apply_outcome(profile, outcome)
        await session.commit()

    if outcome.status == "ok":
        _retry_after = None
        logger.info("Scheduled database backup written to %s", outcome.file)
        return
    _retry_after = datetime.now().astimezone() + timedelta(minutes=15)
    logger.error("Scheduled database backup failed: %s", outcome.message)


async def backup_scheduler_loop() -> None:
    logger.info("Database backup scheduler started.")
    try:
        await asyncio.sleep(8)
        while True:
            try:
                await run_scheduled_backup_if_due()
            except Exception:
                logger.exception("Database backup check failed")
            await asyncio.sleep(30)
    except asyncio.CancelledError:
        return
