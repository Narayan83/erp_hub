from pathlib import Path
from uuid import UUID

from fastapi import HTTPException, UploadFile

from modules.kramcop.kc.kramcop_env import resolve_storage_root

ALLOWED = {".jpg", ".jpeg", ".png", ".webp"}
MAX_BYTES = 3 * 1024 * 1024


def uploads_dir() -> Path:
    path = resolve_storage_root() / "uploads" / "members"
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve_member_file(stored: str) -> Path | None:
    if not stored:
        return None
    path = uploads_dir() / Path(stored).name
    if path.is_file():
        return path
    return None


async def save_member_file(member_id: UUID, kind: str, file: UploadFile) -> str:
    suffix = Path(file.filename or "photo.jpg").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(status_code=400, detail="Use JPG, PNG or WEBP")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="File must be under 3 MB")
    name = f"{member_id}_{kind}{suffix}"
    dest = uploads_dir() / name
    dest.write_bytes(data)
    return name
