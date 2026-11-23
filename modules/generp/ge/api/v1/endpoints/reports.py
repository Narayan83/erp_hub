from datetime import date
import logging
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.cashbook import CashbookVoucher, CashbookVoucherLine
from modules.generp.ge.models.masters import CompanyProfile, Ledger, Party, PaymentMode, PrintConfig
from modules.generp.ge.models.transactions import Voucher, VoucherEntry, VoucherPayment
from modules.generp.ge.reports.bill_context import (
    apply_bill_format,
    build_sale_bill_context,
    company_header_context,
    split_gst,
)
from modules.generp.ge.reports.bill_formats import is_thermal, resolve_bill_format
from modules.generp.ge.reports.layout_render import render_document_html
from modules.generp.ge.services.print_local import get_report_format
from modules.generp.ge.schemas.transactions import (
    CashbookRow,
    DaybookRow,
    DebtorRow,
    LedgerDetailsResponse,
    LedgerEntryRow,
)
from modules.generp.ge.services.posting import load_voucher
from modules.generp.ge.services.reports import ReportService

logger = logging.getLogger(__name__)

router = APIRouter()


def _report_service() -> ReportService:
    return ReportService()


def _report_code_for_voucher(voucher) -> str:
    voucher_type = getattr(voucher, "voucher_type", None)
    if voucher_type == "WHOLESALE":
        return "WHOLESALE_BILL"
    if voucher_type == "PURCHASE":
        return "PURCHASE_BILL"
    return "SALE_BILL"


async def _load_layout_options(session: AsyncSession, code: str) -> dict | None:
    from erp_core.product_config import get_product_name

    obj = (
        await session.execute(
            select(PrintConfig).where(
                PrintConfig.product == get_product_name(),
                PrintConfig.code == code.upper(),
            )
        )
    ).scalar_one_or_none()
    return obj.layout_options if obj else None


def _render_sale_bill_html(voucher, requested_format: str | None) -> tuple[str, str]:
    report_code = _report_code_for_voucher(voucher)
    bill_format = resolve_bill_format(requested_format, get_report_format(report_code))
    template = "sale_bill_thermal.html" if is_thermal(bill_format) else "sale_bill_receipt.html"
    return bill_format, template


async def _sale_bill_html_response(session: AsyncSession, voucher, requested_format: str | None) -> HTMLResponse:
    bill_format, template = _render_sale_bill_html(voucher, requested_format)
    context = await _company_report_context(session, build_sale_bill_context(voucher))
    context = apply_bill_format(context, bill_format)
    report_code = _report_code_for_voucher(voucher)

    async def _generp_or_template() -> str:
        try:
            layout_raw = await _load_layout_options(session, report_code)
            return render_document_html(
                code=report_code,
                context=context,
                layout_raw=layout_raw,
                bill_format=bill_format,
            )
        except Exception:
            logger.exception("Layout render failed for %s, falling back to template", report_code)
            return _report_service().render_html(template, context, bill_format=bill_format)

    # Prefer platform designed sheets (Print Master / Bill Template Designer) when present.
    from erp_core.services.designed_print import render_designed_or_fallback

    html = await render_designed_or_fallback(
        session,
        code=report_code,
        context=context,
        fallback_html=_generp_or_template,
    )
    return HTMLResponse(content=html)


async def _company_report_context(session: AsyncSession, base: dict) -> dict:
    profile = (
        await session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
    ).scalar_one_or_none()
    return {**base, **company_header_context(profile or {})}


def _signed_opening(ledger: Ledger) -> float:
    bal = float(ledger.opening_balance or 0)
    return bal if (ledger.opening_type or "Dr") == "Dr" else -bal


