"""Dashboard analytics from live database."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import User
from modules.generp.ge.models.masters import Category, Party, PaymentMode, Product
from modules.generp.ge.models.transactions import Voucher, VoucherItem, VoucherPayment

router = APIRouter()

SALE_TYPES = ("SALE", "WHOLESALE", "SHOP_SALE")
PURCHASE_TYPES = ("PURCHASE",)


def _f(v) -> float:
    return float(v or 0)


@router.get("/stats")
async def dashboard_stats(
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    days: int = Query(14, ge=7, le=90),
):
    today = date.today()
    month_start = today.replace(day=1)
    week_start = today - timedelta(days=today.weekday())  # Monday
    range_start = today - timedelta(days=days - 1)

    async def _count(model, *where):
        q = select(func.count()).select_from(model)
        for w in where:
            q = q.where(w)
        return int((await session.execute(q)).scalar_one() or 0)

    async def _voucher_sum(types: tuple[str, ...], date_from: date | None = None, date_to: date | None = None):
        q = select(func.coalesce(func.sum(Voucher.net_amount), 0)).where(
            Voucher.voucher_type.in_(types),
            Voucher.is_cancelled.is_(False),
        )
        if date_from is not None:
            q = q.where(Voucher.voucher_date >= date_from)
        if date_to is not None:
            q = q.where(Voucher.voucher_date <= date_to)
        return _f((await session.execute(q)).scalar_one())

    async def _voucher_count(types: tuple[str, ...], date_from: date | None = None, date_to: date | None = None):
        q = select(func.count()).select_from(Voucher).where(
            Voucher.voucher_type.in_(types),
            Voucher.is_cancelled.is_(False),
        )
        if date_from is not None:
            q = q.where(Voucher.voucher_date >= date_from)
        if date_to is not None:
            q = q.where(Voucher.voucher_date <= date_to)
        return int((await session.execute(q)).scalar_one() or 0)

    products = await _count(Product, Product.is_active.is_(True))
    categories = await _count(Category, Category.is_active.is_(True))
    customers = await _count(
        Party, Party.is_active.is_(True), Party.party_type.in_(("customer", "both"))
    )
    vendors = await _count(
        Party, Party.is_active.is_(True), Party.party_type.in_(("vendor", "both"))
    )
    sales_count = await _count(Voucher, Voucher.voucher_type == "SALE")
    purchase_count = await _count(Voucher, Voucher.voucher_type == "PURCHASE")

    today_sales = await _voucher_sum(SALE_TYPES, today, today)
    today_purchases = await _voucher_sum(PURCHASE_TYPES, today, today)
    today_sale_bills = await _voucher_count(SALE_TYPES, today, today)
    week_sales = await _voucher_sum(SALE_TYPES, week_start, today)
    month_sales = await _voucher_sum(SALE_TYPES, month_start, today)
    month_purchases = await _voucher_sum(PURCHASE_TYPES, month_start, today)
    month_sale_bills = await _voucher_count(SALE_TYPES, month_start, today)

    # Daily sales + purchases series
    daily_rows = (
        await session.execute(
            select(
                Voucher.voucher_date,
                Voucher.voucher_type,
                func.coalesce(func.sum(Voucher.net_amount), 0),
                func.count(),
            )
            .where(
                Voucher.is_cancelled.is_(False),
                Voucher.voucher_date >= range_start,
                Voucher.voucher_date <= today,
                Voucher.voucher_type.in_(("SALE", "WHOLESALE", "PURCHASE")),
            )
            .group_by(Voucher.voucher_date, Voucher.voucher_type)
            .order_by(Voucher.voucher_date)
        )
    ).all()

    by_day: dict[str, dict] = {}
    for d in range(days):
        day = range_start + timedelta(days=d)
        key = day.isoformat()
        by_day[key] = {
            "date": key,
            "sales": 0.0,
            "wholesale": 0.0,
            "purchases": 0.0,
            "sale_bills": 0,
        }
    for vdate, vtype, amount, cnt in daily_rows:
        key = vdate.isoformat() if hasattr(vdate, "isoformat") else str(vdate)
        if key not in by_day:
            continue
        amt = _f(amount)
        if vtype == "SALE":
            by_day[key]["sales"] += amt
            by_day[key]["sale_bills"] += int(cnt or 0)
        elif vtype == "WHOLESALE":
            by_day[key]["wholesale"] += amt
            by_day[key]["sale_bills"] += int(cnt or 0)
        elif vtype == "PURCHASE":
            by_day[key]["purchases"] += amt

    sales_trend = []
    for key in sorted(by_day.keys()):
        row = by_day[key]
        sales_trend.append(
            {
                "date": row["date"],
                "sales": round(row["sales"] + row["wholesale"], 2),
                "retail_sales": round(row["sales"], 2),
                "wholesale_sales": round(row["wholesale"], 2),
                "purchases": round(row["purchases"], 2),
                "bills": row["sale_bills"],
            }
        )

    # Top products (sale + wholesale) in period
    top_product_rows = (
        await session.execute(
            select(
                VoucherItem.product_id,
                Product.code,
                Product.name,
                func.coalesce(func.sum(VoucherItem.quantity), 0),
                func.coalesce(func.sum(VoucherItem.amount), 0),
            )
            .join(Voucher, Voucher.id == VoucherItem.voucher_id)
            .outerjoin(Product, Product.id == VoucherItem.product_id)
            .where(
                Voucher.is_cancelled.is_(False),
                Voucher.voucher_type.in_(SALE_TYPES),
                Voucher.voucher_date >= range_start,
                Voucher.voucher_date <= today,
                VoucherItem.product_id.is_not(None),
            )
            .group_by(VoucherItem.product_id, Product.code, Product.name)
            .order_by(func.sum(VoucherItem.amount).desc())
            .limit(8)
        )
    ).all()
    top_products = [
        {
            "product_id": pid,
            "code": code,
            "name": name or "—",
            "qty": _f(qty),
            "amount": round(_f(amt), 2),
        }
        for pid, code, name, qty, amt in top_product_rows
    ]

    # Low stock
    low_stock_rows = (
        await session.execute(
            select(Product.id, Product.code, Product.name, Product.current_stock, Product.unit)
            .where(Product.is_active.is_(True), Product.current_stock <= 5)
            .order_by(Product.current_stock.asc())
            .limit(10)
        )
    ).all()
    low_stock = [
        {
            "product_id": pid,
            "code": code,
            "name": name,
            "current_stock": _f(stock),
            "unit": unit,
        }
        for pid, code, name, stock, unit in low_stock_rows
    ]

    # Payment mode mix today (collections)
    pay_rows = (
        await session.execute(
            select(
                PaymentMode.id,
                PaymentMode.name,
                PaymentMode.is_credit,
                func.coalesce(func.sum(VoucherPayment.amount), 0),
            )
            .join(VoucherPayment, VoucherPayment.payment_mode_id == PaymentMode.id)
            .join(Voucher, Voucher.id == VoucherPayment.voucher_id)
            .where(
                Voucher.is_cancelled.is_(False),
                Voucher.voucher_type.in_(SALE_TYPES),
                Voucher.voucher_date == today,
            )
            .group_by(PaymentMode.id, PaymentMode.name, PaymentMode.is_credit)
            .order_by(func.sum(VoucherPayment.amount).desc())
        )
    ).all()
    payment_mix_today = [
        {
            "payment_mode_id": pid,
            "name": name,
            "is_credit": bool(is_credit),
            "amount": round(_f(amt), 2),
        }
        for pid, name, is_credit, amt in pay_rows
    ]
    today_collected = round(
        sum(p["amount"] for p in payment_mix_today if not p["is_credit"]),
        2,
    )
    today_credit = round(
        sum(p["amount"] for p in payment_mix_today if p["is_credit"]),
        2,
    )

    # Recent bills
    recent = (
        await session.execute(
            select(Voucher)
            .options(selectinload(Voucher.party))
            .where(
                Voucher.is_cancelled.is_(False),
                Voucher.voucher_type.in_(("SALE", "WHOLESALE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN")),
            )
            .order_by(Voucher.voucher_date.desc(), Voucher.created_at.desc())
            .limit(12)
        )
    ).scalars().all()
    recent_vouchers = [
        {
            "id": v.id,
            "voucher_type": v.voucher_type,
            "voucher_no": v.voucher_no,
            "voucher_date": v.voucher_date.isoformat() if v.voucher_date else None,
            "party_name": v.party.name if v.party else None,
            "net_amount": round(_f(v.net_amount), 2),
        }
        for v in recent
    ]

    # Month sales split retail vs wholesale
    month_retail = await _voucher_sum(("SALE",), month_start, today)
    month_wholesale = await _voucher_sum(("WHOLESALE",), month_start, today)

    return {
        # legacy fields (desktop / older clients)
        "products": products,
        "categories": categories,
        "customers": customers,
        "vendors": vendors,
        "sales_count": sales_count,
        "purchase_count": purchase_count,
        "today_sales": round(today_sales, 2),
        "today_purchases": round(today_purchases, 2),
        # aliases used by android earlier
        "today_bills": today_sale_bills,
        "total_products": products,
        "total_customers": customers,
        # richer analytics
        "as_of": today.isoformat(),
        "range_days": days,
        "kpis": {
            "today_sales": round(today_sales, 2),
            "today_purchases": round(today_purchases, 2),
            "today_bills": today_sale_bills,
            "today_collected": today_collected,
            "today_credit": today_credit,
            "week_sales": round(week_sales, 2),
            "month_sales": round(month_sales, 2),
            "month_purchases": round(month_purchases, 2),
            "month_bills": month_sale_bills,
            "month_retail_sales": round(month_retail, 2),
            "month_wholesale_sales": round(month_wholesale, 2),
            "products": products,
            "customers": customers,
            "vendors": vendors,
            "low_stock_count": len(low_stock),
        },
        "sales_trend": sales_trend,
        "top_products": top_products,
        "low_stock": low_stock,
        "payment_mix_today": payment_mix_today,
        "recent_vouchers": recent_vouchers,
    }
