"""Unique stock barcodes issued on purchase, consumed on sale.

When Software Setup → Unique barcode stock is on:
- a normal product gets one barcode per piece (qty 1)
- a product with multiple barcode = Yes and pieces = 10, buying 70,
  gets one barcode for 70 pieces, printed 7 times (70 / 10)
Sale of that shared barcode asks for a quantity and reduces only that much.
"""

from __future__ import annotations

import math
from datetime import date

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.models.masters import CompanyProfile, Product
from modules.generp.ge.models.stock import LotMaster, StockBarcode, StockBarcodeMove
from modules.generp.ge.models.transactions import DocumentSequence, Voucher, VoucherItem

_EPS = 0.0005


def label_copies(qty: float, pieces: float) -> int:
    """How many times the same barcode is printed. 70 pieces at 10 → 7."""
    qty = float(qty or 0)
    pieces = float(pieces or 0)
    if qty <= 0:
        return 0
    if pieces <= 0:
        pieces = 1
    return max(1, math.ceil((qty / pieces) - 1e-9))


def unit_qtys(qty: float) -> list[float]:
    """Split a purchase qty into one-piece barcodes, keeping a fractional tail."""
    qty = round(float(qty or 0), 3)
    if qty <= 0:
        return []
    whole = int(math.floor(qty + 1e-9))
    out = [1.0] * whole
    frac = round(qty - whole, 3)
    if frac > _EPS:
        out.append(frac)
    return out or [qty]


async def unique_barcode_enabled(session: AsyncSession) -> bool:
    profile = (
        await session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
    ).scalar_one_or_none()
    return bool(profile and getattr(profile, "unique_barcode_stock", False))


async def _next_code(session: AsyncSession) -> str:
    seq = (
        await session.execute(
            select(DocumentSequence)
            .where(DocumentSequence.name == "STOCK_BARCODE")
            .with_for_update()
        )
    ).scalar_one_or_none()
    if seq is None:
        max_no = 0
        existing = (await session.execute(select(StockBarcode.barcode))).scalars().all()
        for raw in existing:
            text = str(raw or "").strip()
            if text.isdigit():
                max_no = max(max_no, int(text))
        seq = DocumentSequence(name="STOCK_BARCODE", prefix="", last_number=max_no)
        session.add(seq)
        await session.flush()
        seq = (
            await session.execute(
                select(DocumentSequence).where(DocumentSequence.id == seq.id).with_for_update()
            )
        ).scalar_one()
    seq.last_number = int(seq.last_number or 0) + 1
    await session.flush()
    return str(int(seq.last_number))


def _status_after(remaining: float, *, outbound_status: str) -> str:
    if remaining > _EPS:
        return "in_stock"
    return outbound_status


async def _record_move(
    session: AsyncSession,
    row: StockBarcode,
    delta: float,
    *,
    reason: str,
    outbound_status: str,
    voucher_id: str | None = None,
    voucher_item_id: str | None = None,
    stock_voucher_id: str | None = None,
) -> None:
    delta = round(float(delta), 3)
    if abs(delta) <= _EPS:
        return
    remaining = round(float(row.qty_remaining or 0) + delta, 3)
    if remaining < -_EPS:
        raise HTTPException(
            status_code=400,
            detail=f"Barcode {row.barcode} has only {float(row.qty_remaining or 0):.3f} left.",
        )
    if remaining < 0:
        remaining = 0
    row.qty_remaining = remaining
    row.status = _status_after(remaining, outbound_status=outbound_status if delta < 0 else "in_stock")
    if remaining > _EPS:
        row.status = "in_stock"
    session.add(
        StockBarcodeMove(
            stock_barcode_id=row.id,
            qty_delta=delta,
            reason=reason,
            voucher_id=voucher_id,
            voucher_item_id=voucher_item_id,
            stock_voucher_id=stock_voucher_id,
        )
    )


