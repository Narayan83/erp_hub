from __future__ import annotations

import base64
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from modules.generp.ge.reports.money_words import amount_in_words

DEFAULT_COMPANY_NAME = "GenERP"

_LOGO_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def _profile_field(profile: Any, name: str, default: Any = None) -> Any:
    if isinstance(profile, dict):
        value = profile.get(name)
    else:
        value = getattr(profile, name, None)
    return default if value is None or value == "" else value


def company_logo_public_url(profile: Any) -> str:
    raw = _profile_field(profile, "logo_path")
    if not raw:
        return ""
    return f"/media/company-logo/{Path(str(raw)).name}"


def company_logo_print_src(profile: Any) -> str:
    """Embed the logo as a data URI so print HTML works without a network fetch."""
    raw = _profile_field(profile, "logo_path")
    if not raw:
        return ""
    from modules.generp.ge.config import get_settings

    path = get_settings().company_logo_dir / Path(str(raw)).name
    if not path.is_file():
        return company_logo_public_url(profile)
    ext = path.suffix.lower()
    mime = _LOGO_MIME.get(ext) or "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def company_header_context(profile: Any, *, name_field: str = "name") -> dict[str, Any]:
    name = _profile_field(profile, name_field) or _profile_field(profile, "name") or DEFAULT_COMPANY_NAME
    address_lines = [
        _profile_field(profile, "address_line1"),
        _profile_field(profile, "address_line2"),
        _profile_field(profile, "address_line3"),
        _profile_field(profile, "address_line4"),
    ]
    city = _profile_field(profile, "city")
    state = _profile_field(profile, "state")
    pin_code = _profile_field(profile, "pin_code")
    phone = str(_profile_field(profile, "phone") or _profile_field(profile, "mobile") or "").strip()
    email = str(_profile_field(profile, "email") or "").strip()
    website = str(_profile_field(profile, "website") or "").strip()
    gstin = str(_profile_field(profile, "gstin") or "").strip()

    trailing_address = [part for part in [city, state, pin_code] if part]
    address_parts = [part for part in address_lines if part]
    if trailing_address:
        address_parts.append(", ".join(trailing_address))

    return {
        "company_name": name,
        "company_address": ", ".join(address_parts),
        "company_address_lines": [part for part in address_lines if part],
        "company_phone": phone,
        "company_email": email,
        "company_website": website,
        "company_gstin": gstin,
        "company_logo_url": company_logo_public_url(profile),
        "company_logo_src": company_logo_print_src(profile),
    }


def _fmt_qty(value: Any) -> str:
    qty = float(value or 0)
    if abs(qty - round(qty)) < 1e-9:
        return str(int(round(qty)))
    text = f"{qty:.3f}".rstrip("0").rstrip(".")
    return text or "0"


def _fmt_date_short(value: date | datetime | str | None) -> str:
    text = _fmt_date(value)
    if text == "—":
        return text
    return text.replace("/", "-")


def split_gst(tax_amount: float, company_gstin: str, customer_gstin: str) -> tuple[float, float, float]:
    tax = round(float(tax_amount or 0), 2)
    if tax <= 0:
        return 0.0, 0.0, 0.0
    company_state = (company_gstin or "").strip().upper()[:2]
    party_state = (customer_gstin or "").strip().upper()[:2]
    if company_state and party_state and company_state != party_state and party_state.isalnum():
        return 0.0, 0.0, tax
    cgst = round(tax / 2.0, 2)
    sgst = round(tax - cgst, 2)
    return cgst, sgst, 0.0


def _gst_split(tax_amount: float, company_gstin: str, customer_gstin: str) -> tuple[float, float, float]:
    return split_gst(tax_amount, company_gstin, customer_gstin)


def _fmt_money(value: Any) -> str:
    if value is None:
        return "0.00"
    return f"{Decimal(str(value)):.2f}"


def _fmt_date(value: date | datetime | str | None) -> str:
    if not value:
        return "—"
    if isinstance(value, datetime):
        return value.strftime("%d/%m/%Y")
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    text = str(value)
    if len(text) >= 10 and text[4] == "-":
        parts = text[:10].split("-")
        if len(parts) == 3:
            return f"{parts[2]}/{parts[1]}/{parts[0]}"
    return text


