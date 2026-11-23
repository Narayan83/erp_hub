from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from erp_core.product_config import get_product_name
from modules.hospital.hms.models.menu import Menu
from modules.hospital.hms.models.role import Role
from modules.hospital.hms.models.role_menu_permission import RoleMenuPermission
from modules.hospital.hms.models.user_role_mapping import UserRoleMapping
from modules.hospital.hms.repositories.menu import MenuRepository
from modules.hospital.hms.schemas.menu import MenuCreate, MenuPermissions, MenuRead, MenuTreeNode, MenuUpdate

# Soft-delete blocked — sidebar / auth depend on these.
PROTECTED_MENU_CODES = frozenset({"dashboard", "menu_creation", "masters", "user_management"})


class MenuService:
    SUPER_ADMIN_ROLE = "Super Admin"

    def __init__(self, session: AsyncSession):
        self.repo = MenuRepository(session)
        self.session = session

    async def list_menus(self, *, include_inactive: bool = False) -> list[MenuRead]:
        menus = await self.repo.list_all() if include_inactive else await self.repo.list_all_active()
        return [MenuRead.model_validate(m) for m in menus]

    async def get_menu(self, menu_id: str) -> MenuRead:
        menu = await self.repo.get_by_id(menu_id)
        if not menu:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu not found")
        return MenuRead.model_validate(menu)

    async def create_menu(self, data: MenuCreate) -> MenuRead:
        if data.parent_id:
            parent = await self.repo.get_by_id(data.parent_id)
            if not parent or not parent.is_active:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Parent menu not found")

        label = data.label.strip()
        code = (data.code or "").strip() or await self.repo.next_auto_code(label)

        existing = await self.repo.get_by_code(code)
        if existing:
            if existing.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Menu code already exists",
                )
            existing.label = label
            existing.parent_id = data.parent_id
            existing.icon = data.icon
            existing.sort_order = data.sort_order
            existing.legacy_mcode = data.legacy_mcode
            existing.legacy_form = data.legacy_form or existing.legacy_form or "MENUCRT"
            existing.parameters = data.parameters
            existing.is_active = True
            if existing.module != "core":
                existing.module = get_product_name()
            await self.session.flush()
            await self._ensure_super_admin_permission(existing.id)
            await self.session.refresh(existing)
            return MenuRead.model_validate(existing)

        menu = Menu(
            code=code,
            label=label,
            parent_id=data.parent_id,
            icon=data.icon,
            sort_order=data.sort_order,
            legacy_mcode=data.legacy_mcode,
            legacy_form=data.legacy_form or "MENUCRT",
            parameters=data.parameters,
            module=get_product_name(),
            is_active=data.is_active,
        )
        self.session.add(menu)
        await self.session.flush()
        await self._ensure_super_admin_permission(menu.id)
        await self.session.refresh(menu)
        return MenuRead.model_validate(menu)

    async def update_menu(self, menu_id: str, data: MenuUpdate) -> MenuRead:
        menu = await self.repo.get_by_id(menu_id)
        if not menu or not menu.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu not found")

        payload = data.model_dump(exclude_unset=True)
        if "parent_id" in payload:
            parent_id = payload["parent_id"]
            if parent_id == menu.id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Menu cannot be its own parent",
                )
            if parent_id:
                parent = await self.repo.get_by_id(parent_id)
                if not parent or not parent.is_active:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Parent menu not found",
                    )
                if await self._is_descendant(menu.id, parent_id):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Cannot move a menu under one of its descendants",
                    )

        for field, value in payload.items():
            if field == "label" and value is not None:
                value = value.strip()
            setattr(menu, field, value)

        await self.session.flush()
        await self.session.refresh(menu)
        return MenuRead.model_validate(menu)

    async def delete_menu(self, menu_id: str) -> MenuRead:
        menu = await self.repo.get_by_id(menu_id)
        if not menu or not menu.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu not found")
        if menu.code in PROTECTED_MENU_CODES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete protected menu '{menu.code}'",
            )
        children = await self.repo.list_active_children(menu.id)
        if children:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Deactivate or reassign child menus first",
            )
        menu.is_active = False
        await self.session.flush()
        await self.session.refresh(menu)
        return MenuRead.model_validate(menu)

    async def _is_descendant(self, ancestor_id: str, candidate_id: str) -> bool:
        """True if candidate_id is under ancestor_id in the active tree."""
        menus = await self.repo.list_all_active()
        children_map: dict[str, list[str]] = {}
        for m in menus:
            if m.parent_id:
                children_map.setdefault(m.parent_id, []).append(m.id)
        stack = list(children_map.get(ancestor_id, []))
        while stack:
            current = stack.pop()
            if current == candidate_id:
                return True
            stack.extend(children_map.get(current, []))
        return False

    async def _ensure_super_admin_permission(self, menu_id: str) -> None:
        role_result = await self.session.execute(
            select(Role).where(Role.role_name == self.SUPER_ADMIN_ROLE, Role.is_active.is_(True))
        )
        role = role_result.scalar_one_or_none()
        if not role:
            return
        existing = await self.session.execute(
            select(RoleMenuPermission).where(
                RoleMenuPermission.role_id == role.id,
                RoleMenuPermission.menu_id == menu_id,
            )
        )
        if existing.scalar_one_or_none():
            return
        self.session.add(
            RoleMenuPermission(
                role_id=role.id,
                menu_id=menu_id,
                can_view=True,
                can_create=True,
                can_update=True,
                can_delete=True,
            )
        )
        await self.session.flush()

    async def get_user_menu_tree(self, user_id: str) -> list[MenuTreeNode]:
        role_ids, is_super_admin = await self._get_user_roles(user_id)
        menus = await self.repo.list_all_active()

        if is_super_admin:
            permission_map = {
                menu.id: MenuPermissions(can_view=True, can_create=True, can_update=True, can_delete=True)
                for menu in menus
            }
        elif role_ids:
            permission_map = await self._merged_permissions(role_ids)
        else:
            permission_map = {}

        return self._build_tree(menus, parent_id=None, permission_map=permission_map, is_super_admin=is_super_admin)

    async def _get_user_roles(self, user_id: str) -> tuple[list[str], bool]:
        result = await self.session.execute(
            select(UserRoleMapping)
            .options(selectinload(UserRoleMapping.role))
            .where(UserRoleMapping.user_id == user_id)
        )
        mappings = result.scalars().all()
        role_ids: list[str] = []
        is_super_admin = False
        for mapping in mappings:
            if mapping.role and mapping.role.is_active:
                role_ids.append(mapping.role_id)
                if mapping.role.role_name == self.SUPER_ADMIN_ROLE:
                    is_super_admin = True
        return role_ids, is_super_admin

    async def _merged_permissions(self, role_ids: list[str]) -> dict[str, MenuPermissions]:
        result = await self.session.execute(
            select(RoleMenuPermission).where(RoleMenuPermission.role_id.in_(role_ids))
        )
        merged: dict[str, MenuPermissions] = {}
        for perm in result.scalars().all():
            current = merged.get(
                perm.menu_id,
                MenuPermissions(can_view=False, can_create=False, can_update=False, can_delete=False),
            )
            merged[perm.menu_id] = MenuPermissions(
                can_view=current.can_view or perm.can_view,
                can_create=current.can_create or perm.can_create,
                can_update=current.can_update or perm.can_update,
                can_delete=current.can_delete or perm.can_delete,
            )
        return merged

    def _build_tree(
        self,
        menus: list[Menu],
        parent_id: str | None,
        permission_map: dict[str, MenuPermissions],
        is_super_admin: bool,
    ) -> list[MenuTreeNode]:
        nodes: list[MenuTreeNode] = []
        siblings = sorted(
            [m for m in menus if m.parent_id == parent_id],
            key=lambda m: m.sort_order,
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
