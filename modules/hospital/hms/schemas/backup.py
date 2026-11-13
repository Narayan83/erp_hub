from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class BackupSettingsUpdate(BaseModel):
    enabled: bool = False
    backup_time: str = "22:00"
    directory: str | None = Field(None, max_length=500)
    keep_days: int = Field(30, ge=1, le=365)

    @field_validator("backup_time")
    @classmethod
    def check_time(cls, value: str) -> str:
        text = (value or "").strip()
        parts = text.split(":")
        if (
            len(parts) != 2
            or len(parts[0]) != 2
            or len(parts[1]) != 2
            or not parts[0].isdigit()
            or not parts[1].isdigit()
        ):
            raise ValueError("Backup time must be HH:MM in 24-hour form, for example 22:00.")
        hour, minute = int(parts[0]), int(parts[1])
        if hour > 23 or minute > 59:
            raise ValueError("Backup time must be HH:MM in 24-hour form, for example 22:00.")
        return f"{hour:02d}:{minute:02d}"

    @field_validator("directory")
    @classmethod
    def blank_directory(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class BackupSettingsRead(BaseModel):
    enabled: bool
    backup_time: str
    directory: str | None
    keep_days: int
    last_backup_at: datetime | None
    last_backup_status: str | None
    last_backup_file: str | None
    scheduler_note: str
