"""Voucher posting: builds bill totals, double-entry ledger postings, stock updates."""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.models.masters import CompanyProfile, GstRate, Ledger, Party, PaymentMode, Product
from modules.generp.ge.services.tax import compute_line_amounts, normalize_slabs, resolve_slab, tax_inclusive_for
from modules.generp.ge.models.transactions import (
    Voucher,
    VoucherEntry,
    VoucherItem,
    VoucherPayment,
)
from modules.generp.ge.schemas.transactions import VoucherIn
from modules.generp.ge.services.cashbook_posting import CashbookPostingService
from modules.generp.ge.services.document_numbers import next_document_no, peek_document_no
from modules.generp.ge.services.ledger_codes import ledger_by_key
from modules.generp.ge.services.stock_lots import add_lot, consume_fifo, peek_fifo, restore_fifo, reverse_source_lots
from modules.generp.ge.services.stock_guard import assert_stock_available, lock_products
from modules.generp.ge.services.sale_pricing import SALE_RATE_FIFO, company_sale_rate_source

VOUCHER_PREFIX = {
    "SALE": "SAL",
    "WHOLESALE": "WSL",
    "PURCHASE": "PUR",
    "SALE_RETURN": "SRN",
    "PURCHASE_RETURN": "PRN",
    "SHOP_SALE": "SHOP",
}

# Counter sales that reduce stock and use split tender / party credit flow
RETAIL_SALE_TYPES = frozenset({"SALE", "WHOLESALE", "SHOP_SALE"})

CASHBOOK_SOURCE = {
    "SALE": "sale_bill",
    "WHOLESALE": "wholesale_bill",
    "SHOP_SALE": "shop_sale",
}


async def _post_sale_cashbook(
    session: AsyncSession,
    voucher: Voucher,
    party: Party | None,
    payments: list,
    *,
    bill_before_adjust: float,
    net_payable: float,
    adjust_advance: float,
) -> None:
    """Post retail sale into the unified cashbook (soft-deactivates prior voucher on edit)."""
    source_type = CASHBOOK_SOURCE.get(voucher.voucher_type)
    if not source_type:
        return

    payment_entries: list[tuple[str, float]] = []
    for p in payments:
        amt = round(float(getattr(p, "amount", 0) or 0), 2)
        mode_id = getattr(p, "payment_mode_id", None)
        if not mode_id or amt <= 0:
            continue
        mode = (
            await session.execute(select(PaymentMode).where(PaymentMode.id == mode_id))
        ).scalar_one_or_none()
        if mode and mode.is_credit:
            continue
        payment_entries.append((mode_id, amt))

    cash_paid = round(sum(a for _m, a in payment_entries), 2)
    # Cashbook income = cash/bank collected + advance adjusted (credit due stays on party ledger)
    cashbook_net = cash_paid
    if cashbook_net <= 0.005 and adjust_advance <= 0.005:
        # Fully on credit — deactivate any prior cashbook voucher and skip
        await CashbookPostingService(session).deactivate_by_source(source_type, voucher.id)
        return

    from decimal import Decimal

    await CashbookPostingService(session).post_bill(
        source_type=source_type,
        source_id=voucher.id,
        bill_no=voucher.voucher_no,
        bill_date=voucher.voucher_date,
        party_id=party.id if party else None,
        party_code=party.code if party else None,
        payment_entries=[(m, Decimal(str(a))) for m, a in payment_entries],
        gross_amount=Decimal(str(bill_before_adjust)),
        net_amount=Decimal(str(cashbook_net)),
        adjust_advance=Decimal(str(adjust_advance)),
    )


async def _tax_profile(session: AsyncSession) -> CompanyProfile | None:
    return (
        await session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
    ).scalar_one_or_none()


async def _product_ceiling_mrp(session: AsyncSession, product: Product) -> float:
    source = await company_sale_rate_source(session)
    if source == SALE_RATE_FIFO:
        lot = await peek_fifo(session, product.id)
        if lot and float(lot.mrp or 0) > 0:
            return float(lot.mrp)
    return float(product.mrp or 0)


async def _assert_sale_discount_ceiling(
    product: Product,
    *,
    qty: float,
    rate: float,
    discount_amount: float,
    voucher_type: str,
) -> None:
    ceiling = float(getattr(product, "max_discount_pct", 0) or 0)
    if ceiling <= 0:
        return
    if voucher_type == "WHOLESALE":
        list_price = float(product.wholesale_price or 0) or float(product.sale_price or 0)
    else:
        list_price = float(product.sale_price or 0)
    if list_price <= 0:
        return
    unit = rate if qty <= 0 else (qty * rate - discount_amount) / qty
    min_amt = round(list_price * (1 - min(ceiling, 100.0) / 100.0), 2)
    name = product.name or product.code or "item"
    if unit + 0.005 < min_amt:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Minimum amount you can give for {name} is {min_amt:.2f} "
                f"({ceiling:g}% off sale price {list_price:.2f})."
            ),
        )