async def _ledger_details(
    session: AsyncSession, ledger: Ledger, date_from: date | None, date_to: date | None
) -> LedgerDetailsResponse:
    trading_q = (
        select(VoucherEntry, Voucher)
        .join(Voucher, Voucher.id == VoucherEntry.voucher_id)
        .where(VoucherEntry.ledger_id == ledger.id, Voucher.is_cancelled.is_(False))
    )
    if date_from:
        trading_q = trading_q.where(VoucherEntry.entry_date >= date_from)
    if date_to:
        trading_q = trading_q.where(VoucherEntry.entry_date <= date_to)

    cashbook_q = (
        select(CashbookVoucherLine, CashbookVoucher)
        .join(CashbookVoucher, CashbookVoucher.id == CashbookVoucherLine.voucher_id)
        .where(
            CashbookVoucherLine.ledger_id == ledger.id,
            CashbookVoucherLine.is_active.is_(True),
            CashbookVoucher.is_active.is_(True),
        )
    )
    if date_from:
        cashbook_q = cashbook_q.where(CashbookVoucher.voucher_date >= date_from)
    if date_to:
        cashbook_q = cashbook_q.where(CashbookVoucher.voucher_date <= date_to)

    opening = _signed_opening(ledger)
    if date_from:
        trading_before = (
            await session.execute(
                select(
                    func.coalesce(func.sum(VoucherEntry.debit), 0),
                    func.coalesce(func.sum(VoucherEntry.credit), 0),
                )
                .join(Voucher, Voucher.id == VoucherEntry.voucher_id)
                .where(
                    VoucherEntry.ledger_id == ledger.id,
                    Voucher.is_cancelled.is_(False),
                    VoucherEntry.entry_date < date_from,
                )
            )
        ).one()
        cashbook_before = (
            await session.execute(
                select(
                    func.coalesce(func.sum(CashbookVoucherLine.debit_amount), 0),
                    func.coalesce(func.sum(CashbookVoucherLine.credit_amount), 0),
                )
                .join(CashbookVoucher, CashbookVoucher.id == CashbookVoucherLine.voucher_id)
                .where(
                    CashbookVoucherLine.ledger_id == ledger.id,
                    CashbookVoucherLine.is_active.is_(True),
                    CashbookVoucher.is_active.is_(True),
                    CashbookVoucher.voucher_date < date_from,
                )
            )
        ).one()
        opening += (
            float(trading_before[0] or 0)
            - float(trading_before[1] or 0)
            + float(cashbook_before[0] or 0)
            - float(cashbook_before[1] or 0)
        )

    activity: list[tuple[date, str, str, str | None, float, float, int]] = []
    for entry, voucher in (await session.execute(trading_q)).all():
        activity.append(
            (
                entry.entry_date,
                voucher.voucher_type,
                voucher.voucher_no,
                entry.narration,
                float(entry.debit or 0),
                float(entry.credit or 0),
                0,
            )
        )
    for line, voucher in (await session.execute(cashbook_q)).all():
        voucher_type = str(voucher.kind or voucher.source_type or "ACCOUNTING").replace("_", " ").upper()
        activity.append(
            (
                voucher.voucher_date,
                voucher_type,
                voucher.voucher_no,
                line.narration or voucher.narration,
                float(line.debit_amount or 0),
                float(line.credit_amount or 0),
                1,
            )
        )
    activity.sort(key=lambda item: (item[0], item[2], item[6]))

    balance = opening
    rows: list[LedgerEntryRow] = []
    for entry_date, voucher_type, voucher_no, narration, debit, credit, _source in activity:
        balance += debit - credit
        rows.append(
            LedgerEntryRow(
                entry_date=entry_date,
                voucher_type=voucher_type,
                voucher_no=voucher_no,
                narration=narration,
                debit=debit,
                credit=credit,
                balance=round(balance, 2),
            )
        )
    return LedgerDetailsResponse(
        ledger_id=ledger.id,
        ledger_name=ledger.name,
        opening_balance=round(opening, 2),
        rows=rows,
        closing_balance=round(balance, 2),
    )


