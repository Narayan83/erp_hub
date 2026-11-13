"""Ledger code auto-increment helpers and system-ledger lookup.

Display codes are memorable integers: 1, 2, 3, … (Cash = 1).
Legacy L0001 / L0002 codes are still parsed so existing rows migrate.
"""

from __future__ import annotations

import re

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.models.masters import Ledger

_DIGIT_RE = re.compile(r"^\d+$")
_LEGACY_L_RE = re.compile(r"^L(\d+)$", re.IGNORECASE)
LEDGER_CODE_LIMIT = 999_999


def parse_ledger_n(code: str | None) -> int:
    s = str(code or "").strip()
    if _DIGIT_RE.match(s):
        return int(s)
    m = _LEGACY_L_RE.match(s)
    return int(m.group(1)) if m else 0


def format_ledger_code(n: int) -> str:
    return str(int(n))


def normalize_ledger_code(code: str | None) -> str:
    raw = str(code or "").strip()
    n = parse_ledger_n(raw)
    if n:
        return format_ledger_code(n)
    return raw.upper()


def next_code_from_used(used: set[str], start: int = 1) -> str:
    """Next free integer code not in `used` (in-memory, for seeding)."""
    occupied = {parse_ledger_n(c) for c in used}
    occupied.discard(0)
    n = max(start, 1)
    while n <= LEDGER_CODE_LIMIT:
        if n not in occupied and format_ledger_code(n) not in used:
            return format_ledger_code(n)
        n += 1
    raise ValueError(f"Ledger code limit {LEDGER_CODE_LIMIT} reached")


async def next_ledger_code(session: AsyncSession) -> str:
    """Next auto code among numeric / legacy L#### ledgers (active or inactive)."""
    rows = (await session.execute(select(Ledger.code))).scalars().all()
    used = {str(c) for c in rows if c}
    max_n = 0
    for code in used:
        max_n = max(max_n, parse_ledger_n(code))
    n = max_n + 1
    while n <= LEDGER_CODE_LIMIT:
        code = format_ledger_code(n)
        if code not in used:
            return code
        n += 1
    raise ValueError(f"Ledger code limit {LEDGER_CODE_LIMIT} reached")


async def ledger_by_key(session: AsyncSession, key: str) -> Ledger | None:
    """Find a system ledger by stable key, falling back to the display code."""
    key = (key or "").strip()
    if not key:
        return None
    rows = list(
        (
            await session.execute(
                select(Ledger).where(or_(Ledger.system_key == key, Ledger.code == key))
            )
        ).scalars().all()
    )
    if not rows:
        return None
    active = [r for r in rows if r.is_active]
    pool = active or rows
    keyed = next((r for r in pool if (r.system_key or "") == key), None)
    if keyed:
        return keyed
    return next((r for r in pool if r.code == key), pool[0])
