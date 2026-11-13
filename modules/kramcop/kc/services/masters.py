from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.kramcop.kc.models.masters import Category, ShareType

DEFAULT_CATEGORIES = [
    ("G", "General", "ಸಾಮಾನ್ಯ", True),
    ("O", "Others", "ಇತರೆ", False),
]

DEFAULT_SHARE_TYPES = [
    (1, "A", 85, "SHARE A/C (A CLASS)"),
    (2, "B", 86, "SHARE A/C (B CLASS)"),
    (3, "C", 87, "SHARE A/C (C CLASS)"),
    (4, "D", 88, "SHARE A/C (D CLASS)"),
]


async def seed_masters(session: AsyncSession) -> None:
    existing_cat = {c.code for c in (await session.execute(select(Category))).scalars().all()}
    for code, name_en, name_kn, is_default in DEFAULT_CATEGORIES:
        if code not in existing_cat:
            session.add(Category(code=code, name_en=name_en, name_kn=name_kn, is_default=is_default))
    existing_st = {s.code: s for s in (await session.execute(select(ShareType))).scalars().all()}
    for code, prefix, legacy, name in DEFAULT_SHARE_TYPES:
        if code not in existing_st:
            session.add(ShareType(code=code, prefix=prefix, legacy_code=legacy, name=name, is_active=True))
        elif not (existing_st[code].prefix or "").strip():
            existing_st[code].prefix = prefix
