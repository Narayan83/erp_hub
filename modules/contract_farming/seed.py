from sqlalchemy.ext.asyncio import AsyncSession

from modules.contract_farming.services.seed_data import seed_contract_farming_domain as _seed


async def seed_contract_farming_domain(session: AsyncSession) -> None:
    await _seed(session)
