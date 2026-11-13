from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from erp_core.models.auth import Menu, RoleMenuPermission, User, UserRoleMapping
from erp_core.product_config import enabled_modules

SUPER_ADMIN_ROLE = "Super Admin"


class MenuService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_user_menu_tree(self, user_id: str) -> list[dict]:
        user = (
            await self.session.execute(
                select(User)
                .options(selectinload(User.role_mappings).selectinload(UserRoleMapping.role))
                .where(User.id == user_id)
            )
        ).scalar_one_or_none()
        if not user:
            return []

        is_super = any(
            m.role and m.role.is_active and m.role.role_name == SUPER_ADMIN_ROLE
            for m in (user.role_mappings or [])
        )
        active_modules = set(enabled_modules())
        menus = (
            await self.session.execute(
                select(Menu)
                .where(Menu.is_active.is_(True), Menu.module.in_(active_modules))
                .order_by(Menu.sort_order, Menu.label)
            )
        ).scalars().all()

        allowed: set[str] | None = None
        if not is_super:
            role_ids = [m.role_id for m in user.role_mappings if m.role and m.role.is_active]
            if not role_ids:
                return []
            perms = (
                await self.session.execute(
                    select(RoleMenuPermission).where(
                        RoleMenuPermission.role_id.in_(role_ids),
                        RoleMenuPermission.can_view.is_(True),
                    )
                )
            ).scalars().all()
            allowed = {p.menu_id for p in perms}

        by_parent: dict[str | None, list[Menu]] = {}
        for menu in menus:
            if allowed is not None and menu.id not in allowed:
                continue
            by_parent.setdefault(menu.parent_id, []).append(menu)

        def build(parent_id: str | None) -> list[dict]:
            nodes = []
            for menu in by_parent.get(parent_id, []):
                children = build(menu.id)
                # Keep parents that have visible children even if leaf-only filtering
                if menu.parent_id is None and not children and allowed is not None:
                    # top-level without children: only if itself allowed (already filtered)
                    pass
                nodes.append({"code": menu.code, "label": menu.label, "children": children})
            return nodes

        return build(None)