async def issue_purchase_barcodes(
    session: AsyncSession,
    voucher: Voucher,
    line: VoucherItem,
    product: Product,
) -> None:
    if not await unique_barcode_enabled(session):
        return
    qty = round(float(line.quantity or 0), 3)
    if qty <= 0:
        return
    rate = float(line.rate or 0)
    disc = float(line.discount_amount or 0)
    unit_cost = rate
    if qty > 0 and disc > 0:
        unit_cost = max(0.0, round((qty * rate - disc) / qty, 2))
    sale = float(line.sale_price or 0) or float(product.sale_price or 0)
    mrp = float(line.mrp or 0) or float(product.mrp or 0)
    gross = qty * rate
    disc_pct = round((disc / gross) * 100, 2) if gross > 0 else 0.0
    multi = bool(getattr(product, "multi_barcode", False))
    pieces = float(getattr(product, "barcode_piece_qty", 1) or 1)
    lot_id = getattr(line, "lot_id", None)
    supplier_id = voucher.party_id
    inward = voucher.voucher_date or date.today()

    if multi:
        copies = label_copies(qty, pieces)
        code = await _next_code(session)
        session.add(
            StockBarcode(
                barcode=code,
                product_id=product.id,
                lot_id=lot_id,
                voucher_id=voucher.id,
                voucher_item_id=line.id,
                supplier_id=supplier_id,
                inward_date=inward,
                qty_in=qty,
                qty_remaining=qty,
                cost_price=unit_cost,
                sale_rate=sale,
                mrp=mrp,
                disc_pct=disc_pct,
                status="in_stock",
                print_copies=copies,
            )
        )
        await session.flush()
        return

    for part in unit_qtys(qty):
        code = await _next_code(session)
        session.add(
            StockBarcode(
                barcode=code,
                product_id=product.id,
                lot_id=lot_id,
                voucher_id=voucher.id,
                voucher_item_id=line.id,
                supplier_id=supplier_id,
                inward_date=inward,
                qty_in=part,
                qty_remaining=part,
                cost_price=unit_cost,
                sale_rate=sale,
                mrp=mrp,
                disc_pct=disc_pct,
                status="in_stock",
                print_copies=1,
            )
        )
    await session.flush()


async def release_purchase_barcodes(session: AsyncSession, voucher_id: str) -> None:
    """Drop barcodes created by a purchase. Refuses when any piece was already used."""
    rows = (
        await session.execute(
            select(StockBarcode).where(StockBarcode.voucher_id == voucher_id).with_for_update()
        )
    ).scalars().all()
    if not rows:
        return
    ids = [r.id for r in rows]
    used = (
        await session.execute(
            select(func.count())
            .select_from(StockBarcodeMove)
            .where(StockBarcodeMove.stock_barcode_id.in_(ids))
        )
    ).scalar_one()
    if int(used or 0) > 0:
        raise HTTPException(
            status_code=400,
            detail="Barcodes from this purchase are already sold or transferred. The bill cannot be changed.",
        )
    for row in rows:
        if row.status != "in_stock" or float(row.qty_remaining or 0) + _EPS < float(row.qty_in or 0):
            raise HTTPException(
                status_code=400,
                detail=f"Barcode {row.barcode} is already used. The purchase cannot be changed.",
            )
        await session.delete(row)
    await session.flush()


async def _in_stock_rows(session: AsyncSession, product_id: str) -> list[StockBarcode]:
    return list(
        (
            await session.execute(
                select(StockBarcode)
                .where(
                    StockBarcode.product_id == product_id,
                    StockBarcode.status == "in_stock",
                    StockBarcode.qty_remaining > 0,
                )
                .order_by(StockBarcode.inward_date, StockBarcode.barcode)
                .with_for_update()
            )
        ).scalars().all()
    )


