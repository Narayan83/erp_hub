from sqlalchemy.ext.asyncio import AsyncSession

from modules.kramcop.kc.schema import ensure_kramcop_schema
from modules.kramcop.kc.services.access import seed_roles
from modules.kramcop.kc.services.auth import get_setting, set_setting
from modules.kramcop.kc.services.import_excel import import_workbook
from modules.kramcop.kc.services.masters import seed_masters


async def seed_initial_data(session: AsyncSession) -> dict:
    await ensure_kramcop_schema(session)
    await seed_masters(session)
    await seed_roles(session)
    await session.flush()
    if not await get_setting(session, "society_name"):
        await set_setting(session, "society_name", "Kramcop")
    if not await get_setting(session, "acno_prefix"):
        await set_setting(session, "acno_prefix", "D-")
    return await import_workbook(session)