@router.get("/ledger-details", response_model=LedgerDetailsResponse)
async def ledger_details(
    ledger_id: str,
    date_from: date | None = None,
    date_to: date | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    ledger = (await session.execute(select(Ledger).where(Ledger.id == ledger_id))).scalar_one_or_none()
    if not ledger:
        raise HTTPException(status_code=404, detail="Ledger not found")
    return await _ledger_details(session, ledger, date_from, date_to)


@router.get("/sundry-debtors", response_model=list[DebtorRow])
async def sundry_debtors(
    group_name: str = "Sundry Debtors",
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    ledgers = (
        await session.execute(select(Ledger).where(Ledger.group_name == group_name, Ledger.is_active.is_(True)))
    ).scalars().all()
    party_by_ledger = {
        p.ledger_id: p
        for p in (await session.execute(select(Party).where(Party.ledger_id.isnot(None)))).scalars().all()
    }
    rows: list[DebtorRow] = []
    for ledger in ledgers:
        totals = (
            await session.execute(
                select(
                    func.coalesce(func.sum(VoucherEntry.debit), 0),
                    func.coalesce(func.sum(VoucherEntry.credit), 0),
                )
                .join(Voucher, Voucher.id == VoucherEntry.voucher_id)
                .where(VoucherEntry.ledger_id == ledger.id, Voucher.is_cancelled.is_(False))
            )
        ).one()
        cashbook_totals = (
            await session.execute(
                select(
                    func.coalesce(func.sum(CashbookVoucherLine.debit_amount), 0),
                    func.coalesce(func.sum(CashbookVoucherLine.credit_amount), 0),
                )
                .join(CashbookVoucher, CashbookVoucher.id == CashbookVoucherLine.voucher_id)
                .where(
                    CashbookVoucherLine.ledger_id == ledger.id,
                    CashbookVoucherLine.is_active.is_(True),
                    CashbookVoucher.is_active.is_(True),
                )
            )
        ).one()
        debit = float(totals[0] or 0) + float(cashbook_totals[0] or 0)
        credit = float(totals[1] or 0) + float(cashbook_totals[1] or 0)
        balance = _signed_opening(ledger) + debit - credit
        if abs(balance) < 0.005:
            continue
        # Debtors: positive (Dr) balance. Creditors group: negative shown as positive owed.
        if group_name == "Sundry Debtors" and balance <= 0:
            continue
        if group_name == "Sundry Creditors" and balance >= 0:
            continue
        party = party_by_ledger.get(ledger.id)
        rows.append(
            DebtorRow(
                party_id=party.id if party else None,
                ledger_id=ledger.id,
                name=ledger.name,
                debit=round(debit, 2),
                credit=round(credit, 2),
                balance=round(abs(balance), 2),
            )
        )
    rows.sort(key=lambda r: r.balance, reverse=True)
    return rows


@router.get("/debtor-details", response_model=LedgerDetailsResponse)
async def debtor_details(
    party_id: str | None = None,
    ledger_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if party_id and not ledger_id:
        party = (await session.execute(select(Party).where(Party.id == party_id))).scalar_one_or_none()
        if not party or not party.ledger_id:
            raise HTTPException(status_code=404, detail="Party ledger not found")
        ledger_id = party.ledger_id
    ledger = (await session.execute(select(Ledger).where(Ledger.id == ledger_id))).scalar_one_or_none()
    if not ledger:
        raise HTTPException(status_code=404, detail="Ledger not found")
    return await _ledger_details(session, ledger, date_from, date_to)


@router.get("/cashbook", response_model=list[CashbookRow])
async def cashbook(
    date_from: date | None = None,
    date_to: date | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    cash_ledgers = (
        await session.execute(
            select(Ledger).where(
                Ledger.is_cash.is_(True)
                | Ledger.is_bank.is_(True)
                | (Ledger.code == "CASH")
                | Ledger.group_name.in_(["Cash", "Bank", "Cash/Bank", "Cash-in-Hand", "Bank Accounts"])
            )
        )
    ).scalars().all()
    if not cash_ledgers:
        return []
    ledger_ids = [c.id for c in cash_ledgers]
    opening = sum(_signed_opening(c) for c in cash_ledgers)
    q = (
        select(VoucherEntry, Voucher)
        .join(Voucher, Voucher.id == VoucherEntry.voucher_id)
        .where(VoucherEntry.ledger_id.in_(ledger_ids), Voucher.is_cancelled.is_(False))
    )
    if date_from:
        q = q.where(VoucherEntry.entry_date >= date_from)
    if date_to:
        q = q.where(VoucherEntry.entry_date <= date_to)
    q = q.order_by(VoucherEntry.entry_date, Voucher.voucher_no)
    result = await session.execute(q)
    balance = opening
    rows: list[CashbookRow] = []
    for entry, voucher in result.all():
        debit = float(entry.debit or 0)
        credit = float(entry.credit or 0)
        balance += debit - credit
        rows.append(
            CashbookRow(
                entry_date=entry.entry_date,
                voucher_type=voucher.voucher_type,
                voucher_no=voucher.voucher_no,
                narration=entry.narration,
                debit=debit,
                credit=credit,
                balance=round(balance, 2),
            )
        )
    return rows


@router.get("/daybook", response_model=list[DaybookRow])
async def daybook(
    day: date | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    q = select(Voucher).where(Voucher.is_cancelled.is_(False))
    if day:
        q = q.where(Voucher.voucher_date == day)
    else:
        if date_from:
            q = q.where(Voucher.voucher_date >= date_from)
        if date_to:
            q = q.where(Voucher.voucher_date <= date_to)
    q = q.options(selectinload(Voucher.party)).order_by(Voucher.voucher_date, Voucher.voucher_no)
    result = await session.execute(q)
    return [
        DaybookRow(
            voucher_date=v.voucher_date,
            voucher_type=v.voucher_type,
            voucher_no=v.voucher_no,
            party_name=v.party.name if v.party else None,
            net_amount=float(v.net_amount or 0),
        )
        for v in result.scalars().all()
    ]


@router.get("/daily-collection")
async def daily_collection(
    day: date | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    bill_from: str | None = None,
    bill_to: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await _daily_collection_payload(
        session, day=day, date_from=date_from, date_to=date_to, bill_from=bill_from, bill_to=bill_to
    )
    return data


@router.get("/daily-collection/bills")
async def daily_collection_bills(
    day: date | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    bill_from: str | None = None,
    bill_to: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await _daily_collection_bills_payload(
        session, day=day, date_from=date_from, date_to=date_to, bill_from=bill_from, bill_to=bill_to
    )


@router.get("/daily-collection/bills/html")
async def daily_collection_bills_html(
    day: date | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    bill_from: str | None = None,
    bill_to: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await _daily_collection_bills_payload(
        session, day=day, date_from=date_from, date_to=date_to, bill_from=bill_from, bill_to=bill_to
    )
    context = await _company_report_context(session, data)
    html = _report_service().render_html("daily_collection_bills.html", context)
    return HTMLResponse(content=html)


@router.get("/daily-collection/html")
async def daily_collection_html(
    day: date | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    bill_from: str | None = None,
    bill_to: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await _daily_collection_payload(
        session, day=day, date_from=date_from, date_to=date_to, bill_from=bill_from, bill_to=bill_to
    )
    context = await _company_report_context(session, data)
    report_code = "DAILY_COLLECTION_REPORT"

    async def _generp_or_template() -> str:
        try:
            layout_raw = await _load_layout_options(session, report_code)
            return render_document_html(
                code=report_code,
                context=context,
                layout_raw=layout_raw,
                bill_format="A4",
            )
        except Exception:
            logger.exception("Layout render failed for daily collection, falling back to template")
            return _report_service().render_html("daily_collection.html", context)

    from erp_core.services.designed_print import render_designed_or_fallback

    html = await render_designed_or_fallback(
        session,
        code=report_code,
        context=context,
        fallback_html=_generp_or_template,
    )
    return HTMLResponse(content=html)


async def _collection_vouchers(
    session: AsyncSession,
    *,
    date_from: date,
    date_to: date,
    bill_from: str | None,
    bill_to: str | None,
) -> list[Voucher]:
    q = (
        select(Voucher)
        .options(selectinload(Voucher.items), selectinload(Voucher.party))
        .where(
            Voucher.voucher_type.in_(("SALE", "WHOLESALE")),
            Voucher.is_cancelled.is_(False),
            Voucher.voucher_date >= date_from,
            Voucher.voucher_date <= date_to,
        )
        .order_by(Voucher.voucher_date, Voucher.voucher_no)
    )
    bf = (bill_from or "").strip()
    bt = (bill_to or "").strip()
    if bf:
        q = q.where(Voucher.voucher_no >= bf)
    if bt:
        q = q.where(Voucher.voucher_no <= bt)
    return list((await session.execute(q)).scalars().unique().all())


def _rate_key(rate: float) -> str:
    n = float(rate or 0)
    if abs(n - round(n)) < 0.001:
        return str(int(round(n)))
    return f"{n:.2f}".rstrip("0").rstrip(".")


def _unique_gst_rates(vouchers: list[Voucher]) -> list[str]:
    seen: set[str] = set()
    for v in vouchers:
        for it in v.items or []:
            seen.add(_rate_key(float(it.gst_rate or 0)))
    return sorted(seen, key=lambda k: float(k))


def _sum_amount_maps(maps: list[dict[str, float]], gst_rates: list[str]) -> dict[str, float]:
    out = {k: 0.0 for k in gst_rates}
    for m in maps:
        for k, val in m.items():
            out[k] = round(out.get(k, 0) + float(val or 0), 2)
    return out


def _bill_collection_row(voucher: Voucher, gst_rates: list[str]) -> dict:
    amounts = {k: 0.0 for k in gst_rates}
    for it in voucher.items or []:
        key = _rate_key(float(it.gst_rate or 0))
        amounts[key] = round(amounts.get(key, 0) + float(it.amount or 0), 2)
    total = round(sum(amounts.values()), 2)
    return {
        "id": voucher.id,
        "voucher_no": voucher.voucher_no,
        "voucher_type": voucher.voucher_type,
        "voucher_date": voucher.voucher_date.isoformat() if voucher.voucher_date else None,
        "party_name": voucher.party.name if voucher.party else "Walk-in",
        "net_amount": float(voucher.net_amount or 0),
        "amounts": amounts,
        "total": total,
    }


def _collection_date_range(
    day: date | None, date_from: date | None, date_to: date | None
) -> tuple[date, date]:
    start = date_from or day or date.today()
    end = date_to or day or date.today()
    if end < start:
        start, end = end, start
    return start, end


async def _daily_collection_bills_payload(
    session: AsyncSession,
    *,
    day: date | None,
    date_from: date | None,
    date_to: date | None,
    bill_from: str | None,
    bill_to: str | None,
) -> dict:
    start, end = _collection_date_range(day, date_from, date_to)
    vouchers = await _collection_vouchers(
        session, date_from=start, date_to=end, bill_from=bill_from, bill_to=bill_to
    )
    gst_rates = _unique_gst_rates(vouchers)
    bills = [_bill_collection_row(v, gst_rates) for v in vouchers]
    totals = _sum_amount_maps([b["amounts"] for b in bills], gst_rates)
    grand = round(sum(float(b["total"]) for b in bills), 2)
    return {
        "date": start.isoformat() if start == end else None,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "bill_from": (bill_from or "").strip() or None,
        "bill_to": (bill_to or "").strip() or None,
        "gst_rates": gst_rates,
        "bills": bills,
        "totals": {"amounts": totals, "total": grand, "bill_count": len(bills)},
    }


async def _daily_collection_payload(
    session: AsyncSession,
    *,
    day: date | None,
    date_from: date | None,
    date_to: date | None,
    bill_from: str | None,
    bill_to: str | None,
) -> dict:
    start, end = _collection_date_range(day, date_from, date_to)
    vouchers = await _collection_vouchers(
        session, date_from=start, date_to=end, bill_from=bill_from, bill_to=bill_to
    )
    gst_rates = _unique_gst_rates(vouchers)
    grouped: dict[date, list[Voucher]] = defaultdict(list)
    for v in vouchers:
        grouped[v.voucher_date].append(v)

    rows = []
    for d in sorted(grouped):
        bills = grouped[d]
        bills.sort(key=lambda x: x.voucher_no)
        amounts = {k: 0.0 for k in gst_rates}
        for v in bills:
            for it in v.items or []:
                key = _rate_key(float(it.gst_rate or 0))
                amounts[key] = round(amounts.get(key, 0) + float(it.amount or 0), 2)
        total = round(sum(amounts.values()), 2)
        rows.append(
            {
                "date": d.isoformat(),
                "bill_from": bills[0].voucher_no if bills else "",
                "bill_to": bills[-1].voucher_no if bills else "",
                "bill_count": len(bills),
                "amounts": amounts,
                "total": total,
            }
        )

    col_totals = _sum_amount_maps([r["amounts"] for r in rows], gst_rates)
    grand = round(sum(float(r["total"]) for r in rows), 2)

    pay_q = (
        select(
            PaymentMode.name,
            func.coalesce(func.sum(VoucherPayment.amount), 0),
        )
        .join(Voucher, Voucher.id == VoucherPayment.voucher_id)
        .join(PaymentMode, PaymentMode.id == VoucherPayment.payment_mode_id, isouter=True)
        .where(
            Voucher.voucher_type.in_(("SALE", "WHOLESALE")),
            Voucher.voucher_date >= start,
            Voucher.voucher_date <= end,
            Voucher.is_cancelled.is_(False),
            PaymentMode.is_credit.is_(False),
        )
        .group_by(PaymentMode.name)
        .order_by(PaymentMode.name)
    )
    if (bill_from or "").strip():
        pay_q = pay_q.where(Voucher.voucher_no >= bill_from.strip())
    if (bill_to or "").strip():
        pay_q = pay_q.where(Voucher.voucher_no <= bill_to.strip())
    pay_result = await session.execute(pay_q)
    payment_rows = [{"payment_mode": name or "Cash", "total": float(total or 0)} for name, total in pay_result.all()]
    payment_total = round(sum(r["total"] for r in payment_rows), 2)

    return {
        "date": start.isoformat() if start == end else None,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "bill_from": (bill_from or "").strip() or None,
        "bill_to": (bill_to or "").strip() or None,
        "gst_rates": gst_rates,
        "rows": rows,
        "totals": {
            "amounts": col_totals,
            "total": grand,
            "bill_count": sum(int(r["bill_count"]) for r in rows),
        },
        "payment_rows": payment_rows,
        "payment_total": payment_total,
        "total": payment_total,
    }


def _empty_tax_totals() -> dict[str, float]:
    return {"taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0, "cess": 0.0, "total": 0.0}


def _add_tax_totals(acc: dict[str, float], row: dict) -> None:
    for key in acc:
        acc[key] = round(acc[key] + float(row.get(key) or 0), 2)


async def _company_gstin(session: AsyncSession) -> str:
    profile = (
        await session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
    ).scalar_one_or_none()
    return str(getattr(profile, "gstin", None) or "")


def _tax_breakup_for_voucher(voucher: Voucher, company_gstin: str) -> list[dict]:
    grouped: dict[str, dict[str, float]] = {}
    for it in voucher.items or []:
        key = _rate_key(float(it.gst_rate or 0))
        bucket = grouped.setdefault(key, {"taxable": 0.0, "gst": 0.0, "total": 0.0})
        bucket["taxable"] = round(bucket["taxable"] + float(it.taxable_amount or 0), 2)
        bucket["gst"] = round(bucket["gst"] + float(it.gst_amount or 0), 2)
        bucket["total"] = round(bucket["total"] + float(it.amount or 0), 2)
    party_gstin = str(getattr(voucher.party, "gstin", None) or "") if voucher.party else ""
    rows = []
    for gst_pct in sorted(grouped, key=lambda k: float(k)):
        bucket = grouped[gst_pct]
        cgst, sgst, igst = split_gst(bucket["gst"], company_gstin, party_gstin)
        rows.append(
            {
                "id": voucher.id,
                "voucher_id": voucher.id,
                "voucher_no": voucher.voucher_no,
                "voucher_type": voucher.voucher_type,
                "voucher_date": voucher.voucher_date.isoformat() if voucher.voucher_date else None,
                "party_name": voucher.party.name if voucher.party else "Walk-in",
                "gst_pct": gst_pct,
                "taxable": bucket["taxable"],
                "cgst": cgst,
                "sgst": sgst,
                "igst": igst,
                "cess": 0.0,
                "total": bucket["total"],
            }
        )
    return rows


async def _taxwise_bill_summary_payload(
    session: AsyncSession,
    *,
    date_from: date | None,
    date_to: date | None,
    bill_from: str | None,
    bill_to: str | None,
) -> dict:
    start, end = _collection_date_range(None, date_from, date_to)
    vouchers = await _collection_vouchers(
        session, date_from=start, date_to=end, bill_from=bill_from, bill_to=bill_to
    )
    company_gstin = await _company_gstin(session)
    rows: list[dict] = []
    for voucher in vouchers:
        rows.extend(_tax_breakup_for_voucher(voucher, company_gstin))
    totals = _empty_tax_totals()
    for row in rows:
        _add_tax_totals(totals, row)
    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "bill_from": (bill_from or "").strip() or None,
        "bill_to": (bill_to or "").strip() or None,
        "rows": rows,
        "totals": totals,
    }


async def _taxwise_summary_payload(
    session: AsyncSession,
    *,
    date_from: date | None,
    date_to: date | None,
    bill_from: str | None,
    bill_to: str | None,
) -> dict:
    data = await _taxwise_bill_summary_payload(
        session, date_from=date_from, date_to=date_to, bill_from=bill_from, bill_to=bill_to
    )
    grouped: dict[str, dict[str, float]] = {}
    for row in data["rows"]:
        key = str(row["gst_pct"])
        bucket = grouped.setdefault(key, _empty_tax_totals())
        _add_tax_totals(bucket, row)
    rows = [
        {"gst_pct": key, **grouped[key]}
        for key in sorted(grouped, key=lambda k: float(k))
    ]
    totals = _empty_tax_totals()
    for row in rows:
        _add_tax_totals(totals, row)
    return {
        "date_from": data["date_from"],
        "date_to": data["date_to"],
        "bill_from": data["bill_from"],
        "bill_to": data["bill_to"],
        "rows": rows,
        "totals": totals,
    }


@router.get("/taxwise-bill-summary")
async def taxwise_bill_summary(
    date_from: date | None = None,
    date_to: date | None = None,
    bill_from: str | None = None,
    bill_to: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await _taxwise_bill_summary_payload(
        session, date_from=date_from, date_to=date_to, bill_from=bill_from, bill_to=bill_to
    )


@router.get("/taxwise-bill-summary/html")
async def taxwise_bill_summary_html(
    date_from: date | None = None,
    date_to: date | None = None,
    bill_from: str | None = None,
    bill_to: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await _taxwise_bill_summary_payload(
        session, date_from=date_from, date_to=date_to, bill_from=bill_from, bill_to=bill_to
    )
    context = await _company_report_context(session, data)
    html = _report_service().render_html("taxwise_bill_summary.html", context)
    return HTMLResponse(content=html)


@router.get("/taxwise-summary")
async def taxwise_summary(
    date_from: date | None = None,
    date_to: date | None = None,
    bill_from: str | None = None,
    bill_to: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await _taxwise_summary_payload(
        session, date_from=date_from, date_to=date_to, bill_from=bill_from, bill_to=bill_to
    )


@router.get("/taxwise-summary/html")
async def taxwise_summary_html(
    date_from: date | None = None,
    date_to: date | None = None,
    bill_from: str | None = None,
    bill_to: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await _taxwise_summary_payload(
        session, date_from=date_from, date_to=date_to, bill_from=bill_from, bill_to=bill_to
    )
    context = await _company_report_context(session, data)
    html = _report_service().render_html("taxwise_summary.html", context)
    return HTMLResponse(content=html)


@router.get("/sale-bill/{voucher_id}/html")
async def sale_bill_html(
    voucher_id: str,
    format: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    voucher = await load_voucher(session, voucher_id)
    if not voucher or voucher.voucher_type not in ("SALE", "WHOLESALE", "PURCHASE"):
        raise HTTPException(status_code=404, detail="Bill not found")
    try:
        return await _sale_bill_html_response(session, voucher, format)
    except Exception as exc:
        logger.exception("Failed to render sale bill %s", voucher_id)
        raise HTTPException(status_code=500, detail=f"Failed to render bill: {exc}") from exc


@router.get("/sale-bill/by-no/{voucher_no}/html")
async def sale_bill_html_by_no(
    voucher_no: str,
    voucher_type: str = "SALE",
    format: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if voucher_type not in ("SALE", "WHOLESALE", "PURCHASE"):
        raise HTTPException(status_code=400, detail="Invalid voucher_type")
    voucher = (
        await session.execute(
            select(Voucher).where(
                Voucher.voucher_no == voucher_no, Voucher.voucher_type == voucher_type
            )
        )
    ).scalar_one_or_none()
    if not voucher:
        raise HTTPException(status_code=404, detail="Sale bill not found")
    voucher = await load_voucher(session, voucher.id)
    if not voucher:
        raise HTTPException(status_code=404, detail="Sale bill not found")
    try:
        return await _sale_bill_html_response(session, voucher, format)
    except Exception as exc:
        logger.exception("Failed to render sale bill %s", voucher_no)
        raise HTTPException(status_code=500, detail=f"Failed to render bill: {exc}") from exc