async def _purchase_parking_enabled(session: AsyncSession) -> bool:
    profile = await _tax_profile(session)
    return bool(getattr(profile, "purchase_bill_parking", False)) if profile else False


async def _resolve_item_gst(
    session: AsyncSession, item, product: Product | None
) -> tuple[float, str | None]:
    slabs = normalize_slabs(getattr(product, "tax_slabs", None) if product else None)
    slab = resolve_slab(slabs, float(item.rate or 0)) if slabs else None
    gst_id = (slab.get("gst_id") if slab else None) or item.gst_id or (
        product.gst_id if product else None
    )
    gst_rate = float(slab["rate"]) if slab else 0.0
    gst = None
    if gst_id:
        gst = (
            await session.execute(select(GstRate).where(GstRate.id == gst_id))
        ).scalar_one_or_none()
        if gst and not slab:
            gst_rate = float(gst.rate or 0)
    if slab and (not gst_id or gst is None):
        gst = (
            await session.execute(
                select(GstRate).where(GstRate.is_active.is_(True), GstRate.rate == gst_rate)
            )
        ).scalars().first()
        if gst:
            gst_id = gst.id
    return gst_rate, gst_id


async def _add_item_line(
    session: AsyncSession,
    voucher: Voucher,
    item,
    idx: int,
    *,
    inclusive: bool,
    voucher_type: str,
    post_stock: bool = True,
) -> tuple[float, float, float]:
    qty = float(item.quantity or 0)
    rate = float(item.rate or 0)
    line_disc = float(item.discount_amount or 0)
    mrp = float(getattr(item, "mrp", 0) or 0)
    sale_price = float(getattr(item, "sale_price", 0) or 0)
    profit_pct = float(getattr(item, "profit_pct", 0) or 0)
    product: Product | None = None
    if item.product_id:
        product = (
            await session.execute(
                select(Product).where(Product.id == item.product_id).with_for_update()
            )
        ).scalar_one_or_none()
    if mrp <= 0 and product is not None and voucher_type in RETAIL_SALE_TYPES:
        mrp = await _product_ceiling_mrp(session, product)
    gst_rate, gst_id = await _resolve_item_gst(session, item, product)
    taxable, gst_amount, amount = compute_line_amounts(
        qty=qty,
        rate=rate,
        discount_amount=line_disc,
        gst_rate=gst_rate,
        inclusive=inclusive,
    )
    session.add(
        VoucherItem(
            voucher_id=voucher.id,
            product_id=item.product_id,
            description=item.description,
            quantity=qty,
            rate=rate,
            discount_amount=line_disc,
            gst_id=gst_id,
            gst_rate=gst_rate,
            gst_amount=gst_amount,
            taxable_amount=taxable,
            amount=amount,
            mrp=mrp,
            sale_price=sale_price,
            profit_pct=profit_pct,
            sort_order=idx,
        )
    )
    if product:
        if post_stock and (voucher_type in RETAIL_SALE_TYPES or voucher_type == "PURCHASE_RETURN"):
            await assert_stock_available(session, product, qty)
        if post_stock and voucher_type in RETAIL_SALE_TYPES:
            await _assert_sale_discount_ceiling(
                product,
                qty=qty,
                rate=rate,
                discount_amount=line_disc,
                voucher_type=voucher_type,
            )
        if post_stock:
            cur = float(product.current_stock or 0)
            if voucher_type in RETAIL_SALE_TYPES:
                cur -= qty
            elif voucher_type == "PURCHASE":
                cur += qty
            elif voucher_type == "SALE_RETURN":
                cur += qty
            elif voucher_type == "PURCHASE_RETURN":
                cur -= qty
            product.current_stock = cur
        if post_stock and voucher_type == "PURCHASE":
            if rate > 0:
                product.purchase_price = rate
            if mrp > 0:
                product.mrp = mrp
            if sale_price > 0:
                product.sale_price = sale_price
        if post_stock:
            if voucher_type in RETAIL_SALE_TYPES:
                await consume_fifo(session, product.id, qty)
            elif voucher_type == "PURCHASE":
                await add_lot(
                    session,
                    product,
                    qty,
                    voucher.voucher_date,
                    source_type="PURCHASE",
                    source_id=voucher.id,
                    cost=rate,
                    sale_rate=sale_price if sale_price > 0 else None,
                    mrp=mrp if mrp > 0 else None,
                )
            elif voucher_type == "SALE_RETURN":
                await add_lot(
                    session,
                    product,
                    qty,
                    voucher.voucher_date,
                    source_type="SALE_RETURN",
                    source_id=voucher.id,
                    sale_rate=rate,
                )
            elif voucher_type == "PURCHASE_RETURN":
                await consume_fifo(session, product.id, qty)
    return qty * rate, taxable, gst_amount


