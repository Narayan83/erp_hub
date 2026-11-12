"""Configurable document numbers. Sequence is consumed only on save.

Saved format: {text_prefix}{year}{prefix2}{prefix3}{sequence}

Entry screens must not show or reserve a number. Peeking the next value
would make users think a number is taken even if they never save.

Year modes:
  none            — omit year
  financial_year  — Indian FY 2627, 2728, …
  year            — calendar 2026, 2027, …

Concurrent saves take a FOR UPDATE lock on the sequence row so two terminals
never get the same number. Opening a bill does not reserve a number.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.models.transactions import DocumentNumberRule, DocumentSequence

YEAR_NONE = "none"
YEAR_FY = "financial_year"
YEAR_CAL = "year"
YEAR_MODES = (YEAR_NONE, YEAR_FY, YEAR_CAL)

DEFAULT_PREFIX2 = "01"
DEFAULT_PREFIX3 = "01"
DEFAULT_DIGITS = 6
MIN_DIGITS = 4
MAX_DIGITS = 10

DOCUMENT_KIND_LABELS: list[tuple[str, str]] = [
    ("SALE", "Sale Bill"),
    ("WHOLESALE", "Wholesale Bill"),
    ("PURCHASE", "Purchase Bill"),
    ("SALE_RETURN", "Sales Return"),
    ("PURCHASE_RETURN", "Purchase Return"),
    ("SHOP_SALE", "Shop Sale"),
    ("ORDER_SALES_ORDER", "Sales Order"),
    ("ORDER_PURCHASE_ORDER", "Purchase Order"),
    ("accounting_advance", "Advance Collection"),
    ("accounting_payment", "Payment / Adjustment"),
    ("accounting_contra", "Contra Entry"),
    ("STOCK_INWARD_DC", "Inward DC"),
    ("STOCK_OUTWARD_DC", "Outward DC"),
    ("STOCK_INWARD_DC_RETURN", "Inward DC Return"),
    ("STOCK_OUTWARD_DC_RETURN", "Outward DC Return"),
    ("STOCK_SHORTAGE", "Shortage"),
    ("STOCK_EXCESS", "Excess"),
    ("STOCK_WASTAGE", "Wastage"),
    ("STOCK_EXCHANGE", "Exchange"),
    ("STOCK_CONVERSION", "Stock Conversion"),
    ("STOCK_TRANSFER_OUT", "Stock Transfer Out"),
    ("STOCK_TRANSFER_IN", "Stock Transfer In"),
]


@dataclass(frozen=True)
class NumberRule:
    text_prefix: str
    year_mode: str
    prefix2: str
    prefix3: str
    seq_digits: int


def fy_code(d: date | None = None) -> str:
    """Indian FY as 4 digits: Apr 2026–Mar 2027 → 2627."""
    target = d or date.today()
    start = target.year if target.month >= 4 else target.year - 1
    return f"{start % 100:02d}{(start + 1) % 100:02d}"


def calendar_year(d: date | None = None) -> str:
    return str((d or date.today()).year)


def year_part(mode: str, d: date | None = None) -> str:
    if mode == YEAR_FY:
        return fy_code(d)
    if mode == YEAR_CAL:
        return calendar_year(d)
    return ""


def normalize_year_mode(raw: str | None) -> str:
    s = str(raw or "").strip().lower().replace(" ", "_")
    if s in ("fy", "financial", "fin_year"):
        return YEAR_FY
    if s in ("calendar", "cal", "yyyy"):
        return YEAR_CAL
    if s in YEAR_MODES:
        return s
    return YEAR_FY


def clamp_digits(n: int | None) -> int:
    try:
        v = int(n or DEFAULT_DIGITS)
    except (TypeError, ValueError):
        v = DEFAULT_DIGITS
    return max(MIN_DIGITS, min(MAX_DIGITS, v))


def sanitize_token(raw: str | None, max_len: int = 12) -> str:
    return "".join(ch for ch in str(raw or "").strip() if ch.isalnum() or ch in "-/._")[:max_len]


def pad_seq(n: int, digits: int) -> str:
    return f"{int(n):0{clamp_digits(digits)}d}"


def display_no(rule: NumberRule, n: int) -> str:
    """What the bill screen shows before save: text prefix + sequence only."""
    return f"{rule.text_prefix}{pad_seq(n, rule.seq_digits)}"


def full_no(rule: NumberRule, n: int, voucher_date: date | None = None) -> str:
    """Number stored when the document is saved."""
    return (
        f"{rule.text_prefix}"
        f"{year_part(rule.year_mode, voucher_date)}"
        f"{rule.prefix2}"
        f"{rule.prefix3}"
        f"{pad_seq(n, rule.seq_digits)}"
    )


def rule_from_row(row: DocumentNumberRule | None) -> NumberRule:
    if row is None:
        return NumberRule("", YEAR_FY, DEFAULT_PREFIX2, DEFAULT_PREFIX3, DEFAULT_DIGITS)
    return NumberRule(
        text_prefix=sanitize_token(row.prefix, 16),
        year_mode=normalize_year_mode(getattr(row, "year_mode", None)),
        prefix2=sanitize_token(getattr(row, "prefix2", None), 12),
        prefix3=sanitize_token(getattr(row, "prefix3", None), 12),
        seq_digits=clamp_digits(getattr(row, "seq_digits", None)),
    )


def _seq_name(kind: str, rule: NumberRule, voucher_date: date | None) -> str:
    yp = year_part(rule.year_mode, voucher_date)
    return f"{kind}:{rule.text_prefix}:{yp}:{rule.prefix2}:{rule.prefix3}:{rule.seq_digits}"


async def load_rule(session: AsyncSession, kind: str) -> NumberRule:
    row = (
        await session.execute(select(DocumentNumberRule).where(DocumentNumberRule.kind == kind))
    ).scalar_one_or_none()
    return rule_from_row(row)


async def _lock_sequence(session: AsyncSession, name: str, stored_prefix: str) -> DocumentSequence:
    seq = (
        await session.execute(
            select(DocumentSequence).where(DocumentSequence.name == name).with_for_update()
        )
    ).scalar_one_or_none()
    if seq:
        return seq
    try:
        async with session.begin_nested():
            session.add(DocumentSequence(name=name, prefix=stored_prefix, last_number=0))
            await session.flush()
    except IntegrityError:
        pass
    return (
        await session.execute(
            select(DocumentSequence).where(DocumentSequence.name == name).with_for_update()
        )
    ).scalar_one()


async def next_document_no(
    session: AsyncSession,
    kind: str,
    voucher_date: date | None = None,
    *,
    branch_id: str | None = None,
    branch_code: str | None = None,
    dept_code: str | None = None,
) -> str:
    """Consume the next number. Call only when the document is saved."""
    del branch_id, branch_code, dept_code
    rule = await load_rule(session, kind)
    name = _seq_name(kind, rule, voucher_date)
    stored = full_no(rule, 0, voucher_date)[:80]
    seq = await _lock_sequence(session, name, stored)
    seq.prefix = stored
    seq.last_number = int(seq.last_number or 0) + 1
    await session.flush()
    return full_no(rule, seq.last_number, voucher_date)


async def peek_document_no(
    session: AsyncSession,
    kind: str,
    voucher_date: date | None = None,
    *,
    branch_id: str | None = None,
    branch_code: str | None = None,
    dept_code: str | None = None,
) -> tuple[str, str | None]:
    """Read-only screen preview: text prefix + next sequence. Does not consume."""
    del branch_id, branch_code, dept_code
    rule = await load_rule(session, kind)
    name = _seq_name(kind, rule, voucher_date)
    seq = (
        await session.execute(select(DocumentSequence).where(DocumentSequence.name == name))
    ).scalar_one_or_none()
    last_n = int(seq.last_number) if seq else 0
    last_no = display_no(rule, last_n) if last_n > 0 else None
    return display_no(rule, last_n + 1), last_no


def _rule_to_out(kind: str, label: str, row: DocumentNumberRule) -> dict:
    rule = rule_from_row(row)
    return {
        "id": row.id,
        "kind": kind,
        "label": label,
        "prefix": rule.text_prefix,
        "year_mode": rule.year_mode,
        "prefix2": rule.prefix2,
        "prefix3": rule.prefix3,
        "seq_digits": rule.seq_digits,
        "sample_no": full_no(rule, 1),
        "sample_display": display_no(rule, 1),
    }


async def list_number_rules(session: AsyncSession) -> list[dict]:
    existing = {
        r.kind: r
        for r in (await session.execute(select(DocumentNumberRule))).scalars().all()
    }
    out: list[dict] = []
    for kind, label in DOCUMENT_KIND_LABELS:
        row = existing.get(kind)
        if row is None:
            row = DocumentNumberRule(
                kind=kind,
                prefix="",
                year_mode=YEAR_FY,
                prefix2=DEFAULT_PREFIX2,
                prefix3=DEFAULT_PREFIX3,
                seq_digits=DEFAULT_DIGITS,
            )
            session.add(row)
            await session.flush()
            existing[kind] = row
        out.append(_rule_to_out(kind, label, row))
    return out


async def save_number_rules(session: AsyncSession, rules: list[dict]) -> list[dict]:
    allowed = {k for k, _ in DOCUMENT_KIND_LABELS}
    existing = {
        r.kind: r
        for r in (await session.execute(select(DocumentNumberRule))).scalars().all()
    }
    for item in rules:
        kind = str(item.get("kind") or "").strip()
        if kind not in allowed:
            continue
        text_prefix = sanitize_token(item.get("prefix"), 16)
        year_mode = normalize_year_mode(item.get("year_mode"))
        prefix2 = sanitize_token(item.get("prefix2"), 12)
        prefix3 = sanitize_token(item.get("prefix3"), 12)
        seq_digits = clamp_digits(item.get("seq_digits"))
        row = existing.get(kind)
        if row is None:
            row = DocumentNumberRule(kind=kind)
            session.add(row)
            existing[kind] = row
        row.prefix = text_prefix
        row.year_mode = year_mode
        row.prefix2 = prefix2
        row.prefix3 = prefix3
        row.seq_digits = seq_digits
    await session.flush()
    return await list_number_rules(session)
