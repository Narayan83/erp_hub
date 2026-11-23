"""CRUD for per-user, per-menu shortcut buttons."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.product_config import enabled_modules
from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import Menu, User
from modules.generp.ge.models.dashboard import DashboardShortcut
from modules.generp.ge.schemas.dashboard import (
    DashboardShortcutBulkIn,
    DashboardShortcutIn,
    DashboardShortcutOut,
)

router = APIRouter()

DEFAULT_SHORTCUTS: list[tuple[str, str, int]] = [
    ("sale_bill", "Sale Bill", 1),
    ("sales_order", "Sales Order", 2),
    ("purchase_bill", "Purchase", 3),
    ("purchase_order", "Purchase Order", 4),
    ("stock_conversion", "Stock Conversion", 5),
    ("stock_balances", "Consolidated Stock", 6),
    ("trial_balance", "Trial Balance", 7),
    ("advance_collection", "Advance", 8),
    ("product_creation", "Product Master", 9),
]

HIDDEN_FROM_PICKER = {"dashboard", "dashboard_shortcuts"}
EMPTY_MARKER = "_empty"
DEFAULT_HOST = "dashboard"


async def _menu_label_map(session: AsyncSession) -> dict[str, str]:
    rows = (await session.execute(select(Menu.code, Menu.label).where(Menu.is_active.is_(True)))).all()
    return {code: label for code, label in rows}


def _owned(user_id: str):
    return DashboardShortcut.user_id == user_id


def _norm_host(code: str | None) -> str:
    value = (code or DEFAULT_HOST).strip().lower()
    return value or DEFAULT_HOST


def _owned_host(user_id: str, host_code: str):
    return (
        DashboardShortcut.user_id == user_id,
        DashboardShortcut.host_code == host_code,
    )


async def _ensure_user_shortcuts(session: AsyncSession, user: User) -> None:
    """Seed this user's dashboard shortcuts on first visit from legacy globals or defaults."""
    existing = (
        await session.execute(
            select(DashboardShortcut.id).where(_owned(user.id)).limit(1)
        )
    ).scalar_one_or_none()
    if existing:
        return

    legacy = list(
        (
            await session.execute(
                select(DashboardShortcut)
                .where(DashboardShortcut.user_id.is_(None))
                .order_by(DashboardShortcut.sort_order, DashboardShortcut.button_label)
            )
        ).scalars().all()
    )
    if legacy:
        for row in legacy:
            if row.menu_code.startswith("_"):
                continue
            session.add(
                DashboardShortcut(
                    user_id=user.id,
                    host_code=DEFAULT_HOST,
                    menu_code=row.menu_code,
                    button_label=row.button_label,
                    sort_order=row.sort_order,
                    is_active=row.is_active,
                    created_by=user.id,
                )
            )
    else:
        for code, label, order in DEFAULT_SHORTCUTS:
            session.add(
                DashboardShortcut(
                    user_id=user.id,
                    host_code=DEFAULT_HOST,
                    menu_code=code,
                    button_label=label,
                    sort_order=order,
                    is_active=True,
                    created_by=user.id,
                )
            )
    await session.flush()


async def _rename_product_master_shortcuts(session: AsyncSession, user: User) -> None:
    """Keep shortcut buttons in sync with the Product Master menu label."""
    rows = (
        await session.execute(
            select(DashboardShortcut).where(
                _owned(user.id),
                DashboardShortcut.menu_code == "product_creation",
                DashboardShortcut.button_label == "Product Creation",
            )
        )
    ).scalars().all()
    for row in rows:
        row.button_label = "Product Master"
    if rows:
        await session.flush()


async def _user_rows(
    session: AsyncSession, user: User, host_code: str
) -> list[DashboardShortcut]:
    await _ensure_user_shortcuts(session, user)
    await _rename_product_master_shortcuts(session, user)
    return list(
        (
            await session.execute(
                select(DashboardShortcut)
                .where(*_owned_host(user.id, host_code))
                .order_by(DashboardShortcut.sort_order, DashboardShortcut.button_label)
            )
        ).scalars().all()
    )


def _to_out(row: DashboardShortcut, labels: dict[str, str]) -> DashboardShortcutOut:
    return DashboardShortcutOut(
        id=row.id,
        host_code=row.host_code or DEFAULT_HOST,
        menu_code=row.menu_code,
        button_label=row.button_label,
        sort_order=row.sort_order,
        is_active=row.is_active,
        menu_label=labels.get(row.menu_code),
    )


def _reject_target(host_code: str, menu_code: str) -> str | None:
    if menu_code in HIDDEN_FROM_PICKER or menu_code.startswith("_"):
        return "That menu cannot be added as a shortcut"
    if menu_code == host_code:
        return "A menu cannot shortcut to itself"
    return None


