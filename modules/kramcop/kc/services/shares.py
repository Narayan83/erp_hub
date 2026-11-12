from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.kramcop.kc.models.member import Transaction

SHARE_ADD = "share_addition"
SHARE_DEL = "share_deletion"
KIND_OTHER = "other"

KIND_LABELS = {
    SHARE_ADD: "Share addition",
    SHARE_DEL: "Share deletion",
    KIND_OTHER: "Other",
}


def normalize_share_no(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text or text in ("\\N", "None", "NULL"):
        return ""
    try:
        number = int(float(text))
        return "" if number == 0 else str(number)
    except (TypeError, ValueError):
        return text


def classify_imported(typ: int | None, drcr: int | None) -> str:
    if typ in (85, 86, 87, 88):
        if drcr in (3, 4):
            return SHARE_DEL
        return SHARE_ADD
    return KIND_OTHER


def kind_label(kind: str) -> str:
    if kind == SHARE_ADD:
        return "Share addition"
    if kind == SHARE_DEL:
        return "Share deletion"
    return "Other"


async def current_shares_by_acno(
    session: AsyncSession,
    acnos: Iterable[int] | None = None,
) -> dict[int, list[str]]:
    stmt = select(Transaction.acno, Transaction.rno, Transaction.kind, Transaction.txn_date).where(
        Transaction.kind.in_([SHARE_ADD, SHARE_DEL])
    )
    acno_list = list(acnos) if acnos is not None else None
    if acno_list is not None:
        if not acno_list:
            return {}
        stmt = stmt.where(Transaction.acno.in_(acno_list))
    stmt = stmt.order_by(Transaction.txn_date.asc().nullsfirst(), Transaction.created_at.asc())
    rows = (await session.execute(stmt)).all()
    held: dict[int, list[str]] = defaultdict(list)
    for acno, rno, kind, _date in rows:
        share = normalize_share_no(rno)
        if not share:
            continue
        current = held[acno]
        if kind == SHARE_ADD:
            if share not in current:
                current.append(share)
        elif kind == SHARE_DEL and share in current:
            current.remove(share)
    return dict(held)


def format_share_nos(shares: list[str] | None) -> str:
    return ", ".join(shares or [])
