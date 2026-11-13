"""Categories, share types, and the member workbook. Menus stay in core seed."""

from sqlalchemy.ext.asyncio import AsyncSession

from modules.kramcop.kc.seeds.bootstrap import seed_initial_data


async def seed_kramcop_domain(session: AsyncSession) -> None:
    await seed_initial_data(session)