async def _consume_rows(
    session: AsyncSession,
    rows: list[StockBarcode],
    qty: float,
    *,
    reason: str,
    outbound_status: str,
    voucher_id: str | None,
    voucher_item_id: str | None,
    stock_voucher_id: str | None,
    line: VoucherItem | None,
    strict: bool,
) -> None:
    if not rows or qty <= _EPS:
        return
    available = sum(float(r.qty_remaining or 0) for r in rows)
    if strict and available + _EPS < qty:
        name = rows[0].barcode
        raise HTTPException(
            status_code=400,
            detail=f"Barcode {name} has only {available:.3f} left.",
        )
    left = min(qty, available)
    for row in rows:
        if left <= _EPS:
            break
        take = min(left, float(row.qty_remaining or 0))
        if take <= _EPS:
            continue
        if line is not None and not getattr(line, "lot_id", None) and row.lot_id:
            line.lot_id = row.lot_id
        await _record_move(
            session,
            row,
            -take,
            reason=reason,
            outbound_status=outbound_status,
            voucher_id=voucher_id,
            voucher_item_id=voucher_item_id,
            stock_voucher_id=stock_voucher_id,
        )
        left -= take


async def consume_sale_barcodes(
    session: AsyncSession,
    voucher: Voucher,
    line: VoucherItem,
    product: Product,
    qty: float,
) -> None:
    if not await unique_barcode_enabled(session):
        return
    bc_id = getattr(line, "stock_barcode_id", None)
    if bc_id:
        row = (
            await session.execute(
                select(StockBarcode).where(StockBarcode.id == bc_id).with_for_update()
            )
        ).scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=400, detail="Stock barcode was not found.")
        if row.product_id != product.id:
            raise HTTPException(status_code=400, detail="Barcode does not belong to this product.")
        if row.status == "transferred":
            raise HTTPException(status_code=400, detail=f"Barcode {row.barcode} is transferred.")
        if not line.lot_id and row.lot_id:
            line.lot_id = row.lot_id
        await _consume_rows(
            session,
            [row],
            qty,
            reason="SALE",
            outbound_status="sold",
            voucher_id=voucher.id,
            voucher_item_id=line.id,
            stock_voucher_id=None,
            line=line,
            strict=True,
        )
        return
    rows = await _in_stock_rows(session, product.id)
    await _consume_rows(
        session,
        rows,
        qty,
        reason="SALE",
        outbound_status="sold",
        voucher_id=voucher.id,
        voucher_item_id=line.id,
        stock_voucher_id=None,
        line=line,
        strict=False,
    )


async def restore_sale_barcodes(
    session: AsyncSession,
    voucher: Voucher,
    line: VoucherItem,
    product: Product,
    qty: float,
) -> None:
    """Put returned pieces back onto the barcode they were sold from."""
    if not await unique_barcode_enabled(session) or qty <= _EPS:
        return
    bc_id = getattr(line, "stock_barcode_id", None)
    if bc_id:
        row = (
            await session.execute(
                select(StockBarcode).where(StockBarcode.id == bc_id).with_for_update()
            )
        ).scalar_one_or_none()
        targets = [row] if row else []
    else:
        targets = list(
            (
                await session.execute(
                    select(StockBarcode)
                    .where(
                        StockBarcode.product_id == product.id,
                        StockBarcode.qty_remaining < StockBarcode.qty_in,
                        StockBarcode.status.in_(("sold", "in_stock")),
                    )
                    .order_by(StockBarcode.inward_date.desc(), StockBarcode.barcode.desc())
                    .with_for_update()
                )
            ).scalars().all()
        )
    left = float(qty)
    for row in targets:
        if left <= _EPS or row is None:
            break
        room = round(float(row.qty_in or 0) - float(row.qty_remaining or 0), 3)
        if room <= _EPS:
            continue
        add = min(left, room)
        await _record_move(
            session,
            row,
            add,
            reason="SALE_RETURN",
            outbound_status="sold",
            voucher_id=voucher.id,
            voucher_item_id=line.id,
        )
        left -= add