async def _ledger_by_code(session: AsyncSession, code: str) -> Ledger | None:
    return await ledger_by_key(session, code)


def _gstin_state(gstin: str | None) -> str:
    g = (gstin or "").strip().upper()
    if len(g) >= 2 and g[:2].isdigit():
        return g[:2]
    return ""


async def _is_interstate(session: AsyncSession, party: Party | None) -> bool:
    company = await _tax_profile(session)
    c_code = _gstin_state(getattr(company, "gstin", None) if company else None)
    p_code = _gstin_state(getattr(party, "gstin", None) if party else None)
    if c_code and p_code:
        return c_code != p_code
    c_state = (getattr(company, "state", None) or "").strip().lower() if company else ""
    p_state = (getattr(party, "state", None) or "").strip().lower() if party else ""
    if c_state and p_state:
        return c_state != p_state
    return False


async def _post_gst(
    session: AsyncSession,
    add,
    tax_total: float,
    *,
    output: bool,
    interstate: bool,
    reverse: bool = False,
) -> None:
    """Split GST onto CGST/SGST or IGST; fall back to GST_OUTPUT / GST_INPUT."""
    tax_total = round(float(tax_total or 0), 2)
    if tax_total < 0.005:
        return
    debit_first = (output and reverse) or (not output and not reverse)

    def sides(amount: float) -> tuple[float, float]:
        return (amount, 0.0) if debit_first else (0.0, amount)

    if interstate:
        key = "IGST_OUTPUT" if output else "IGST_INPUT"
        igst = await ledger_by_key(session, key)
        if igst:
            d, c = sides(tax_total)
            add(igst, d, c)
            return
    else:
        cgst_key = "CGST_OUTPUT" if output else "CGST_INPUT"
        sgst_key = "SGST_OUTPUT" if output else "SGST_INPUT"
        cgst = await ledger_by_key(session, cgst_key)
        sgst = await ledger_by_key(session, sgst_key)
        if cgst and sgst:
            half = round(tax_total / 2.0, 2)
            rest = round(tax_total - half, 2)
            d1, c1 = sides(half)
            d2, c2 = sides(rest)
            add(cgst, d1, c1)
            add(sgst, d2, c2)
            return
    fallback = await ledger_by_key(session, "GST_OUTPUT" if output else "GST_INPUT")
    d, c = sides(tax_total)
    add(fallback, d, c)


async def _next_voucher_no(
    session: AsyncSession, vtype: str, voucher_date: date | None = None
) -> str:
    """Atomically increment a per-type FY counter under a row lock so two terminals
    saving at the same time can never produce the same bill number."""
    return await next_document_no(session, vtype, voucher_date)


async def peek_next_voucher_no(
    session: AsyncSession,
    vtype: str,
    voucher_date: date | None = None,
) -> tuple[str, str | None]:
    """Read-only preview of the next number (does NOT consume it) plus the last issued one."""
    return await peek_document_no(session, vtype, voucher_date)


