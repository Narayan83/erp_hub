"""MS Access (.mdb / .accdb) -> PostgreSQL migration endpoints."""

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.database import get_session_factory
from modules.hospital.hms.api.deps import get_session
from modules.hospital.hms.api.v1.endpoints.admin import CLEAR_DB_PASSWORD, require_admin
from modules.hospital.hms.models.user import User
from modules.hospital.hms.services import mdb_migration as mdb

router = APIRouter()
_runner: asyncio.Task | None = None

_ALLOWED_EXTENSIONS = {".mdb", ".accdb"}


class MdbRunRequest(BaseModel):
    password: str = Field(..., description="Maintenance password (2015)")
    mdb_password: str = Field(default="", description="MS Access database password")
    file_token: str | None = Field(default=None, description="Token returned by /mdb-migrate/inspect")
    mdb_path: str | None = Field(default=None, description="Optional server-local path to .mdb file")
    selected_keys: list[str] = Field(default_factory=lambda: ["patients", "ipd_bills"])
    replace_existing: bool = False
    dry_run: bool = False


def _bad(exc: Exception) -> HTTPException:
    detail = str(getattr(exc, "orig", exc) or exc)
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


@router.get("/mdb-migrate/defaults")
async def mdb_migrate_defaults(_: User = Depends(require_admin)) -> dict:
    return {
        "tables": mdb.MDB_TABLES_CATALOG,
        "migrate_order": mdb.MIGRATE_ORDER,
        "target_url": mdb.display_postgres_url(),
        "maintenance_password_hint": "Same password as Reset Database",
    }


@router.post("/mdb-migrate/inspect")
async def mdb_migrate_inspect(
    file: UploadFile | None = File(default=None),
    file_token: str | None = Form(default=None),
    mdb_path: str | None = Form(default=None),
    mdb_password: str = Form(default=""),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict:
    """Upload or locate an MDB file, test its password, and preview table counts."""
    saved_token = (file_token or "").strip() or None
    saved_path: str | None = None
    original_name: str | None = None
    size_bytes: int | None = None
    created_temp_dir: str | None = None

    try:
        if file is not None and file.filename:
            ext = Path(file.filename).suffix.lower()
            if ext not in _ALLOWED_EXTENSIONS:
                raise ValueError("Only .mdb and .accdb files are supported.")
            created_temp_dir = tempfile.mkdtemp(prefix="hms_mdb_upload_")
            safe_name = Path(file.filename).name
            dest_path = os.path.join(created_temp_dir, safe_name)
            total_written = 0
            with open(dest_path, "wb") as out_fh:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    out_fh.write(chunk)
                    total_written += len(chunk)
            if total_written == 0:
                raise ValueError("Uploaded MDB file is empty.")
            saved_path = dest_path
            original_name = safe_name
            size_bytes = total_written
        else:
            saved_path = mdb.resolve_mdb_path(file_token=saved_token, mdb_path=mdb_path)
            original_name = os.path.basename(saved_path)
            size_bytes = os.path.getsize(saved_path)

        preview = await mdb.preview_mdb(saved_path, mdb_password, session)

        if created_temp_dir is not None:
            saved_token = mdb.register_uploaded_mdb(
                saved_path,
                original_name or "database.mdb",
                size_bytes or 0,
            )

        return {
            **preview,
            "file_token": saved_token,
            "file_name": original_name,
            "file_size": size_bytes,
            "message": f"Connected to {original_name} via {preview.get('driver')}.",
        }
    except Exception as exc:  # noqa: BLE001
        if created_temp_dir is not None:
            shutil.rmtree(created_temp_dir, ignore_errors=True)
        raise _bad(exc) from exc


@router.post("/mdb-migrate/start")
async def mdb_migrate_start(
    payload: MdbRunRequest,
    _: User = Depends(require_admin),
) -> dict:
    """Start MDB migration in the background; UI polls /mdb-migrate/progress."""
    global _runner
    if payload.password != CLEAR_DB_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Incorrect maintenance password.",
        )
    if not payload.selected_keys:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least one table to migrate.",
        )
    if mdb.job_status().get("running"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An MDB migration is already running.",
        )

    try:
        resolved_path = mdb.resolve_mdb_path(
            file_token=payload.file_token,
            mdb_path=payload.mdb_path,
        )
    except Exception as exc:  # noqa: BLE001
        raise _bad(exc) from exc

    mdb.mark_started()

    async def runner() -> None:
        try:
            async with get_session_factory()() as session:
                await mdb.run_mdb_migration(
                    mdb_path=resolved_path,
                    mdb_password=payload.mdb_password,
                    selected_keys=payload.selected_keys,
                    replace_existing=payload.replace_existing,
                    dry_run=payload.dry_run,
                    app_session=session,
                )
        except Exception as exc:  # noqa: BLE001
            detail = str(getattr(exc, "orig", exc) or exc)
            mdb.mark_failed(detail)

    def _finished(task: asyncio.Task) -> None:
        if not mdb.job_status().get("running"):
            return
        if task.cancelled():
            mdb.mark_failed("Migration was cancelled.")
            return
        exc = task.exception()
        detail = str(getattr(exc, "orig", exc) or exc) if exc else "Migration stopped unexpectedly."
        mdb.mark_failed(detail)

    _runner = asyncio.create_task(runner())
    _runner.add_done_callback(_finished)
    return {"ok": True, "message": "MDB migration started."}


@router.get("/mdb-migrate/progress")
async def mdb_migrate_progress(_: User = Depends(require_admin)) -> dict:
    task = _runner
    if task is not None and task.done() and mdb.job_status().get("running"):
        if task.cancelled():
            mdb.mark_failed("Migration was cancelled.")
        else:
            exc = task.exception()
            detail = str(getattr(exc, "orig", exc) or exc) if exc else "Migration stopped unexpectedly."
            mdb.mark_failed(detail)
    return mdb.job_status()
