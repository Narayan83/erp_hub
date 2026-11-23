"""Render a saved bill layout to printable HTML (table-based, same engine idea as GenERP)."""

from __future__ import annotations

import html
import json
from typing import Any

from erp_core.printing.layouts import (
    layout_for_format,
    normalize_layout,
    page_insets,
    paper_mm,
    resolve_format,
)
from erp_core.printing.page_size_stamp import orient_page_mm


def _esc(value: Any) -> str:
    return html.escape("" if value is None else str(value))


def _field_text(field: dict[str, Any], context: dict[str, Any], line: dict[str, Any] | None = None) -> str:
    fid = str(field.get("id") or "")
    if fid.startswith("copy_"):
        fid = str(field.get("source_id") or fid)
    if fid.startswith("static_") or fid in {"computer_note", "signature", "thanks"}:
        return str(field.get("text") or field.get("label") or "")
    if fid == "bill_title":
        return str(field.get("text") or context.get("bill_title") or field.get("label") or "")
    if line is not None:
        return "" if line.get(fid) is None else str(line.get(fid))
    if fid == "payment_mode":
        payments = context.get("payments") or []
        if isinstance(payments, list) and payments:
            parts = []
            for item in payments:
                if not isinstance(item, dict):
                    continue
                mode = str(item.get("mode") or "").strip()
                if not mode:
                    continue
                doc = str(item.get("document_no") or "").strip()
                parts.append(f"{mode} [{doc}]" if doc else mode)
            if parts:
                return ", ".join(parts)
        return str(context.get("payment_mode") or "")
    if fid == "adjust_advance":
        if context.get("hide_advance_on_bill"):
            return ""
        value = context.get("adjust_advance")
        if value is None or str(value).strip() in {"", "0", "0.00"}:
            return ""
        return str(value)
    if fid == "ward_bed":
        explicit = context.get("ward_bed")
        if explicit:
            return str(explicit)
        return f"{context.get('ward_name') or '—'} / {context.get('bed_no') or '—'}"
    if fid == "receipt_amount":
        return str(context.get("receipt_amount") or context.get("amount") or "")
    value = context.get(fid)
    if value is None or value == "":
        return ""
    return str(value)


def _align(field: dict[str, Any]) -> str:
    align = field.get("align") or "left"
    return align if align in {"left", "center", "right"} else "left"


