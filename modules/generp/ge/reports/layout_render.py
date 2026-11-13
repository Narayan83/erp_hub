"""Render sale bills and reports from a saved print layout."""

from __future__ import annotations

import html
from typing import Any

from modules.generp.ge.reports.bill_formats import is_thermal
from modules.generp.ge.reports.page_layout import prepare_report_html
from modules.generp.ge.reports.print_layouts import (
    DEFAULT_COMPUTER_NOTE,
    DEFAULT_REPORT_TITLE,
    DEFAULT_SIGNATURE,
    DEFAULT_TAX_INVOICE,
    DEFAULT_TERMS,
    DEFAULT_THANKS,
    KIND_REPORT,
    fit_layout_to_page,
    layout_for_format,
    normalize_layout,
    page_orientation_of,
    page_padding_of,
    paper_mm_of,
    printable_inner_mm,
    resolve_layout_format,
    visible_fields,
)

_A4_CSS = """
html, body { font-family: "Times New Roman", Times, serif; font-size: 11pt; font-weight: bold; color: #000;
  margin: 0; padding: 0; width: %(width)smm; max-width: %(width)smm; min-height: %(height)smm; background: #fff;
  overflow-x: hidden; }
@page { %(page_css)s }
p { margin: 0; padding: 0; color: #000; }
table { border-collapse: collapse; }
.header-title { font-size: 18pt; font-weight: bold; color: #000; text-align: center; }
.header-meta { font-size: 11pt; font-weight: bold; color: #000; text-align: center; }
.header-sub { font-size: 12pt; font-weight: bold; color: #000; text-align: center; text-decoration: underline; margin-top: 4px; margin-bottom: 6px; }
.meta { font-size: 11pt; font-weight: bold; color: #000; }
.grid { font-size: 10pt; font-weight: bold; color: #000; border: 1px solid #000; padding: 3px 4px; }
.note { font-size: 9pt; font-weight: normal; color: #000; }
.terms { font-size: 9pt; font-weight: normal; margin-top: 6px; }
.thanks { font-style: italic; margin-top: 8px; }
.you-save { font-weight: 700; font-size: 12pt; text-align: center; margin-top: 6px; }
.placed-band { position: relative; width: 100%%; }
.placed { position: absolute; overflow: hidden; box-sizing: border-box; line-height: 1.15; white-space: pre-wrap; }
.placed img { max-width: 100%%; max-height: 100%%; object-fit: contain; display: block; }
.header-logo { text-align: center; margin: 2px 0; }
.header-logo img { max-width: 40mm; max-height: 18mm; object-fit: contain; }
.page-frame { width: %(width)smm; min-height: %(height)smm; box-sizing: border-box; overflow-x: hidden; }
.page-frame.has-border { border: 0.4mm solid #000; }
table.items-mm { width: 100%% !important; max-width: 100%%; table-layout: fixed; margin-top: 6px; }
table.items-mm td, table.items-mm th { box-sizing: border-box; overflow: hidden; }
"""

_THERMAL_CSS = """
@page { %(page_css)s }
html, body { width: %(width)smm; max-width: %(width)smm; margin: 0 auto; padding: 0; height: auto;
  font-family: "Courier New", Courier, monospace; font-size: %(font)s; font-weight: bold; color: #000; }
body.thermal-slip { padding: 0; box-sizing: border-box; }
p { margin: 0; padding: 0; }
    table { width: 100%%; border-collapse: collapse; table-layout: auto; }
.center { text-align: center; }
.right { text-align: right; }
.shop { font-size: %(shop)s; letter-spacing: 0.5px; }
.title { font-size: 11pt; text-decoration: underline; margin: 2px 0 4px; }
.rule { border: 0; border-top: 1px dashed #000; margin: 6px 0; height: 1px; width: 100%%; }
.rule-line { margin: 2px 0 6px; letter-spacing: 1px; font-weight: normal; }
.meta td { padding: 1px 0; vertical-align: top; }
.items th, .items td { padding: 2px 1px; font-size: %(item)s; vertical-align: top; }
.items th { border-bottom: 1px solid #000; }
.items tbody tr:last-child td { border-bottom: none; }
.tot { font-size: %(tot)s; }
.words { font-size: 8pt; font-weight: normal; margin-top: 3px; }
.terms { font-size: 8pt; font-weight: normal; margin-top: 6px; }
.thanks { font-style: italic; margin-top: 8px; font-size: 9pt; }
.you-save { font-weight: 700; font-size: 11pt; text-align: center; margin-top: 4px; }
.placed-band { position: relative; width: 100%%; }
.placed { position: absolute; overflow: hidden; box-sizing: border-box; line-height: 1.15; white-space: pre-wrap; }
.placed img { max-width: 100%%; max-height: 100%%; object-fit: contain; display: block; }
.header-logo { text-align: center; margin: 2px 0; }
.header-logo img { max-width: 28mm; max-height: 14mm; object-fit: contain; }
.page-frame { box-sizing: border-box; }
.page-frame.has-border { border: 0.4mm solid #000; }
table.items-mm { width: 100%% !important; max-width: 100%%; table-layout: fixed; margin-top: 6px; }
table.items-mm td, table.items-mm th { box-sizing: border-box; overflow: hidden; }
"""


