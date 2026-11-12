from datetime import date

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.hospital.hms.models.pharmacy import (
    PharmacyItem,
    PharmacyPurchaseBill,
    PharmacyPurchaseBillLine,
    PharmacySaleBill,
    PharmacySaleBillLine,
    PharmacySupplier,
)
from modules.hospital.hms.repositories.base import BaseRepository


class PharmacySaleBillRepository(BaseRepository[PharmacySaleBill]):
    model = PharmacySaleBill

    async def get_with_lines(self, bill_id: str) -> PharmacySaleBill | None:
        result = await self.session.execute(
            select(PharmacySaleBill)
            .options(selectinload(PharmacySaleBill.lines))
            .where(PharmacySaleBill.id == bill_id, PharmacySaleBill.is_active.is_(True))
        )
        return result.scalar_one_or_none()

    async def list_by_date_range(
        self, from_date: date, to_date: date
    ) -> list[PharmacySaleBill]:
        result = await self.session.execute(
            select(PharmacySaleBill)
            .options(selectinload(PharmacySaleBill.lines))
            .where(
                PharmacySaleBill.is_active.is_(True),
                PharmacySaleBill.bill_kind == "sale",
                PharmacySaleBill.bill_date >= from_date,
                PharmacySaleBill.bill_date <= to_date,
            )
            .order_by(PharmacySaleBill.bill_date.desc(), PharmacySaleBill.bill_no.desc())
        )
        return list(result.scalars().all())

    async def get_last_bill_no(self, bill_kind: str = "sale") -> str | None:
        result = await self.session.execute(
            select(PharmacySaleBill.bill_no)
            .where(
                PharmacySaleBill.is_active.is_(True),
                PharmacySaleBill.bill_kind == bill_kind,
            )
            .order_by(PharmacySaleBill.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def list_paginated(
        self,
        *,
        bill_kind: str,
        page: int = 1,
        page_size: int = 50,
        search: str | None = None,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> tuple[list[tuple[PharmacySaleBill, int]], int]:
        line_count = (
            select(func.count(PharmacySaleBillLine.id))
            .where(PharmacySaleBillLine.bill_id == PharmacySaleBill.id)
            .correlate(PharmacySaleBill)
            .scalar_subquery()
        )
        filters = [
            PharmacySaleBill.is_active.is_(True),
            PharmacySaleBill.bill_kind == bill_kind,
        ]
        if from_date is not None:
            filters.append(PharmacySaleBill.bill_date >= from_date)
        if to_date is not None:
            filters.append(PharmacySaleBill.bill_date <= to_date)
        term = (search or "").strip()
        if term:
            like = f"%{term}%"
            filters.append(
                PharmacySaleBill.bill_no.ilike(like)
                | PharmacySaleBill.patient_name.ilike(like)
            )

        count_result = await self.session.execute(
            select(func.count()).select_from(PharmacySaleBill).where(*filters)
        )
        total = int(count_result.scalar_one() or 0)

        result = await self.session.execute(
            select(PharmacySaleBill, func.coalesce(line_count, 0))
            .where(*filters)
            .order_by(
                PharmacySaleBill.bill_date.desc(),
                PharmacySaleBill.created_at.desc(),
                PharmacySaleBill.bill_no.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return [(row[0], int(row[1])) for row in result.all()], total


class PharmacyPurchaseBillRepository(BaseRepository[PharmacyPurchaseBill]):
    model = PharmacyPurchaseBill

    async def get_with_lines(self, bill_id: str) -> PharmacyPurchaseBill | None:
        result = await self.session.execute(
            select(PharmacyPurchaseBill)
            .options(selectinload(PharmacyPurchaseBill.lines))
            .where(PharmacyPurchaseBill.id == bill_id, PharmacyPurchaseBill.is_active.is_(True))
        )
        return result.scalar_one_or_none()

    async def list_by_date_range(
        self, from_date: date, to_date: date
    ) -> list[PharmacyPurchaseBill]:
        result = await self.session.execute(
            select(PharmacyPurchaseBill)
            .options(selectinload(PharmacyPurchaseBill.lines))
            .where(
                PharmacyPurchaseBill.is_active.is_(True),
                PharmacyPurchaseBill.bill_date >= from_date,
                PharmacyPurchaseBill.bill_date <= to_date,
            )
            .order_by(PharmacyPurchaseBill.bill_date.desc(), PharmacyPurchaseBill.bill_no.desc())
        )
        return list(result.scalars().all())

    async def get_last_bill_no(self, bill_kind: str = "purchase") -> str | None:
        result = await self.session.execute(
            select(PharmacyPurchaseBill.bill_no)
            .where(
                PharmacyPurchaseBill.is_active.is_(True),
                PharmacyPurchaseBill.bill_kind == bill_kind,
            )
            .order_by(PharmacyPurchaseBill.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def list_paginated(
        self,
        *,
        bill_kind: str,
        page: int = 1,
        page_size: int = 50,
        search: str | None = None,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> tuple[list[tuple[PharmacyPurchaseBill, int, str | None]], int]:
        line_count = (
            select(func.count(PharmacyPurchaseBillLine.id))
            .where(PharmacyPurchaseBillLine.bill_id == PharmacyPurchaseBill.id)
            .correlate(PharmacyPurchaseBill)
            .scalar_subquery()
        )
        filters = [
            PharmacyPurchaseBill.is_active.is_(True),
            PharmacyPurchaseBill.bill_kind == bill_kind,
        ]
        if from_date is not None:
            filters.append(PharmacyPurchaseBill.bill_date >= from_date)
        if to_date is not None:
            filters.append(PharmacyPurchaseBill.bill_date <= to_date)
        term = (search or "").strip()
        if term:
            like = f"%{term}%"
            filters.append(
                PharmacyPurchaseBill.bill_no.ilike(like)
                | PharmacyPurchaseBill.invoice_no.ilike(like)
                | PharmacySupplier.name.ilike(like)
                | PharmacySupplier.code.ilike(like)
            )

        count_query = (
            select(func.count())
            .select_from(PharmacyPurchaseBill)
            .outerjoin(PharmacySupplier, PharmacyPurchaseBill.supplier_id == PharmacySupplier.id)
            .where(*filters)
        )
        count_result = await self.session.execute(count_query)
        total = int(count_result.scalar_one() or 0)

        result = await self.session.execute(
            select(
                PharmacyPurchaseBill,
                func.coalesce(line_count, 0),
                PharmacySupplier.name,
            )
            .outerjoin(PharmacySupplier, PharmacyPurchaseBill.supplier_id == PharmacySupplier.id)
            .where(*filters)
            .order_by(
                PharmacyPurchaseBill.bill_date.desc(),
                PharmacyPurchaseBill.created_at.desc(),
                PharmacyPurchaseBill.bill_no.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return [(row[0], int(row[1]), row[2]) for row in result.all()], total


async def purchased_qty_by_item(session: AsyncSession) -> dict[str, int]:
    """Net purchased qty (purchases minus supplier returns)."""
    signed_qty = func.sum(
        case(
            (PharmacyPurchaseBill.bill_kind == "return", -PharmacyPurchaseBillLine.quantity),
            else_=PharmacyPurchaseBillLine.quantity,
        )
    )
    result = await session.execute(
        select(
            PharmacyPurchaseBillLine.item_id,
            func.coalesce(signed_qty, 0),
        )
        .join(PharmacyPurchaseBill, PharmacyPurchaseBillLine.bill_id == PharmacyPurchaseBill.id)
        .where(PharmacyPurchaseBill.is_active.is_(True))
        .group_by(PharmacyPurchaseBillLine.item_id)
    )
    return {row[0]: int(row[1]) for row in result.all()}


async def stock_batches_for_item(session: AsyncSession, item_id: str) -> list[dict]:
    """Remaining stock by batch (purchases minus returns minus sales). Nearest expiry first."""
    signed_qty = case(
        (PharmacyPurchaseBill.bill_kind == "return", -PharmacyPurchaseBillLine.quantity),
        else_=PharmacyPurchaseBillLine.quantity,
    )
    purchased = await session.execute(
        select(
            PharmacyPurchaseBillLine.batch_no,
            PharmacyPurchaseBillLine.expiry_date,
            signed_qty,
            PharmacyPurchaseBillLine.rate,
            PharmacyPurchaseBill.bill_date,
        )
        .join(PharmacyPurchaseBill, PharmacyPurchaseBillLine.bill_id == PharmacyPurchaseBill.id)
        .where(
            PharmacyPurchaseBillLine.item_id == item_id,
            PharmacyPurchaseBill.is_active.is_(True),
        )
    )
    buckets: dict[str, dict] = {}
    for batch_no, expiry, qty, rate, bill_date in purchased.all():
        key = (batch_no or "").strip()
        bucket = buckets.get(key)
        if bucket is None:
            bucket = {
                "batch_no": key or None,
                "expiry_date": expiry,
                "stock_qty": 0,
                "purchase_rate": rate,
                "bill_date": bill_date,
            }
            buckets[key] = bucket
        bucket["stock_qty"] += int(qty or 0)
        if expiry is not None and (bucket["expiry_date"] is None or expiry < bucket["expiry_date"]):
            bucket["expiry_date"] = expiry
        if bill_date is not None and (bucket["bill_date"] is None or bill_date >= bucket["bill_date"]):
            bucket["purchase_rate"] = rate
            bucket["bill_date"] = bill_date

    signed_sold_qty = func.sum(
        case(
            (PharmacySaleBill.bill_kind == "return", -PharmacySaleBillLine.quantity),
            else_=PharmacySaleBillLine.quantity,
        )
    )
    sold_rows = await session.execute(
        select(
            PharmacySaleBillLine.batch_no,
            func.coalesce(signed_sold_qty, 0),
        )
        .join(PharmacySaleBill, PharmacySaleBillLine.bill_id == PharmacySaleBill.id)
        .where(
            PharmacySaleBillLine.item_id == item_id,
            PharmacySaleBill.is_active.is_(True),
        )
        .group_by(PharmacySaleBillLine.batch_no)
    )
    for batch_no, qty in sold_rows.all():
        key = (batch_no or "").strip()
        if key in buckets:
            buckets[key]["stock_qty"] -= int(qty or 0)

    rows = [row for row in buckets.values() if row["stock_qty"] > 0]
    rows.sort(key=lambda row: (row["expiry_date"] is None, row["expiry_date"] or date.max))
    for row in rows:
        row.pop("bill_date", None)
    return rows


async def sold_qty_by_item(session: AsyncSession) -> dict[str, int]:
    signed_qty = func.sum(
        case(
            (PharmacySaleBill.bill_kind == "return", -PharmacySaleBillLine.quantity),
            else_=PharmacySaleBillLine.quantity,
        )
    )
    result = await session.execute(
        select(
            PharmacySaleBillLine.item_id,
            func.coalesce(signed_qty, 0),
        )
        .join(PharmacySaleBill, PharmacySaleBillLine.bill_id == PharmacySaleBill.id)
        .where(PharmacySaleBill.is_active.is_(True))
        .group_by(PharmacySaleBillLine.item_id)
    )
    return {row[0]: int(row[1]) for row in result.all()}


async def returnable_sale_batches_for_item(session: AsyncSession, item_id: str) -> list[dict]:
    """Net sold quantity by batch, used to prevent returning more than was sold."""
    signed_qty = func.sum(
        case(
            (PharmacySaleBill.bill_kind == "return", -PharmacySaleBillLine.quantity),
            else_=PharmacySaleBillLine.quantity,
        )
    )
    result = await session.execute(
        select(
            PharmacySaleBillLine.batch_no,
            func.max(PharmacySaleBillLine.expiry_date),
            func.coalesce(signed_qty, 0).label("returnable_qty"),
            func.max(PharmacySaleBillLine.rate),
        )
        .join(PharmacySaleBill, PharmacySaleBillLine.bill_id == PharmacySaleBill.id)
        .where(
            PharmacySaleBillLine.item_id == item_id,
            PharmacySaleBill.is_active.is_(True),
        )
        .group_by(PharmacySaleBillLine.batch_no)
        .having(func.coalesce(signed_qty, 0) > 0)
    )
    return [
        {
            "batch_no": row[0],
            "expiry_date": row[1],
            "stock_qty": int(row[2]),
            "rate": row[3],
        }
        for row in result.all()
    ]


async def sales_summary_by_item(
    session: AsyncSession, from_date: date, to_date: date
) -> list[tuple[str, str, int, float]]:
    result = await session.execute(
        select(
            PharmacySaleBillLine.item_code,
            PharmacySaleBillLine.item_name,
            func.coalesce(func.sum(PharmacySaleBillLine.quantity), 0),
            func.coalesce(func.sum(PharmacySaleBillLine.amount), 0),
        )
        .join(PharmacySaleBill, PharmacySaleBillLine.bill_id == PharmacySaleBill.id)
        .where(
            PharmacySaleBill.is_active.is_(True),
            PharmacySaleBill.bill_kind == "sale",
            PharmacySaleBill.bill_date >= from_date,
            PharmacySaleBill.bill_date <= to_date,
        )
        .group_by(PharmacySaleBillLine.item_code, PharmacySaleBillLine.item_name)
        .order_by(PharmacySaleBillLine.item_name)
    )
    return list(result.all())


async def schedule_h_sales(
    session: AsyncSession, from_date: date, to_date: date
) -> list[tuple]:
    result = await session.execute(
        select(
            PharmacySaleBill.bill_no,
            PharmacySaleBill.bill_date,
            PharmacySaleBill.patient_name,
            PharmacySaleBillLine.item_code,
            PharmacySaleBillLine.item_name,
            PharmacySaleBillLine.schedule,
            PharmacySaleBillLine.quantity,
            PharmacySaleBillLine.amount,
        )
        .join(PharmacySaleBillLine, PharmacySaleBillLine.bill_id == PharmacySaleBill.id)
        .where(
            PharmacySaleBill.is_active.is_(True),
            PharmacySaleBill.bill_kind == "sale",
            PharmacySaleBill.bill_date >= from_date,
            PharmacySaleBill.bill_date <= to_date,
            PharmacySaleBillLine.schedule.in_(["H", "H1", "X"]),
        )
        .order_by(PharmacySaleBill.bill_date.desc(), PharmacySaleBill.bill_no.desc())
    )
    return list(result.all())


async def list_active_items(session: AsyncSession) -> list[PharmacyItem]:
    result = await session.execute(
        select(PharmacyItem)
        .where(PharmacyItem.is_active.is_(True))
        .order_by(PharmacyItem.item_type, PharmacyItem.name)
    )
    return list(result.scalars().all())
