from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.models.auth import Menu, RoleMenuPermission, UserRoleMapping
from modules.generp.ge.models.masters import CompanyProfile
from modules.generp.ge.schemas.menu import MenuPermissions, MenuTreeNode

SUPER_ADMIN_ROLE = "Super Admin"
# Always licensed so Software Setup can change the package.
PACKAGE_LOCKED_CODES = frozenset({"company_profile"})


class MenuService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_all_active(self) -> list[Menu]:
        result = await self.session.execute(select(Menu).where(Menu.is_active.is_(True)))
        return list(result.scalars().all())

    async def package_codes(self) -> set[str] | None:
        """None means the package has not been set, so every menu stays available."""
        profile = (
            await self.session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
        ).scalar_one_or_none()
        raw = getattr(profile, "package_menu_codes", None) if profile else None
        if not isinstance(raw, list):
            return None
        codes = {str(code).strip() for code in raw if str(code).strip()}
        codes.update(PACKAGE_LOCKED_CODES)
        return codes

    def apply_package(self, menus: list[Menu], codes: set[str] | None) -> list[Menu]:
        if codes is None:
            return menus
        by_parent: dict[str | None, list[Menu]] = {}
        for menu in menus:
            by_parent.setdefault(menu.parent_id, []).append(menu)
        keep: set[str] = set()

        def walk(menu: Menu) -> bool:
            child_hit = False
            for child in by_parent.get(menu.id, []):
                if walk(child):
                    child_hit = True
            if menu.code in codes or child_hit:
                keep.add(menu.id)
                return True
            return False

        for root in by_parent.get(None, []):
            walk(root)
        return [menu for menu in menus if menu.id in keep]

    async def list_packaged(self) -> list[Menu]:
        return self.apply_package(await self.list_all_active(), await self.package_codes())

    async def get_user_menu_tree(self, user_id: str) -> list[MenuTreeNode]:
        role_ids, is_super_admin = await self._get_user_roles(user_id)
        menus = await self.list_packaged()

        if is_super_admin:
            permission_map = {
                m.id: MenuPermissions(can_view=True, can_create=True, can_update=True, can_delete=True)
                for m in menus
            }
        elif role_ids:
            permission_map = await self._merged_permissions(role_ids)
        else:
            permission_map = {}

        return self._build_tree(menus, None, permission_map, is_super_admin)

    async def _get_user_roles(self, user_id: str) -> tuple[list[str], bool]:
        result = await self.session.execute(
            select(UserRoleMapping)
            .options(selectinload(UserRoleMapping.role))
            .where(UserRoleMapping.user_id == user_id)
        )
        role_ids: list[str] = []
        is_super_admin = False
        for mapping in result.scalars().all():
            if mapping.role and mapping.role.is_active:
                role_ids.append(mapping.role_id)
                if mapping.role.role_name == SUPER_ADMIN_ROLE:
                    is_super_admin = True
        return role_ids, is_super_admin

    async def _merged_permissions(self, role_ids: list[str]) -> dict[str, MenuPermissions]:
        result = await self.session.execute(
            select(RoleMenuPermission).where(RoleMenuPermission.role_id.in_(role_ids))
        )
        merged: dict[str, MenuPermissions] = {}
        for perm in result.scalars().all():
            current = merged.get(perm.menu_id, MenuPermissions())
            merged[perm.menu_id] = MenuPermissions(
                can_view=current.can_view or perm.can_view,
                can_create=current.can_create or perm.can_create,
                can_update=current.can_update or perm.can_update,
                can_delete=current.can_delete or perm.can_delete,
            )
        return merged

    def _build_tree(self, menus, parent_id, permission_map, is_super_admin) -> list[MenuTreeNode]:
        nodes: list[MenuTreeNode] = []
        siblings = sorted(
            [m for m in menus if m.parent_id == parent_id], key=lambda m: m.sort_order
        )
        for menu in siblings:
            children = self._build_tree(menus, menu.id, permission_map, is_super_admin)
            perms = permission_map.get(
                menu.id,
                MenuPermissions(
                    can_view=is_super_admin,
                    can_create=is_super_admin,
                    can_update=is_super_admin,
                    can_delete=is_super_admin,
                ),
            )
            if perms.can_view or children:
                nodes.append(
                    MenuTreeNode(
                        id=menu.id,
                        code=menu.code,
                        label=menu.label,
                        icon=menu.icon,
                        sort_order=menu.sort_order,
                        legacy_mcode=menu.legacy_mcode,
                        legacy_form=menu.legacy_form,
                        parameters=menu.parameters,
                        permissions=perms if perms.can_view else MenuPermissions(can_view=True),
                        children=children,
                    )
                )
        return nodes
