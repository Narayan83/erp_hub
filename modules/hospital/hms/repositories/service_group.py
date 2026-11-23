from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.models.service_group import ServiceGroup
from modules.hospital.hms.repositories.base import BaseRepository


class ServiceGroupRepository(BaseRepository[ServiceGroup]):
    model = ServiceGroup

    def __init__(self, session: AsyncSession):
        super().__init__(session)

    async def list_active(self) -> list[ServiceGroup]:
        result = await self.session.execute(
            select(ServiceGroup)
            .where(ServiceGroup.is_active.is_(True))
            .order_by(ServiceGroup.sort_order, ServiceGroup.code)
        )
        return list(result.scalars().all())

    async def get_by_code(self, code: str) -> ServiceGroup | None:
        result = await self.session.execute(
            select(ServiceGroup).where(ServiceGroup.code == code)
        )
        return result.scalar_one_or_none()
