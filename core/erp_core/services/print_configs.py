from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.models.masters import PrintConfig
from erp_core.product_config import module_enabled
from erp_core.repositories.print_configs import PrintConfigRepository
from erp_core.schemas.print_configs import PrintConfigCreate, PrintConfigRead, PrintConfigUpdate


class PrintConfigService:
    def __init__(self, session: AsyncSession):
        self.repo = PrintConfigRepository(session)

    # ── optional hospital enrichment (single-service OPD bill templates) ──────

    async def single_service_options(self) -> list[tuple[str, str]]:
        """Active single-service OPD options as (id, name); [] when hospital is not enabled."""
        try:
            if not module_enabled("hospital"):
                return []
            from modules.hospital.hms.models.single_service_opd import SingleServiceOpdOption

            # Savepoint: a missing table must not poison the caller's transaction.
            async with self.repo.session.begin_nested():
                result = await self.repo.session.execute(
                    select(SingleServiceOpdOption.id, SingleServiceOpdOption.name)
                    .where(SingleServiceOpdOption.is_active.is_(True))
                    .order_by(SingleServiceOpdOption.sort_order, SingleServiceOpdOption.name)
                )
                return [(str(option_id), name) for option_id, name in result.all()]
        except Exception:
            return []

    async def single_service_option_name(self, option_id: str) -> str | None:
        """Name of an active single-service OPD option, or None when missing / hospital disabled."""
        try:
            if not module_enabled("hospital"):
                return None
            from modules.hospital.hms.models.single_service_opd import SingleServiceOpdOption

            async with self.repo.session.begin_nested():
                result = await self.repo.session.execute(
                    select(SingleServiceOpdOption.name, SingleServiceOpdOption.is_active).where(
                        SingleServiceOpdOption.id == option_id
                    )
                )
                row = result.first()
            if row is None or not row[1]:
                return None
            return (row[0] or "").strip() or "Single Service OPD Bill"
        except Exception:
            return None

    # ── layouts ───────────────────────────────────────────────────────────────

    async def designed_layout_entries(self) -> list[tuple[str, Any]]:
        """Newest designed templates first, so a shared page keeps one design."""
        result = await self.repo.session.execute(
            select(PrintConfig.code, PrintConfig.layout_options)
            .where(PrintConfig.layout_options.is_not(None))
            .order_by(PrintConfig.updated_at.desc())
        )
        return [(str(code), layout) for code, layout in result.all()]

    # ── CRUD ──────────────────────────────────────────────────────────────────

    async def list_configs(self) -> list[PrintConfigRead]:
        items = await self.repo.list_active()
        return [PrintConfigRead.model_validate(item) for item in items]

    async def get_config(self, config_id: str) -> PrintConfigRead:
        item = await self.repo.get_by_id(config_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Print config not found")
        return PrintConfigRead.model_validate(item)

    async def get_config_by_code(self, code: str) -> PrintConfigRead:
        item = await self.repo.get_by_code(code)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Print config not found")
        return PrintConfigRead.model_validate(item)

    async def create_config(self, data: PrintConfigCreate) -> PrintConfigRead:
        code = data.code.strip().upper()
        existing = await self.repo.get_by_code(code)
        if existing:
            if existing.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Print config code already exists",
                )
            self._apply_create_fields(existing, data)
            existing.is_active = True
            await self.repo.session.flush()
            await self.repo.session.refresh(existing)
            return PrintConfigRead.model_validate(existing)

        item = PrintConfig(
            code=code,
            name=data.name.strip(),
            printer_name=(data.printer_name.strip() if data.printer_name else None),
            paper_size=data.paper_size,
            custom_width_mm=data.custom_width_mm,
            custom_height_mm=data.custom_height_mm,
            orientation=data.orientation,
            print_mode=data.print_mode,
            margin_top_mm=data.margin_top_mm,
            margin_right_mm=data.margin_right_mm,
            margin_bottom_mm=data.margin_bottom_mm,
            margin_left_mm=data.margin_left_mm,
            copies=data.copies,
            sort_order=data.sort_order,
            is_active=True,
        )
        self.repo.session.add(item)
        await self.repo.session.flush()
        await self.repo.session.refresh(item)
        return PrintConfigRead.model_validate(item)

    async def update_config(self, config_id: str, data: PrintConfigUpdate) -> PrintConfigRead:
        item = await self.repo.get_by_id(config_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Print config not found")
        for field, value in data.model_dump(exclude_unset=True).items():
            if field == "name" and value is not None:
                value = value.strip()
            elif field == "printer_name":
                value = value.strip() if value else None
            setattr(item, field, value)
        if item.paper_size == "CUSTOM" and (not item.custom_width_mm or not item.custom_height_mm):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Custom width and height (mm) are required for CUSTOM paper size",
            )
        await self.repo.session.flush()
        await self.repo.session.refresh(item)
        return PrintConfigRead.model_validate(item)

    async def delete_config(self, config_id: str) -> PrintConfigRead:
        item = await self.repo.get_by_id(config_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Print config not found")
        item.is_active = False
        await self.repo.session.flush()
        await self.repo.session.refresh(item)
        return PrintConfigRead.model_validate(item)

    @staticmethod
    def _apply_create_fields(item: PrintConfig, data: PrintConfigCreate) -> None:
        item.name = data.name.strip()
        item.printer_name = data.printer_name.strip() if data.printer_name else None
        item.paper_size = data.paper_size
        item.custom_width_mm = data.custom_width_mm
        item.custom_height_mm = data.custom_height_mm
        item.orientation = data.orientation
        item.print_mode = data.print_mode
        item.margin_top_mm = data.margin_top_mm
        item.margin_right_mm = data.margin_right_mm
        item.margin_bottom_mm = data.margin_bottom_mm
        item.margin_left_mm = data.margin_left_mm
        item.copies = data.copies
        item.sort_order = data.sort_order