async def create_voucher(
    session: AsyncSession, data: VoucherIn, user_id: str | None
) -> Voucher:
    if data.voucher_type not in VOUCHER_PREFIX:
        raise HTTPException(status_code=400, detail="Invalid voucher_type")
    if not data.items:
        raise HTTPException(status_code=400, detail="At least one line item is required")

    is_sale_side = data.voucher_type in ("SALE", "WHOLESALE", "SHOP_SALE", "SALE_RETURN")
    is_credit = bool(data.is_credit)

    party: Party | None = None
    if data.party_id:
        party = (
            await session.execute(select(Party).where(Party.id == data.party_id))
        ).scalar_one_or_none()
    if is_credit and not party:
        raise HTTPException(status_code=400, detail="Credit bill requires a party (customer/vendor)")

    await lock_products(session, [it.product_id for it in data.items])

    payment_mode: PaymentMode | None = None
    if data.payment_mode_id:
        payment_mode = (
            await session.execute(select(PaymentMode).where(PaymentMode.id == data.payment_mode_id))
        ).scalar_one_or_none()

    voucher = Voucher(
        voucher_type=data.voucher_type,
        voucher_no=await _next_voucher_no(
            session, data.voucher_type, data.voucher_date or date.today()
        ),
        voucher_date=data.voucher_date or date.today(),
        party_id=party.id if party else None,
        payment_mode_id=payment_mode.id if payment_mode else None,
        is_credit=is_credit,
        narration=data.narration,
        party_bill_no=_party_bill_no(data),
        created_by=user_id,
    )
    parking_on = await _purchase_parking_enabled(session)
    is_parked = (
        bool(getattr(data, "is_parked", False))
        and parking_on
        and data.voucher_type == "PURCHASE"
    )
    voucher.is_parked = is_parked
    session.add(voucher)
    await session.flush()

    profile = await _tax_profile(session)
    inclusive = tax_inclusive_for(data.voucher_type, profile)
    gross = 0.0
    tax_total = 0.0
    taxable_total = 0.0
    for idx, item in enumerate(data.items):
        line_gross, taxable, gst_amount = await _add_item_line(
            session,
            voucher,
            item,
            idx,
            inclusive=inclusive,
            voucher_type=data.voucher_type,
            post_stock=not is_parked,
        )
        gross += line_gross
        taxable_total += taxable
        tax_total += gst_amount

    discount = float(data.discount_amount or 0)
    adjust = max(0.0, round(float(getattr(data, "adjust_advance", 0) or 0), 2))
    bill_before_adjust = round(taxable_total + tax_total - discount, 2)
    net = round(bill_before_adjust - adjust, 2)
    if net < -0.005:
        raise HTTPException(status_code=400, detail="adjust_advance cannot exceed bill amount")
    if adjust > 0.005 and not party:
        raise HTTPException(status_code=400, detail="Customer is required when adjusting advance")
    voucher.gross_amount = round(gross, 2)
    voucher.discount_amount = discount
    voucher.tax_amount = round(tax_total, 2)
    voucher.adjust_advance = adjust
    voucher.net_amount = max(net, 0.0)
    taxable_net = taxable_total - discount

    if is_parked:
        await session.flush()
        return voucher
    if data.voucher_type in RETAIL_SALE_TYPES and data.payments:
        cash_bank_paid, party_due = await _apply_sale_payments(
            session, voucher, data.payments, voucher.net_amount, party
        )
        voucher.is_credit = party_due > 0.005
        first_mode = next((p.payment_mode_id for p in data.payments if p.payment_mode_id), None)
        if first_mode:
            voucher.payment_mode_id = first_mode
        await _post_entries_sale_split(
            session, voucher, party, data.payments, taxable_net, tax_total, party_due
        )
        await _post_sale_cashbook(
            session,
            voucher,
            party,
            data.payments,
            bill_before_adjust=bill_before_adjust,
            net_payable=voucher.net_amount,
            adjust_advance=adjust,
        )
    elif data.voucher_type == "PURCHASE":
        payments = data.payments or []
        _cash_paid, party_due = await _apply_sale_payments(
            session,
            voucher,
            payments,
            voucher.net_amount,
            party,
            party_label="supplier",
        )
        voucher.is_credit = party_due > 0.005
        first_mode = next((p.payment_mode_id for p in payments if p.payment_mode_id), None)
        if first_mode:
            voucher.payment_mode_id = first_mode
        await _post_entries_purchase_split(
            session, voucher, party, payments, taxable_net, tax_total, party_due
        )
    else:
        await _post_entries(session, voucher, party, payment_mode, taxable_net, tax_total, voucher.net_amount)
    await session.flush()
    return voucher


async def _rebuild_voucher_lines(
    session: AsyncSession,
    voucher: Voucher,
    data: VoucherIn,
    *,
    post_stock: bool = True,
) -> tuple[Party | None, float, float, float]:
    """Shared item builder for create and update. Returns party, taxable_net, tax_total, net."""
    if not data.items:
        raise HTTPException(status_code=400, detail="At least one line item is required")

    party: Party | None = None
    if data.party_id:
        party = (
            await session.execute(select(Party).where(Party.id == data.party_id))
        ).scalar_one_or_none()

    await lock_products(session, [it.product_id for it in data.items])

    profile = await _tax_profile(session)
    inclusive = tax_inclusive_for(data.voucher_type, profile)
    gross = 0.0
    tax_total = 0.0
    taxable_total = 0.0
    for idx, item in enumerate(data.items):
        line_gross, taxable, gst_amount = await _add_item_line(
            session,
            voucher,
            item,
            idx,
            inclusive=inclusive,
            voucher_type=voucher.voucher_type,
            post_stock=post_stock,
        )
        gross += line_gross
        taxable_total += taxable
        tax_total += gst_amount

    discount = float(data.discount_amount or 0)
    adjust = max(0.0, round(float(getattr(data, "adjust_advance", 0) or 0), 2))
    bill_before_adjust = round(taxable_total + tax_total - discount, 2)
    net = round(bill_before_adjust - adjust, 2)
    if net < -0.005:
        raise HTTPException(status_code=400, detail="adjust_advance cannot exceed bill amount")
    if adjust > 0.005 and not party:
        raise HTTPException(status_code=400, detail="Customer is required when adjusting advance")
    voucher.gross_amount = round(gross, 2)
    voucher.discount_amount = discount
    voucher.tax_amount = round(tax_total, 2)
    voucher.adjust_advance = adjust
    voucher.net_amount = max(net, 0.0)
    taxable_net = taxable_total - discount
    return party, taxable_net, tax_total, voucher.net_amount


