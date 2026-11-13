"""Shopping Cart analytics — SHOP_SALE vouchers only."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import User
from modules.generp.ge.models.masters import Party, Product
from modules.generp.ge.models.transactions import Voucher, VoucherItem

router = APIRouter()

SHOP_TYPE = "SHOP_SALE"


def _f(v) -> float:
    return float(v or 0)


@router.get("/analytics")
async def shop_analytics(
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    days: int = Query(30, ge=7, le=180),
):
    today = date.today()
    month_start = today.replace(day=1)
    week_start = today - timedelta(days=today.weekday())
    range_start = today - timedelta(days=days - 1)

    async def _sum(date_from: date | None = None, date_to: date | None = None) -> float:
        q = select(func.coalesce(func.sum(Voucher.net_amount), 0)).where(
            Voucher.voucher_type == SHOP_TYPE,
            Voucher.is_cancelled.is_(False),
        )
        if date_from is not None:
            q = q.where(Voucher.voucher_date >= date_from)
        if date_to is not None:
            q = q.where(Voucher.voucher_date <= date_to)
        return _f((await session.execute(q)).scalar_one())

    async def _count(date_from: date | None = None, date_to: date | None = None) -> int:
        q = select(func.count()).select_from(Voucher).where(
            Voucher.voucher_type == SHOP_TYPE,
            Voucher.is_cancelled.is_(False),
        )
        if date_from is not None:
            q = q.where(Voucher.voucher_date >= date_from)
        if date_to is not None:
            q = q.where(Voucher.voucher_date <= date_to)
        return int((await session.execute(q)).scalar_one() or 0)

    today_sales = await _sum(today, today)
    today_orders = await _count(today, today)
    week_sales = await _sum(week_start, today)
    month_sales = await _sum(month_start, today)
    range_sales = await _sum(range_start, today)
    range_orders = await _count(range_start, today)

    # Day-wise series
    daily_rows = (
        await session.execute(
            select(
                Voucher.voucher_date,
                func.coalesce(func.sum(Voucher.net_amount), 0),
                func.count(),
            )
            .where(
                Voucher.voucher_type == SHOP_TYPE,
                Voucher.is_cancelled.is_(False),
                Voucher.voucher_date >= range_start,
                Voucher.voucher_date <= today,
            )
            .group_by(Voucher.voucher_date)
            .order_by(Voucher.voucher_date)
        )
    ).all()
    by_day: dict[str, dict] = {}
    for i in range(days):
        day = range_start + timedelta(days=i)
        key = day.isoformat()
        by_day[key] = {"date": key, "sales": 0.0, "orders": 0}
    for vdate, amount, cnt in daily_rows:
        key = vdate.isoformat() if hasattr(vdate, "isoformat") else str(vdate)
        if key in by_day:
            by_day[key]["sales"] = _f(amount)
            by_day[key]["orders"] = int(cnt or 0)
    daywise = list(by_day.values())

    # Top products by qty + amount
    top_product_rows = (
        await session.execute(
            select(
                VoucherItem.product_id,
                Product.name,
                Product.code,
                func.coalesce(func.sum(VoucherItem.quantity), 0),
                func.coalesce(func.sum(VoucherItem.amount), 0),
            )
            .join(Voucher, Voucher.id == VoucherItem.voucher_id)
            .outerjoin(Product, Product.id == VoucherItem.product_id)
            .where(
                Voucher.voucher_type == SHOP_TYPE,
                Voucher.is_cancelled.is_(False),
                Voucher.voucher_date >= range_start,
                Voucher.voucher_date <= today,
            )
            .group_by(VoucherItem.product_id, Product.name, Product.code)
            .order_by(func.coalesce(func.sum(VoucherItem.amount), 0).desc())
            .limit(15)
        )
    ).all()
    top_products = [
        {
            "product_id": pid,
            "name": name or "Unknown",
            "code": code,
            "qty": _f(qty),
            "amount": _f(amount),
        }
        for pid, name, code, qty, amount in top_product_rows
    ]

    # Top customers by amount + order count
    top_customer_rows = (
        await session.execute(
            select(
                Voucher.party_id,
                Party.name,
                Party.phone,
                Party.code,
                func.count(Voucher.id),
                func.coalesce(func.sum(Voucher.net_amount), 0),
            )
            .outerjoin(Party, Party.id == Voucher.party_id)
            .where(
                Voucher.voucher_type == SHOP_TYPE,
                Voucher.is_cancelled.is_(False),
                Voucher.voucher_date >= range_start,
                Voucher.voucher_date <= today,
                Voucher.party_id.is_not(None),
            )
            .group_by(Voucher.party_id, Party.name, Party.phone, Party.code)
            .order_by(func.coalesce(func.sum(Voucher.net_amount), 0).desc())
            .limit(15)
        )
    ).all()
    top_customers = [
        {
            "party_id": pid,
            "name": name or "Walk-in",
            "phone": phone,
            "code": code,
            "orders": int(cnt or 0),
            "amount": _f(amount),
        }
        for pid, name, phone, code, cnt, amount in top_customer_rows
    ]

    # Recent purchasers / orders (who purchased)
    recent = (
        await session.execute(
            select(Voucher)
            .options(selectinload(Voucher.party), selectinload(Voucher.items))
            .where(
                Voucher.voucher_type == SHOP_TYPE,
                Voucher.is_cancelled.is_(False),
            )
            .order_by(Voucher.voucher_date.desc(), Voucher.created_at.desc())
            .limit(25)
        )
    ).scalars().all()
    recent_orders = [
        {
            "id": v.id,
            "voucher_no": v.voucher_no,
            "voucher_date": v.voucher_date.isoformat() if v.voucher_date else None,
            "party_id": v.party_id,
            "party_name": v.party.name if v.party else None,
            "party_phone": v.party.phone if v.party else None,
            "net_amount": _f(v.net_amount),
            "item_count": len(v.items or []),
            "narration": v.narration,
        }
        for v in recent
    ]

    unique_buyers = (
        await session.execute(
            select(func.count(func.distinct(Voucher.party_id))).where(
                Voucher.voucher_type == SHOP_TYPE,
                Voucher.is_cancelled.is_(False),
                Voucher.voucher_date >= range_start,
                Voucher.voucher_date <= today,
                Voucher.party_id.is_not(None),
            )
        )
    ).scalar_one()

    avg_order = round(range_sales / range_orders, 2) if range_orders else 0.0

    return {
        "as_of": today.isoformat(),
        "days": days,
        "kpis": {
            "today_sales": today_sales,
            "today_orders": today_orders,
            "week_sales": week_sales,
            "month_sales": month_sales,
            "range_sales": range_sales,
            "range_orders": range_orders,
            "unique_customers": int(unique_buyers or 0),
            "avg_order_value": avg_order,
        },
        "daywise": daywise,
        "top_products": top_products,
        "top_customers": top_customers,
        "recent_orders": recent_orders,
    }
