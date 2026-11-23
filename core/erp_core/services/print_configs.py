from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.models.auth import Menu
from erp_core.models.masters import PrintConfig
from erp_core.printing.layouts import KIND_BILL
from erp_core.product_config import enabled_modules, module_enabled
from erp_core.repositories.print_configs import PrintConfigRepository
from erp_core.schemas.print_configs import PrintConfigCreate, PrintConfigRead, PrintConfigUpdate

_EXCLUDED_MENU_CODES = frozenset({"print_master", "print_template_designer"})


def _with_local_printer(item: PrintConfig) -> PrintConfigRead:
    """Page settings stay on the product. The counter's printer is its own print dialog."""
    data = PrintConfigRead.model_validate(item)
    return data.model_copy(update={"printer_name": None})


class PrintConfigService:
    def __init__(self, session: AsyncSession, product: str | None = None):
        self.repo = PrintConfigRepository(session, product=product)

    # ── optional hospital enrichment (single-service OPD bill templates) ──────

    async def single_service_option_details(self) -> list[tuple[str, str, str]]:
        """Active single-service OPD options as (id, name, menu_code); [] when hospital is disabled."""
        try:
            if not module_enabled("hospital"):
                return []
            from modules.hospital.hms.models.single_service_opd import SingleServiceOpdOption

            # Savepoint: a missing table must not poison the caller's transaction.
            async with self.repo.session.begin_nested():
                result = await self.repo.session.execute(
                    select(
                        SingleServiceOpdOption.id,
                        SingleServiceOpdOption.name,
                        SingleServiceOpdOption.menu_code,
                    )
                    .where(SingleServiceOpdOption.is_active.is_(True))
                    .order_by(SingleServiceOpdOption.sort_order, SingleServiceOpdOption.name)
                )
                return [
                    (str(option_id), str(name or ""), str(menu_code or ""))
                    for option_id, name, menu_code in result.all()
                ]
        except Exception:
            return []

    async def single_service_options(self) -> list[tuple[str, str]]:
        """Active single-service OPD options as (id, name); [] when hospital is not enabled."""
        details = await self.single_service_option_details()
        return [(option_id, name) for option_id, name, _menu_code in details]

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

    # ── product-scoped menu & document catalog ────────────────────────────────

    async def active_product_menus(self) -> list[tuple[str, str]]:
        """Active leaf menus for the running product in sidebar tree order."""
        active_modules = set(enabled_modules())
        rows = (
            await self.repo.session.execute(
                select(Menu)
                .where(Menu.is_active.is_(True), Menu.module.in_(active_modules))
                .order_by(Menu.sort_order, Menu.label)
            )
        ).scalars().all()
        if not rows:
            return []

        parent_ids = {m.parent_id for m in rows if m.parent_id}
        by_parent: dict[str | None, list[Menu]] = {}
        for menu in rows:
            by_parent.setdefault(menu.parent_id, []).append(menu)

        ordered: list[tuple[str, str]] = []
        visited: set[str] = set()

        def walk(parent_id: str | None) -> None:
            for menu in by_parent.get(parent_id, []):
                if menu.id in visited:
                    continue
                visited.add(menu.id)
                if menu.id in parent_ids:
                    walk(menu.id)
                    continue
                code = (menu.code or "").strip()
                if not code or code.lower() in _EXCLUDED_MENU_CODES:
                    continue
                ordered.append((code, (menu.label or code).strip()))

        walk(None)
        # Include any active leaf whose parent was inactive/missing so nothing is dropped.
        for menu in rows:
            if menu.id in visited or menu.id in parent_ids:
                continue
            code = (menu.code or "").strip()
            if not code or code.lower() in _EXCLUDED_MENU_CODES:
                continue
            ordered.append((code, (menu.label or code).strip()))
        return ordered

    async def product_documents(self) -> list[dict[str, str]]:
        """Designer menu list: active menus of the running product only."""
        docs: list[dict[str, str]] = []
        seen_codes: set[str] = set()
        for menu_code, menu_label in await self.active_product_menus():
            doc_code = menu_code.upper()
            if doc_code in seen_codes:
                continue
            docs.append(
                {
                    "code": doc_code,
                    "name": menu_label,
                    "kind": KIND_BILL,
                    "menu_code": menu_code,
                }
            )
            seen_codes.add(doc_code)
        return docs

    async def resolve_document(self, code: str) -> tuple[str, str] | None:
        """Resolve a document code strictly within the active product's catalog."""
        code_u = (code or "").strip().upper()
        if not code_u:
            return None
        for doc in await self.product_documents():
            if doc["code"] == code_u:
                return doc["code"], doc["name"]
        return None

    # ── layouts ───────────────────────────────────────────────────────────────

    async def designed_layout_entries(self) -> list[tuple[str, Any]]:
        """Newest designed templates first, scoped strictly to the active product."""
        result = await self.repo.session.execute(
            select(PrintConfig.code, PrintConfig.layout_options)
            .where(
                PrintConfig.product == self.repo.product,
                PrintConfig.is_active.is_(True),
                PrintConfig.layout_options.is_not(None),
            )
            .order_by(PrintConfig.updated_at.desc())
        )
        return [(str(code), layout) for code, layout in result.all()]

    # ── CRUD ──────────────────────────────────────────────────────────────────

    async def list_configs(self) -> list[PrintConfigRead]:
        items = await self.repo.list_active()
        return [_with_local_printer(item) for item in items]

    async def get_config(self, config_id: str) -> PrintConfigRead:
        item = await self.repo.get_by_id(config_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Print config not found")
        return _with_local_printer(item)

    async def get_config_by_code(self, code: str) -> PrintConfigRead:
        item = await self.repo.get_by_code(code)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Print config not found")
        return _with_local_printer(item)

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
            return _with_local_printer(existing)

        item = PrintConfig(
            product=self.repo.product,
            code=code,
            name=data.name.strip(),
            # Printer is per-PC (print.ini), not shared in the database.
            printer_name=None,
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
        return _with_local_printer(item)

    async def update_config(self, config_id: str, data: PrintConfigUpdate) -> PrintConfigRead:
        item = await self.repo.get_by_id(config_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Print config not found")
        payload = data.model_dump(exclude_unset=True)
        payload.pop("printer_name", None)
        for field, value in payload.items():
            if field == "name" and value is not None:
                value = value.strip()
            setattr(item, field, value)
        item.printer_name = None
        if item.paper_size == "CUSTOM" and (not item.custom_width_mm or not item.custom_height_mm):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Custom width and height (mm) are required for CUSTOM paper size",
            )
        await self.repo.session.flush()
        await self.repo.session.refresh(item)
        return _with_local_printer(item)

    async def delete_config(self, config_id: str) -> PrintConfigRead:
        item = await self.repo.get_by_id(config_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Print config not found")
        item.is_active = False
        await self.repo.session.flush()
        await self.repo.session.refresh(item)
        return _with_local_printer(item)

    @staticmethod
    def _apply_create_fields(item: PrintConfig, data: PrintConfigCreate) -> None:
        item.name = data.name.strip()
        item.printer_name = None
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