async def update_voucher(
    session: AsyncSession, voucher_id: str, data: VoucherIn, user_id: str | None
) -> Voucher:
    locked = (
        await session.execute(select(Voucher).where(Voucher.id == voucher_id).with_for_update())
    ).scalar_one_or_none()
    if not locked:
        raise HTTPException(status_code=404, detail="Voucher not found")
    voucher = await load_voucher(session, voucher_id)
    if not voucher:
        raise HTTPException(status_code=404, detail="Voucher not found")
    if voucher.is_cancelled:
        raise HTTPException(status_code=400, detail="Cannot modify a cancelled voucher")
    if voucher.voucher_type not in RETAIL_SALE_TYPES and voucher.voucher_type != "PURCHASE":
        raise HTTPException(status_code=400, detail="Only sale, wholesale, or purchase bills can be modified here")
    if data.voucher_type != voucher.voucher_type:
        raise HTTPException(status_code=400, detail="Invalid voucher_type")

    await lock_products(
        session,
        [it.product_id for it in voucher.items] + [it.product_id for it in data.items],
    )

    was_parked = bool(getattr(voucher, "is_parked", False))
    parking_on = await _purchase_parking_enabled(session)
    is_parked = (
        bool(getattr(data, "is_parked", False))
        and parking_on
        and voucher.voucher_type == "PURCHASE"
    )

    if voucher.voucher_type == "PURCHASE":
        if not was_parked:
            await _unpost_purchase_stock(session, voucher)
    else:
        for item in voucher.items:
            if item.product_id:
                product = (
                    await session.execute(
                        select(Product).where(Product.id == item.product_id).with_for_update()
                    )
                ).scalar_one_or_none()
                if product:
                    product.current_stock = float(product.current_stock or 0) + float(item.quantity or 0)
                    await restore_fifo(session, product.id, float(item.quantity or 0))

    for entry in list(voucher.entries):
        await session.delete(entry)
    for pay in list(voucher.payments):
        await session.delete(pay)
    for item in list(voucher.items):
        await session.delete(item)
    await session.flush()

    voucher.voucher_date = data.voucher_date or date.today()
    voucher.narration = data.narration
    voucher.party_bill_no = _party_bill_no(data)
    voucher.is_parked = is_parked
    party, taxable_net, tax_total, net = await _rebuild_voucher_lines(
        session, voucher, data, post_stock=not is_parked
    )
    voucher.party_id = party.id if party else None

    if is_parked:
        await session.flush()
        return voucher

    if voucher.voucher_type == "PURCHASE":
        payments = data.payments or []
        _cash_bank_paid, party_due = await _apply_sale_payments(
            session, voucher, payments, net, party, party_label="supplier"
        )
        voucher.is_credit = party_due > 0.005
        first_mode = next((p.payment_mode_id for p in payments if p.payment_mode_id), None)
        if first_mode:
            voucher.payment_mode_id = first_mode
        await _post_entries_purchase_split(
            session, voucher, party, payments, taxable_net, tax_total, party_due
        )
    elif data.payments:
        cash_bank_paid, party_due = await _apply_sale_payments(
            session, voucher, data.payments, net, party
        )
        voucher.is_credit = party_due > 0.005
        first_mode = next((p.payment_mode_id for p in data.payments if p.payment_mode_id), None)
        if first_mode:
            voucher.payment_mode_id = first_mode
        await _post_entries_sale_split(
            session, voucher, party, data.payments, taxable_net, tax_total, party_due
        )
        bill_before = round(net + float(voucher.adjust_advance or 0), 2)
        await _post_sale_cashbook(
            session,
            voucher,
            party,
            data.payments,
            bill_before_adjust=bill_before,
            net_payable=net,
            adjust_advance=float(voucher.adjust_advance or 0),
        )
    else:
        raise HTTPException(status_code=400, detail="Sale bill requires payment lines")

    await session.flush()
    return voucher


