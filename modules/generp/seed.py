"""GST, print layouts, payment modes, and the main branch. Menus stay in core seed."""

from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.seeds.bootstrap import (
    _seed_gst,
    _seed_payment_modes,
    _seed_print_configs,
)
from modules.generp.ge.services.stock_posting import ensure_main_branch


async def seed_generp_domain(session: AsyncSession) -> None:
    await _seed_payment_modes(session)
    await _seed_gst(session)
    await _seed_print_configs(session)
    await ensure_main_branch(session)