def _esc(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def _logo_src(context: dict[str, Any]) -> str:
    return str(context.get("company_logo_src") or context.get("company_logo_url") or "").strip()


def _logo_html(field: dict[str, Any], context: dict[str, Any], *, placed: bool) -> str:
    src = _logo_src(context)
    if not src:
        return ""
    align = field.get("align") or "center"
    if align == "right":
        margin = "0 0 0 auto"
    elif align == "left":
        margin = "0 auto 0 0"
    else:
        margin = "0 auto"
    size = "max-width:100%;max-height:100%;" if placed else "max-width:40mm;max-height:18mm;"
    return (
        f'<img src="{_esc(src)}" alt="" '
        f'style="{size}object-fit:contain;display:block;margin:{margin}" />'
    )


def _blank(value: Any) -> bool:
    text = str(value or "").strip()
    return text in ("", "—", "-", "None")


def _cls(align: str | None) -> str:
    if align == "center":
        return "center"
    if align == "right":
        return "right"
    return ""


def _style_align(align: str | None) -> str:
    if align in {"left", "center", "right"}:
        return f"text-align:{align};"
    return ""


def _fmt_mm(value: float) -> str:
    return f"{value:g}"


def _css_font(name: str) -> str:
    safe = str(name).replace("'", "").replace(";", "").replace('"', "")[:60]
    return f"font-family:'{safe}',sans-serif"


def _mm(field: dict[str, Any], *keys: str, default: float | None = None) -> float | None:
    for key in keys:
        if field.get(key) is not None:
            try:
                return float(field[key])
            except (TypeError, ValueError):
                return default
    return default


def _band_placed(fields: list[dict[str, Any]]) -> bool:
    return any(_mm(field, "xMm", "x_mm") is not None for field in fields)


def _padding_tuple(field: dict[str, Any]) -> tuple[float, float, float, float]:
    top = _mm(field, "paddingTopMm", "padding_top_mm", default=0) or 0
    right = _mm(field, "paddingRightMm", "padding_right_mm", default=0) or 0
    bottom = _mm(field, "paddingBottomMm", "padding_bottom_mm", default=0) or 0
    left = _mm(field, "paddingLeftMm", "padding_left_mm", default=0) or 0
    return (top, right, bottom, left)


def _padding_css(field: dict[str, Any], extra: float = 0) -> str:
    top, right, bottom, left = _padding_tuple(field)
    top += extra
    right += extra
    bottom += extra
    left += extra
    if top or right or bottom or left or extra:
        return f"padding:{_fmt_mm(top)}mm {_fmt_mm(right)}mm {_fmt_mm(bottom)}mm {_fmt_mm(left)}mm"
    return ""


def _field_style(field: dict[str, Any], *, skip_border: bool = False) -> str:
    bits: list[str] = []
    align = field.get("align")
    if align in {"left", "center", "right"}:
        bits.append(f"text-align:{align}")
    fam = field.get("fontFamily") or field.get("font_family")
    if fam:
        bits.append(_css_font(str(fam)))
    size = field.get("fontSizePt") if field.get("fontSizePt") is not None else field.get("font_size_pt")
    if size is not None:
        try:
            bits.append(f"font-size:{float(size):g}pt")
        except (TypeError, ValueError):
            pass
    if field.get("bold") is True:
        bits.append("font-weight:700")
    elif field.get("bold") is False:
        bits.append("font-weight:400")
    extra = 0.6 if field.get("border") and not skip_border else 0
    if field.get("border") and not skip_border:
        bits.append("border:0.3mm solid #000;box-sizing:border-box")
    pad = _padding_css(field, extra)
    if pad:
        bits.append(f"{pad};box-sizing:border-box")
    return ";".join(bits)


def _placed_band_html(fields: list[dict[str, Any]], context: dict[str, Any], *, thermal: bool) -> str:
    parts: list[str] = []
    max_h = 4.0
    for field in fields:
        x = _mm(field, "xMm", "x_mm", default=0) or 0
        y = _mm(field, "yMm", "y_mm", default=0) or 0
        w = _mm(field, "widthMm", "width_mm", default=40) or 40
        h = _mm(field, "heightMm", "height_mm", default=6) or 6
        style = _field_style(field)
        if field["id"] == "gst_split":
            inner = _gst_split_html(context, thermal=thermal)
            if not inner:
                continue
            parts.append(
                f'<div class="placed" style="left:{_fmt_mm(x)}mm;top:{_fmt_mm(y)}mm;width:{_fmt_mm(w)}mm;height:{_fmt_mm(h)}mm;{style}">{inner}</div>'
            )
            max_h = max(max_h, y + h)
            continue
        if field["id"] == "company_logo":
            inner = _logo_html(field, context, placed=True)
            if not inner:
                continue
            parts.append(
                f'<div class="placed" style="left:{_fmt_mm(x)}mm;top:{_fmt_mm(y)}mm;width:{_fmt_mm(w)}mm;height:{_fmt_mm(h)}mm;{style}">{inner}</div>'
            )
            max_h = max(max_h, y + h)
            continue
        if field["id"] == "payment_summary":
            inner = _payment_summary_html(context)
            if not inner:
                continue
            parts.append(
                f'<div class="placed" style="left:{_fmt_mm(x)}mm;top:{_fmt_mm(y)}mm;width:{_fmt_mm(w)}mm;height:{_fmt_mm(h)}mm;{style}">{inner}</div>'
            )
            max_h = max(max_h, y + h)
            continue
        text = _field_text(field, context, thermal=thermal)
        if _blank(text.replace("&nbsp;", " ")):
            continue
        body = "<br/>".join(_esc(line) if line != "&nbsp;" else "&nbsp;" for line in text.split("\n"))
        body = body.replace("&amp;nbsp;", "&nbsp;")
        parts.append(
            f'<div class="placed" style="left:{_fmt_mm(x)}mm;top:{_fmt_mm(y)}mm;width:{_fmt_mm(w)}mm;height:{_fmt_mm(h)}mm;{style}">{body}</div>'
        )
        max_h = max(max_h, y + h)
    if not parts:
        return ""
    return f'<div class="placed-band" style="height:{_fmt_mm(max_h)}mm;">{"".join(parts)}</div>'


def _prefixed(field: dict[str, Any], value: str) -> str:
    if field.get("standalone"):
        return value
    label = str(field.get("prefix") or field.get("label") or "").strip()
    if not label:
        return value
    return f"{label} : {value}"


def _field_text(field: dict[str, Any], context: dict[str, Any], *, thermal: bool) -> str:
    fid = field["id"]
    custom = str(field.get("text") or "").strip()

    if fid.startswith("static_"):
        return custom

    if fid == "company_logo":
        return ""

    if fid == "company_name":
        return str(context.get("company_name") or "")
    if fid == "company_address":
        lines = [str(x) for x in (context.get("company_address_lines") or []) if x]
        if lines:
            return "\n".join(lines)
        return str(context.get("company_address") or "")
    if fid == "company_phone_email":
        phone = str(context.get("company_phone") or "").strip()
        email = str(context.get("company_email") or "").strip()
        parts = []
        if phone:
            parts.append(f"Tel: {phone}")
        if email:
            parts.append(f"Email: {email}")
        return " | ".join(parts)
    if fid == "company_phone":
        phone = str(context.get("company_phone") or "").strip()
        return "" if not phone else _prefixed(field, phone)
    if fid == "company_email":
        email = str(context.get("company_email") or "").strip()
        return "" if not email else _prefixed(field, email)
    if fid == "company_gstin":
        gstin = str(context.get("company_gstin") or "").strip()
        return "" if not gstin else _prefixed(field, gstin)
    if fid == "company_website":
        return str(context.get("company_website") or "").strip()
    if fid == "tax_invoice_title":
        return custom or DEFAULT_TAX_INVOICE
    if fid == "bill_title":
        return str(context.get("bill_title") or "")
    if fid == "report_title":
        return custom or str(context.get("report_title") or DEFAULT_REPORT_TITLE)

    if fid == "customer_name":
        prefix = "Name" if thermal and not field.get("prefix") else None
        item = dict(field)
        if prefix and not item.get("prefix"):
            item["prefix"] = prefix
        return _prefixed(item, str(context.get("customer_name") or ""))
    if fid == "customer_mobile":
        mobile = str(context.get("customer_mobile") or "")
        if _blank(mobile):
            return ""
        return _prefixed(field, mobile)
    if fid == "customer_gstin":
        gstin = str(context.get("customer_gstin") or "")
        if _blank(gstin):
            return ""
        return _prefixed(field, gstin)
    if fid == "cash_credit":
        return _prefixed(field, str(context.get("cash_credit") or ""))
    if fid == "bill_no":
        item = dict(field)
        if thermal and not item.get("prefix"):
            item["prefix"] = "Invoice No"
        return _prefixed(item, str(context.get("bill_no") or ""))
    if fid == "bill_date":
        value = context.get("bill_date_short") if thermal else context.get("bill_date")
        return _prefixed(field, str(value or ""))

    if fid == "date_range":
        return f"From {context.get('date_from') or '—'} to {context.get('date_to') or '—'}"
    if fid == "bill_range":
        bill_from = context.get("bill_from")
        bill_to = context.get("bill_to")
        if not bill_from and not bill_to:
            return ""
        return f"Bill {bill_from or '—'} to {bill_to or '—'}"

    if fid == "gross_amount":
        return _prefixed(field, str(context.get("gross_amount") or "0.00"))
    if fid == "discount_amount":
        return _prefixed(field, str(context.get("discount_amount") or "0.00"))
    if fid == "tax_total":
        return _prefixed(field, str(context.get("tax_amount") or "0.00"))
    if fid == "net_amount":
        return _prefixed(field, str(context.get("net_amount") or "0.00"))
    if fid == "paid_amount":
        return _prefixed(field, str(context.get("paid_amount") or "0.00"))
    if fid == "credit_amount":
        credit = str(context.get("credit_amount") or "0.00")
        if credit in {"0.00", "0", ""}:
            return ""
        return _prefixed(field, credit)
    if fid == "payment_mode":
        payments = context.get("payments") or []
        if payments:
            bits = []
            for pay in payments:
                chunk = f"{pay.get('mode')} ({pay.get('amount')})"
                if pay.get("document"):
                    chunk += f" {pay['document']}"
                bits.append(chunk)
            return _prefixed(field, ", ".join(bits))
        return _prefixed(field, str(context.get("payment_mode") or "—"))
    if fid == "paid_due":
        paid = str(context.get("paid_amount") or "0.00")
        if paid in {"0.00", "0", ""}:
            return ""
        credit = str(context.get("credit_amount") or "0.00")
        line = f"Paid : {paid}"
        if credit not in {"0.00", "0", ""}:
            line += f" &nbsp; Due : {credit}"
        return line
    if fid == "amount_in_words":
        return str(context.get("amount_in_words") or "")
    if fid == "narration":
        narration = str(context.get("narration") or "").strip()
        return "" if not narration else _prefixed(field, narration)
    if fid == "terms":
        return custom or DEFAULT_TERMS
    if fid == "computer_note":
        return custom or DEFAULT_COMPUTER_NOTE
    if fid == "signature":
        return custom or DEFAULT_SIGNATURE
    if fid == "thanks":
        return custom or DEFAULT_THANKS
    if fid == "for_company":
        name = str(context.get("company_name") or "")
        return f"for: {name}" if name else ""
    if fid == "you_save":
        value = str(context.get("you_save") or "").strip()
        if _blank(value) or value in {"0.00", "0"}:
            return ""
        return _prefixed(field, value)
    if fid == "gst_split":
        return "__GST_SPLIT__"
    return str(context.get(fid) or custom or "")


def _p(text: str, field: dict[str, Any], *, css: str = "") -> str:
    align = field.get("align") or "left"
    classes = []
    if field["id"] in {"company_name"}:
        classes.append("header-title" if "shop" not in css else "shop")
    elif field["id"] in {"bill_title", "report_title", "tax_invoice_title"}:
        classes.append("header-sub" if "title" not in css else "title")
    elif field["id"] in {"computer_note"}:
        classes.append("note")
    elif field["id"] in {"thanks"}:
        classes.append("thanks")
    elif field["id"] in {"you_save"}:
        classes.append("you-save")
    elif field["id"] in {"terms", "amount_in_words"}:
        classes.append("terms" if field["id"] == "terms" else "words")
    else:
        classes.append("header-meta" if field.get("full_row") and align == "center" else "meta")
    extra = f" {css}" if css else ""
    style = _field_style(field)
    if field["id"] == "company_name" and "shop" in extra:
        classes = ["center", "shop"]
    if field["id"] == "tax_invoice_title":
        classes = ["center", "title"]
    body = "<br/>".join(_esc(line) if line != "&nbsp;" else "&nbsp;" for line in text.split("\n"))
    # paid_due may include &nbsp; already escaped — restore
    body = body.replace("&amp;nbsp;", "&nbsp;")
    cls = " ".join(c for c in classes if c)
    return f'<p class="{cls}" style="{style}{extra}">{body}</p>'


def _wrap_rows(fields: list[dict[str, Any]], context: dict[str, Any], *, thermal: bool, per_row: int) -> list[list[tuple[dict[str, Any], str]]]:
    rows: list[list[tuple[dict[str, Any], str]]] = []
    current: list[tuple[dict[str, Any], str]] = []
    for field in fields:
        text = _field_text(field, context, thermal=thermal)
        if field["id"] not in {"gst_split"} and _blank(text.replace("&nbsp;", " ")):
            continue
        if field.get("full_row"):
            if current:
                rows.append(current)
                current = []
            rows.append([(field, text)])
            continue
        current.append((field, text))
        if len(current) >= per_row:
            rows.append(current)
            current = []
    if current:
        rows.append(current)
    return rows


def _meta_table(fields: list[dict[str, Any]], context: dict[str, Any], *, thermal: bool) -> str:
    per_row = 2 if thermal else 3
    rows = _wrap_rows(fields, context, thermal=thermal, per_row=per_row)
    if not rows:
        return ""
    html_rows = []
    for row in rows:
        cells = []
        span = max(1, int(12 / max(1, len(row))))
        width = int(100 / max(1, len(row)))
        for field, text in row:
            align = field.get("align") or "left"
            body = "<br/>".join(_esc(line) for line in text.split("\n"))
            body = body.replace("&amp;nbsp;", "&nbsp;")
            style = _field_style(field)
            style_attr = f' style="{style}"' if style else ""
            cells.append(
                f'<td width="{width}%" class="meta" align="{align}" colspan="{span}"{style_attr}>{body}</td>'
            )
        html_rows.append(f"<tr>{''.join(cells)}</tr>")
    return (
        f'<table width="100%" border="0" cellspacing="0" cellpadding="{2 if not thermal else 0}" class="meta">'
        f"{''.join(html_rows)}</table>"
    )


def _line_value(line: dict[str, Any], col_id: str) -> str:
    return str(line.get(col_id) if col_id != "name" else line.get("name") or "")


def _col_width_mm(col: dict[str, Any]) -> float | None:
    return _mm(col, "widthMm", "width_mm")


def _items_use_mm(columns: list[dict[str, Any]]) -> bool:
    return bool(columns) and all(_col_width_mm(c) is not None for c in columns)


def _col_box_style(col: dict[str, Any], *, width_css: str, skip_border: bool = True) -> str:
    style = _field_style(col, skip_border=skip_border)
    bits = [width_css]
    if style:
        bits.append(style)
    return ";".join(bits)


def _scale_mm_columns(columns: list[dict[str, Any]], inner_mm: float) -> list[dict[str, Any]]:
    """Keep column proportions and stretch millimetre widths to the printable inner width."""
    if inner_mm <= 0 or not _items_use_mm(columns):
        return columns
    total = sum(_col_width_mm(c) or 0 for c in columns)
    if total <= 0:
        return columns
    target = max(20.0, inner_mm)
    if abs(total - target) < 0.4:
        return columns
    ratio = target / total
    out: list[dict[str, Any]] = []
    for col in columns:
        item = dict(col)
        item["widthMm"] = round((_col_width_mm(item) or 10) * ratio * 10) / 10
        out.append(item)
    # Rounding each column to 0.1mm can drift past the page; take it off the widest one.
    drift = round(sum(_col_width_mm(c) or 0 for c in out) - target, 2)
    if drift > 0:
        widest = max(out, key=lambda c: _col_width_mm(c) or 0)
        widest["widthMm"] = round(max(2.0, (_col_width_mm(widest) or 10) - drift) * 10) / 10
    return out


def _items_table(
    columns: list[dict[str, Any]],
    lines: list[dict[str, Any]],
    totals: list[dict[str, Any]],
    context: dict[str, Any],
    *,
    thermal: bool,
    inner_mm: float = 0.0,
) -> str:
    if not columns:
        return ""
    if not thermal and inner_mm > 0:
        columns = _scale_mm_columns(columns, inner_mm)
    use_mm = _items_use_mm(columns)
    total_w = sum(int(c.get("width") or 10) for c in columns) or 1
    ths = []
    for col in columns:
        align = col.get("align") or "left"
        label = col.get("label") or col["id"]
        cls = "grid" if not thermal else ""
        if use_mm:
            wmm = _col_width_mm(col) or 10
            width_css = f"width:{_fmt_mm(wmm)}mm;max-width:{_fmt_mm(wmm)}mm"
        else:
            pct = max(4, round(100 * int(col.get("width") or 10) / total_w))
            width_css = f"width:{pct}%"
        style = _col_box_style(col, width_css=width_css)
        style_attr = f' style="{style}"'
        if use_mm:
            ths.append(
                f'<td class="{cls}" align="{align}"{style_attr}>{_esc(label)}</td>'
                if not thermal
                else f'<th align="{align}"{style_attr}>{_esc(str(label).upper())}</th>'
            )
        else:
            pct = max(4, round(100 * int(col.get("width") or 10) / total_w))
            ths.append(
                f'<td width="{pct}%" class="{cls}" align="{align}"{style_attr}>{_esc(label)}</td>'
                if not thermal
                else f'<th align="{align}" width="{pct}%"{style_attr}>{_esc(str(label).upper())}</th>'
            )
    body_rows = []
    for line in lines:
        tds = []
        for col in columns:
            align = col.get("align") or "left"
            val = _line_value(line, col["id"])
            if use_mm:
                wmm = _col_width_mm(col) or 10
                width_css = f"width:{_fmt_mm(wmm)}mm;max-width:{_fmt_mm(wmm)}mm"
            else:
                pct = max(4, round(100 * int(col.get("width") or 10) / total_w))
                width_css = f"width:{pct}%"
            style = _col_box_style(col, width_css=width_css)
            style_attr = f' style="{style}"'
            if thermal:
                tds.append(f'<td align="{align}"{style_attr}>{_esc(val)}</td>')
            elif use_mm:
                tds.append(f'<td class="grid" align="{align}"{style_attr}>{_esc(val)}</td>')
            else:
                pct = max(4, round(100 * int(col.get("width") or 10) / total_w))
                tds.append(f'<td width="{pct}%" class="grid" align="{align}"{style_attr}>{_esc(val)}</td>')
        body_rows.append(f"<tr>{''.join(tds)}</tr>")

    n = len(columns)
    extra = []
    table_total_ids = {"gross_amount", "discount_amount", "tax_total", "net_amount"}
    for field in totals:
        if field["id"] not in table_total_ids:
            continue
        text = _field_text(field, context, thermal=thermal)
        if _blank(text):
            continue
        # last cell is amount, previous are label
        label = _esc(text.rsplit(":", 1)[0] + " :" if ":" in text else (field.get("label") or ""))
        amount = _esc(text.split(":")[-1].strip() if ":" in text else text)
        if thermal:
            extra.append(f'<tr><td>{label}</td><td class="right">{amount}</td></tr>')
        else:
            span = max(1, n - 1)
            extra.append(
                f'<tr><td colspan="{span}" class="grid" align="right">{label}</td>'
                f'<td class="grid" align="right">{amount}</td></tr>'
            )

    mm_style = (
        "width:100%;max-width:100%;table-layout:fixed;margin-top:6px;"
        if use_mm
        else ""
    )
    mm_class = " items-mm" if use_mm else ""
    if thermal:
        table_style = f' style="{mm_style}"' if mm_style else ""
        return (
            f'<table class="items{mm_class}" cellspacing="0" cellpadding="0"{table_style}>'
            f"<thead><tr>{''.join(ths)}</tr></thead>"
            f"<tbody>{''.join(body_rows)}</tbody></table>"
            '<div class="rule"></div>'
            '<p class="rule-line">--------------------------------</p>'
            + (f'<table class="meta tot" cellspacing="0" cellpadding="0">{"".join(extra)}</table>' if extra else "")
        )
    if use_mm:
        return (
            f'<table class="items-mm" border="1" cellspacing="0" cellpadding="0" style="{mm_style}">'
            f"<tr>{''.join(ths)}</tr>{''.join(body_rows)}{''.join(extra)}</table>"
        )
    return (
        f'<table width="100%" border="1" cellspacing="0" cellpadding="3" style="margin-top:6px;">'
        f"<tr>{''.join(ths)}</tr>{''.join(body_rows)}{''.join(extra)}</table>"
    )


def _gst_split_html(context: dict[str, Any], *, thermal: bool) -> str:
    igst = str(context.get("igst_amount") or "0.00")
    tax = str(context.get("tax_amount") or "0.00")
    if igst not in {"0.00", "0", ""}:
        if thermal:
            return f'<table class="meta tot"><tr><td>IGST</td><td class="right">{_esc(igst)}</td></tr></table>'
        return f'<p class="meta">IGST : {_esc(igst)}</p>'
    if tax in {"0.00", "0", ""}:
        return ""
    cgst = _esc(context.get("cgst_amount") or "0.00")
    sgst = _esc(context.get("sgst_amount") or "0.00")
    if thermal:
        return (
            f'<table class="meta tot"><tr><td>CGST : {cgst}</td>'
            f'<td class="right">SGST : {sgst}</td></tr></table>'
        )
    return f'<p class="meta">CGST : {cgst} &nbsp; SGST : {sgst}</p>'


def _header_html(fields: list[dict[str, Any]], context: dict[str, Any], *, thermal: bool) -> str:
    parts = []
    for field in fields:
        if field["id"] == "company_logo":
            inner = _logo_html(field, context, placed=False)
            if not inner:
                continue
            if thermal:
                style = _field_style(field)
                style_attr = f' style="{style}"' if style else ""
                parts.append(f'<p class="center header-logo"{style_attr}>{inner}</p>')
            else:
                parts.append(f'<p class="header-logo">{inner}</p>')
            continue
        text = _field_text(field, context, thermal=thermal)
        if _blank(text):
            continue
        if thermal:
            fid = field["id"]
            style = _field_style(field)
            style_attr = f' style="{style}"' if style else ""
            if fid == "tax_invoice_title":
                parts.append(f'<p class="center title"{style_attr}>{_esc(text)}</p>')
            elif fid == "company_name":
                parts.append(f'<p class="center shop"{style_attr}>{_esc(text)}</p>')
            else:
                cls = "center" if (field.get("align") or "center") == "center" else ""
                for line in text.split("\n"):
                    if line.strip():
                        parts.append(f'<p class="{cls}"{style_attr}>{_esc(line)}</p>')
        else:
            parts.append(_p(text, field))
    if not parts:
        return ""
    if thermal:
        return "".join(parts)
    return f'<table width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td align="center">{"".join(parts)}</td></tr></table>'


def _footer_html(fields: list[dict[str, Any]], context: dict[str, Any], *, thermal: bool) -> str:
    pairable = {"paid_amount", "payment_mode", "credit_amount"}
    parts: list[str] = []
    pending: list[tuple[dict[str, Any], str]] = []

    def flush_pending() -> None:
        nonlocal pending
        if not pending:
            return
        cells = []
        width = int(100 / len(pending))
        for field, text in pending:
            body = "<br/>".join(_esc(line) for line in text.split("\n"))
            body = body.replace("&amp;nbsp;", "&nbsp;")
            cells.append(
                f'<td width="{width}%" class="meta" align="{field.get("align") or "left"}">{body}</td>'
            )
        parts.append(
            f'<table width="100%" border="0" cellspacing="0" cellpadding="2" style="margin-top:8px;"><tr>{"".join(cells)}</tr></table>'
        )
        pending = []

    for field in fields:
        text = _field_text(field, context, thermal=thermal)
        if field["id"] == "gst_split":
            flush_pending()
            html_bit = _gst_split_html(context, thermal=thermal)
            if html_bit:
                parts.append(html_bit)
            continue
        if _blank(text.replace("&nbsp;", " ")):
            continue
        if field["id"] == "signature":
            flush_pending()
            parts.append(
                '<table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top:20px;">'
                "<tr>"
                '<td width="55%" class="note" valign="bottom">&nbsp;</td>'
                f'<td width="45%" class="meta" align="center" valign="bottom" '
                f'style="border-top:1px solid #000; padding-top:4px;">{_esc(text)}</td>'
                "</tr></table>"
            )
            continue
        if not thermal and field["id"] in pairable and not field.get("full_row"):
            pending.append((field, text))
            if len(pending) >= 2:
                flush_pending()
            continue
        flush_pending()
        if field["id"] == "terms":
            lines = "".join(f"<p>{_esc(line)}</p>" for line in text.split("\n") if line.strip())
            parts.append(f'<div class="terms">{lines}</div>')
        elif field["id"] == "paid_due":
            parts.append(f"<p>{text}</p>")
        else:
            parts.append(_p(text, field))
    flush_pending()
    return "".join(parts)


def _report_table(band: dict[str, list[dict[str, Any]]], context: dict[str, Any]) -> str:
    columns = visible_fields(band, "columns")
    if not columns:
        return ""
    gst_rates = list(context.get("gst_rates") or [])
    head = []
    for col in columns:
        if col["id"] == "gst_rate_columns":
            for rate in gst_rates:
                label = f"{int(rate) if float(rate).is_integer() else rate}%"
                head.append(f'<td class="grid" align="right">{_esc(label)}</td>')
            continue
        align = col.get("align") or "left"
        style = _field_style(col, skip_border=True)
        style_attr = f' style="{style}"' if style else ""
        head.append(
            f'<td class="grid" align="{align}"{style_attr}>{_esc(col.get("label") or col["id"])}</td>'
        )

    body = []
    rows = list(context.get("rows") or [])
    if not rows:
        span = len(head) or 1
        body.append(f'<tr><td class="grid" colspan="{span}" align="center">No bills in this range</td></tr>')
    for row in rows:
        tds = []
        amounts = row.get("amounts") or {}
        for col in columns:
            if col["id"] == "gst_rate_columns":
                for rate in gst_rates:
                    tds.append(f'<td class="grid" align="right">{float(amounts.get(rate, 0)):.2f}</td>')
                continue
            align = col.get("align") or "left"
            key = "date" if col["id"] == "date" else col["id"]
            val = row.get(key, "")
            if col["id"] == "total":
                val = f"{float(row.get('total') or 0):.2f}"
            style = _field_style(col, skip_border=True)
            style_attr = f' style="{style}"' if style else ""
            tds.append(f'<td class="grid" align="{align}"{style_attr}>{_esc(val)}</td>')
        body.append(f"<tr>{''.join(tds)}</tr>")

    totals = context.get("totals") or {}
    tot_amounts = totals.get("amounts") or {}
    foot = []
    label_span = sum(1 for c in columns if c["id"] not in {"gst_rate_columns", "total"})
    count = totals.get("bill_count")
    count_txt = f" ({count} bills)" if count else ""
    if label_span:
        foot.append(f'<td class="grid tot" colspan="{label_span}" align="right">Page / Report Total{count_txt}</td>')
    for col in columns:
        if col["id"] == "gst_rate_columns":
            for rate in gst_rates:
                foot.append(f'<td class="grid tot" align="right">{float(tot_amounts.get(rate, 0)):.2f}</td>')
        elif col["id"] == "total":
            foot.append(f'<td class="grid tot" align="right">{float(totals.get("total") or 0):.2f}</td>')
        elif label_span == 0:
            foot.append(f'<td class="grid tot">{_esc(col.get("label") or "")}</td>')
    return (
        '<table border="1" cellspacing="0" cellpadding="3">'
        f"<thead><tr>{''.join(head)}</tr></thead>"
        f"<tbody>{''.join(body)}</tbody>"
        f"<tfoot><tr>{''.join(foot)}</tr></tfoot></table>"
    )


def _payment_summary_html(context: dict[str, Any]) -> str:
    rows = list(context.get("payment_rows") or [])
    if not rows:
        return ""
    body = [
        f'<tr><td class="grid">{_esc(p.get("payment_mode"))}</td>'
        f'<td class="grid" align="right">{float(p.get("total") or 0):.2f}</td></tr>'
        for p in rows
    ]
    total = float(context.get("payment_total") or 0)
    return (
        '<p class="meta" style="margin-top:14px;">Collection by payment mode</p>'
        '<table border="1" cellspacing="0" cellpadding="3" style="width:50%;">'
        f"{''.join(body)}"
        f'<tr><td class="grid tot">Total Collection</td><td class="grid tot" align="right">{total:.2f}</td></tr>'
        "</table>"
    )


def _margin_css(pad: dict[str, float]) -> str:
    return (
        f"{_fmt_mm(pad['paddingTopMm'])}mm {_fmt_mm(pad['paddingRightMm'])}mm "
        f"{_fmt_mm(pad['paddingBottomMm'])}mm {_fmt_mm(pad['paddingLeftMm'])}mm"
    )


def _page_css_from_padding(
    fmt: str,
    _pad: dict[str, float],
    orientation: str = "portrait",
    paper: tuple[float, float] | None = None,
) -> str:
    # Visual inset is on .page-frame so the designer preview iframe matches print.
    width_mm, height_mm = paper if paper is not None else (0.0, 0.0)
    if not paper:
        from modules.generp.ge.reports.bill_formats import oriented_paper_mm

        width_mm, height_mm = oriented_paper_mm(fmt, orientation)
    if is_thermal(fmt):
        return f"size: {width_mm:.0f}mm auto; margin: 0;"
    return f"size: {width_mm:g}mm {height_mm:g}mm; margin: 0;"


def _page_frame(inner: str, layout: dict[str, Any], fmt: str) -> str:
    page_border = bool((layout.get("page_borders") or {}).get(fmt))
    frame_cls = "page-frame has-border" if page_border else "page-frame"
    pad = page_padding_of(layout, fmt)
    style = f' style="padding:{_margin_css(pad)};box-sizing:border-box;"'
    return f'<div class="{frame_cls}"{style}>{inner}</div>'


def render_bill_html(context: dict[str, Any], layout: dict[str, Any], bill_format: str | None) -> str:
    fmt = resolve_layout_format(layout, bill_format)
    thermal = is_thermal(fmt)
    if not thermal:
        layout = fit_layout_to_page(layout, fmt)
    band = layout_for_format(layout, fmt)
    pad = page_padding_of(layout, fmt)
    orientation = page_orientation_of(layout, fmt)
    page_w, page_h = paper_mm_of(layout, fmt)
    inner_mm = printable_inner_mm(layout, fmt)
    page_css = _page_css_from_padding(fmt, pad, orientation, (page_w, page_h))
    width = int(page_w) if float(page_w).is_integer() else page_w
    height = int(page_h) if float(page_h).is_integer() else page_h
    if thermal:
        css = _THERMAL_CSS % {
            "page_css": page_css,
            "width": width,
            "font": "9pt" if fmt == "THERMAL_58" else "10pt",
            "shop": "12pt" if fmt == "THERMAL_58" else "14pt",
            "item": "8pt" if fmt == "THERMAL_58" else "9pt",
            "tot": "10pt" if fmt == "THERMAL_58" else "11pt",
        }
        body_cls = "thermal-slip"
    else:
        css = _A4_CSS % {"page_css": page_css, "width": width, "height": height}
        body_cls = ""

    header_fields = visible_fields(band, "header")
    meta_fields = visible_fields(band, "meta")
    totals_fields = visible_fields(band, "totals")
    footer_fields = visible_fields(band, "footer")
    totals_placed = _band_placed(totals_fields)

    header = (
        _placed_band_html(header_fields, context, thermal=thermal)
        if _band_placed(header_fields)
        else _header_html(header_fields, context, thermal=thermal)
    )
    meta = (
        _placed_band_html(meta_fields, context, thermal=thermal)
        if _band_placed(meta_fields)
        else _meta_table(meta_fields, context, thermal=thermal)
    )
    items = _items_table(
        visible_fields(band, "columns"),
        list(context.get("lines") or []),
        [] if totals_placed else totals_fields,
        context,
        thermal=thermal,
        inner_mm=0.0 if thermal else inner_mm,
    )
    gst_in_totals = any(f["id"] == "gst_split" for f in totals_fields)
    if totals_placed:
        totals_html = _placed_band_html(totals_fields, context, thermal=thermal)
        gst_html = ""
    else:
        totals_html = ""
        gst_html = _gst_split_html(context, thermal=thermal) if gst_in_totals else ""
    footer = (
        _placed_band_html(footer_fields, context, thermal=thermal)
        if _band_placed(footer_fields)
        else _footer_html(footer_fields, context, thermal=thermal)
    )

    rule = '<div class="rule"></div>' if thermal else ""
    chunks = [header, rule, meta, rule, items]
    if totals_html:
        chunks.append(totals_html)
    if gst_html:
        chunks.append(gst_html)
    chunks.append(footer)
    inner = "".join(chunk for chunk in chunks if chunk)
    inner = _page_frame(inner, layout, fmt)

    title = _esc(f"{context.get('bill_title') or 'Bill'} - {context.get('bill_no') or ''}")
    page_attrs = f"data-page-w='{width}' data-page-orientation='{orientation}'"
    if not thermal:
        page_attrs += f" data-page-h='{height}'"
    return (
        "<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'>"
        f"<title>{title}</title><style type='text/css'>{css}</style></head>"
        f"<body class='{body_cls}' {page_attrs}>{inner}</body></html>"
    )


def render_report_html(context: dict[str, Any], layout: dict[str, Any], bill_format: str | None) -> str:
    fmt = resolve_layout_format(layout, bill_format)
    band = layout_for_format(layout, fmt)
    pad = page_padding_of(layout, fmt)
    orientation = page_orientation_of(layout, fmt)
    page_w, page_h = paper_mm_of(layout, fmt)
    width = int(page_w) if float(page_w).is_integer() else page_w
    height = int(page_h) if float(page_h).is_integer() else page_h
    css = _A4_CSS % {
        "page_css": _page_css_from_padding(fmt, pad, orientation, (page_w, page_h)),
        "width": width,
        "height": height,
    }
    header_fields = visible_fields(band, "header")
    meta_fields = visible_fields(band, "meta")
    footer_fields = visible_fields(band, "footer")
    header = (
        _placed_band_html(header_fields, context, thermal=False)
        if _band_placed(header_fields)
        else _header_html(header_fields, context, thermal=False)
    )
    meta = (
        _placed_band_html(meta_fields, context, thermal=False)
        if _band_placed(meta_fields)
        else _meta_table(meta_fields, context, thermal=False)
    )
    table = _report_table(band, context)
    footer_bits = []
    if _band_placed(footer_fields):
        footer_bits.append(_placed_band_html(footer_fields, context, thermal=False))
    else:
        for field in footer_fields:
            if field["id"] == "payment_summary":
                footer_bits.append(_payment_summary_html(context))
            else:
                text = _field_text(field, context, thermal=False)
                if not _blank(text):
                    footer_bits.append(_p(text, field))
    inner = "".join([header, meta, table, *footer_bits])
    inner = _page_frame(inner, layout, fmt)
    return (
        "<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'>"
        "<title>Daily Collection Report</title>"
        f"<style type='text/css'>{css}</style></head>"
        f"<body data-page-w='{width}' data-page-h='{height}' "
        f"data-page-orientation='{orientation}'>{inner}</body></html>"
    )


def render_document_html(
    *,
    code: str,
    context: dict[str, Any],
    layout_raw: Any,
    bill_format: str | None,
) -> str:
    layout = normalize_layout(code, layout_raw)
    kind = layout.get("kind")
    fmt = resolve_layout_format(layout, bill_format)
    if kind == KIND_REPORT:
        html_out = render_report_html(context, layout, fmt)
    else:
        html_out = render_bill_html(context, layout, fmt)
    page_w, page_h = paper_mm_of(layout, fmt)
    # Inset lives on .page-frame so the live preview iframe matches the printer.
    # @page margin stays 0 here to avoid doubling that inset.
    return prepare_report_html(
        html_out,
        bill_format=fmt,
        page_margin="0",
        orientation=page_orientation_of(layout, fmt),
        paper_mm=(page_w, page_h),
    )
