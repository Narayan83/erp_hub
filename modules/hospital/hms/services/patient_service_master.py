from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.models.patient_service_master import PatientServiceMaster
from modules.hospital.hms.models.service_group import ServiceGroup
from modules.hospital.hms.repositories.patient_service_master import PatientServiceMasterRepository
from modules.hospital.hms.schemas.patient_service_master import (
    PatientServiceImportResult,
    PatientServiceMasterCreate,
    PatientServiceMasterRead,
    PatientServiceMasterUpdate,
)
from modules.hospital.hms.services.patient_service_import import (
    interpret_service_rows,
    load_service_table,
)


class PatientServiceMasterService:
    PATHOLOGY_CATEGORY_CODE = "LAB"

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = PatientServiceMasterRepository(session)

    def _to_read(self, item: PatientServiceMaster) -> PatientServiceMasterRead:
        read = PatientServiceMasterRead.model_validate(item)
        if item.doctor:
            read = read.model_copy(update={"doctor_name": item.doctor.full_name})
        if item.group:
            read = read.model_copy(update={"group_name": item.group.name})
        if item.sub_category:
            read = read.model_copy(update={"sub_category_name": item.sub_category.name})
        return read

    async def list_services(self) -> list[PatientServiceMasterRead]:
        items = await self.repo.list_active(
            exclude_group_codes=(self.PATHOLOGY_CATEGORY_CODE,)
        )
        return [self._to_read(item) for item in items]

    async def _ensure_patient_service_group(self, group_id: str | None) -> None:
        if not group_id:
            return
        group = (
            await self.session.execute(
                select(ServiceGroup).where(ServiceGroup.id == group_id)
            )
        ).scalar_one_or_none()
        if group and group.code == self.PATHOLOGY_CATEGORY_CODE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Pathology services must be managed from Pathology, not Patient Service Master",
            )

    async def get_service(self, service_id: str) -> PatientServiceMasterRead:
        item = await self.repo.get_by_id(service_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")
        await self._ensure_patient_service_group(item.group_id)
        return self._to_read(item)

    async def create_service(self, data: PatientServiceMasterCreate) -> PatientServiceMasterRead:
        raw_code = (data.code or "").strip()
        code = raw_code.upper() if raw_code else await self.repo.next_auto_code()
        await self._ensure_patient_service_group(data.group_id)
        existing = await self.repo.get_by_code(code)
        if existing:
            if existing.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Service code already exists",
                )
            for field, value in data.model_dump().items():
                if field == "code":
                    continue
                if field == "name" and value is not None:
                    value = value.strip()
                setattr(existing, field, value)
            if not existing.is_sharing:
                existing.doctor_id = None
            if not existing.is_renewal:
                existing.renewal_days = None
            if existing.is_service_active:
                existing.close_date = None
            self._validate_item(existing)
            existing.is_active = True
            await self.repo.session.flush()
            await self.repo.session.refresh(existing)
            item = await self.repo.get_by_id(existing.id)
            return self._to_read(item)  # type: ignore[arg-type]

        item = PatientServiceMaster(
            code=code,
            name=data.name.strip(),
            **data.model_dump(exclude={"code", "name"}),
        )
        self._validate_item(item)
        self.repo.session.add(item)
        await self.repo.session.flush()
        await self.repo.session.refresh(item)
        loaded = await self.repo.get_by_id(item.id)
        return self._to_read(loaded)  # type: ignore[arg-type]

    def _validate_item(self, item: PatientServiceMaster) -> None:
        if item.is_sharing and not item.doctor_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Doctor is required when sharing is enabled",
            )
        if item.is_renewal and item.renewal_days is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Renewal days is required when renewal is enabled",
            )
        if not item.is_service_active and not item.close_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Close date is required when status is closed",
            )

    async def update_service(
        self, service_id: str, data: PatientServiceMasterUpdate
    ) -> PatientServiceMasterRead:
        item = await self.repo.get_by_id(service_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

        for field, value in data.model_dump(exclude_unset=True).items():
            if field == "name" and value is not None:
                value = value.strip()
            setattr(item, field, value)
        await self._ensure_patient_service_group(item.group_id)
        if not item.is_sharing:
            item.doctor_id = None
        if not item.is_renewal:
            item.renewal_days = None
        if item.is_service_active:
            item.close_date = None
        self._validate_item(item)

        await self.repo.session.flush()
        loaded = await self.repo.get_by_id(item.id)
        return self._to_read(loaded)  # type: ignore[arg-type]

    async def delete_service(self, service_id: str) -> PatientServiceMasterRead:
        item = await self.repo.get_by_id(service_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")
        await self._ensure_patient_service_group(item.group_id)
        item.is_active = False
        await self.repo.session.flush()
        loaded = await self.repo.get_by_id(item.id)
        return self._to_read(loaded)  # type: ignore[arg-type]

    async def import_file(self, data: bytes, filename: str) -> PatientServiceImportResult:
        try:
            table = load_service_table(data, filename)
            rows = interpret_service_rows(table)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        created = 0
        auto = 0
        errors: list[str] = []
        used: set[str] = set()
        for row in rows:
            if row.error:
                errors.append(f"Row {row.row_number}: {row.error}")
                continue
            if row.code and row.code in used:
                errors.append(f"Row {row.row_number}: Code {row.code} is repeated in this file")
                continue
            if row.code:
                existing = await self.repo.get_by_code(row.code)
                if existing and existing.is_active:
                    errors.append(f"Row {row.row_number}: Code {row.code} already exists")
                    used.add(row.code)
                    continue
                used.add(row.code)
            payload = PatientServiceMasterCreate(
                code=row.code,
                name=row.name,
                rate=row.rate,
                service_charge=row.service_charge,
            )
            try:
                async with self.session.begin_nested():
                    saved = await self.create_service(payload)
            except HTTPException as exc:
                detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
                errors.append(f"Row {row.row_number}: {detail}")
                continue
            except IntegrityError:
                errors.append(
                    f"Row {row.row_number}: Code {row.code or ''} already exists".rstrip()
                )
                continue
            created += 1
            if row.auto_code:
                auto += 1
            if saved.code:
                used.add(saved.code.strip().upper())

        shown = errors[:80]
        if len(errors) > 80:
            shown.append(f"… {len(errors) - 80} more")
        return PatientServiceImportResult(
            created=created,
            skipped=len(errors),
            errors=shown,
            message=_import_message(created, auto, len(errors)),
        )


def _import_message(created: int, auto: int, errors: int) -> str:
    if created == 0 and errors == 0:
        return "No service rows found. Fill Name and Rate on the Services sheet, then import again."
    noun = "service" if created == 1 else "services"
    parts = [f"Imported {created} {noun}."]
    if auto:
        word = "code was" if auto == 1 else "codes were"
        parts.append(f"{auto} {word} generated automatically.")
    if errors:
        word = "row was" if errors == 1 else "rows were"
        parts.append(f"{errors} {word} skipped.")
    return " ".join(parts)
