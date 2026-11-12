"""Discount scheme CRUD + apply helper."""

from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.models.discounts import DiscountScheme
from modules.generp.ge.schemas.stock import DiscountApplyIn, DiscountApplyOut, DiscountSchemeIn


async def create_scheme(session: AsyncSession, data: DiscountSchemeIn) -> DiscountScheme:
    code = data.code.strip().upper()
    exists = (
        await session.execute(select(DiscountScheme).where(DiscountScheme.code == code))
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail=f"Discount code {code} already exists")
    row = DiscountScheme(
        code=code,
        name=data.name.strip(),
        scope=data.scope.upper(),
        discount_type=data.discount_type.upper(),
        value=float(data.value or 0),
        min_bill_amount=float(data.min_bill_amount or 0),
        max_discount_amount=data.max_discount_amount,
        product_id=data.product_id,
        category_id=data.category_id,
        valid_from=data.valid_from,
        valid_to=data.valid_to,
        applies_to=data.applies_to.upper(),
        narration=data.narration,
        is_active=data.is_active,
    )
    session.add(row)
    await session.flush()
    return row


async def update_scheme(session: AsyncSession, scheme_id: str, data: DiscountSchemeIn) -> DiscountScheme:
    row = await session.get(DiscountScheme, scheme_id)
    if not row:
        raise HTTPException(status_code=404, detail="Discount scheme not found")
    row.name = data.name.strip()
    row.scope = data.scope.upper()
    row.discount_type = data.discount_type.upper()
    row.value = float(data.value or 0)
    row.min_bill_amount = float(data.min_bill_amount or 0)
    row.max_discount_amount = data.max_discount_amount
    row.product_id = data.product_id
    row.category_id = data.category_id
    row.valid_from = data.valid_from
    row.valid_to = data.valid_to
    row.applies_to = data.applies_to.upper()
    row.narration = data.narration
    row.is_active = data.is_active
    await session.flush()
    return row


async def list_schemes(session: AsyncSession, active_only: bool = False) -> list[DiscountScheme]:
    q = select(DiscountScheme).order_by(DiscountScheme.code)
    if active_only:
        q = q.where(DiscountScheme.is_active.is_(True))
    return list((await session.execute(q)).scalars().all())


async def get_scheme(session: AsyncSession, scheme_id: str) -> DiscountScheme:
    row = await session.get(DiscountScheme, scheme_id)
    if not row:
        raise HTTPException(status_code=404, detail="Discount scheme not found")
    return row


async def delete_scheme(session: AsyncSession, scheme_id: str) -> None:
    row = await get_scheme(session, scheme_id)
    row.is_active = False
    await session.flush()


def _scheme_valid_on(row: DiscountScheme, on: date) -> bool:
    if not row.is_active:
        return False
    if row.valid_from and on < row.valid_from:
        return False
    if row.valid_to and on > row.valid_to:
        return False
    return True


async def apply_discount(session: AsyncSession, data: DiscountApplyIn) -> DiscountApplyOut:
    """Compute discount amount for a bill or line from a scheme (or best matching)."""
    today = date.today()
    scheme: DiscountScheme | None = None
    if data.scheme_id:
        scheme = await get_scheme(session, data.scheme_id)
    else:
        # Pick first matching active scheme by scope priority
        schemes = await list_schemes(session, active_only=True)
        for s in schemes:
            if not _scheme_valid_on(s, today):
                continue
            if s.applies_to not in ("ALL", data.voucher_type.upper()):
                continue
            if s.scope == "PRODUCT" and data.product_id and s.product_id == data.product_id:
                scheme = s
                break
            if s.scope == "CATEGORY" and data.category_id and s.category_id == data.category_id:
                scheme = s
                break
            if s.scope in ("BILL", "LINE") and float(data.bill_amount or 0) >= float(s.min_bill_amount or 0):
                scheme = s
                break

    if not scheme or not _scheme_valid_on(scheme, today):
        return DiscountApplyOut(discount_amount=0, discount_pct=0)

    base = float(data.line_amount if data.line_amount is not None else data.bill_amount or 0)
    if base < float(scheme.min_bill_amount or 0):
        return DiscountApplyOut(
            scheme_id=scheme.id,
            scheme_code=scheme.code,
            scheme_name=scheme.name,
            discount_amount=0,
            discount_pct=0,
        )

    if scheme.discount_type == "PCT":
        amt = round(base * float(scheme.value) / 100.0, 2)
        pct = float(scheme.value)
    else:
        amt = round(float(scheme.value), 2)
        pct = round((amt / base) * 100.0, 4) if base else 0

    if scheme.max_discount_amount is not None:
        amt = min(amt, float(scheme.max_discount_amount))

    return DiscountApplyOut(
        scheme_id=scheme.id,
        scheme_code=scheme.code,
        scheme_name=scheme.name,
        discount_amount=amt,
        discount_pct=pct,
    )
