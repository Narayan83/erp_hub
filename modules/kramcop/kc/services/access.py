from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.kramcop.kc.models.auth import User
from modules.kramcop.kc.models.masters import Role, RoleMenu, UserRole

MENU_CATALOG = [
    ("dashboard", "Dashboard"),
    ("customer_master", "Customer Master"),
    ("category_master", "Category Master"),
    ("share_type_master", "Share Type Master"),
    ("share_entry", "Share addition / deletion"),
    ("share_schedule", "Share Schedule"),
    ("share_summary", "Share Summary"),
    ("address_labels", "Address Labels"),
    ("category_members", "Category members"),
    ("user_addition_modification", "Users"),
    ("kc_roles", "Roles"),
    ("kc_audit", "Audit trail"),
    ("society_profile", "Society master"),
]


async def role_menu_map(session: AsyncSession, role_id: UUID) -> list[RoleMenu]:
    return list((await session.execute(select(RoleMenu).where(RoleMenu.role_id == role_id))).scalars().all())


async def user_role_ids(session: AsyncSession, user_id: str) -> list[UUID]:
    uid = str(user_id)
    return [row[0] for row in (await session.execute(select(UserRole.role_id).where(UserRole.user_id == uid))).all()]


async def user_menus(session: AsyncSession, user_id: str) -> list[str]:
    role_ids = await user_role_ids(session, user_id)
    if not role_ids:
        return [key for key, _ in MENU_CATALOG]
    rows = (
        await session.execute(select(RoleMenu.menu_key).where(RoleMenu.role_id.in_(role_ids), RoleMenu.can_view.is_(True)))
    ).all()
    keys = {r[0] for r in rows}
    return [key for key, _ in MENU_CATALOG if key in keys]


async def set_user_roles(session: AsyncSession, user_id: str, role_ids: list[UUID]) -> None:
    uid = str(user_id)
    await session.execute(delete(UserRole).where(UserRole.user_id == uid))
    for rid in role_ids:
        session.add(UserRole(user_id=uid, role_id=rid))


async def set_role_menus(session: AsyncSession, role_id: UUID, menus: list[dict]) -> None:
    await session.execute(delete(RoleMenu).where(RoleMenu.role_id == role_id))
    for item in menus:
        key = str(item.get("menu_key") or "")
        if not key:
            continue
        session.add(
            RoleMenu(
                role_id=role_id,
                menu_key=key,
                can_view=bool(item.get("can_view", True)),
                can_add=bool(item.get("can_add", False)),
                can_edit=bool(item.get("can_edit", False)),
                can_delete=bool(item.get("can_delete", False)),
            )
        )


async def seed_roles(session: AsyncSession) -> None:
    existing = (await session.execute(select(Role).where(Role.name == "Admin"))).scalar_one_or_none()
    if not existing:
        existing = Role(name="Admin", description="Full access")
        session.add(existing)
        await session.flush()
        await set_role_menus(
            session,
            existing.id,
            [
                {"menu_key": key, "can_view": True, "can_add": True, "can_edit": True, "can_delete": True}
                for key, _ in MENU_CATALOG
            ],
        )
    clerk = (await session.execute(select(Role).where(Role.name == "Clerk"))).scalar_one_or_none()
    if not clerk:
        clerk = Role(name="Clerk", description="Entry and reports")
        session.add(clerk)
        await session.flush()
        clerk_keys = {
            "dashboard",
            "customer_master",
            "share_entry",
            "share_schedule",
            "share_summary",
            "address_labels",
            "category_members",
        }
        await set_role_menus(
            session,
            clerk.id,
            [
                {
                    "menu_key": key,
                    "can_view": True,
                    "can_add": key in {"customer_master", "share_entry"},
                    "can_edit": key in {"customer_master", "share_entry"},
                    "can_delete": False,
                }
                for key, _ in MENU_CATALOG
                if key in clerk_keys
            ],
        )
    admin_user = (await session.execute(select(User).where(User.username == "admin"))).scalar_one_or_none()
    if admin_user:
        mapped = await user_role_ids(session, admin_user.id)
        if not mapped:
            session.add(UserRole(user_id=admin_user.id, role_id=existing.id))
