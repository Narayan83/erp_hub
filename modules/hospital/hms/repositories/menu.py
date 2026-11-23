from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from erp_core.product_config import enabled_modules
from modules.hospital.hms.models.menu import Menu
from modules.hospital.hms.repositories.base import BaseRepository


def _for_this_product():
    """Core menus are shared. Every other menu belongs to one product."""
    return Menu.module.in_(enabled_modules())


class MenuRepository(BaseRepository[Menu]):
    model = Menu

    def __init__(self, session: AsyncSession):
        super().__init__(session)

    async def list_active_tree(self) -> list[Menu]:
        result = await self.session.execute(
            select(Menu)
            .options(selectinload(Menu.children))
            .where(Menu.parent_id.is_(None), Menu.is_active.is_(True), _for_this_product())
            .order_by(Menu.sort_order)
        )
        roots = list(result.scalars().unique().all())
        allowed = set(enabled_modules())
        for root in roots:
            root.children = sorted(
                [c for c in root.children if c.is_active and c.module in allowed],
                key=lambda m: m.sort_order,
            )
        return roots

    async def list_all_active(self) -> list[Menu]:
        result = await self.session.execute(
            select(Menu)
            .where(Menu.is_active.is_(True), _for_this_product())
            .order_by(Menu.sort_order)
        )
        return list(result.scalars().all())

    async def list_all(self) -> list[Menu]:
        result = await self.session.execute(
            select(Menu).where(_for_this_product()).order_by(Menu.sort_order, Menu.label)
        )
        return list(result.scalars().all())

    async def get_by_code(self, code: str) -> Menu | None:
        result = await self.session.execute(select(Menu).where(Menu.code == code))
        return result.scalar_one_or_none()

    async def next_auto_code(self, label: str) -> str:
        """Build a unique snake_case code from the label (menu_2, menu_3, … if needed)."""
        import re

        base = (label or "").strip().lower().replace(" ", "_").replace("-", "_")
        base = re.sub(r"[^a-z0-9_]", "", base)
        base = re.sub(r"_+", "_", base).strip("_")[:70]
        if not base or not base[0].isalpha():
            base = f"menu_{base}" if base else "menu"
        candidate = base
        suffix = 2
        while await self.get_by_code(candidate):
            tail = f"_{suffix}"
            candidate = f"{base[: 80 - len(tail)]}{tail}"
            suffix += 1
        return candidate

    async def list_active_children(self, parent_id: str) -> list[Menu]:
        result = await self.session.execute(
            select(Menu)
            .where(Menu.parent_id == parent_id, Menu.is_active.is_(True), _for_this_product())
            .order_by(Menu.sort_order)
        )
        return list(result.scalars().all())