async def _apply_sale_payments(
    session: AsyncSession,
    voucher: Voucher,
    payments: list,
    net: float,
    party: Party | None,
    party_label: str = "customer",
) -> tuple[float, float]:
    """Persist tender lines and return (cash/bank paid, unpaid party balance)."""
    cash_bank_paid = 0.0
    for idx, p in enumerate(payments):
        amt = round(float(p.amount or 0), 2)
        mode: PaymentMode | None = None
        if p.payment_mode_id:
            mode = (
                await session.execute(
                    select(PaymentMode).where(PaymentMode.id == p.payment_mode_id)
                )
            ).scalar_one_or_none()
        session.add(
            VoucherPayment(
                voucher_id=voucher.id,
                payment_mode_id=mode.id if mode else None,
                amount=amt,
                reference=getattr(p, "reference", None),
                sort_order=idx,
            )
        )
        # A "credit" mode is not real money in hand → it becomes party outstanding.
        if mode and not mode.is_credit:
            cash_bank_paid += amt
    party_due = round(net - cash_bank_paid, 2)
    if party_due > 0.005 and not party:
        raise HTTPException(
            status_code=400,
            detail=f"Select a {party_label}: the bill is not fully paid (a credit balance remains).",
        )
    if party_due < -0.005 and not party:
        raise HTTPException(
            status_code=400,
            detail="Paid amount is more than the bill total. Reduce the tender.",
        )
    return cash_bank_paid, party_due


async def _counter_ledger(
    session: AsyncSession, payment_mode: PaymentMode | None
) -> Ledger | None:
    """The cash/bank ledger for non-credit bills."""
    if payment_mode and payment_mode.ledger_id:
        return (
            await session.execute(select(Ledger).where(Ledger.id == payment_mode.ledger_id))
        ).scalar_one_or_none()
    return await _ledger_by_code(session, "CASH")


async def _post_entries(
    session: AsyncSession,
    voucher: Voucher,
    party: Party | None,
    payment_mode: PaymentMode | None,
    taxable_net: float,
    tax_total: float,
    net: float,
) -> None:
    vtype = voucher.voucher_type
    d = voucher.voucher_date
    sales = await _ledger_by_code(session, "SALES")
    sales_return = await _ledger_by_code(session, "SALES_RETURN") or sales
    purchase = await _ledger_by_code(session, "PURCHASE")
    purchase_return = await _ledger_by_code(session, "PURCHASE_RETURN") or purchase
    interstate = await _is_interstate(session, party)

    def add(ledger: Ledger | None, debit: float, credit: float) -> None:
        if not ledger or (abs(debit) < 0.005 and abs(credit) < 0.005):
            return
        session.add(
            VoucherEntry(
                voucher_id=voucher.id,
                ledger_id=ledger.id,
                entry_date=d,
                debit=round(debit, 2),
                credit=round(credit, 2),
                narration=f"{vtype} {voucher.voucher_no}",
            )
        )

    party_ledger = None
    if party and party.ledger_id:
        party_ledger = (
            await session.execute(select(Ledger).where(Ledger.id == party.ledger_id))
        ).scalar_one_or_none()
    counter = await _counter_ledger(session, payment_mode)

    if vtype in RETAIL_SALE_TYPES:
        debit_ledger = party_ledger if voucher.is_credit else counter
        add(debit_ledger, net, 0)
        add(sales, 0, taxable_net)
        await _post_gst(session, add, tax_total, output=True, interstate=interstate)
    elif vtype == "SALE_RETURN":
        credit_ledger = party_ledger if voucher.is_credit else counter
        add(sales_return, taxable_net, 0)
        await _post_gst(session, add, tax_total, output=True, interstate=interstate, reverse=True)
        add(credit_ledger, 0, net)
    elif vtype == "PURCHASE":
        credit_ledger = party_ledger if voucher.is_credit else counter
        add(purchase, taxable_net, 0)
        await _post_gst(session, add, tax_total, output=False, interstate=interstate)
        add(credit_ledger, 0, net)
    elif vtype == "PURCHASE_RETURN":
        debit_ledger = party_ledger if voucher.is_credit else counter
        add(debit_ledger, net, 0)
        add(purchase_return, 0, taxable_net)
        await _post_gst(session, add, tax_total, output=False, interstate=interstate, reverse=True)