async def consume_purchase_return(
    session: AsyncSession,
    voucher: Voucher,
    line: VoucherItem,
    product: Product,
    qty: float,
) -> None:
    if not await unique_barcode_enabled(session):
        return
    rows = await _in_stock_rows(session, product.id)
    await _consume_rows(
        session,
        rows,
        qty,
        reason="PURCHASE_RETURN",
        outbound_status="returned",
        voucher_id=voucher.id,
        voucher_item_id=line.id,
        stock_voucher_id=None,
        line=line,
        strict=False,
    )


async def transfer_out_barcodes(
    session: AsyncSession,
    *,
    product_id: str,
    qty: float,
    stock_voucher_id: str,
) -> None:
    if not await unique_barcode_enabled(session):
        return
    rows = await _in_stock_rows(session, product_id)
    await _consume_rows(
        session,
        rows,
        qty,
        reason="TRANSFER_OUT",
        outbound_status="transferred",
        voucher_id=None,
        voucher_item_id=None,
        stock_voucher_id=stock_voucher_id,
        line=None,
        strict=False,
    )


async def reverse_barcode_moves(
    session: AsyncSession,
    *,
    voucher_id: str | None = None,
    stock_voucher_id: str | None = None,
) -> None:
    if not voucher_id and not stock_voucher_id:
        return
    q = select(StockBarcodeMove)
    if voucher_id:
        q = q.where(StockBarcodeMove.voucher_id == voucher_id)
    else:
        q = q.where(StockBarcodeMove.stock_voucher_id == stock_voucher_id)
    moves = (await session.execute(q)).scalars().all()
    for mv in moves:
        row = (
            await session.execute(
                select(StockBarcode).where(StockBarcode.id == mv.stock_barcode_id).with_for_update()
            )
        ).scalar_one_or_none()
        if row is not None:
            remaining = round(float(row.qty_remaining or 0) - float(mv.qty_delta or 0), 3)
            if remaining < 0:
                remaining = 0
            cap = float(row.qty_in or 0)
            if cap > 0 and remaining > cap + _EPS:
                remaining = cap
            row.qty_remaining = remaining
            if remaining > _EPS:
                row.status = "in_stock"
            elif mv.reason == "TRANSFER_OUT":
                row.status = "transferred"
            elif mv.reason == "PURCHASE_RETURN":
                row.status = "returned"
            else:
                row.status = "sold"
        await session.delete(mv)
    if moves:
        await session.flush()


async def lookup_barcode(session: AsyncSession, raw: str) -> dict | None:
    text = (raw or "").strip()
    if not text:
        return None
    row = (
        await session.execute(select(StockBarcode).where(StockBarcode.barcode == text))
    ).scalar_one_or_none()
    if row is None and text.isdigit():
        row = (
            await session.execute(select(StockBarcode).where(StockBarcode.barcode == str(int(text))))
        ).scalar_one_or_none()
    if row is None:
        return None
    product = (
        await session.execute(select(Product).where(Product.id == row.product_id))
    ).scalar_one_or_none()
    if product is None:
        return None
    lot = None
    if row.lot_id:
        lot = (
            await session.execute(select(LotMaster).where(LotMaster.id == row.lot_id))
        ).scalar_one_or_none()
    remaining = float(row.qty_remaining or 0)
    multi = bool(getattr(product, "multi_barcode", False))
    return {
        "id": row.id,
        "barcode": row.barcode,
        "product_id": product.id,
        "product_code": product.code,
        "product_name": product.name,
        "qty_remaining": remaining,
        "qty_in": float(row.qty_in or 0),
        "ask_qty": bool(multi and remaining > _EPS) or remaining > 1 + _EPS,
        "sale_rate": float(row.sale_rate or 0),
        "mrp": float(row.mrp or 0),
        "cost_price": float(row.cost_price or 0),
        "status": row.status,
        "lot_id": row.lot_id,
        "lot_name": f"{lot.code} {lot.name}".strip() if lot else None,
        "multi_barcode": multi,
    }


