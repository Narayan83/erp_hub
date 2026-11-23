"""Customer / vendor display IDs: 1, 2, 3, … auto-increment per series.

Customers (and 'both') share one number series; vendors share another, so
customer 1 and supplier 1 can coexist. A 'both' party occupies the number
in both series.
"""

from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.models.masters import Party

CUSTOMER_TYPES = ("customer", "both")
VENDOR_TYPES = ("vendor", "both")
_DIGIT_RE = re.compile(r"^\d+$")
_LEGACY_RE = re.compile(r"^(?:CUST|VEND)(\d+)$", re.IGNORECASE)
PARTY_CODE_LIMIT = 999_999


def parse_party_n(code: str | None) -> int:
    s = str(code or "").strip()
    if _DIGIT_RE.match(s):
        return int(s)
    m = _LEGACY_RE.match(s)
    return int(m.group(1)) if m else 0


def format_party_code(n: int) -> str:
    return str(int(n))


def normalize_party_code(code: str | None) -> str:
    raw = str(code or "").strip()
    n = parse_party_n(raw)
    if n:
        return format_party_code(n)
    return raw


def series_slot(code: str | None) -> int:
    """Numeric place in the 1..999999 series. Other codes do not move the counter."""
    n = parse_party_n(code)
    if 1 <= n <= PARTY_CODE_LIMIT:
        return n
    return 0


def _candidate_slots(start: int):
    n = start if 1 <= start <= PARTY_CODE_LIMIT else 1
    first = n
    while n <= PARTY_CODE_LIMIT:
        yield n
        n += 1
    n = 1
    while n < first:
        yield n
        n += 1


def _series_types(party_type: str) -> tuple[str, ...]:
    if party_type == "vendor":
        return VENDOR_TYPES
    return CUSTOMER_TYPES


async def party_code_taken(
    session: AsyncSession,
    party_type: str,
    code: str,
    *,
    exclude_id: str | None = None,
) -> bool:
    wanted = (party_type or "").strip().lower()
    types: tuple[str, ...]
    if wanted == "both":
        q = select(Party.id).where(Party.code == code)
    else:
        types = _series_types(wanted)
        q = select(Party.id).where(Party.party_type.in_(types), Party.code == code)
    if exclude_id:
        q = q.where(Party.id != exclude_id)
    return (await session.execute(q)).scalar_one_or_none() is not None


async def find_party_by_code(
    session: AsyncSession,
    code: str,
    *,
    party_type: str | None = None,
) -> Party | None:
    """Look up by display ID. If customer 1 and vendor 1 both exist, prefer customer."""
    wanted = normalize_party_code(code)
    if not wanted:
        return None
    q = select(Party).where(Party.code == wanted, Party.is_active.is_(True))
    if party_type == "vendor":
        q = q.where(Party.party_type.in_(VENDOR_TYPES))
    elif party_type == "customer":
        q = q.where(Party.party_type.in_(CUSTOMER_TYPES))
    rows = list((await session.execute(q)).scalars().all())
    if not rows:
        return None
    for kind in ("customer", "both", "vendor"):
        hit = next((r for r in rows if r.party_type == kind), None)
        if hit:
            return hit
    return rows[0]


async def next_party_code(
    session: AsyncSession,
    party_type: str,
    preferred: str | None = None,
) -> str:
    wanted = (party_type or "customer").strip().lower()
    if preferred and str(preferred).strip():
        code = normalize_party_code(preferred)
        if await party_code_taken(session, wanted, code):
            raise ValueError("Code already exists")
        return code

    if wanted == "both":
        cust_rows = (await session.execute(select(Party.code).where(Party.party_type.in_(CUSTOMER_TYPES)))).scalars().all()
        vend_rows = (await session.execute(select(Party.code).where(Party.party_type.in_(VENDOR_TYPES)))).scalars().all()
        occupied = {series_slot(c) for c in (*cust_rows, *vend_rows)}
    else:
        rows = (
            await session.execute(select(Party.code).where(Party.party_type.in_(_series_types(wanted))))
        ).scalars().all()
        occupied = {series_slot(c) for c in rows}
    occupied.discard(0)
    start = (max(occupied) if occupied else 0) + 1
    for n in _candidate_slots(start):
        if n in occupied:
            continue
        code = format_party_code(n)
        if not await party_code_taken(session, wanted, code):
            return code
    raise ValueError("Party code limit reached")
