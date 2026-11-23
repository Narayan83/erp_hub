"""Previous hospital version (PostgreSQL) → this database."""

from __future__ import annotations

import asyncio
import contextlib
import json

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.database import get_session_factory
from modules.hospital.hms.api.deps import get_session
from modules.hospital.hms.api.v1.endpoints.admin import CLEAR_DB_PASSWORD, require_admin
from modules.hospital.hms.models.user import User
from modules.hospital.hms.services import previous_hospital_migration as prev

router = APIRouter()
_runner: asyncio.Task | None = None


class SourceRequest(BaseModel):
    source_url: str = Field(default=prev.DEFAULT_SOURCE_URL)


class RunRequest(BaseModel):
    password: str
    source_url: str = Field(default=prev.DEFAULT_SOURCE_URL)
    selected_keys: list[str] = Field(default_factory=list)
    replace_existing: bool = True
    dry_run: bool = False


def _bad(exc: Exception) -> HTTPException:
    detail = str(getattr(exc, "orig", exc) or exc)
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


@router.get("/previous-migrate/defaults")
async def previous_migrate_defaults(_: User = Depends(require_admin)) -> dict:
    return {
        "source_url": prev.DEFAULT_SOURCE_URL,
        "target_url": prev.display_postgres_url(),
        "maintenance_password_hint": "Same password as Reset Database",
        "notes": (
            "Copies a hospital that is still on the previous version "
            "(PostgreSQL database, usually named hms) into this version."
        ),
    }


@router.post("/previous-migrate/test")
async def previous_migrate_test(
    payload: SourceRequest,
    _: User = Depends(require_admin),
) -> dict:
    try:
        return await prev.test_source(payload.source_url)
    except Exception as exc:  # noqa: BLE001
        raise _bad(exc) from exc


@router.post("/previous-migrate/preview")
async def previous_migrate_preview(
    payload: SourceRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict:
    try:
        tables = await prev.list_common_tables(payload.source_url, session)
    except Exception as exc:  # noqa: BLE001
        raise _bad(exc) from exc
    return {"tables": tables, "target_url": prev.display_postgres_url()}


@router.post("/previous-migrate/run")
async def previous_migrate_run(
    payload: RunRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict:
    if payload.password != CLEAR_DB_PASSWORD:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Incorrect maintenance password.")
    try:
        return await prev.run_migration(
            source_url=payload.source_url,
            selected_keys=payload.selected_keys,
            replace_existing=payload.replace_existing,
            dry_run=payload.dry_run,
            app_session=session,
        )
    except Exception as exc:  # noqa: BLE001
        raise _bad(exc) from exc


@router.post("/previous-migrate/run-stream")
async def previous_migrate_run_stream(
    payload: RunRequest,
    _: User = Depends(require_admin),
) -> StreamingResponse:
    if payload.password != CLEAR_DB_PASSWORD:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Incorrect maintenance password.")
    if not payload.selected_keys:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least one table to copy.",
        )

    queue: asyncio.Queue = asyncio.Queue()

    async def progress(event: dict) -> None:
        await queue.put(event)

    async def runner() -> None:
        try:
            async with get_session_factory()() as session:
                await prev.run_migration(
                    source_url=payload.source_url,
                    selected_keys=payload.selected_keys,
                    replace_existing=payload.replace_existing,
                    dry_run=payload.dry_run,
                    app_session=session,
                    progress=progress,
                )
        except Exception as exc:  # noqa: BLE001
            await queue.put({"type": "error", "message": prev.public_error(exc)})
        finally:
            await queue.put(None)

    async def generate():
        task = asyncio.create_task(runner())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield json.dumps(event, default=str) + "\n"
        finally:
            if not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/previous-migrate/start")
async def previous_migrate_start(
    payload: RunRequest,
    _: User = Depends(require_admin),
) -> dict:
    """Start the copy and return immediately. The page polls /progress."""
    global _runner
    if payload.password != CLEAR_DB_PASSWORD:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Incorrect maintenance password.")
    if not payload.selected_keys:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least one table to copy.",
        )
    if prev.job_status().get("running"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A migration is already running.",
        )
    prev.mark_started()

    async def runner() -> None:
        try:
            async with get_session_factory()() as session:
                await prev.run_migration(
                    source_url=payload.source_url,
                    selected_keys=payload.selected_keys,
                    replace_existing=payload.replace_existing,
                    dry_run=payload.dry_run,
                    app_session=session,
                )
        except Exception as exc:  # noqa: BLE001
            if not prev.job_status().get("error"):
                prev.mark_failed(prev.public_error(exc))

    def _finished(task: asyncio.Task) -> None:
        if not prev.job_status().get("running"):
            return
        if task.cancelled():
            prev.mark_failed("Migration was cancelled.")
            return
        exc = task.exception()
        prev.mark_failed(prev.public_error(exc) if exc else "Migration stopped before it finished.")

    _runner = asyncio.create_task(runner())
    _runner.add_done_callback(_finished)
    return {"ok": True, "message": "Migration started."}


@router.get("/previous-migrate/progress")
async def previous_migrate_progress(_: User = Depends(require_admin)) -> dict:
    task = _runner
    if task is not None and task.done() and prev.job_status().get("running"):
        if task.cancelled():
            prev.mark_failed("Migration was cancelled.")
        else:
            exc = task.exception()
            prev.mark_failed(
                prev.public_error(exc) if exc else "Migration stopped before it finished."
            )
    return prev.job_status()