def _num_key(code: str):
    text = str(code or "")
    return (0, int(text)) if text.isdigit() else (1, text)


async def summaries_for_voucher(session: AsyncSession, voucher_id: str) -> dict[str, dict]:
    rows = (
        await session.execute(
            select(StockBarcode).where(StockBarcode.voucher_id == voucher_id)
        )
    ).scalars().all()
    grouped: dict[str, list[StockBarcode]] = {}
    for row in rows:
        grouped.setdefault(row.voucher_item_id or "", []).append(row)
    out: dict[str, dict] = {}
    for key, items in grouped.items():
        items.sort(key=lambda r: _num_key(r.barcode))
        codes = [r.barcode for r in items]
        out[key] = {
            "barcode_from": codes[0] if codes else None,
            "barcode_to": codes[-1] if codes else None,
            "print_copies": sum(int(r.print_copies or 1) for r in items),
            "barcodes": [
                {
                    "barcode": r.barcode,
                    "print_copies": int(r.print_copies or 1),
                    "qty": float(r.qty_in or 0),
                }
                for r in items
            ],
        }
    return out


def _net_rate(sale: float, disc: float) -> float:
    return round(float(sale or 0) * (1 - float(disc or 0) / 100), 2)


async def barcode_stock_report(
    session: AsyncSession,
    *,
    date_from: date | None,
    date_to: date | None,
    status: str,
    barcode: str | None,
    hide_sale_rates: bool,
) -> dict:
    q = select(StockBarcode)
    if date_from:
        q = q.where(StockBarcode.inward_date >= date_from)
    if date_to:
        q = q.where(StockBarcode.inward_date <= date_to)
    wanted = (status or "not_sold").strip().lower()
    if wanted in ("not_sold", "not sold", "unsold"):
        q = q.where(StockBarcode.status == "in_stock", StockBarcode.qty_remaining > 0)
    elif wanted == "sold":
        q = q.where(StockBarcode.status == "sold")
    elif wanted == "transferred":
        q = q.where(StockBarcode.status == "transferred")
    if barcode and barcode.strip() and barcode.strip() not in ("0",):
        q = q.where(StockBarcode.barcode == barcode.strip())
    rows = (await session.execute(q.order_by(StockBarcode.inward_date, StockBarcode.barcode))).scalars().all()
    product_ids = {r.product_id for r in rows}
    lot_ids = {r.lot_id for r in rows if r.lot_id}
    products = {}
    if product_ids:
        products = {
            p.id: p
            for p in (
                await session.execute(select(Product).where(Product.id.in_(product_ids)))
            ).scalars().all()
        }
    lots = {}
    if lot_ids:
        lots = {
            lot.id: lot
            for lot in (
                await session.execute(select(LotMaster).where(LotMaster.id.in_(lot_ids)))
            ).scalars().all()
        }
    out_rows = []
    purchase_value = 0.0
    sales_value = 0.0
    for row in rows:
        product = products.get(row.product_id)
        lot = lots.get(row.lot_id) if row.lot_id else None
        qty_in = float(row.qty_in or 0)
        remaining = float(row.qty_remaining or 0)
        sold_qty = max(0.0, round(qty_in - remaining, 3))
        if wanted in ("not_sold", "not sold", "unsold"):
            show_qty = remaining
        elif wanted == "sold":
            show_qty = sold_qty or qty_in
        elif wanted == "transferred":
            show_qty = qty_in
        else:
            show_qty = remaining if row.status == "in_stock" else qty_in
        cost = float(row.cost_price or 0)
        sale = float(row.sale_rate or 0)
        disc = float(row.disc_pct or 0)
        net = _net_rate(sale, disc)
        purchase_value += cost * (remaining if wanted in ("not_sold", "not sold", "unsold") else qty_in)
        if wanted == "sold":
            sales_value += net * show_qty
        elif wanted in ("all", ""):
            sales_value += net * sold_qty
        out_rows.append(
            {
                "date": row.inward_date,
                "lot_name": f"{lot.code} {lot.name}".strip() if lot else "",
                "product_name": product.name if product else "",
                "product_code": product.code if product else "",
                "barcode": row.barcode,
                "cost_price": cost,
                "sale_rate": None if hide_sale_rates else sale,
                "disc_pct": None if hide_sale_rates else disc,
                "net_sale_rate": None if hide_sale_rates else net,
                "qty": show_qty,
                "status": row.status,
            }
        )
    margin = round(sales_value - purchase_value, 2)
    margin_pct = round((margin / purchase_value) * 100, 2) if abs(purchase_value) > 0.005 else None
    return {
        "rows": out_rows,
        "purchase_value": round(purchase_value, 2),
        "sales_value": round(sales_value, 2),
        "margin": margin,
        "margin_pct": margin_pct,
    }