def _visible(fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [field for field in fields if field.get("visible")]


def _default_bold(field: dict[str, Any]) -> bool:
    fid = str(field.get("id") or "")
    return fid not in {"computer_note", "thanks"} and not fid.startswith("static_")


def _default_underline(field: dict[str, Any]) -> bool:
    return str(field.get("id") or "") == "bill_title"


def _font_css(field: dict[str, Any], *, fallback: str, default_bold: bool | None = None) -> str:
    parts: list[str] = []
    family = field.get("font_family") or field.get("fontFamily")
    if family:
        safe = "".join(ch for ch in str(family) if ch.isprintable() and ch not in {"'", '"', ";", "<", ">"})
        if safe:
            parts.append(f"font-family:'{safe}',serif;")
    size = field.get("font_size_pt")
    if size is None:
        size = field.get("fontSizePt")
    try:
        points = float(size) if size is not None else None
    except (TypeError, ValueError):
        points = None
    parts.append(f"font-size:{points:g}pt;" if points is not None else f"font-size:{fallback};")
    if "font_bold" in field or "fontBold" in field:
        bold = bool(field.get("font_bold") if "font_bold" in field else field.get("fontBold"))
    else:
        bold = _default_bold(field) if default_bold is None else default_bold
    parts.append(f"font-weight:{'bold' if bold else 'normal'};")
    if "font_italic" in field or "fontItalic" in field:
        italic = bool(field.get("font_italic") if "font_italic" in field else field.get("fontItalic"))
    else:
        italic = False
    parts.append(f"font-style:{'italic' if italic else 'normal'};")
    if "font_underline" in field or "fontUnderline" in field:
        underline = bool(field.get("font_underline") if "font_underline" in field else field.get("fontUnderline"))
    else:
        underline = _default_underline(field)
    if underline:
        parts.append("text-decoration:underline;")
    return "".join(parts)


def _p(text: str, field: dict[str, Any], *, size: str = "11pt", bold: bool | None = None) -> str:
    if not str(text).strip():
        return ""
    return (
        f"<p style='margin:0;padding:1px 0;text-align:{_align(field)};"
        f"{_font_css(field, fallback=size, default_bold=bold)}'>{_esc(text)}</p>"
    )


_HEADER_LABELED = {
    "hospital_phone",
    "hospital_mobile",
    "hospital_email",
    "hospital_gstin",
    "hospital_registration_number",
    "hospital_website",
    "hospital_software_id",
}


def _header_html(fields: list[dict[str, Any]], context: dict[str, Any]) -> str:
    bits: list[str] = []
    for field in _visible(fields):
        text = _field_text(field, context)
        label = str(field.get("label") or "").strip()
        if field["id"] in _HEADER_LABELED and str(text).strip() and label:
            text = f"{label}: {text}"
        aligned = {**field, "align": field.get("align") or "center"}
        if field["id"] == "hospital_name":
            bits.append(_p(text, aligned, size="16pt"))
        elif field["id"] == "bill_title":
            bits.append(
                f"<p style='margin:4px 0 6px;text-align:center;"
                f"{_font_css(aligned, fallback='12pt')}'>{_esc(text)}</p>"
            )
        else:
            bits.append(_p(text, aligned, size="10pt"))
    return "".join(bits)


def _meta_html(fields: list[dict[str, Any]], context: dict[str, Any]) -> str:
    visible = []
    for field in _visible(fields):
        value = _field_text(field, context)
        if not str(value).strip():
            continue
        visible.append((field, value))
    if not visible:
        return ""
    cells = []
    for field, value in visible:
        label = field.get("label") or field["id"]
        cells.append(
            f"<td style='padding:2px 4px;text-align:{_align(field)};"
            f"{_font_css(field, fallback='11pt')}'>"
            f"{_esc(label)} : {_esc(value)}</td>"
        )
    rows = []
    for index in range(0, len(cells), 3):
        chunk = cells[index : index + 3]
        while len(chunk) < 3:
            chunk.append("<td>&nbsp;</td>")
        rows.append("<tr>" + "".join(chunk) + "</tr>")
    return (
        "<table width='100%' cellspacing='0' cellpadding='0' style='margin-top:4px;'>"
        + "".join(rows)
        + "</table>"
    )


def _mm(field: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        if field.get(key) is None or field.get(key) == "":
            continue
        try:
            return float(field[key])
        except (TypeError, ValueError):
            return None
    return None


def _is_placed(fields: list[dict[str, Any]]) -> bool:
    visible = _visible(fields)
    return bool(visible) and all(_mm(field, "x_mm", "xMm") is not None for field in visible)


def _col_weight(field: dict[str, Any]) -> float:
    placed = _mm(field, "width_mm", "widthMm")
    if placed is not None and placed > 0:
        return placed
    try:
        return float(field.get("width") or 10)
    except (TypeError, ValueError):
        return 10.0


def _columns_html(fields: list[dict[str, Any]], context: dict[str, Any]) -> str:
    visible = _visible(fields)
    if not visible:
        return ""
    if _is_placed(fields):
        visible = sorted(visible, key=lambda field: _mm(field, "x_mm", "xMm") or 0)
    total_width = sum(_col_weight(field) for field in visible) or 1
    header_cells = []
    for field in visible:
        pct = round(_col_weight(field) / total_width * 100, 2)
        header_cells.append(
            f"<td width='{pct}%' style='border:1px solid #000;padding:2px 3px;"
            f"{_font_css(field, fallback='10pt')}text-align:{_align(field)};'>"
            f"{_esc(field.get('label') or '')}</td>"
        )
    body = []
    for line in context.get("lines") or []:
        if not isinstance(line, dict):
            continue
        tds = []
        for field in visible:
            pct = round(_col_weight(field) / total_width * 100, 2)
            tds.append(
                f"<td width='{pct}%' style='border:1px solid #000;padding:2px 3px;"
                f"{_font_css(field, fallback='10pt')}text-align:{_align(field)};'>"
                f"{_esc(_field_text(field, context, line))}</td>"
            )
        body.append("<tr>" + "".join(tds) + "</tr>")
    return (
        "<table width='100%' cellspacing='0' cellpadding='0' style='margin-top:6px;border-collapse:collapse;'>"
        f"<tr>{''.join(header_cells)}</tr>{''.join(body)}</table>"
    )


def _totals_html(fields: list[dict[str, Any]], context: dict[str, Any]) -> str:
    rows = []
    for field in _visible(fields):
        if field["id"] == "adjust_advance" and context.get("hide_advance_on_bill"):
            continue
        value = _field_text(field, context)
        if not str(value).strip() or value in {"0.00", "0"}:
            if field["id"] not in {"net_amount", "receipt_amount"}:
                continue
        style = f"text-align:right;padding:1px 8px;{_font_css(field, fallback='11pt')}"
        rows.append(
            "<tr>"
            f"<td style='{style}'>{_esc(field.get('label') or '')}</td>"
            f"<td style='text-align:right;padding:1px 0;width:90px;{_font_css(field, fallback='11pt')}'>"
            f"{_esc(value)}</td></tr>"
        )
    if not rows:
        return ""
    return (
        "<table width='100%' cellspacing='0' cellpadding='0' style='margin-top:6px;'>"
        "<tr><td width='70%'>&nbsp;</td><td width='30%'>"
        "<table width='100%' cellspacing='0' cellpadding='0'>"
        + "".join(rows)
        + "</table></td></tr></table>"
    )


def _footer_html(fields: list[dict[str, Any]], context: dict[str, Any]) -> str:
    bits = []
    for field in _visible(fields):
        text = _field_text(field, context)
        if not str(text).strip():
            continue
        if field["id"] in {"computer_note", "thanks"} or field["id"].startswith("static_"):
            bits.append(_p(text, field, size="9pt", bold=False))
        elif field["id"] == "signature":
            bits.append(
                "<table width='100%' style='margin-top:18px;'><tr>"
                "<td width='55%'>&nbsp;</td>"
                f"<td width='45%' style='border-top:1px solid #000;text-align:center;padding-top:4px;"
                f"{_font_css(field, fallback='11pt')}'>"
                f"{_esc(text)}</td></tr></table>"
            )
        else:
            label = field.get("label") or ""
            bits.append(_p(f"{label} : {text}", field))
    return "".join(bits)


def _placed_body(field: dict[str, Any], context: dict[str, Any], band: str) -> str:
    text = _field_text(field, context)
    if band in {"header", "columns"}:
        return text if band == "header" else str(field.get("label") or "")
    if band == "totals":
        if field["id"] == "adjust_advance" and (
            context.get("hide_advance_on_bill") or not str(text).strip() or text in {"0.00", "0"}
        ):
            return ""
        if field["id"] not in {"net_amount", "receipt_amount"} and (
            not str(text).strip() or text in {"0.00", "0"}
        ):
            return ""
        label = str(field.get("label") or "")
        return f"{label}  {text}".strip()
    if field["id"] in {"computer_note", "thanks", "signature"} or str(field["id"]).startswith("static_"):
        return text
    label = str(field.get("label") or "")
    if str(text).strip():
        return f"{label} : {text}" if label else text
    return ""


def _placed_band_html(fields: list[dict[str, Any]], context: dict[str, Any], band: str, inner_mm: float) -> str:
    visible = [field for field in _visible(fields) if _mm(field, "x_mm", "xMm") is not None]
    if not visible:
        return ""
    rows: list[list[dict[str, Any]]] = []
    for field in sorted(visible, key=lambda item: ((_mm(item, "y_mm", "yMm") or 0), (_mm(item, "x_mm", "xMm") or 0))):
        y = _mm(field, "y_mm", "yMm") or 0
        if rows and abs(y - (_mm(rows[-1][0], "y_mm", "yMm") or 0)) < 2.0:
            rows[-1].append(field)
        else:
            rows.append([field])
    tables: list[str] = []
    inner = max(inner_mm, 1.0)
    for row in rows:
        ordered = sorted(row, key=lambda item: _mm(item, "x_mm", "xMm") or 0)
        cursor = 0.0
        cells: list[tuple[float, str]] = []
        for field in ordered:
            x = max(0.0, _mm(field, "x_mm", "xMm") or 0)
            width = max(4.0, _mm(field, "width_mm", "widthMm") or 20)
            if x > cursor + 0.8:
                cells.append((x - cursor, ""))
            body = _placed_body(field, context, band)
            if band != "columns" and not str(body).strip():
                cursor = max(cursor, x + width)
                continue
            border = ""
            if field["id"] == "signature":
                border = "border-top:1px solid #000;"
            style = (
                f"padding:1px 2px;{_font_css(field, fallback='10pt')}"
                f"text-align:{_align(field)};vertical-align:top;{border}"
            )
            cells.append((width, f"<td style='{style}'>{_esc(body)}</td>"))
            cursor = max(cursor, x + width)
        if cursor < inner - 0.8:
            cells.append((inner - cursor, ""))
        if not any(html_bit for _w, html_bit in cells):
            continue
        total = sum(width for width, _html in cells) or 1
        rendered = []
        for width, html_bit in cells:
            pct = max(1.0, round(width / total * 100, 2))
            if html_bit:
                rendered.append(html_bit.replace("<td ", f"<td width='{pct}%' ", 1))
            else:
                rendered.append(f"<td width='{pct}%'>&nbsp;</td>")
        tables.append(
            "<table width='100%' cellspacing='0' cellpadding='0' style='margin:0;'><tr>"
            + "".join(rendered)
            + "</tr></table>"
        )
    return "".join(tables)


def _band_html(band: str, fields: list[dict[str, Any]], context: dict[str, Any], inner_mm: float) -> str:
    if band != "columns" and _is_placed(fields):
        return _placed_band_html(fields, context, band, inner_mm)
    if band == "header":
        return _header_html(fields, context)
    if band == "meta":
        return _meta_html(fields, context)
    if band == "columns":
        return _columns_html(fields, context)
    if band == "totals":
        return _totals_html(fields, context)
    return _footer_html(fields, context)


def _line_mm(field: dict[str, Any], band: str) -> float:
    points = _mm(field, "font_size_pt", "fontSizePt")
    if points is None:
        points = 9.0 if band == "columns" else 10.0
    return max(3.4, float(points) * 0.3528 * 1.25 + 0.7)


def _fit_placed_bands(
    bands: dict[str, list[dict[str, Any]]],
    content_w: float,
) -> dict[str, list[dict[str, Any]]]:
    """Same fit as the template designer: keep every box inside the margins."""
    rights: list[float] = []
    for fields in bands.values():
        for field in fields:
            if field.get("visible") and _mm(field, "x_mm", "xMm") is not None:
                rights.append((_mm(field, "x_mm", "xMm") or 0) + (_mm(field, "width_mm", "widthMm") or 0))
    if not rights:
        return bands
    span = max(rights)
    if span <= 0 or abs(span - content_w) < 0.35:
        return bands
    ratio = content_w / span
    fitted: dict[str, list[dict[str, Any]]] = {}
    for band, fields in bands.items():
        copied: list[dict[str, Any]] = []
        for field in fields:
            item = dict(field)
            if _mm(item, "x_mm", "xMm") is not None:
                item["x_mm"] = round(max(0.0, (_mm(item, "x_mm", "xMm") or 0) * ratio), 2)
                item["width_mm"] = round(max(0.1, (_mm(item, "width_mm", "widthMm") or 10) * ratio), 2)
            copied.append(item)
        fitted[band] = copied
    return fitted


def _rows_by_y(fields: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    rows: list[list[dict[str, Any]]] = []
    ordered = sorted(
        [field for field in fields if field.get("visible") and _mm(field, "x_mm", "xMm") is not None],
        key=lambda item: ((_mm(item, "y_mm", "yMm") or 0), (_mm(item, "x_mm", "xMm") or 0)),
    )
    for field in ordered:
        y = _mm(field, "y_mm", "yMm") or 0
        if rows and abs(y - (_mm(rows[-1][0], "y_mm", "yMm") or 0)) < 2.0:
            rows[-1].append(field)
        else:
            rows.append([field])
    return rows


def _box(
    field: dict[str, Any],
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    text: str,
    band: str,
    border: bool = False,
) -> dict[str, Any]:
    points = _mm(field, "font_size_pt", "fontSizePt")
    if points is None:
        points = 9.0 if band == "columns" else 10.0
    family = str(field.get("font_family") or field.get("fontFamily") or "Times New Roman")
    if "font_bold" in field or "fontBold" in field:
        bold = bool(field.get("font_bold") if "font_bold" in field else field.get("fontBold"))
    else:
        bold = _default_bold(field)
    if "font_italic" in field or "fontItalic" in field:
        italic = bool(field.get("font_italic") if "font_italic" in field else field.get("fontItalic"))
    else:
        italic = False
    if "font_underline" in field or "fontUnderline" in field:
        underline = bool(field.get("font_underline") if "font_underline" in field else field.get("fontUnderline"))
    else:
        underline = _default_underline(field)
    return {
        "x": round(x, 2),
        "y": round(y, 2),
        "w": round(width, 2),
        "h": round(height, 2),
        "text": text,
        "pt": round(float(points), 2),
        "family": family,
        "bold": bold,
        "italic": italic,
        "underline": underline,
        "align": _align(field),
        "border": border,
        "rule": field.get("id") == "signature",
        "band": band,
    }


def _box_height(field: dict[str, Any], band: str) -> float:
    height = _mm(field, "height_mm", "heightMm")
    if height is not None and height >= 3:
        return float(height)
    return _line_mm(field, band)


def _fit_detail_boxes(
    boxes: list[dict[str, Any]],
    paper_h: float,
    bottom: float,
    *,
    enabled: bool,
) -> list[dict[str, Any]]:
    """Push totals and footer to the bottom so the detail area fills the page."""
    if not enabled:
        return boxes
    foot = [box for box in boxes if box.get("band") in {"totals", "footer"}]
    if not foot:
        return boxes
    foot_bottom = max(float(box["y"]) + float(box["h"]) for box in foot)
    slack = (paper_h - bottom) - foot_bottom
    if slack <= 0.4:
        return boxes
    for box in foot:
        box["y"] = round(float(box["y"]) + slack, 2)
    return boxes


def _field_by_id(bands: dict[str, list[dict[str, Any]]], field_id: str) -> dict[str, Any] | None:
    if not field_id:
        return None
    for fields in bands.values():
        for field in fields:
            if str(field.get("id") or "") == field_id:
                return field
    return None


def _push_footer_below_detail(boxes: list[dict[str, Any]]) -> tuple[float, float | None]:
    """Keep totals and the footer under the last detail row."""
    detail = [box for box in boxes if box.get("band") == "columns"]
    foot = [box for box in boxes if box.get("band") in {"totals", "footer"}]
    if not detail or not foot:
        return 0.0, None
    detail_bottom = max(float(box["y"]) + float(box["h"]) for box in detail)
    foot_top = min(float(box["y"]) for box in foot)
    shift = detail_bottom + 0.8 - foot_top
    if shift <= 0.4:
        return 0.0, foot_top
    for box in foot:
        box["y"] = round(float(box["y"]) + shift, 2)
    return shift, foot_top


def _column_rows(boxes: list[dict[str, Any]]) -> list[tuple[float, float, float, float]]:
    columns = [box for box in boxes if box.get("band") == "columns"]
    if not columns:
        return []
    rows: list[tuple[float, float, float, float]] = []
    seen: list[float] = []
    for box in sorted(columns, key=lambda item: float(item["y"])):
        y = float(box["y"])
        if any(abs(y - prior) < 0.3 for prior in seen):
            continue
        seen.append(y)
        same = [item for item in columns if abs(float(item["y"]) - y) < 0.3]
        left = min(float(item["x"]) for item in same)
        right = max(float(item["x"]) + float(item["w"]) for item in same)
        height = max(float(item["h"]) for item in same)
        rows.append((left, y, max(2.0, right - left), height))
    return rows


def _shape_boxes(
    shapes: list[dict[str, Any]],
    left: float,
    top: float,
    bands: dict[str, list[dict[str, Any]]] | None = None,
    content_w: float | None = None,
    *,
    footer_shift: float = 0.0,
    shift_anchor: float | None = None,
    detail_rows: list[tuple[float, float, float, float]] | None = None,
) -> list[dict[str, Any]]:
    drawn: list[dict[str, Any]] = []
    if bands and content_w:
        bands = _fit_placed_bands(bands, content_w)
    for shape in shapes:
        axis = "v" if shape.get("axis") == "v" else "h"
        x = left + float(shape.get("x_mm") or 0)
        y = top + float(shape.get("y_mm") or 0)
        length = max(2.0, float(shape.get("length_mm") or 20))
        kind = str(shape.get("kind") or "line")
        if kind not in {"line", "rect", "square", "ellipse", "triangle", "diamond", "round"}:
            kind = "line"
        field = _field_by_id(bands or {}, str(shape.get("field_id") or ""))
        if kind == "line" and str(shape.get("mode") or "") == "content" and field is not None:
            if axis == "v":
                field_y = _mm(field, "y_mm", "yMm")
                if field_y is not None:
                    y = top + field_y
                height = _mm(field, "height_mm", "heightMm")
                if height:
                    length = max(2.0, height)
            else:
                field_x = _mm(field, "x_mm", "xMm")
                if field_x is not None:
                    x = left + field_x
                width = _mm(field, "width_mm", "widthMm")
                if not width:
                    try:
                        width = float(field.get("width") or 0)
                    except (TypeError, ValueError):
                        width = 0
                if width:
                    length = max(2.0, width)
        page_y = y
        if (
            shape.get("repeat") != "detail"
            and shift_anchor is not None
            and page_y >= shift_anchor - 0.2
        ):
            page_y += footer_shift
        try:
            rotate = float(shape.get("rotate_deg") or 0)
        except (TypeError, ValueError):
            rotate = 0.0
        if kind == "line" and shape.get("repeat") == "detail" and detail_rows:
            for _row_x, row_y, row_w, _row_h in detail_rows:
                if axis == "v":
                    drawn.append(
                        {
                            "x": left + float(shape.get("x_mm") or 0),
                            "y": row_y + float(shape.get("y_mm") or 0),
                            "w": 0.4,
                            "h": length,
                            "text": "",
                            "line": "v",
                            "rotate": rotate,
                            "pt": 1,
                        }
                    )
                else:
                    drawn.append(
                        {
                            "x": left + float(shape.get("x_mm") or 0),
                            "y": row_y + float(shape.get("y_mm") or 0),
                            "w": length or row_w,
                            "h": 0.4,
                            "text": "",
                            "line": "h",
                            "rotate": rotate,
                            "pt": 1,
                        }
                    )
            continue
        if kind in {"rect", "square", "ellipse", "triangle", "diamond", "round"}:
            box_w = max(2.0, float(shape.get("width_mm") or length))
            box_h = max(2.0, float(shape.get("height_mm") or box_w))
            drawn.append(
                {
                    "x": x,
                    "y": page_y,
                    "w": box_w,
                    "h": box_h,
                    "text": "",
                    "border": True,
                    "shape": kind,
                    "rotate": rotate,
                    "pt": 1,
                }
            )
            continue
        if axis == "v":
            drawn.append(
                {"x": x, "y": page_y, "w": 0.4, "h": length, "text": "", "line": "v", "rotate": rotate, "pt": 1}
            )
        else:
            drawn.append(
                {"x": x, "y": page_y, "w": length, "h": 0.4, "text": "", "line": "h", "rotate": rotate, "pt": 1}
            )
    return drawn


def _free_sheet_boxes(
    bands: dict[str, list[dict[str, Any]]],
    context: dict[str, Any],
    *,
    paper_w: float,
    paper_h: float,
    top: float,
    right: float,
    bottom: float,
    left: float,
    border: bool,
    trim: bool,
    fit_detail: bool = False,
    detail_boxes: bool = True,
) -> dict[str, Any] | None:
    """Each field keeps the page position it was dragged to."""
    content_w = max(12.0, paper_w - left - right)
    fitted = _fit_placed_bands(bands, content_w)
    boxes: list[dict[str, Any]] = []
    lines = [line for line in (context.get("lines") or []) if isinstance(line, dict)]
    for band in ("header", "meta", "columns", "totals", "footer"):
        fields = [
            field
            for field in fitted.get(band) or []
            if field.get("visible") and _mm(field, "x_mm", "xMm") is not None
        ]
        for field in fields:
            height = _box_height(field, band)
            x = left + (_mm(field, "x_mm", "xMm") or 0)
            y = top + (_mm(field, "y_mm", "yMm") or 0)
            width = _mm(field, "width_mm", "widthMm") or 10
            if band == "columns":
                boxes.append(
                    _box(
                        field,
                        x=x,
                        y=y,
                        width=width,
                        height=height,
                            text=str(field.get("label") or ""),
                        band=band,
                        border=detail_boxes,
                    )
                )
                for index, line in enumerate(lines):
                    value = _field_text(field, context, line)
                    boxes.append(
                        _box(
                            field,
                            x=x,
                            y=y + height * (index + 1),
                            width=width,
                            height=height,
                            text="" if value is None else str(value),
                            band=band,
                            border=detail_boxes,
                        )
                    )
                continue
            text = _placed_body(field, context, band)
            if not str(text).strip():
                continue
            boxes.append(
                _box(
                    field,
                    x=x,
                    y=y,
                    width=width,
                    height=height,
                    text=str(text),
                    band=band,
                )
            )
    if not boxes:
        return None
    boxes = _fit_detail_boxes(boxes, paper_h, bottom, enabled=fit_detail)
    if trim and not fit_detail:
        paper_h = max(40.0, max(box["y"] + box["h"] for box in boxes) + bottom)
    return {
        "w": paper_w,
        "h": paper_h,
        "border": border,
        "margin": [top, right, bottom, left],
        "boxes": boxes,
    }


def _sheet_boxes(
    bands: dict[str, list[dict[str, Any]]],
    context: dict[str, Any],
    *,
    paper_w: float,
    paper_h: float,
    top: float,
    right: float,
    bottom: float,
    left: float,
    border: bool,
    free_place: bool = False,
    trim: bool = False,
    fit_detail: bool = False,
    detail_boxes: bool = True,
) -> dict[str, Any] | None:
    """Boxes in the same places as the template designer, one line each.

    The designer canvas always works in absolute millimetres. Previously we
    required *every* visible field to have x/y or we threw the sheet away and
    fell back to the old stacked HTML — so print ignored the saved design.
    Now any placed field is enough to paint the designer sheet.
    """
    placed = [
        field
        for fields in bands.values()
        for field in fields
        if field.get("visible") and _mm(field, "x_mm", "xMm") is not None
    ]
    if not placed and not free_place:
        return None
    # Free-place and packed designs both keep the canvas coordinates.
    return _free_sheet_boxes(
        bands,
        context,
        paper_w=paper_w,
        paper_h=paper_h,
        top=top,
        right=right,
        bottom=bottom,
        left=left,
        border=border,
        trim=trim,
        fit_detail=fit_detail,
        detail_boxes=detail_boxes,
    )


def _sheet_box_style(box: dict[str, Any]) -> str:
    x = float(box.get("x") or 0)
    y = float(box.get("y") or 0)
    w = float(box.get("w") or 0)
    h = float(box.get("h") or 0)
    family = str(box.get("family") or "Times New Roman").replace("'", "")
    pt = float(box.get("pt") or 10)
    align = str(box.get("align") or "left")
    parts = [
        "position:absolute",
        f"left:{x:g}mm",
        f"top:{y:g}mm",
        f"width:{max(0.2, w):g}mm",
        f"height:{max(0.2, h):g}mm",
        "box-sizing:border-box",
        "overflow:hidden",
        f"font-family:'{family}',Times,serif",
        f"font-size:{pt:g}pt",
        f"font-weight:{'700' if box.get('bold') else '400'}",
        f"font-style:{'italic' if box.get('italic') else 'normal'}",
        f"text-decoration:{'underline' if box.get('underline') else 'none'}",
        f"text-align:{align}",
        "white-space:pre-wrap",
        "line-height:1.15",
        "color:#000",
        "margin:0",
        "padding:0",
    ]
    shape = str(box.get("shape") or "")
    line = str(box.get("line") or "")
    if line == "h":
        parts.extend(["border-top:1px solid #000", "height:0", "overflow:visible", "font-size:0"])
    elif line == "v":
        parts.extend(["border-left:1px solid #000", "width:0", "overflow:visible", "font-size:0"])
    elif shape in {"ellipse", "round"}:
        parts.extend(["border:1px solid #000", "border-radius:50%"])
    elif shape in {"rect", "square", "triangle", "diamond"} or box.get("border"):
        parts.append("border:1px solid #000")
    if box.get("rule"):
        parts.extend(["border-top:1px solid #000", "padding-top:2px"])
    try:
        rotate = float(box.get("rotate") or 0)
    except (TypeError, ValueError):
        rotate = 0.0
    if abs(rotate) > 0.05:
        parts.append(f"transform:rotate({rotate:g}deg)")
        parts.append("transform-origin:center center")
    return ";".join(parts)


def _sheet_to_html(sheet: dict[str, Any]) -> str:
    """Paint designer boxes as real absolute HTML so print matches the template canvas."""
    width = float(sheet.get("w") or 210)
    height = float(sheet.get("h") or 297)
    border = "border:1px solid #000;" if sheet.get("border") else ""
    bits: list[str] = []
    for box in sheet.get("boxes") or []:
        if not isinstance(box, dict):
            continue
        text = "" if box.get("line") or box.get("shape") else _esc(box.get("text") or "")
        bits.append(f"<div class='hms-box' style='{_sheet_box_style(box)}'>{text}</div>")
    return (
        f"<div class='hms-sheet' style='position:relative;width:{width:g}mm;height:{height:g}mm;"
        f"{border}margin:0;padding:0;overflow:hidden;background:#fff'>"
        + "".join(bits)
        + "</div>"
    )


def render_bill_html(context: dict[str, Any], layout: dict[str, Any], bill_format: str | None) -> str:
    fmt = resolve_format(layout, bill_format)
    bands = layout_for_format(layout, fmt)
    width, height = paper_mm(layout, fmt)
    orientation = ((layout.get("page") or {}).get(fmt) or {}).get("orientation") or "portrait"
    width, height, orientation = orient_page_mm(width, height, str(orientation), fmt)
    inner = "".join(_band_html(name, bands[name], context, width) for name in ("header", "meta", "columns", "totals", "footer"))
    top, right, bottom, left, border = page_insets(layout, fmt)
    page_meta = ((layout.get("page") or {}).get(fmt) or {})
    if not isinstance(page_meta, dict):
        page_meta = {}
    free_place = bool(page_meta.get("free_place")) and page_meta.get("y_origin") == "page"
    trim = bool(page_meta.get("trim_to_content"))
    fit_detail = bool(page_meta.get("fit_detail"))
    detail_boxes = page_meta.get("detail_boxes") is not False
    if border:
        inner = (
            "<table width='100%' cellspacing='0' cellpadding='2' style='border:1px solid #000;'>"
            f"<tr><td>{inner}</td></tr></table>"
        )
    # Designer coordinates already include page margins — keep @page margin at 0 so print matches canvas.
    page_css = f"@page{{size:{width:g}mm {height:g}mm;margin:0;}}"
    sheet = _sheet_boxes(
        bands,
        context,
        paper_w=width,
        paper_h=height,
        top=top,
        right=right,
        bottom=bottom,
        left=left,
        border=border,
        free_place=free_place,
        trim=trim,
        fit_detail=fit_detail,
        detail_boxes=detail_boxes,
    )
    if sheet is not None:
        footer_shift, shift_anchor = _push_footer_below_detail(sheet["boxes"])
        if trim and sheet["boxes"]:
            sheet["h"] = max(40.0, max(box["y"] + box["h"] for box in sheet["boxes"]) + bottom)
        shapes = page_meta.get("shapes") if isinstance(page_meta.get("shapes"), list) else []
        sheet["boxes"].extend(
            _shape_boxes(
                shapes,
                left,
                top,
                bands,
                max(12.0, width - left - right),
                footer_shift=footer_shift,
                shift_anchor=shift_anchor,
                detail_rows=_column_rows(sheet["boxes"]),
            )
        )
    if sheet and trim:
        height = float(sheet["h"])
        page_css = f"@page{{size:{width:g}mm {height:g}mm;margin:0;}}"
    # Prefer the absolute sheet (matches designer drag positions). Fall back to band tables.
    if sheet is not None:
        body = _sheet_to_html(sheet)
        layout_mode = "sheet-free" if free_place else "sheet"
    else:
        body = (
            f"<div class='hms-flow' style='padding:{top:g}mm {right:g}mm {bottom:g}mm {left:g}mm;'>"
            f"{inner}</div>"
        )
        layout_mode = "flow"
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'/>"
        f"<title>{_esc(context.get('bill_title') or 'Bill')}</title>"
        f"<style>{page_css}"
        "html,body{font-family:'Times New Roman',Times,serif;color:#000;margin:0;padding:0;}"
        "table{border-collapse:collapse;}"
        ".hms-sheet,.hms-flow{color:#000;}</style></head>"
        f"<body data-page-w='{width}' data-page-h='{height}' data-page-orientation='{orientation}' "
        f"data-page-format='{_esc(fmt)}' data-layout-source='designed' data-layout-mode='{layout_mode}'>"
        f"{body}</body></html>"
    )


def render_document_html(*, code: str, context: dict[str, Any], layout_raw: Any, bill_format: str | None) -> str:
    layout = normalize_layout(code, layout_raw)
    return render_bill_html(context, layout, bill_format)
