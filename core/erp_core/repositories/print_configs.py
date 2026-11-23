from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.models.masters import PrintConfig
from erp_core.product_config import get_product_name


class PrintConfigRepository:
    model = PrintConfig

    def __init__(self, session: AsyncSession, product: str | None = None):
        self.session = session
        self.product = (product or get_product_name()).strip().lower()

    async def list_active(self) -> list[PrintConfig]:
        result = await self.session.execute(
            select(PrintConfig)
            .where(
                PrintConfig.product == self.product,
                PrintConfig.is_active.is_(True),
            )
            .order_by(PrintConfig.sort_order, PrintConfig.name)
        )
        return list(result.scalars().all())

    async def get_by_code(self, code: str) -> PrintConfig | None:
        result = await self.session.execute(
            select(PrintConfig).where(
                PrintConfig.product == self.product,
                PrintConfig.code == code.upper(),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, config_id: str) -> PrintConfig | None:
        result = await self.session.execute(
            select(PrintConfig).where(
                PrintConfig.product == self.product,
                PrintConfig.id == config_id,
            )
        )
        return result.scalar_one_or_none()