async def item_stock_report(
    session: AsyncSession,
    *,
    product_id: str | None,
    q: str | None,
) -> list[dict]:
    stmt = select(StockBarcode)
    if product_id:
        stmt = stmt.where(StockBarcode.product_id == product_id)
    rows = (await session.execute(stmt)).scalars().all()
    products = {
        p.id: p
        for p in (await session.execute(select(Product).where(Product.is_active.is_(True)))).scalars().all()
    }
    needle = (q or "").strip().lower()
    bucket: dict[str, dict] = {}
    for row in rows:
        product = products.get(row.product_id)
        if product is None:
            continue
        if needle and needle not in f"{product.code} {product.name}".lower():
            continue
        slot = bucket.setdefault(
            product.id,
            {
                "product_id": product.id,
                "product_code": product.code,
                "product_name": product.name,
                "barcode_count": 0,
                "qty_in": 0.0,
                "qty_sold": 0.0,
                "qty_remaining": 0.0,
                "purchase_value": 0.0,
                "sales_value": 0.0,
            },
        )
        qty_in = float(row.qty_in or 0)
        remaining = float(row.qty_remaining or 0) if row.status == "in_stock" else 0.0
        sold = max(0.0, qty_in - float(row.qty_remaining or 0)) if row.status == "sold" else 0.0
        if row.status == "in_stock":
            sold = max(0.0, qty_in - float(row.qty_remaining or 0))
            remaining = float(row.qty_remaining or 0)
        slot["barcode_count"] += 1
        slot["qty_in"] += qty_in
        slot["qty_sold"] += sold
        slot["qty_remaining"] += remaining
        slot["purchase_value"] += float(row.cost_price or 0) * qty_in
        slot["sales_value"] += _net_rate(float(row.sale_rate or 0), float(row.disc_pct or 0)) * sold
    out = []
    for slot in bucket.values():
        slot["qty_in"] = round(slot["qty_in"], 3)
        slot["qty_sold"] = round(slot["qty_sold"], 3)
        slot["qty_remaining"] = round(slot["qty_remaining"], 3)
        slot["purchase_value"] = round(slot["purchase_value"], 2)
        slot["sales_value"] = round(slot["sales_value"], 2)
        share = (slot["qty_remaining"] / slot["qty_in"]) if slot["qty_in"] else 0
        slot["balance_value"] = round(slot["purchase_value"] * share, 2)
        out.append(slot)
    # Products with no barcodes still show current stock when searching the catalog.
    if not rows or needle or not product_id:
        seen = {r["product_id"] for r in out}
        for product in products.values():
            if product.id in seen:
                continue
            if product_id and product.id != product_id:
                continue
            if needle and needle not in f"{product.code} {product.name}".lower():
                continue
            if not needle and not product_id:
                continue
            out.append(
                {
                    "product_id": product.id,
                    "product_code": product.code,
                    "product_name": product.name,
                    "barcode_count": 0,
                    "qty_in": float(product.current_stock or 0),
                    "qty_sold": 0.0,
                    "qty_remaining": float(product.current_stock or 0),
                    "purchase_value": 0.0,
                    "sales_value": 0.0,
                    "balance_value": 0.0,
                }
            )
    out.sort(key=lambda r: (str(r["product_code"]), str(r["product_name"])))
    return out


