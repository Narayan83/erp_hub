"""Shortcut buttons for whichever product is running.

Menus come from the shared menu table filtered to this product. A new product
json picks the feature up with no extra shortcut table of its own.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.models.auth import Menu, User
from erp_core.models.dashboard_shortcut import DashboardShortcut
from erp_core.product_config import enabled_modules
from erp_core.schemas.dashboard_shortcut import (
    DashboardShortcutBulkSave,
    DashboardShortcutCreate,
    DashboardShortcutRead,
)

DEFAULT_HOST = "dashboard"
EMPTY_MARKER = "_empty"
HIDDEN_FROM_PICKER = {
    "dashboard",
    "dashboard_shortcut_setup",
    "dashboard_shortcuts",
    "print_template_designer",
}

# Seeded only when that menu exists in the current product.
# "New Patient" is intentionally absent — it was never a menu.
HOST_DEFAULT_SHORTCUTS: dict[str, tuple[tuple[str, str, str, int], ...]] = {
    "dashboard": (
        ("opd_bill", "OPD", "Outpatient billing", 1),
        ("ipd_bill", "IPD", "Inpatient billing", 2),
        ("pathology_bill", "Pathology", "Pathology billing", 3),
        ("doctor_wise_collection_report", "Doctor Collection", "Doctor wise collection report", 4),
    ),
    "opd_bill": (
        ("patient_service_creation", "Service Creation", "Patient service creation", 1),
        ("opd_bill_reprint", "Reprint Bill", "OPD bill reprint", 2),
        ("pathology_bill", "Pathology Bill", "Pathology billing", 3),
        ("advance_collection", "Collect Advance", "Advance collection", 4),
        ("in_patient_admission", "IPD Admission", "IPD admission", 5),
        ("ipd_bill", "IPD Bill", "Inpatient billing", 6),
    ),
    "in_patient_discharge": (
        ("ipd_bill", "Admitted List", "IPD bill / admitted list", 1),
        ("ipd_bill_reprint", "Reprint Bill", "IPD bill reprint", 2),
        ("diagnose_management", "Discharge Summary", "Discharge summary", 3),
        ("advance_collection", "Collect Advance", "Advance collection", 4),
        ("in_patient_admission", "IPD Admission", "IPD admission", 5),
    ),
    "ipd_bill": (
        ("in_patient_admission", "IPD Admission", "IPD admission", 1),
        ("in_patient_discharge", "Discharge", "IPD discharge", 2),
        ("ipd_bill_reprint", "Reprint Bill", "IPD bill reprint", 3),
        ("advance_collection", "Collect Advance", "Advance collection", 4),
        ("opd_bill", "OPD Bill", "Outpatient billing", 5),
    ),
    "pathology_bill": (
        ("pathology_bill_reprint", "Reprint Bill", "Pathology bill reprint", 1),
        ("opd_bill", "OPD Bill", "Outpatient billing", 2),
        ("advance_collection", "Collect Advance", "Advance collection", 3),
    ),
}

# Hardcoded chips that are not menu names. Drop them wherever they were copied.
PHANTOM_SHORTCUTS = (("patient_master", "New Patient"),)

# Two hospital menus share the label "Patient Master". The shortcut list has to
# say which screen will actually open.
AMBIGUOUS_PICKER = {
    "patient_master": "Patient Creation",
    "party_master": "Patient Master (Party)",
}


def _is_seeded_new_patient(row) -> bool:
    """Built-in OPD/IPD chip. It was not a menu, so it is not kept."""
    return (getattr(row, "module_code", None), getattr(row, "button_label", None)) in PHANTOM_SHORTCUTS


def _norm_host(code: str | None) -> str:
    value = (code or DEFAULT_HOST).strip().lower()
    return value or DEFAULT_HOST


class DashboardShortcutService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self._leaves: list[Menu] | None = None
        self._by_id: dict[str, Menu] | None = None

    async def list_shortcuts(
        self,
        user: User,
        *,
        host_code: str = DEFAULT_HOST,
        active_only: bool = True,
    ) -> list[DashboardShortcutRead]:
        await self._prepare()
        host = _norm_host(host_code)
        allowed = await self._allowed_codes()
        rows = await self._rows_for_user(user.id, host)
        if active_only:
            rows = [row for row in rows if row.is_active]
        rows = [row for row in rows if row.module_code in allowed]
        return [DashboardShortcutRead.model_validate(row) for row in rows]

    async def list_available_menus(self, *, host_code: str = DEFAULT_HOST) -> list[dict]:
        host = _norm_host(host_code)
        leaves = await self._leaf_menus()
        by_id = await self._menus_by_id()
        label_counts: dict[str, int] = {}
        for menu in leaves:
            label_counts[menu.label] = label_counts.get(menu.label, 0) + 1
        items = []
        for menu in leaves:
            if menu.code in HIDDEN_FROM_PICKER or menu.code == host:
                continue
            parent = by_id.get(menu.parent_id) if menu.parent_id else None
            ambiguous = label_counts.get(menu.label, 0) > 1
            items.append(
                {
                    "code": menu.code,
                    "label": menu.label,
                    "picker_label": self._picker_label(menu, parent.label if parent else "", ambiguous),
                    "parent_id": menu.parent_id,
                }
            )
        items.sort(key=lambda row: (row["picker_label"].lower(), row["code"]))
        return items

    async def ensure_defaults(self) -> None:
        allowed = await self._allowed_codes()
        seeded = False
        for host, items in HOST_DEFAULT_SHORTCUTS.items():
            if host != DEFAULT_HOST and host not in allowed:
                continue
            usable = [item for item in items if item[0] in allowed and item[0] != host]
            if not usable:
                continue
            result = await self.session.execute(
                select(DashboardShortcut.id)
                .where(
                    DashboardShortcut.user_id.is_(None),
                    DashboardShortcut.host_code == host,
                )
                .limit(1)
            )
            if result.scalar_one_or_none():
                continue
            for code, label, desc, order in usable:
                self.session.add(
                    DashboardShortcut(
                        user_id=None,
                        host_code=host,
                        module_code=code,
                        button_label=label,
                        description=desc,
                        sort_order=order,
                        is_active=True,
                    )
                )
            seeded = True
        if seeded:
            await self.session.flush()

    async def save_all(self, user: User, data: DashboardShortcutBulkSave) -> list[DashboardShortcutRead]:
        await self._prepare()
        host = _norm_host(data.host_code)
        cleaned = []
        for item in data.items:
            if not await self._can_pin(host, item.module_code):
                continue
            cleaned.append(item)
        await self._replace_user_host(user.id, host, cleaned)
        return await self.list_shortcuts(user, host_code=host, active_only=False)

    async def create_shortcut(self, user: User, data: DashboardShortcutCreate) -> DashboardShortcutRead:
        await self._prepare()
        host = _norm_host(data.host_code)
        module_code = data.module_code.strip()
        if not await self._can_pin(host, module_code):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That menu cannot be pinned here")
        existing = await self._owned_rows(user.id, host)
        allowed = await self._allowed_codes()
        if not existing:
            shared = await self._shared_rows(host)
            for row in shared:
                if row.module_code == module_code or row.module_code not in allowed:
                    continue
                if _is_seeded_new_patient(row):
                    continue
                self.session.add(self._copy_row(row, user.id))
        else:
            for row in existing:
                if row.module_code == module_code:
                    row.button_label = data.button_label.strip()
                    row.description = (data.description or "").strip() or None
                    row.is_active = data.is_active
                    await self.session.flush()
                    return DashboardShortcutRead.model_validate(row)
            for row in list(existing):
                if row.module_code.startswith("_"):
                    await self.session.delete(row)
        created = DashboardShortcut(
            user_id=user.id,
            host_code=host,
            module_code=module_code,
            button_label=data.button_label.strip(),
            description=(data.description or "").strip() or None,
            sort_order=data.sort_order or 999,
            is_active=data.is_active,
        )
        self.session.add(created)
        await self.session.flush()
        return DashboardShortcutRead.model_validate(created)

    async def delete_shortcut(self, user: User, shortcut_id: str) -> None:
        await self._prepare()
        row = await self.session.get(DashboardShortcut, shortcut_id)
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shortcut not found")
        host = row.host_code or DEFAULT_HOST
        if row.user_id and row.user_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shortcut not found")
        allowed = await self._allowed_codes()
        if row.user_id is None:
            shared = [
                item
                for item in await self._shared_rows(host)
                if item.id != row.id
                and not item.module_code.startswith("_")
                and item.module_code in allowed
                and not _is_seeded_new_patient(item)
            ]
            await self._replace_user_host(
                user.id,
                host,
                [
                    type(
                        "Item",
                        (),
                        {
                            "module_code": item.module_code,
                            "button_label": item.button_label,
                            "description": item.description,
                            "sort_order": item.sort_order,
                            "is_active": item.is_active,
                        },
                    )()
                    for item in shared
                ],
            )
            return
        await self.session.delete(row)
        await self.session.flush()
        remaining = [
            item for item in await self._owned_rows(user.id, host) if not item.module_code.startswith("_")
        ]
        if not remaining:
            self.session.add(
                DashboardShortcut(
                    user_id=user.id,
                    host_code=host,
                    module_code=EMPTY_MARKER,
                    button_label="(none)",
                    sort_order=0,
                    is_active=False,
                )
            )
            await self.session.flush()

    async def _prepare(self) -> None:
        await self._import_legacy_rows()
        await self._purge_phantoms()
        await self.ensure_defaults()

    async def _import_legacy_rows(self) -> None:
        """Copy hospital.dashboard_shortcuts into the shared table once."""
        existing = await self.session.scalar(select(func.count()).select_from(DashboardShortcut))
        if existing:
            return
        reg = await self.session.scalar(text("SELECT to_regclass('hospital.dashboard_shortcuts')"))
        if not reg:
            return
        schema = DashboardShortcut.__table__.schema or "core"
        await self.session.execute(
            text(
                f"""
                INSERT INTO {schema}.dashboard_shortcuts (
                    id, user_id, host_code, module_code, button_label,
                    description, sort_order, is_active, created_at, updated_at
                )
                SELECT
                    id, user_id, host_code, module_code, button_label,
                    description, sort_order, is_active, created_at, updated_at
                FROM hospital.dashboard_shortcuts
                WHERE NOT (
                    module_code = 'patient_master' AND button_label = 'New Patient'
                )
                ON CONFLICT (id) DO NOTHING
                """
            )
        )
        await self.session.flush()

    async def _purge_phantoms(self) -> None:
        result = await self.session.execute(select(DashboardShortcut))
        doomed = [row for row in result.scalars().all() if _is_seeded_new_patient(row)]
        if not doomed:
            return
        for row in doomed:
            await self.session.delete(row)
        await self.session.flush()

    async def _can_pin(self, host: str, module_code: str) -> bool:
        code = (module_code or "").strip()
        if not code or code in HIDDEN_FROM_PICKER or code.startswith("_") or code == host:
            return False
        leaves = await self._leaf_menus()
        return any(menu.code == code for menu in leaves)

    async def _allowed_codes(self) -> set[str]:
        return {menu.code for menu in await self._leaf_menus()}

    async def _leaf_menus(self) -> list[Menu]:
        if self._leaves is not None:
            return self._leaves
        menus = list((await self._menus_by_id()).values())
        parent_ids = {menu.parent_id for menu in menus if menu.parent_id}
        self._leaves = [menu for menu in menus if menu.id not in parent_ids]
        return self._leaves

    async def _menus_by_id(self) -> dict[str, Menu]:
        if self._by_id is not None:
            return self._by_id
        result = await self.session.execute(
            select(Menu)
            .where(Menu.is_active.is_(True), Menu.module.in_(enabled_modules()))
            .order_by(Menu.sort_order, Menu.label)
        )
        self._by_id = {menu.id: menu for menu in result.scalars().all()}
        return self._by_id

    async def _rows_for_user(self, user_id: str, host: str) -> list[DashboardShortcut]:
        owned = await self._owned_rows(user_id, host)
        if owned:
            return [row for row in owned if not row.module_code.startswith("_")]
        return [row for row in await self._shared_rows(host) if not row.module_code.startswith("_")]

    async def _owned_rows(self, user_id: str, host: str) -> list[DashboardShortcut]:
        result = await self.session.execute(
            select(DashboardShortcut)
            .where(DashboardShortcut.user_id == user_id, DashboardShortcut.host_code == host)
            .order_by(DashboardShortcut.sort_order, DashboardShortcut.button_label)
        )
        return list(result.scalars().all())

    async def _shared_rows(self, host: str) -> list[DashboardShortcut]:
        result = await self.session.execute(
            select(DashboardShortcut)
            .where(DashboardShortcut.user_id.is_(None), DashboardShortcut.host_code == host)
            .order_by(DashboardShortcut.sort_order, DashboardShortcut.button_label)
        )
        return list(result.scalars().all())

    async def _replace_user_host(self, user_id: str, host: str, items: list) -> None:
        for row in await self._owned_rows(user_id, host):
            await self.session.delete(row)
        await self.session.flush()
        real = [
            item
            for item in items
            if (item.module_code or "").strip()
            and not item.module_code.startswith("_")
            and not _is_seeded_new_patient(item)
        ]
        if not real:
            self.session.add(
                DashboardShortcut(
                    user_id=user_id,
                    host_code=host,
                    module_code=EMPTY_MARKER,
                    button_label="(none)",
                    sort_order=0,
                    is_active=False,
                )
            )
        for index, item in enumerate(real):
            self.session.add(
                DashboardShortcut(
                    user_id=user_id,
                    host_code=host,
                    module_code=item.module_code.strip(),
                    button_label=item.button_label.strip(),
                    description=(item.description or "").strip() or None,
                    sort_order=item.sort_order if item.sort_order else index + 1,
                    is_active=item.is_active,
                )
            )
        await self.session.flush()

    @staticmethod
    def _picker_label(menu: Menu, parent_label: str, ambiguous: bool) -> str:
        if ambiguous and menu.code in AMBIGUOUS_PICKER:
            return AMBIGUOUS_PICKER[menu.code]
        if not ambiguous:
            return menu.label
        if parent_label:
            return f"{parent_label} / {menu.label} ({menu.code})"
        return f"{menu.label} ({menu.code})"

    @staticmethod
    def _copy_row(row: DashboardShortcut, user_id: str) -> DashboardShortcut:
        return DashboardShortcut(
            user_id=user_id,
            host_code=row.host_code,
            module_code=row.module_code,
            button_label=row.button_label,
            description=row.description,
            sort_order=row.sort_order,
            is_active=row.is_active,
        )
