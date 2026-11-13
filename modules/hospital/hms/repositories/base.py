from typing import Generic, TypeVar

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.database import Base

ModelT = TypeVar("ModelT", bound=Base)


class BaseRepository(Generic[ModelT]):
    model: type[ModelT]

    def __init__(self, session: AsyncSession):
        self.session = session

    def _base_query(self) -> Select[tuple[ModelT]]:
        return select(self.model)

    async def get_by_id(self, record_id: str) -> ModelT | None:
        result = await self.session.execute(
            self._base_query().where(self.model.id == record_id)  # type: ignore[attr-defined]
        )
        return result.scalar_one_or_none()

    async def next_numeric_code(self, *conditions, column=None) -> str:
        """Next free plain-number code (max numeric code + 1), skipping any value already used."""
        code_col = column if column is not None else self.model.code  # type: ignore[attr-defined]
        stmt = select(code_col)
        if conditions:
            stmt = stmt.where(*conditions)
        result = await self.session.execute(stmt)
        codes = {str(code).strip().upper() for code in result.scalars().all() if code}
        nums = [int(code) for code in codes if code.isdigit()]
        candidate = max(nums) + 1 if nums else 1
        while str(candidate) in codes:
            candidate += 1
        return str(candidate)

    async def count(self) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(self.model)
        )
        return result.scalar_one()