def _add_move(slot: dict, key: str, qty: float, amount: float) -> None:
    slot[f"{key}_qty"] += qty
    slot[f"{key}_amt"] += amount


async def movement_stock_report(
    session: AsyncSession,
    *,
    supplier_id: str | None,
    product_id: str | None,
    lot_id: str | None,
    barcode: str | None,
) -> list[dict]:
    from modules.generp.ge.models.stock import StockVoucher, StockVoucherItem

    barcode_product = None
    barcode_lot = None
    if barcode and barcode.strip() and barcode.strip() not in ("0",):
        found = (
            await session.execute(select(StockBarcode).where(StockBarcode.barcode == barcode.strip()))
        ).scalar_one_or_none()
        if found is None:
            return []
        barcode_product = found.product_id
        barcode_lot = found.lot_id

    vouchers = (
        await session.execute(
            select(VoucherItem, Voucher)
            .join(Voucher, Voucher.id == VoucherItem.voucher_id)
            .where(Voucher.is_cancelled.is_(False), Voucher.is_parked.is_(False))
        )
    ).all()
    stock_lines = (
        await session.execute(
            select(StockVoucherItem, StockVoucher)
            .join(StockVoucher, StockVoucher.id == StockVoucherItem.voucher_id)
            .where(
                StockVoucher.is_cancelled.is_(False),
                StockVoucher.voucher_type.in_(("TRANSFER_IN", "TRANSFER_OUT")),
            )
        )
    ).all()

    supplier_keys: set[tuple[str, str | None]] | None = None
    if supplier_id:
        supplier_keys = set()
        for item, voucher in vouchers:
            if voucher.voucher_type == "PURCHASE" and voucher.party_id == supplier_id and item.product_id:
                supplier_keys.add((item.product_id, getattr(item, "lot_id", None)))

    def allowed(pid: str | None, lid: str | None) -> bool:
        if not pid:
            return False
        if product_id and pid != product_id:
            return False
        if lot_id and lid != lot_id:
            return False
        if barcode_product and (pid != barcode_product or lid != barcode_lot):
            return False
        if supplier_keys is not None and (pid, lid) not in supplier_keys:
            return False
        return True

    bucket: dict[tuple[str, str | None], dict] = {}

    def slot_for(pid: str, lid: str | None, when: date | None) -> dict:
        key = (pid, lid)
        if key not in bucket:
            bucket[key] = {
                "product_id": pid,
                "lot_id": lid,
                "date": when,
                "p_qty": 0.0,
                "p_amt": 0.0,
                "pr_qty": 0.0,
                "pr_amt": 0.0,
                "s_qty": 0.0,
                "s_amt": 0.0,
                "sr_qty": 0.0,
                "sr_amt": 0.0,
                "ti_qty": 0.0,
                "ti_amt": 0.0,
                "to_qty": 0.0,
                "to_amt": 0.0,
            }
        slot = bucket[key]
        if when and (slot["date"] is None or when < slot["date"]):
            slot["date"] = when
        return slot

    sale_types = {"SALE", "WHOLESALE", "SHOP_SALE"}
    for item, voucher in vouchers:
        pid = item.product_id
        lid = getattr(item, "lot_id", None)
        if not allowed(pid, lid):
            continue
        qty = float(item.quantity or 0)
        amount = round(qty * float(item.rate or 0) - float(item.discount_amount or 0), 2)
        if amount < 0:
            amount = 0.0
        slot = slot_for(pid, lid, voucher.voucher_date)
        vtype = voucher.voucher_type
        if vtype == "PURCHASE":
            _add_move(slot, "p", qty, amount)
        elif vtype == "PURCHASE_RETURN":
            _add_move(slot, "pr", qty, amount)
        elif vtype in sale_types:
            _add_move(slot, "s", qty, amount)
        elif vtype == "SALE_RETURN":
            _add_move(slot, "sr", qty, amount)

    for item, voucher in stock_lines:
        pid = item.product_id
        lid = getattr(item, "lot_id", None)
        if not allowed(pid, lid):
            continue
        qty = float(item.quantity or 0)
        amount = float(item.amount or 0) or round(qty * float(item.rate or 0), 2)
        slot = slot_for(pid, lid, voucher.voucher_date)
        if voucher.voucher_type == "TRANSFER_IN":
            _add_move(slot, "ti", qty, amount)
        elif voucher.voucher_type == "TRANSFER_OUT":
            _add_move(slot, "to", qty, amount)

    product_ids = {k[0] for k in bucket}
    lot_ids = {k[1] for k in bucket if k[1]}
    products = {}
    if product_ids:
        products = {
            p.id: p
            for p in (await session.execute(select(Product).where(Product.id.in_(product_ids)))).scalars().all()
        }
    lots = {}
    if lot_ids:
        lots = {
            lot.id: lot
            for lot in (await session.execute(select(LotMaster).where(LotMaster.id.in_(lot_ids)))).scalars().all()
        }

    def rate(amt: float, qty: float) -> float:
        return round(amt / qty, 2) if qty > _EPS else 0.0

    out = []
    for (pid, lid), slot in bucket.items():
        product = products.get(pid)
        lot = lots.get(lid) if lid else None
        bal_qty = (
            slot["p_qty"]
            - slot["pr_qty"]
            - slot["s_qty"]
            + slot["sr_qty"]
            + slot["ti_qty"]
            - slot["to_qty"]
        )
        bal_amt = (
            slot["p_amt"]
            - slot["pr_amt"]
            - slot["s_amt"]
            + slot["sr_amt"]
            + slot["ti_amt"]
            - slot["to_amt"]
        )
        out.append(
            {
                "lot_name": f"{lot.code} {lot.name}".strip() if lot else "",
                "lot_code": lot.code if lot else "",
                "date": slot["date"],
                "product_code": product.code if product else "",
                "product_name": product.name if product else "",
                "p_qty": round(slot["p_qty"], 3),
                "p_rate": rate(slot["p_amt"], slot["p_qty"]),
                "p_amt": round(slot["p_amt"], 2),
                "pr_qty": round(slot["pr_qty"], 3),
                "pr_rate": rate(slot["pr_amt"], slot["pr_qty"]),
                "pr_amt": round(slot["pr_amt"], 2),
                "s_qty": round(slot["s_qty"], 3),
                "s_rate": rate(slot["s_amt"], slot["s_qty"]),
                "s_amt": round(slot["s_amt"], 2),
                "sr_qty": round(slot["sr_qty"], 3),
                "sr_rate": rate(slot["sr_amt"], slot["sr_qty"]),
                "sr_amt": round(slot["sr_amt"], 2),
                "ti_qty": round(slot["ti_qty"], 3),
                "ti_rate": rate(slot["ti_amt"], slot["ti_qty"]),
                "ti_amt": round(slot["ti_amt"], 2),
                "to_qty": round(slot["to_qty"], 3),
                "to_rate": rate(slot["to_amt"], slot["to_qty"]),
                "to_amt": round(slot["to_amt"], 2),
                "bal_qty": round(bal_qty, 3),
                "bal_rate": rate(bal_amt, bal_qty),
                "bal_amt": round(bal_amt, 2),
            }
        )
    out.sort(key=lambda r: (str(r["lot_name"]), str(r["date"] or ""), str(r["product_name"])))
    return out