async def _post_entries_sale_split(
    session: AsyncSession,
    voucher: Voucher,
    party: Party | None,
    payments: list,
    taxable_net: float,
    tax_total: float,
    party_due: float,
) -> None:
    """SALE with split tender: debit each cash/bank ledger by its amount, debit the
    customer for any unpaid balance; credit sales + GST output."""
    d = voucher.voucher_date
    sales = await _ledger_by_code(session, "SALES")
    interstate = await _is_interstate(session, party)

    def add(ledger: Ledger | None, debit: float, credit: float) -> None:
        if not ledger or (abs(debit) < 0.005 and abs(credit) < 0.005):
            return
        session.add(
            VoucherEntry(
                voucher_id=voucher.id,
                ledger_id=ledger.id,
                entry_date=d,
                debit=round(debit, 2),
                credit=round(credit, 2),
                narration=f"{voucher.voucher_type} {voucher.voucher_no}",
            )
        )

    for p in payments:
        amt = round(float(p.amount or 0), 2)
        if amt == 0:
            continue
        mode: PaymentMode | None = None
        if p.payment_mode_id:
            mode = (
                await session.execute(
                    select(PaymentMode).where(PaymentMode.id == p.payment_mode_id)
                )
            ).scalar_one_or_none()
        if mode and mode.is_credit:
            continue  # folded into party_due below
        counter = await _counter_ledger(session, mode)
        add(counter, amt, 0)

    if party and abs(party_due) >= 0.005:
        party_ledger = None
        if party.ledger_id:
            party_ledger = (
                await session.execute(select(Ledger).where(Ledger.id == party.ledger_id))
            ).scalar_one_or_none()
        add(party_ledger, max(party_due, 0.0), max(-party_due, 0.0))

    adjust = round(float(getattr(voucher, "adjust_advance", 0) or 0), 2)
    if adjust > 0.005:
        deposit = await _ledger_by_code(session, "CUST-DEPOSIT")
        add(deposit, adjust, 0)

    add(sales, 0, taxable_net)
    await _post_gst(session, add, tax_total, output=True, interstate=interstate)


async def _post_entries_purchase_split(
    session: AsyncSession,
    voucher: Voucher,
    party: Party | None,
    payments: list,
    taxable_net: float,
    tax_total: float,
    party_due: float,
) -> None:
    """PURCHASE with split tender: debit purchase + GST input; credit each cash/bank;
    credit the supplier for any unpaid balance."""
    d = voucher.voucher_date
    purchase = await _ledger_by_code(session, "PURCHASE")
    interstate = await _is_interstate(session, party)

    def add(ledger: Ledger | None, debit: float, credit: float) -> None:
        if not ledger or (abs(debit) < 0.005 and abs(credit) < 0.005):
            return
        session.add(
            VoucherEntry(
                voucher_id=voucher.id,
                ledger_id=ledger.id,
                entry_date=d,
                debit=round(debit, 2),
                credit=round(credit, 2),
                narration=f"{voucher.voucher_type} {voucher.voucher_no}",
            )
        )

    add(purchase, taxable_net, 0)
    await _post_gst(session, add, tax_total, output=False, interstate=interstate)

    for p in payments:
        amt = round(float(p.amount or 0), 2)
        if amt == 0:
            continue
        mode: PaymentMode | None = None
        if p.payment_mode_id:
            mode = (
                await session.execute(
                    select(PaymentMode).where(PaymentMode.id == p.payment_mode_id)
                )
            ).scalar_one_or_none()
        if mode and mode.is_credit:
            continue
        counter = await _counter_ledger(session, mode)
        add(counter, 0, amt)

    if party and abs(party_due) >= 0.005:
        party_ledger = None
        if party.ledger_id:
            party_ledger = (
                await session.execute(select(Ledger).where(Ledger.id == party.ledger_id))
            ).scalar_one_or_none()
        add(party_ledger, max(-party_due, 0.0), max(party_due, 0.0))


def _party_bill_no(data) -> str | None:
    raw = getattr(data, "party_bill_no", None)
    if raw is None:
        return None
    text = str(raw).strip()
    return text[:80] if text else None


def dump_voucher_trace(v: Voucher) -> dict:
    """JSON-serializable voucher snapshot for audit tracing and restore."""
    return {
        "id": v.id,
        "voucher_type": v.voucher_type,
        "voucher_no": v.voucher_no,
        "voucher_date": v.voucher_date.isoformat() if v.voucher_date else None,
        "party_id": v.party_id,
        "party_name": v.party.name if v.party else None,
        "party_bill_no": getattr(v, "party_bill_no", None),
        "narration": v.narration,
        "is_credit": v.is_credit,
        "is_cancelled": v.is_cancelled,
        "gross_amount": float(v.gross_amount or 0),
        "discount_amount": float(v.discount_amount or 0),
        "tax_amount": float(v.tax_amount or 0),
        "adjust_advance": float(getattr(v, "adjust_advance", 0) or 0),
        "net_amount": float(v.net_amount or 0),
        "items": [
            {
                "id": it.id,
                "product_id": it.product_id,
                "product_code": it.product.code if it.product else None,
                "product_name": it.product.name if it.product else it.description,
                "description": it.description,
                "quantity": float(it.quantity or 0),
                "rate": float(it.rate or 0),
                "discount_amount": float(it.discount_amount or 0),
                "gst_id": it.gst_id,
                "gst_rate": float(it.gst_rate or 0),
                "gst_amount": float(it.gst_amount or 0),
                "taxable_amount": float(it.taxable_amount or 0),
                "amount": float(it.amount or 0),
            }
            for it in sorted(v.items or [], key=lambda x: x.sort_order)
        ],
        "payments": [
            {
                "id": p.id,
                "payment_mode_id": p.payment_mode_id,
                "payment_mode_name": p.payment_mode.name if p.payment_mode else None,
                "amount": float(p.amount or 0),
                "reference": p.reference,
            }
            for p in sorted(v.payments or [], key=lambda x: x.sort_order)
        ],
    }


