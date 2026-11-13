from __future__ import annotations

from collections import defaultdict
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.kramcop.kc.models.member import Member, Transaction
from modules.kramcop.kc.services.shares import SHARE_ADD, SHARE_DEL, format_share_nos, normalize_share_no


def payment_drcr(kind: str, payment_mode: str) -> int:
    credit = payment_mode != "adjustment"
    if kind == SHARE_ADD:
        return 1 if credit else 2
    return 3 if credit else 4


def share_type_to_legacy(code: int) -> int:
    return {1: 85, 2: 86, 3: 87, 4: 88}.get(code, 88)


async def next_share_no(session: AsyncSession) -> str:
    rows = (await session.execute(select(Transaction.rno))).all()
    highest = 0
    for (rno,) in rows:
        try:
            n = int(float(str(rno).strip()))
            if n > highest:
                highest = n
        except (TypeError, ValueError):
            continue
    return str(highest + 1)


def _apply(held: dict[int, list[str]], amounts: dict[int, list[float]], acno: int, rno: str, kind: str, amount: float):
    share = normalize_share_no(rno)
    if share:
        current = held[acno]
        if kind == SHARE_ADD:
            if share not in current:
                current.append(share)
        elif kind == SHARE_DEL and share in current:
            current.remove(share)
    add, delete = amounts[acno]
    if kind == SHARE_ADD:
        amounts[acno] = [add + float(amount or 0), delete]
    elif kind == SHARE_DEL:
        amounts[acno] = [add, delete + float(amount or 0)]


async def balances_by_acno(
    session: AsyncSession,
    acnos: list[int] | None = None,
    as_on: date | None = None,
) -> dict[int, tuple[float, float, float, list[str]]]:
    stmt = select(
        Transaction.acno,
        Transaction.rno,
        Transaction.kind,
        Transaction.amount,
        Transaction.txn_date,
        Transaction.created_at,
    ).where(Transaction.kind.in_([SHARE_ADD, SHARE_DEL]))
    if acnos is not None:
        if not acnos:
            return {}
        stmt = stmt.where(Transaction.acno.in_(acnos))
    if as_on is not None:
        stmt = stmt.where((Transaction.txn_date.is_(None)) | (Transaction.txn_date <= as_on))
    stmt = stmt.order_by(Transaction.txn_date.asc().nullsfirst(), Transaction.created_at.asc())
    held: dict[int, list[str]] = defaultdict(list)
    amounts: dict[int, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for acno, rno, kind, amount, _d, _c in (await session.execute(stmt)).all():
        _apply(held, amounts, acno, rno, kind, amount)
    out: dict[int, tuple[float, float, float, list[str]]] = {}
    keys = set(held) | set(amounts)
    for acno in keys:
        add, delete = amounts[acno]
        out[acno] = (add, delete, add - delete, list(held.get(acno, [])))
    return out


async def account_totals(session: AsyncSession, acno: int, as_on: date | None = None):
    data = await balances_by_acno(session, [acno], as_on)
    return data.get(acno, (0.0, 0.0, 0.0, []))


async def next_acno_hint(session: AsyncSession) -> int:
    result = await session.execute(select(func.coalesce(func.max(Member.acno), 0)))
    return int(result.scalar() or 0) + 1