def _field(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        value = obj.get(name)
    else:
        value = getattr(obj, name, None)
    return default if value is None else value


def _payment_rows(voucher: Any) -> list[dict[str, Any]]:
    payments = _field(voucher, "payments", []) or []
    rows: list[dict[str, Any]] = []
    for payment in payments:
        if isinstance(payment, dict):
            rows.append(
                {
                    "mode": payment.get("payment_mode_name") or "—",
                    "amount": _fmt_money(payment.get("amount")),
                    "document": (payment.get("reference") or "").strip(),
                }
            )
        else:
            mode = getattr(payment, "payment_mode", None)
            rows.append(
                {
                    "mode": (mode.name if mode else None) or "—",
                    "amount": _fmt_money(getattr(payment, "amount", 0)),
                    "document": (getattr(payment, "reference", None) or "").strip(),
                }
            )
    return rows


def _line_rows(voucher: Any) -> list[dict[str, Any]]:
    items = _field(voucher, "items", []) or []
    rows: list[dict[str, Any]] = []
    for index, item in enumerate(items, start=1):
        if isinstance(item, dict):
            qty = float(item.get("quantity") or 0)
            rate = float(item.get("rate") or 0)
            disc_amt = float(item.get("discount_amount") or 0)
            gross = qty * rate
            disc_pct = round((disc_amt / gross) * 100.0, 2) if gross > 0 else 0.0
            product = item.get("product") or {}
            rows.append(
                {
                    "sr": index,
                    "code": item.get("product_code") or product.get("code") or "",
                    "name": item.get("product_name") or product.get("name") or item.get("description") or "",
                    "qty": _fmt_qty(qty),
                    "rate": _fmt_money(rate),
                    "profit_pct": f"{float(item.get('profit_pct') or 0):,.2f}",
                    "sale_price": _fmt_money(item.get("sale_price")),
                    "mrp": _fmt_money(item.get("mrp")),
                    "disc": _fmt_money(disc_amt),
                    "disc_pct": f"{disc_pct:,.2f}",
                    "gst_pct": f"{float(item.get('gst_rate') or 0):,.0f}",
                    "taxable": _fmt_money(item.get("taxable_amount")),
                    "gst": _fmt_money(item.get("gst_amount")),
                    "amount": _fmt_money(item.get("amount")),
                }
            )
        else:
            qty = float(item.quantity or 0)
            rate = float(item.rate or 0)
            disc_amt = float(item.discount_amount or 0)
            gross = qty * rate
            disc_pct = round((disc_amt / gross) * 100.0, 2) if gross > 0 else 0.0
            product = getattr(item, "product", None)
            rows.append(
                {
                    "sr": index,
                    "code": getattr(product, "code", "") if product else "",
                    "name": (getattr(product, "name", None) if product else None) or item.description or "",
                    "qty": _fmt_qty(qty),
                    "rate": _fmt_money(rate),
                    "profit_pct": f"{float(getattr(item, 'profit_pct', 0) or 0):,.2f}",
                    "sale_price": _fmt_money(getattr(item, "sale_price", 0)),
                    "mrp": _fmt_money(getattr(item, "mrp", 0)),
                    "disc": _fmt_money(disc_amt),
                    "disc_pct": f"{disc_pct:,.2f}",
                    "gst_pct": f"{float(item.gst_rate or 0):,.0f}",
                    "taxable": _fmt_money(item.taxable_amount),
                    "gst": _fmt_money(item.gst_amount),
                    "amount": _fmt_money(item.amount),
                }
            )
    return rows


def _line_qty_mrp_amount(item: Any) -> tuple[float, float, float]:
    if isinstance(item, dict):
        qty = float(item.get("quantity") or item.get("qty") or 0)
        mrp = float(item.get("mrp") or 0)
        amount = float(item.get("amount") or 0)
        if mrp <= 0:
            product = item.get("product") or {}
            mrp = float(product.get("mrp") or 0) if isinstance(product, dict) else 0.0
        return qty, mrp, amount
    qty = float(getattr(item, "quantity", 0) or 0)
    mrp = float(getattr(item, "mrp", 0) or 0)
    amount = float(getattr(item, "amount", 0) or 0)
    if mrp <= 0:
        product = getattr(item, "product", None)
        mrp = float(getattr(product, "mrp", 0) or 0) if product is not None else 0.0
    return qty, mrp, amount


def _you_save_amount(voucher: Any) -> float:
    vtype = (
        voucher.get("voucher_type")
        if isinstance(voucher, dict)
        else getattr(voucher, "voucher_type", None)
    )
    if str(vtype or "").upper() == "PURCHASE":
        return 0.0
    items = _field(voucher, "items", []) or []
    total = 0.0
    for item in items:
        qty, mrp, amount = _line_qty_mrp_amount(item)
        if mrp <= 0 or qty <= 0:
            continue
        total += max(0.0, round(mrp * qty - amount, 2))
    return round(total, 2)


def build_sale_bill_context(voucher: Any) -> dict[str, Any]:
    party = _field(voucher, "party")
    if isinstance(party, dict):
        customer_name = party.get("name") or "Walk-in"
        customer_mobile = party.get("phone") or party.get("mobile") or "—"
        customer_gstin = party.get("gstin") or "—"
    elif party:
        customer_name = getattr(party, "name", None) or _field(voucher, "party_name") or "Walk-in"
        customer_mobile = getattr(party, "phone", None) or getattr(party, "mobile", None) or "—"
        customer_gstin = getattr(party, "gstin", None) or "—"
    else:
        customer_name = _field(voucher, "party_name") or "Walk-in"
        customer_mobile = "—"
        customer_gstin = "—"

    payments = _payment_rows(voucher)
    if isinstance(voucher, dict):
        paid = float(voucher.get("paid_amount") or 0)
    else:
        paid = sum(
            float(p.amount or 0)
            for p in (getattr(voucher, "payments", None) or [])
            if getattr(p, "payment_mode", None) is None or not p.payment_mode.is_credit
        )
    net = float(_field(voucher, "net_amount", 0) or 0)
    credit = round(net - paid, 2)

    return {
        "bill_title": (
            "Purchase Bill"
            if getattr(voucher, "voucher_type", None) == "PURCHASE"
            or (isinstance(voucher, dict) and voucher.get("voucher_type") == "PURCHASE")
            else "Tax Invoice / Wholesale Bill"
            if getattr(voucher, "voucher_type", None) == "WHOLESALE"
            or (isinstance(voucher, dict) and voucher.get("voucher_type") == "WHOLESALE")
            else "Tax Invoice / Sale Bill"
        ),
        "bill_no": _field(voucher, "voucher_no"),
        "bill_date": _fmt_date(_field(voucher, "voucher_date")),
        "bill_date_short": _fmt_date_short(_field(voucher, "voucher_date")),
        "customer_name": customer_name,
        "customer_mobile": customer_mobile,
        "customer_gstin": customer_gstin,
        "lines": _line_rows(voucher),
        "gross_amount": _fmt_money(_field(voucher, "gross_amount", 0)),
        "discount_amount": _fmt_money(_field(voucher, "discount_amount", 0)),
        "tax_amount": _fmt_money(_field(voucher, "tax_amount", 0)),
        "net_amount": _fmt_money(net),
        "paid_amount": _fmt_money(paid),
        "credit_amount": _fmt_money(credit if credit > 0 else 0),
        "payments": payments,
        "has_split_payments": len(payments) > 1,
        "payment_mode": ", ".join(p["mode"] for p in payments) if payments else "—",
        "cash_credit": "Credit" if bool(_field(voucher, "is_credit", False)) else "Cash",
        "narration": _field(voucher, "narration", "") or "",
        "amount_in_words": amount_in_words(net),
        "you_save": _fmt_money(_you_save_amount(voucher)),
    }


def _money_float(value: Any) -> float:
    text = str(value or "0").replace(",", "").strip()
    try:
        return float(text)
    except ValueError:
        return 0.0


def apply_bill_format(context: dict[str, Any], bill_format: str | None) -> dict[str, Any]:
    from modules.generp.ge.reports.bill_formats import is_thermal, normalize_bill_format, paper_width_mm

    fmt = normalize_bill_format(bill_format)
    thermal = is_thermal(fmt)
    width = paper_width_mm(fmt)
    if thermal:
        page_css = f"size: {width:.0f}mm auto; margin: 2mm;"
    elif fmt == "A5":
        page_css = "size: 210mm 148mm; margin: 6mm;"
    else:
        page_css = "size: A4 portrait; margin: 8mm;"

    tax = _money_float(context.get("tax_amount"))
    cgst, sgst, igst = _gst_split(
        tax,
        str(context.get("company_gstin") or ""),
        str(context.get("customer_gstin") or ""),
    )
    net = _money_float(context.get("net_amount"))
    context.update(
        {
            "bill_format": fmt,
            "is_thermal": thermal,
            "paper_width_mm": int(width) if float(width).is_integer() else width,
            "page_css": page_css,
            "cgst_amount": _fmt_money(cgst),
            "sgst_amount": _fmt_money(sgst),
            "igst_amount": _fmt_money(igst),
            "amount_in_words": context.get("amount_in_words") or amount_in_words(net),
        }
    )
    return context