async def _ensure_empty_marker(session: AsyncSession, user: User, host_code: str) -> None:
    remaining = (
        await session.execute(
            select(DashboardShortcut.id)
            .where(
                *_owned_host(user.id, host_code),
                DashboardShortcut.menu_code != EMPTY_MARKER,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if remaining is None:
        session.add(
            DashboardShortcut(
                user_id=user.id,
                host_code=host_code,
                menu_code=EMPTY_MARKER,
                button_label="(none)",
                sort_order=0,
                is_active=False,
                created_by=user.id,
            )
        )
        await session.flush()


@router.get("", response_model=list[DashboardShortcutOut])
async def list_shortcuts(
    active_only: bool = False,
    host_code: str = DEFAULT_HOST,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    host = _norm_host(host_code)
    labels = await _menu_label_map(session)
    rows = [r for r in await _user_rows(session, user, host) if not r.menu_code.startswith("_")]
    if active_only:
        rows = [r for r in rows if r.is_active]
    return [_to_out(r, labels) for r in rows]


@router.get("/available-menus")
async def available_menus(
    host_code: str | None = None,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Leaf menus that can be linked as shortcuts (exclude folder parents with only children)."""
    host = _norm_host(host_code) if host_code else None
    rows = (
        await session.execute(
            select(Menu)
            .where(Menu.is_active.is_(True), Menu.module.in_(enabled_modules()))
            .order_by(Menu.sort_order, Menu.label)
        )
    ).scalars().all()
    folder_ids = {m.parent_id for m in rows if m.parent_id}
    leaves = [m for m in rows if m.id not in folder_ids]
    hidden = set(HIDDEN_FROM_PICKER)
    if host:
        hidden.add(host)
    return [
        {
            "code": m.code,
            "label": m.label,
            "parent_id": m.parent_id,
        }
        for m in leaves
        if m.code not in hidden
    ]


@router.post("", response_model=DashboardShortcutOut)
async def create_shortcut(
    data: DashboardShortcutIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await _ensure_user_shortcuts(session, user)
    host = _norm_host(data.host_code)
    code = data.menu_code.strip()
    bad = _reject_target(host, code)
    if bad:
        raise HTTPException(status_code=400, detail=bad)
    exists = (
        await session.execute(
            select(DashboardShortcut).where(
                *_owned_host(user.id, host),
                DashboardShortcut.menu_code == code,
            )
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail=f"Shortcut for menu '{code}' already exists")
    marker = (
        await session.execute(
            select(DashboardShortcut).where(
                *_owned_host(user.id, host),
                DashboardShortcut.menu_code == EMPTY_MARKER,
            )
        )
    ).scalar_one_or_none()
    if marker:
        await session.delete(marker)
        await session.flush()
    owned_orders = (
        await session.execute(
            select(DashboardShortcut.sort_order).where(*_owned_host(user.id, host))
        )
    ).scalars().all()
    max_order = max(owned_orders, default=0)
    row = DashboardShortcut(
        user_id=user.id,
        host_code=host,
        menu_code=code,
        button_label=data.button_label.strip(),
        sort_order=data.sort_order or (max_order + 1),
        is_active=data.is_active,
        created_by=user.id,
    )
    session.add(row)
    await session.flush()
    labels = await _menu_label_map(session)
    return _to_out(row, labels)


@router.put("/bulk", response_model=list[DashboardShortcutOut])
async def replace_shortcuts(
    data: DashboardShortcutBulkIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Full replace of this user's shortcuts for one host menu."""
    host = _norm_host(data.host_code)
    existing = list(
        (await session.execute(select(DashboardShortcut).where(*_owned_host(user.id, host)))).scalars().all()
    )
    for row in existing:
        await session.delete(row)
    await session.flush()

    seen: set[str] = set()
    for idx, item in enumerate(data.items):
        code = item.menu_code.strip()
        if not code or _reject_target(host, code) or code in seen:
            continue
        seen.add(code)
        session.add(
            DashboardShortcut(
                user_id=user.id,
                host_code=host,
                menu_code=code,
                button_label=item.button_label.strip() or code,
                sort_order=item.sort_order if item.sort_order else idx + 1,
                is_active=item.is_active,
                created_by=user.id,
            )
        )
    if not seen:
        session.add(
            DashboardShortcut(
                user_id=user.id,
                host_code=host,
                menu_code=EMPTY_MARKER,
                button_label="(none)",
                sort_order=0,
                is_active=False,
                created_by=user.id,
            )
        )
    await session.flush()
    labels = await _menu_label_map(session)
    rows = [r for r in await _user_rows(session, user, host) if not r.menu_code.startswith("_")]
    return [_to_out(r, labels) for r in rows]


@router.put("/{shortcut_id}", response_model=DashboardShortcutOut)
async def update_shortcut(
    shortcut_id: str,
    data: DashboardShortcutIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await session.get(DashboardShortcut, shortcut_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Shortcut not found")
    host = _norm_host(data.host_code or row.host_code)
    code = data.menu_code.strip()
    bad = _reject_target(host, code)
    if bad:
        raise HTTPException(status_code=400, detail=bad)
    clash = (
        await session.execute(
            select(DashboardShortcut).where(
                *_owned_host(user.id, host),
                DashboardShortcut.menu_code == code,
                DashboardShortcut.id != shortcut_id,
            )
        )
    ).scalar_one_or_none()
    if clash:
        raise HTTPException(status_code=400, detail=f"Shortcut for menu '{code}' already exists")
    row.host_code = host
    row.menu_code = code
    row.button_label = data.button_label.strip()
    row.sort_order = data.sort_order
    row.is_active = data.is_active
    await session.flush()
    labels = await _menu_label_map(session)
    return _to_out(row, labels)


@router.delete("/{shortcut_id}")
async def delete_shortcut(
    shortcut_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await session.get(DashboardShortcut, shortcut_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Shortcut not found")
    host = row.host_code or DEFAULT_HOST
    await session.delete(row)
    await session.flush()
    await _ensure_empty_marker(session, user, host)
    return {"message": "Deleted"}