async def _unpost_purchase_stock(session: AsyncSession, voucher: Voucher) -> None:
    for item in voucher.items or []:
        if not item.product_id:
            continue
        qty = float(item.quantity or 0)
        product = (
            await session.execute(
                select(Product).where(Product.id == item.product_id).with_for_update()
            )
        ).scalar_one_or_none()
        if not product:
            continue
        product.current_stock = float(product.current_stock or 0) - qty
        await reverse_source_lots(session, voucher.id, product.id, qty)


async def cancel_posted_voucher(session: AsyncSession, voucher_id: str) -> Voucher:
    locked = (
        await session.execute(select(Voucher).where(Voucher.id == voucher_id).with_for_update())
    ).scalar_one_or_none()
    if not locked:
        raise HTTPException(status_code=404, detail="Not found")
    voucher = await load_voucher(session, voucher_id)
    if not voucher:
        raise HTTPException(status_code=404, detail="Not found")
    if voucher.is_cancelled:
        raise HTTPException(status_code=400, detail="This bill is already deleted")
    if voucher.voucher_type == "PURCHASE" and not bool(getattr(voucher, "is_parked", False)):
        await _unpost_purchase_stock(session, voucher)
        for entry in list(voucher.entries or []):
            await session.delete(entry)
    voucher.is_cancelled = True
    await session.flush()
    return voucher


async def restore_cancelled_voucher(session: AsyncSession, voucher_id: str) -> Voucher:
    locked = (
        await session.execute(select(Voucher).where(Voucher.id == voucher_id).with_for_update())
    ).scalar_one_or_none()
    if not locked:
        raise HTTPException(status_code=404, detail="Voucher not found")
    voucher = await load_voucher(session, voucher_id)
    if not voucher:
        raise HTTPException(status_code=404, detail="Voucher not found")
    if not voucher.is_cancelled:
        raise HTTPException(status_code=400, detail="This bill is already active")
    if voucher.voucher_type == "PURCHASE" and not (voucher.entries or []) and not bool(
        getattr(voucher, "is_parked", False)
    ):
        for item in voucher.items or []:
            if not item.product_id:
                continue
            qty = float(item.quantity or 0)
            product = (
                await session.execute(
                    select(Product).where(Product.id == item.product_id).with_for_update()
                )
            ).scalar_one_or_none()
            if not product:
                continue
            product.current_stock = float(product.current_stock or 0) + qty
            await add_lot(
                session,
                product,
                qty,
                voucher.voucher_date,
                source_type="PURCHASE",
                source_id=voucher.id,
                cost=float(item.rate or 0),
            )
        payments = list(voucher.payments or [])
        taxable_net = sum(float(it.taxable_amount or 0) for it in (voucher.items or [])) - float(
            voucher.discount_amount or 0
        )
        tax_total = float(voucher.tax_amount or 0)
        cash_paid = 0.0
        for p in payments:
            amt = round(float(p.amount or 0), 2)
            if amt == 0:
                continue
            if p.payment_mode and p.payment_mode.is_credit:
                continue
            if p.payment_mode_id and not p.payment_mode:
                continue
            if p.payment_mode and not p.payment_mode.is_credit:
                cash_paid += amt
            elif not p.payment_mode_id:
                cash_paid += amt
        party_due = round(float(voucher.net_amount or 0) - cash_paid, 2)
        await _post_entries_purchase_split(
            session, voucher, voucher.party, payments, taxable_net, tax_total, party_due
        )
    voucher.is_cancelled = False
    await session.flush()
    return voucher


async def load_voucher(session: AsyncSession, voucher_id: str) -> Voucher | None:
    return (
        await session.execute(
            select(Voucher)
            .options(
                selectinload(Voucher.items).selectinload(VoucherItem.product),
                selectinload(Voucher.party),
                selectinload(Voucher.payments).selectinload(VoucherPayment.payment_mode),
                selectinload(Voucher.entries),
            )
            .where(Voucher.id == voucher_id)
        )
    ).scalar_one_or_none()
