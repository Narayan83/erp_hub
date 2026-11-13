from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.hospital.hms.models.single_service_opd import (
    SingleServiceOpdBill,
    SingleServiceOpdOption,
    SingleServiceOpdOptionService,
)


def _bill_load_options():
    return (
        selectinload(SingleServiceOpdBill.option),
        selectinload(SingleServiceOpdBill.patient),
        selectinload(SingleServiceOpdBill.doctor),
        selectinload(SingleServiceOpdBill.lines),
    )
from modules.hospital.hms.repositories.base import BaseRepository


def _option_load_options():
    return (
        selectinload(SingleServiceOpdOption.service),
        selectinload(SingleServiceOpdOption.doctor),
        selectinload(SingleServiceOpdOption.services).selectinload(
            SingleServiceOpdOptionService.service
        ),
    )


class SingleServiceOpdOptionRepository(BaseRepository[SingleServiceOpdOption]):
    model = SingleServiceOpdOption

    def __init__(self, session: AsyncSession):
        super().__init__(session)

    async def list_all(self) -> list[SingleServiceOpdOption]:
        stmt = (
            select(SingleServiceOpdOption)
            .options(*_option_load_options())
            .order_by(SingleServiceOpdOption.sort_order, SingleServiceOpdOption.name)
        )
        result = await self.session.execute(stmt)
        return list(result.unique().scalars().all())

    async def get_by_id(self, option_id: str) -> SingleServiceOpdOption | None:
        stmt = (
            select(SingleServiceOpdOption)
            .options(*_option_load_options())
            .where(SingleServiceOpdOption.id == option_id)
        )
        result = await self.session.execute(stmt)
        return result.unique().scalar_one_or_none()

    async def get_by_menu_code(self, menu_code: str) -> SingleServiceOpdOption | None:
        stmt = (
            select(SingleServiceOpdOption)
            .options(*_option_load_options())
            .where(
                SingleServiceOpdOption.menu_code == menu_code,
                SingleServiceOpdOption.is_active.is_(True),
            )
        )
        result = await self.session.execute(stmt)
        return result.unique().scalar_one_or_none()

    async def get_by_name(self, name: str) -> SingleServiceOpdOption | None:
        stmt = select(SingleServiceOpdOption).where(
            func.lower(SingleServiceOpdOption.name) == name.strip().lower()
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_prefix(self, prefix: str) -> SingleServiceOpdOption | None:
        stmt = select(SingleServiceOpdOption).where(
            func.upper(SingleServiceOpdOption.bill_prefix) == prefix.strip().upper()
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_menu(self, menu_code: str) -> SingleServiceOpdOption | None:
        stmt = select(SingleServiceOpdOption).where(SingleServiceOpdOption.menu_code == menu_code)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def next_sort_order(self) -> int:
        result = await self.session.execute(select(func.max(SingleServiceOpdOption.sort_order)))
        current = result.scalar_one()
        return int(current or 0) + 1


class SingleServiceOpdBillRepository(BaseRepository[SingleServiceOpdBill]):
    model = SingleServiceOpdBill

    def __init__(self, session: AsyncSession):
        super().__init__(session)

    async def get_by_id(self, bill_id: str) -> SingleServiceOpdBill | None:
        stmt = (
            select(SingleServiceOpdBill)
            .options(*_bill_load_options())
            .where(SingleServiceOpdBill.id == bill_id)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def count_for_option(self, option_id: str) -> int:
        result = await self.session.execute(
            select(func.count())
            .select_from(SingleServiceOpdBill)
            .where(SingleServiceOpdBill.option_id == option_id)
        )
        return int(result.scalar_one())

    async def list_for_option_on_date(
        self, option_id: str, bill_date: date
    ) -> list[SingleServiceOpdBill]:
        stmt = (
            select(SingleServiceOpdBill)
            .options(*_bill_load_options())
            .where(
                SingleServiceOpdBill.option_id == option_id,
                SingleServiceOpdBill.bill_date == bill_date,
                SingleServiceOpdBill.is_active.is_(True),
            )
            .order_by(SingleServiceOpdBill.bill_no)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_by_option_and_dates(
        self,
        option_id: str,
        from_date: date,
        to_date: date,
    ) -> list[SingleServiceOpdBill]:
        stmt = (
            select(SingleServiceOpdBill)
            .options(*_bill_load_options())
            .where(
                SingleServiceOpdBill.option_id == option_id,
                SingleServiceOpdBill.is_active.is_(True),
                SingleServiceOpdBill.bill_date >= from_date,
                SingleServiceOpdBill.bill_date <= to_date,
            )
            .order_by(SingleServiceOpdBill.bill_date, SingleServiceOpdBill.bill_no)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def search(self, option_id: str, query: str, *, limit: int = 50) -> list[SingleServiceOpdBill]:
        text = query.strip()
        like = f"%{text}%"
        stmt = (
            select(SingleServiceOpdBill)
            .options(*_bill_load_options())
            .where(
                SingleServiceOpdBill.option_id == option_id,
                SingleServiceOpdBill.is_active.is_(True),
                or_(
                    SingleServiceOpdBill.bill_no.ilike(like),
                    SingleServiceOpdBill.patient_name.ilike(like),
                    SingleServiceOpdBill.patient_no.ilike(like),
                ),
            )
            .order_by(SingleServiceOpdBill.bill_date.desc(), SingleServiceOpdBill.bill_no.desc())
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
