from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.models.ward import Ward
from modules.hospital.hms.repositories.base import BaseRepository


class WardRepository(BaseRepository[Ward]):
    model = Ward

    def __init__(self, session: AsyncSession):
        super().__init__(session)

    async def list_active(self) -> list[Ward]:
        result = await self.session.execute(
            select(Ward).where(Ward.is_active.is_(True)).order_by(Ward.sort_order, Ward.name)
        )
        return list(result.scalars().all())

    async def get_by_code(self, code: str) -> Ward | None:
        result = await self.session.execute(select(Ward).where(Ward.code == code))
        return result.scalar_one_or_none()

    async def next_auto_code(self) -> str:
        """Next ward code as a plain number (max numeric code + 1, else count + 1)."""
        result = await self.session.execute(select(Ward.code))
        codes = [str(code).strip() for code in result.scalars().all() if code]
        nums = [int(code) for code in codes if code.isdigit()]
        if nums:
            return str(max(nums) + 1)
        return str(len(codes) + 1)

    async def get_by_id(self, ward_id: str) -> Ward | None:
        result = await self.session.execute(select(Ward).where(Ward.id == ward_id))
        return result.scalar_one_or_none()
