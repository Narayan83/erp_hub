"""Print template layouts stored on PrintConfig.layout_options.

Super Admin (or a role granted Print Template Designer) can reorder, hide, and
relabel fields. Staff always print the saved layout — no per-customer exe.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from modules.generp.ge.reports.bill_formats import BILL_FORMATS, is_thermal, normalize_bill_format, normalize_orientation, oriented_paper_mm
from modules.generp.ge.reports.money_words import amount_in_words

LAYOUT_VERSION = 1
FORMAT_KEYS = tuple(code for code, _label in BILL_FORMATS)
CUSTOM_PREFIX = "CUSTOM_"

KIND_BILL = "bill"
KIND_REPORT = "report"
KIND_BARCODE = "barcode"

DOCUMENT_KINDS: dict[str, str] = {
    "SALE_BILL": KIND_BILL,
    "WHOLESALE_BILL": KIND_BILL,
    "PURCHASE_BILL": KIND_BILL,
    "DAILY_COLLECTION_REPORT": KIND_REPORT,
    "BARCODE_LABEL": KIND_BARCODE,
}

DOCUMENT_NAMES: dict[str, str] = {
    "SALE_BILL": "Sale Bill",
    "WHOLESALE_BILL": "Wholesale Bill",
    "PURCHASE_BILL": "Purchase Bill",
    "DAILY_COLLECTION_REPORT": "Daily Collection Report",
    "BARCODE_LABEL": "Barcode Label",
}

BANDS = ("header", "meta", "columns", "totals", "footer")

# Catalog: id, label, band, optional flags
BILL_CATALOG: list[dict[str, Any]] = [
    {"id": "company_logo", "label": "Company logo", "band": "header", "standalone": True},
    {"id": "company_name", "label": "Company name", "band": "header", "standalone": True},
    {"id": "company_address", "label": "Company address", "band": "header", "standalone": True},
    {"id": "company_phone_email", "label": "Phone & email", "band": "header"},
    {"id": "company_phone", "label": "Phone", "band": "header", "prefix": "MOB"},
    {"id": "company_email", "label": "Email", "band": "header", "prefix": "Email"},
    {"id": "company_gstin", "label": "Company GSTIN", "band": "header", "prefix": "GSTIN"},
    {"id": "company_website", "label": "Website", "band": "header", "standalone": True},
    {"id": "tax_invoice_title", "label": "TAX INVOICE heading", "band": "header", "standalone": True},
    {"id": "bill_title", "label": "Bill title", "band": "header", "standalone": True},
    {"id": "customer_name", "label": "Customer / Party", "band": "meta", "prefix": "Customer"},
    {"id": "customer_mobile", "label": "Mobile", "band": "meta", "prefix": "Mobile"},
    {"id": "customer_gstin", "label": "Customer GSTIN", "band": "meta", "prefix": "GSTIN"},
    {"id": "cash_credit", "label": "Cash / Credit", "band": "meta", "prefix": "Type"},
    {"id": "bill_no", "label": "Bill number", "band": "meta", "prefix": "Bill No"},
    {"id": "bill_date", "label": "Bill date", "band": "meta", "prefix": "Date"},
    {"id": "sr", "label": "#", "band": "columns", "align": "center", "width": 5},
    {"id": "code", "label": "Code", "band": "columns", "align": "left", "width": 10},
    {"id": "name", "label": "Product", "band": "columns", "align": "left", "width": 28},
    {"id": "qty", "label": "Qty", "band": "columns", "align": "right", "width": 9},
    {"id": "rate", "label": "Rate", "band": "columns", "align": "right", "width": 10},
    {"id": "profit_pct", "label": "Profit %", "band": "columns", "align": "right", "width": 8},
    {"id": "sale_price", "label": "Sale Price", "band": "columns", "align": "right", "width": 10},
    {"id": "mrp", "label": "MRP", "band": "columns", "align": "right", "width": 10},
    {"id": "disc", "label": "Discount", "band": "columns", "align": "right", "width": 8},
    {"id": "disc_pct", "label": "Disc%", "band": "columns", "align": "right", "width": 8},
    {"id": "gst_pct", "label": "GST%", "band": "columns", "align": "right", "width": 8},
    {"id": "taxable", "label": "Taxable", "band": "columns", "align": "right", "width": 10},
    {"id": "gst", "label": "GST", "band": "columns", "align": "right", "width": 8},
    {"id": "amount", "label": "Amount", "band": "columns", "align": "right", "width": 12},
    {"id": "gross_amount", "label": "Gross amount", "band": "totals", "prefix": "Gross"},
    {"id": "discount_amount", "label": "Bill discount", "band": "totals", "prefix": "Discount"},
    {"id": "tax_total", "label": "Tax total", "band": "totals", "prefix": "Tax Total"},
    {"id": "net_amount", "label": "Net amount", "band": "totals", "prefix": "Net Amount"},
    {"id": "gst_split", "label": "CGST / SGST / IGST", "band": "totals"},
    {"id": "paid_amount", "label": "Paid", "band": "footer", "prefix": "Paid"},
    {"id": "payment_mode", "label": "Payment", "band": "footer", "prefix": "Payment"},
    {"id": "credit_amount", "label": "Balance due", "band": "footer", "prefix": "Balance Due"},
    {"id": "paid_due", "label": "Paid & due (one line)", "band": "footer"},
    {"id": "amount_in_words", "label": "Amount in words", "band": "footer"},
    {"id": "narration", "label": "Narration", "band": "footer", "prefix": "Narration"},
    {"id": "terms", "label": "Terms & conditions", "band": "footer", "standalone": True},
    {"id": "computer_note", "label": "Computer-generated note", "band": "footer", "standalone": True},
    {"id": "signature", "label": "Receiver signature", "band": "footer", "standalone": True},
    {"id": "for_company", "label": "For company (sign-off)", "band": "footer", "standalone": True},
    {"id": "you_save", "label": "You save", "band": "footer", "prefix": "You Save", "default_visible": True, "bold": True, "align": "center"},
    {"id": "thanks", "label": "Thank you line", "band": "footer", "standalone": True},
]

REPORT_CATALOG: list[dict[str, Any]] = [
    {"id": "company_logo", "label": "Company logo", "band": "header", "standalone": True},
    {"id": "company_name", "label": "Company name", "band": "header", "standalone": True},
    {"id": "company_address", "label": "Company address", "band": "header", "standalone": True},
    {"id": "company_phone_email", "label": "Phone & email", "band": "header"},
    {"id": "company_gstin", "label": "Company GSTIN", "band": "header", "prefix": "GSTIN"},
    {"id": "company_website", "label": "Website", "band": "header", "standalone": True},
    {"id": "report_title", "label": "Report title", "band": "header", "standalone": True},
    {"id": "date_range", "label": "Date range", "band": "meta"},
    {"id": "bill_range", "label": "Bill number range", "band": "meta"},
    {"id": "date", "label": "Date", "band": "columns", "align": "left", "width": 16},
    {"id": "bill_from", "label": "Bill From", "band": "columns", "align": "left", "width": 18},
    {"id": "bill_to", "label": "Bill To", "band": "columns", "align": "left", "width": 18},
    {"id": "gst_rate_columns", "label": "GST rate columns", "band": "columns", "align": "right", "width": 12},
    {"id": "total", "label": "Total", "band": "columns", "align": "right", "width": 14},
    {"id": "payment_summary", "label": "Collection by payment mode", "band": "footer", "standalone": True},
]

_CATALOG_BY_KIND: dict[str, list[dict[str, Any]]] = {
    KIND_BILL: BILL_CATALOG,
    KIND_REPORT: REPORT_CATALOG,
}

DEFAULT_TERMS = (
    "* No Amount Refundable\n"
    "* Goods once sold will not be taken back\n"
    "* No color guarantee"
)
DEFAULT_COMPUTER_NOTE = "Computer generated bill — signature not required."
DEFAULT_SIGNATURE = "Receiver's Signature"
DEFAULT_THANKS = "THANK YOU VISIT AGAIN"
DEFAULT_TAX_INVOICE = "TAX INVOICE"
DEFAULT_REPORT_TITLE = "Daily Collection Report"

_ALIGN_OK = {"left", "center", "right"}


def catalog_for_kind(kind: str) -> list[dict[str, Any]]:
    return deepcopy(_CATALOG_BY_KIND.get(kind) or [])


def catalog_by_id(kind: str) -> dict[str, dict[str, Any]]:
    return {row["id"]: row for row in catalog_for_kind(kind)}


def _field(catalog_row: dict[str, Any], *, visible: bool, **extra: Any) -> dict[str, Any]:
    item = {
        "id": catalog_row["id"],
        "visible": visible,
        "label": catalog_row.get("label") or catalog_row["id"],
        "align": catalog_row.get("align") or ("center" if catalog_row["band"] == "header" else "left"),
        "full_row": bool(extra.get("full_row", catalog_row["band"] == "header")),
    }
    if catalog_row["band"] == "columns":
        item["width"] = int(catalog_row.get("width") or 10)
        item["align"] = catalog_row.get("align") or "left"
        item.pop("full_row", None)
    if extra:
        for key, value in extra.items():
            if value is not None:
                item[key] = value
    return item


def _band_fields(kind: str, band: str, visible_ids: list[str], extra: dict[str, dict] | None = None) -> list[dict[str, Any]]:
    by_id = catalog_by_id(kind)
    extra = extra or {}
    visible_set = set(visible_ids)
    ordered: list[dict[str, Any]] = []
    for fid in visible_ids:
        row = by_id.get(fid)
        if not row or row["band"] != band:
            continue
        ordered.append(_field(row, visible=True, **extra.get(fid, {})))
    for row in catalog_for_kind(kind):
        if row["band"] != band or row["id"] in visible_set:
            continue
        ordered.append(_field(row, visible=False, **extra.get(row["id"], {})))
    return ordered


def _bill_a4() -> dict[str, list[dict[str, Any]]]:
    header_extra = {
        "company_name": {"align": "center"},
        "company_address": {"align": "center"},
        "company_phone_email": {"align": "center"},
        "company_gstin": {"align": "center"},
        "company_website": {"align": "center"},
        "bill_title": {"align": "center"},
    }
    return {
        "header": _band_fields(
            KIND_BILL,
            "header",
            [
                "company_name",
                "company_address",
                "company_phone_email",
                "company_gstin",
                "company_website",
                "bill_title",
            ],
            header_extra,
        ),
        "meta": _band_fields(
            KIND_BILL,
            "meta",
            ["customer_name", "customer_mobile", "bill_date", "customer_gstin", "cash_credit", "bill_no"],
            {
                "customer_name": {"full_row": False, "align": "left"},
                "customer_mobile": {"full_row": False, "align": "center"},
                "bill_date": {"full_row": False, "align": "right"},
                "customer_gstin": {"full_row": False, "align": "left"},
                "cash_credit": {"full_row": False, "align": "center"},
                "bill_no": {"full_row": False, "align": "right"},
            },
        ),
        "columns": _band_fields(
            KIND_BILL,
            "columns",
            ["sr", "code", "name", "qty", "rate", "disc_pct", "taxable", "gst", "amount"],
        ),
        "totals": _band_fields(KIND_BILL, "totals", ["tax_total", "net_amount"]),
        "footer": _band_fields(
            KIND_BILL,
            "footer",
            ["paid_amount", "payment_mode", "credit_amount", "you_save", "narration", "computer_note", "signature"],
            {
                "paid_amount": {"full_row": False, "align": "left"},
                "payment_mode": {"full_row": False, "align": "right"},
                "credit_amount": {"full_row": False, "align": "left"},
                "you_save": {"align": "center", "bold": True, "full_row": True, "prefix": "You Save"},
                "computer_note": {"align": "left", "full_row": False, "text": DEFAULT_COMPUTER_NOTE},
                "signature": {"align": "center", "full_row": False, "text": DEFAULT_SIGNATURE},
                "terms": {"text": DEFAULT_TERMS},
                "thanks": {"text": DEFAULT_THANKS, "align": "center"},
            },
        ),
    }


def _bill_thermal(*, include_disc: bool) -> dict[str, list[dict[str, Any]]]:
    cols = ["sr", "name", "qty", "rate"]
    if include_disc:
        cols.append("disc")
    cols.append("amount")
    header_extra = {
        "tax_invoice_title": {"align": "center", "text": DEFAULT_TAX_INVOICE},
        "company_name": {"align": "center"},
        "company_address": {"align": "center"},
        "company_gstin": {"align": "center"},
        "company_phone": {"align": "center"},
        "thanks": {"align": "center", "text": DEFAULT_THANKS},
    }
    return {
        "header": _band_fields(
            KIND_BILL,
            "header",
            ["tax_invoice_title", "company_name", "company_address", "company_gstin", "company_phone"],
            header_extra,
        ),
        "meta": _band_fields(
            KIND_BILL,
            "meta",
            ["bill_no", "bill_date", "customer_name", "customer_mobile"],
            {
                "bill_no": {"full_row": False, "align": "left", "prefix": "Invoice No"},
                "bill_date": {"full_row": False, "align": "right", "prefix": "Date"},
                "customer_name": {"full_row": True, "align": "left", "prefix": "Name"},
                "customer_mobile": {"full_row": True, "align": "left"},
            },
        ),
        "columns": _band_fields(KIND_BILL, "columns", cols),
        "totals": _band_fields(
            KIND_BILL,
            "totals",
            ["net_amount", "gst_split"],
            {"net_amount": {"prefix": "Total", "label": "Total"}},
        ),
        "footer": _band_fields(
            KIND_BILL,
            "footer",
            ["amount_in_words", "paid_due", "terms", "for_company", "you_save", "thanks"],
            {
                "terms": {"text": DEFAULT_TERMS, "align": "left"},
                "you_save": {"align": "center", "bold": True, "full_row": True, "prefix": "You Save"},
                "thanks": {"text": DEFAULT_THANKS, "align": "center"},
                "for_company": {"align": "right"},
            },
        ),
    }


def _report_default() -> dict[str, list[dict[str, Any]]]:
    return {
        "header": _band_fields(
            KIND_REPORT,
            "header",
            ["company_name", "company_address", "company_phone_email", "company_gstin", "company_website", "report_title"],
            {
                "company_name": {"align": "center"},
                "company_address": {"align": "center"},
                "company_phone_email": {"align": "center"},
                "company_gstin": {"align": "center"},
                "company_website": {"align": "center"},
                "report_title": {"align": "center", "text": DEFAULT_REPORT_TITLE},
            },
        ),
        "meta": _band_fields(
            KIND_REPORT,
            "meta",
            ["date_range", "bill_range"],
            {"date_range": {"full_row": False}, "bill_range": {"full_row": False}},
        ),
        "columns": _band_fields(
            KIND_REPORT,
            "columns",
            ["date", "bill_from", "bill_to", "gst_rate_columns", "total"],
        ),
        "totals": [],
        "footer": _band_fields(KIND_REPORT, "footer", ["payment_summary"]),
    }


def default_barcode_layout() -> dict[str, Any]:
    gap = {
        "gap_left_mm": 0,
        "gap_right_mm": 0,
        "gap_bottom_mm": 0,
        "show_border": False,
    }
    return {
        "version": LAYOUT_VERSION,
        "kind": KIND_BARCODE,
        "default_layout": "SINGLE",
        "fields": [
            {"id": "heading", "label": "", "source": "name", "enabled": True, "bold": True},
            {"id": "mrp", "label": "MRP", "source": "mrp", "enabled": True},
            {"id": "sale", "label": "Rate", "source": "sale_price", "enabled": False},
            {"id": "expiry", "label": "Exp", "source": "expiry", "enabled": False},
        ],
        "gaps": {layout: dict(gap) for layout in ("DOUBLE", "SINGLE", "MINI", "CUSTOM")},
        "sheet": {
            "totalWidthMm": 101.6,
            "columns": 2,
            "columnGapMm": 2,
            "heightMm": 25.4,
            "rowGapMm": 0,
        },
    }


def default_band_layout(kind: str, bill_format: str) -> dict[str, list[dict[str, Any]]]:
    fmt = normalize_bill_format(bill_format)
    if kind == KIND_REPORT:
        return _report_default()
    if fmt == "THERMAL_58":
        return _bill_thermal(include_disc=False)
    if fmt.startswith("THERMAL_"):
        return _bill_thermal(include_disc=True)
    return _bill_a4()


def default_document_layout(code: str) -> dict[str, Any]:
    kind = DOCUMENT_KINDS.get(code.upper())
    if kind == KIND_BARCODE:
        return default_barcode_layout()
    if kind not in (KIND_BILL, KIND_REPORT):
        return {"version": LAYOUT_VERSION, "kind": kind or KIND_BILL, "formats": {}}
    formats = {fmt: default_band_layout(kind, fmt) for fmt in FORMAT_KEYS}
    if str(code).upper() == "PURCHASE_BILL":
        extra_ids = ["profit_pct", "sale_price", "mrp"]
        extra = _band_fields(KIND_BILL, "columns", extra_ids)
        by_id = {f["id"]: f for f in extra}
        for bands in formats.values():
            cols = list(bands.get("columns") or [])
            ids = [str(c.get("id")) for c in cols]
            insert_at = ids.index("rate") + 1 if "rate" in ids else len(cols)
            for fid in reversed(extra_ids):
                if fid in ids:
                    continue
                cols.insert(insert_at, by_id[fid])
            bands["columns"] = cols
    return {"version": LAYOUT_VERSION, "kind": kind, "formats": formats}


def _clean_field(raw: Any, catalog_row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    fid = str(raw.get("id") or "").strip()
    if not fid:
        return None
    is_static = fid.startswith("static_")
    if not catalog_row and not is_static:
        return None
    band = (catalog_row or {}).get("band") or str(raw.get("band") or "footer")
    align = str(raw.get("align") or (catalog_row or {}).get("align") or "left").lower()
    if align not in _ALIGN_OK:
        align = "left"
    item: dict[str, Any] = {
        "id": fid,
        "visible": bool(raw.get("visible", True)),
        "label": str(raw.get("label") or (catalog_row or {}).get("label") or fid),
        "align": align,
    }
    if band == "columns":
        try:
            width = int(raw.get("width") or (catalog_row or {}).get("width") or 10)
        except (TypeError, ValueError):
            width = 10
        item["width"] = max(2, min(400, width))
    else:
        item["full_row"] = bool(raw.get("full_row", band == "header"))
        if raw.get("prefix") is not None:
            item["prefix"] = str(raw.get("prefix") or "")
        elif catalog_row and catalog_row.get("prefix"):
            item["prefix"] = str(catalog_row["prefix"])
    if raw.get("text") is not None:
        item["text"] = str(raw.get("text") or "")
    if raw.get("bold") is not None:
        item["bold"] = bool(raw.get("bold"))
    fam = raw.get("fontFamily") or raw.get("font_family")
    if fam:
        item["fontFamily"] = str(fam).strip()[:60]
    size = _opt_float(raw, "fontSizePt", "font_size_pt")
    if size is not None:
        item["fontSizePt"] = max(5.0, min(36.0, size))
    if raw.get("border") is not None:
        item["border"] = bool(raw.get("border"))
    for camel, snake in (
        ("xMm", "x_mm"),
        ("yMm", "y_mm"),
        ("widthMm", "width_mm"),
        ("heightMm", "height_mm"),
    ):
        val = _opt_float(raw, camel, snake)
        if val is not None:
            item[camel] = max(0.0, min(400.0, val))
    for camel, snake in (
        ("paddingLeftMm", "padding_left_mm"),
        ("paddingRightMm", "padding_right_mm"),
        ("paddingTopMm", "padding_top_mm"),
        ("paddingBottomMm", "padding_bottom_mm"),
    ):
        val = _opt_float(raw, camel, snake)
        if val is not None:
            item[camel] = max(0.0, min(20.0, val))
    if is_static:
        item["band"] = band
        item["text"] = str(raw.get("text") or "")
        item["standalone"] = True
    return item


def _opt_float(raw: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        if key in raw and raw[key] is not None and raw[key] != "":
            try:
                return round(float(raw[key]), 2)
            except (TypeError, ValueError):
                return None
    return None


def _merge_band(kind: str, band: str, saved: Any) -> list[dict[str, Any]]:
    catalog_rows = [row for row in catalog_for_kind(kind) if row["band"] == band]
    by_id = {row["id"]: row for row in catalog_rows}
    saved_list = saved if isinstance(saved, list) else []
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for raw in saved_list:
        fid = str((raw or {}).get("id") or "") if isinstance(raw, dict) else ""
        catalog_row = by_id.get(fid)
        item = _clean_field(raw, catalog_row)
        if not item:
            continue
        if item["id"] in seen and not item["id"].startswith("static_"):
            continue
        seen.add(item["id"])
        merged.append(item)
    for row in catalog_rows:
        if row["id"] in seen:
            continue
        extra = {
            k: row[k]
            for k in ("prefix", "bold", "align")
            if k in row and row[k] is not None
        }
        item = _field(row, visible=bool(row.get("default_visible")), **extra)
        if row["id"] == "you_save":
            thanks_at = next((i for i, x in enumerate(merged) if x.get("id") == "thanks"), None)
            if thanks_at is not None:
                merged.insert(thanks_at, item)
            else:
                merged.append(item)
        else:
            merged.append(item)
    return merged


def _normalize_band_layout(kind: str, raw: Any, bill_format: str) -> dict[str, list[dict[str, Any]]]:
    fallback = default_band_layout(kind, bill_format)
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, list[dict[str, Any]]] = {}
    for band in BANDS:
        if kind == KIND_REPORT and band == "totals":
            out[band] = []
            continue
        out[band] = _merge_band(kind, band, src.get(band, fallback.get(band)))
    return out


def _gap_mm(src: dict[str, Any], key: str, default: float) -> float:
    if key not in src:
        return default
    try:
        n = float(src.get(key))
    except (TypeError, ValueError):
        return default
    return max(0.0, min(20.0, round(n, 1)))


def _gap_block(raw: Any) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    return {
        "gap_left_mm": _gap_mm(src, "gap_left_mm", 0),
        "gap_right_mm": _gap_mm(src, "gap_right_mm", 0),
        "gap_bottom_mm": _gap_mm(src, "gap_bottom_mm", 0),
        "show_border": bool(src.get("show_border", False)),
    }


def _normalize_barcode(raw: Any) -> dict[str, Any]:
    base = default_barcode_layout()
    src = raw if isinstance(raw, dict) else {}
    fields = src.get("fields")
    if isinstance(fields, list) and fields:
        cleaned = []
        for item in fields:
            if not isinstance(item, dict) or not item.get("id") or not item.get("source"):
                continue
            cleaned.append(
                {
                    "id": str(item["id"]),
                    "label": str(item.get("label") or ""),
                    "source": str(item["source"]),
                    "enabled": bool(item.get("enabled", True)),
                    "bold": bool(item.get("bold", False)),
                }
            )
        if cleaned:
            base["fields"] = cleaned
    layout = str(src.get("default_layout") or base["default_layout"]).upper()
    if layout in {"DOUBLE", "SINGLE", "MINI", "CUSTOM"}:
        base["default_layout"] = layout
    src_gaps = src.get("gaps") if isinstance(src.get("gaps"), dict) else {}
    flat_keys = ("gap_left_mm", "gap_right_mm", "gap_bottom_mm", "show_border")
    flat = _gap_block(src) if any(k in src for k in flat_keys) else None
    gaps: dict[str, Any] = {}
    for size in ("DOUBLE", "SINGLE", "MINI", "CUSTOM"):
        piece = src_gaps.get(size)
        if isinstance(piece, dict):
            gaps[size] = _gap_block(piece)
        elif flat is not None:
            gaps[size] = dict(flat)
        else:
            gaps[size] = _gap_block({})
    canvases = src.get("canvases")
    if isinstance(canvases, dict):
        base["canvases"] = canvases
    base["sheet"] = _sheet_block(src.get("sheet"))
    gaps["CUSTOM"] = {**gaps["CUSTOM"], "gap_bottom_mm": base["sheet"]["rowGapMm"]}
    base["gaps"] = gaps
    return base


def _sheet_num(src: dict[str, Any], *keys: str, default: float, lo: float, hi: float) -> float:
    for key in keys:
        if key in src and src[key] is not None and src[key] != "":
            try:
                return max(lo, min(hi, round(float(src[key]), 1)))
            except (TypeError, ValueError):
                return default
    return default


def _sheet_block(raw: Any) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    columns = _sheet_num(src, "columns", default=2, lo=1, hi=8)
    return {
        "totalWidthMm": _sheet_num(src, "totalWidthMm", "total_width_mm", default=101.6, lo=20, hi=400),
        "columns": int(columns),
        "columnGapMm": _sheet_num(src, "columnGapMm", "column_gap_mm", default=2, lo=0, hi=40),
        "heightMm": _sheet_num(src, "heightMm", "height_mm", default=25.4, lo=8, hi=150),
        "rowGapMm": _sheet_num(src, "rowGapMm", "row_gap_mm", default=0, lo=0, hi=40),
    }


def custom_pages_of(layout: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    src = layout.get("custom_pages") if isinstance(layout, dict) else None
    if not isinstance(src, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for raw_code, raw in src.items():
        code = str(raw_code or "").strip().upper().replace("-", "_").replace(" ", "")
        if not code.startswith(CUSTOM_PREFIX) or len(code) <= len(CUSTOM_PREFIX):
            continue
        if not isinstance(raw, dict):
            continue
        try:
            width = float(raw.get("widthMm", raw.get("width_mm") or 0))
            height = float(raw.get("heightMm", raw.get("height_mm") or 0))
        except (TypeError, ValueError):
            continue
        if width < 40 or height < 40:
            continue
        name = str(raw.get("name") or code[len(CUSTOM_PREFIX) :].replace("_", " ").title())[:80]
        out[code] = {
            "name": name.strip() or "Custom",
            "widthMm": max(40.0, min(400.0, round(width, 1))),
            "heightMm": max(40.0, min(600.0, round(height, 1))),
        }
    return out


def resolve_layout_format(layout: dict[str, Any] | None, bill_format: str | None) -> str:
    raw = (bill_format or "").strip().upper().replace("-", "_").replace(" ", "")
    if raw in FORMAT_KEYS:
        return raw
    pages = custom_pages_of(layout)
    if raw in pages:
        return raw
    return normalize_bill_format(bill_format)


def paper_mm_of(layout: dict[str, Any] | None, bill_format: str | None) -> tuple[float, float]:
    fmt = resolve_layout_format(layout, bill_format)
    pages = custom_pages_of(layout)
    orientation = page_orientation_of(layout, fmt)
    if fmt in pages:
        page = pages[fmt]
        return oriented_paper_mm(fmt, orientation, size=(page["widthMm"], page["heightMm"]))
    return oriented_paper_mm(fmt, orientation)


def _pad_block(piece: Any) -> dict[str, float] | None:
    if not isinstance(piece, dict):
        return None
    block: dict[str, float] = {}
    for camel, snake in (
        ("paddingLeftMm", "padding_left_mm"),
        ("paddingRightMm", "padding_right_mm"),
        ("paddingTopMm", "padding_top_mm"),
        ("paddingBottomMm", "padding_bottom_mm"),
    ):
        val = _opt_float(piece, camel, snake)
        if val is not None:
            block[camel] = max(0.0, min(40.0, val))
    return block or None


def normalize_layout(code: str, raw: Any) -> dict[str, Any]:
    code_u = (code or "").upper()
    kind = DOCUMENT_KINDS.get(code_u)
    if kind == KIND_BARCODE:
        return _normalize_barcode(raw)
    if kind not in (KIND_BILL, KIND_REPORT):
        return default_document_layout(code_u or "SALE_BILL")
    src = raw if isinstance(raw, dict) else {}
    saved_formats = src.get("formats") if isinstance(src.get("formats"), dict) else {}
    # Older single-band payload (no formats wrapper) applies to A4.
    legacy_bands = all(band in src for band in ("header", "columns")) if src else False
    custom_pages = custom_pages_of(src)
    format_keys = list(FORMAT_KEYS) + list(custom_pages.keys())
    formats: dict[str, Any] = {}
    for fmt in format_keys:
        piece = saved_formats.get(fmt)
        if piece is None and legacy_bands and fmt == "A4":
            piece = src
        formats[fmt] = _normalize_band_layout(kind, piece, "A4" if fmt.startswith(CUSTOM_PREFIX) else fmt)
    src_borders = src.get("page_borders") if isinstance(src.get("page_borders"), dict) else {}
    page_borders: dict[str, bool] = {}
    for fmt in format_keys:
        piece = saved_formats.get(fmt)
        from_piece = bool(piece.get("page_border")) if isinstance(piece, dict) else False
        page_borders[fmt] = bool(src_borders.get(fmt, from_piece))
    src_pads = src.get("page_paddings") if isinstance(src.get("page_paddings"), dict) else {}
    page_paddings: dict[str, dict[str, float]] = {}
    for fmt in format_keys:
        block = _pad_block(src_pads.get(fmt))
        if block:
            page_paddings[fmt] = block
    src_orients = src.get("page_orientations") if isinstance(src.get("page_orientations"), dict) else {}
    page_orientations: dict[str, str] = {}
    for fmt in format_keys:
        if is_thermal(fmt):
            continue
        raw_orient = src_orients.get(fmt)
        if normalize_orientation(str(raw_orient) if raw_orient is not None else "") == "landscape":
            page_orientations[fmt] = "landscape"
    out = {"version": LAYOUT_VERSION, "kind": kind, "formats": formats, "page_borders": page_borders}
    if custom_pages:
        out["custom_pages"] = custom_pages
    if page_paddings:
        out["page_paddings"] = page_paddings
    if page_orientations:
        out["page_orientations"] = page_orientations
    return out


def layout_for_format(layout: dict[str, Any], bill_format: str | None) -> dict[str, list[dict[str, Any]]]:
    fmt = resolve_layout_format(layout, bill_format)
    formats = layout.get("formats") if isinstance(layout, dict) else None
    if isinstance(formats, dict) and fmt in formats:
        return formats[fmt]
    kind = layout.get("kind") if isinstance(layout, dict) else KIND_BILL
    return default_band_layout(str(kind or KIND_BILL), fmt)


def visible_fields(band_layout: dict[str, list[dict[str, Any]]], band: str) -> list[dict[str, Any]]:
    return [item for item in (band_layout.get(band) or []) if item.get("visible")]


def default_page_padding(bill_format: str | None) -> dict[str, float]:
    fmt = normalize_bill_format(bill_format)
    if fmt.startswith("THERMAL"):
        value = 2.0
    elif fmt == "A5":
        value = 6.0
    else:
        value = 8.0
    return {
        "paddingLeftMm": value,
        "paddingRightMm": value,
        "paddingTopMm": value,
        "paddingBottomMm": value,
    }


def page_orientation_of(layout: dict[str, Any] | None, bill_format: str | None) -> str:
    fmt = resolve_layout_format(layout, bill_format)
    if is_thermal(fmt):
        return "portrait"
    stored = ""
    if isinstance(layout, dict):
        orients = layout.get("page_orientations")
        if isinstance(orients, dict) and orients.get(fmt) is not None:
            stored = str(orients.get(fmt) or "")
    return normalize_orientation(stored)


def printable_inner_mm(layout: dict[str, Any] | None, bill_format: str | None) -> float:
    fmt = resolve_layout_format(layout, bill_format)
    pad = page_padding_of(layout, fmt)
    width_mm, _height = paper_mm_of(layout, fmt)
    return max(20.0, round((width_mm - pad["paddingLeftMm"] - pad["paddingRightMm"]) * 10) / 10)


def set_layout_orientation(layout: dict[str, Any], bill_format: str | None, orientation: str) -> dict[str, Any]:
    fmt = resolve_layout_format(layout, bill_format)
    orients = dict(layout.get("page_orientations") or {})
    if is_thermal(fmt) or normalize_orientation(orientation) != "landscape":
        orients.pop(fmt, None)
    else:
        orients[fmt] = "landscape"
    next_layout = dict(layout)
    if orients:
        next_layout["page_orientations"] = orients
    else:
        next_layout.pop("page_orientations", None)
    return next_layout


def _field_mm(field: dict[str, Any], *keys: str, default: float = 0.0) -> float:
    for key in keys:
        if field.get(key) is not None:
            try:
                return float(field[key])
            except (TypeError, ValueError):
                return default
    return default


def _content_right_mm(fields: list[dict[str, Any]]) -> float:
    rights: list[float] = []
    for field in fields:
        if not field.get("visible"):
            continue
        if field.get("xMm") is None and field.get("x_mm") is None:
            continue
        x = _field_mm(field, "xMm", "x_mm")
        w = _field_mm(field, "widthMm", "width_mm", default=20.0)
        rights.append(x + w)
    return max(rights) if rights else 0.0


def _band_placed(fields: list[dict[str, Any]]) -> bool:
    return any(f.get("visible") and (f.get("xMm") is not None or f.get("x_mm") is not None) for f in fields)


def _scale_band_to_inner(fields: list[dict[str, Any]], from_inner: float, to_inner: float) -> list[dict[str, Any]]:
    if to_inner <= 0:
        return fields
    source = from_inner if from_inner > 0.5 else to_inner
    if abs(to_inner - source) < 0.2:
        return fields
    ratio = to_inner / source
    out: list[dict[str, Any]] = []
    for field in fields:
        item = dict(field)
        if item.get("visible") and (item.get("xMm") is not None or item.get("x_mm") is not None):
            width = max(2.0, _field_mm(item, "widthMm", "width_mm", default=20.0) * ratio)
            x = max(0.0, _field_mm(item, "xMm", "x_mm") * ratio)
            width = min(width, to_inner)
            x = min(x, max(0.0, to_inner - width))
            item["xMm"] = round(x * 10) / 10
            item["widthMm"] = round(width * 10) / 10
            if item.get("width") is not None:
                item["width"] = max(2, min(400, int(round(width))))
        out.append(item)
    return out


def _pack_columns_fill(fields: list[dict[str, Any]], inner_mm: float) -> list[dict[str, Any]]:
    usable = max(2.0, inner_mm - 2)
    next_fields = [dict(f) for f in fields]
    visible = [f for f in next_fields if f.get("visible")]
    total = sum(max(2.0, _field_mm(f, "widthMm", "width_mm", default=float(f.get("width") or 10))) for f in visible)
    if visible and total > 0:
        ratio = usable / total
        for field in visible:
            w = max(2.0, _field_mm(field, "widthMm", "width_mm", default=float(field.get("width") or 10)) * ratio)
            field["widthMm"] = round(w * 10) / 10
            field["width"] = max(2, min(400, int(round(w))))
    x = 1.0
    for field in visible:
        w = max(2.0, min(_field_mm(field, "widthMm", "width_mm", default=10.0), max(2.0, usable - (x - 1))))
        field["xMm"] = round(x * 10) / 10
        field["widthMm"] = round(w * 10) / 10
        field["yMm"] = 1.0
        x += w
    return next_fields


def fit_layout_to_page(layout: dict[str, Any], bill_format: str | None, from_inner_mm: float | None = None) -> dict[str, Any]:
    """Stretch placed fields to the printable inner width after paper / orientation changes."""
    fmt = resolve_layout_format(layout, bill_format)
    to_inner = printable_inner_mm(layout, fmt)
    page_from = (
        from_inner_mm
        if from_inner_mm is not None and from_inner_mm > 0.5 and abs(from_inner_mm - to_inner) >= 0.2
        else 0.0
    )
    formats = dict(layout.get("formats") or {})
    band = dict(formats.get(fmt) or {})
    next_formats = dict(formats)
    next_band = dict(band)
    for name in BANDS:
        fields = list(band.get(name) or [])
        if not fields or not _band_placed(fields):
            continue
        source = page_from or _content_right_mm(fields) or to_inner
        scaled = _scale_band_to_inner(fields, source, to_inner)
        if name == "columns":
            scaled = _pack_columns_fill(scaled, to_inner)
        next_band[name] = scaled
    next_formats[fmt] = next_band
    return {**layout, "formats": next_formats}


def page_padding_of(layout: dict[str, Any] | None, bill_format: str | None) -> dict[str, float]:
    fmt = resolve_layout_format(layout, bill_format)
    fallback = default_page_padding(fmt)
    stored = {}
    if isinstance(layout, dict):
        pads = layout.get("page_paddings")
        if isinstance(pads, dict) and isinstance(pads.get(fmt), dict):
            stored = pads[fmt]
    out = dict(fallback)
    for key in fallback:
        snake = (
            "padding_left_mm"
            if key == "paddingLeftMm"
            else "padding_right_mm"
            if key == "paddingRightMm"
            else "padding_top_mm"
            if key == "paddingTopMm"
            else "padding_bottom_mm"
        )
        val = stored.get(key, stored.get(snake))
        if val is not None:
            try:
                out[key] = max(0.0, min(40.0, float(val)))
            except (TypeError, ValueError):
                pass
    return out


def catalog_payload() -> dict[str, Any]:
    return {
        "documents": [
            {"code": code, "name": DOCUMENT_NAMES[code], "kind": kind}
            for code, kind in DOCUMENT_KINDS.items()
        ],
        "formats": [{"code": code, "name": label} for code, label in BILL_FORMATS],
        "bands": list(BANDS),
        "catalogs": {
            KIND_BILL: BILL_CATALOG,
            KIND_REPORT: REPORT_CATALOG,
            KIND_BARCODE: {
                "sources": [
                    "name",
                    "code",
                    "barcode",
                    "mrp",
                    "sale_price",
                    "wholesale_price",
                    "hsn_code",
                    "category_name",
                    "expiry",
                    "custom",
                ]
            },
        },
        "defaults": {code: default_document_layout(code) for code in DOCUMENT_KINDS},
    }


def sample_bill_context(*, wholesale: bool = False) -> dict[str, Any]:
    from modules.generp.ge.reports.bill_context import apply_bill_format

    net = 1180.00
    context = {
        "bill_title": "Tax Invoice / Wholesale Bill" if wholesale else "Tax Invoice / Sale Bill",
        "bill_no": "WS-001" if wholesale else "SB-001",
        "bill_date": "27/08/2026",
        "bill_date_short": "27-08-2026",
        "customer_name": "Sample Customer",
        "customer_mobile": "9876543210",
        "customer_gstin": "33AAAAA0000A1Z5",
        "lines": [
            {
                "sr": 1,
                "code": "P001",
                "name": "Cotton Shirt",
                "qty": "2",
                "rate": "500.00",
                "profit_pct": "20.00",
                "sale_price": "600.00",
                "mrp": "650.00",
                "disc": "20.00",
                "disc_pct": "2.00",
                "gst_pct": "5",
                "taxable": "980.00",
                "gst": "49.00",
                "amount": "1029.00",
            },
            {
                "sr": 2,
                "code": "P002",
                "name": "Trousers",
                "qty": "1",
                "rate": "300.00",
                "profit_pct": "15.00",
                "sale_price": "345.00",
                "mrp": "399.00",
                "disc": "0.00",
                "disc_pct": "0.00",
                "gst_pct": "5",
                "taxable": "300.00",
                "gst": "15.00",
                "amount": "315.00",
            },
        ],
        "gross_amount": "1300.00",
        "discount_amount": "20.00",
        "tax_amount": "64.00",
        "net_amount": f"{net:.2f}",
        "paid_amount": "1180.00",
        "credit_amount": "0.00",
        "payments": [{"mode": "Cash", "amount": "1180.00", "document": ""}],
        "has_split_payments": False,
        "payment_mode": "Cash",
        "cash_credit": "Cash",
        "narration": "Sample preview bill",
        "amount_in_words": amount_in_words(net),
        "you_save": "355.00",
        "company_name": "Sample Traders",
        "company_address": "12 Market Street, Chennai, 600001",
        "company_address_lines": ["12 Market Street", "Chennai, 600001"],
        "company_phone": "044-12345678",
        "company_email": "shop@example.com",
        "company_website": "www.example.com",
        "company_gstin": "33BBBBB0000B1Z2",
        "cgst_amount": "32.00",
        "sgst_amount": "32.00",
        "igst_amount": "0.00",
    }
    return apply_bill_format(context, "A4")


def sample_report_context() -> dict[str, Any]:
    return {
        "date": "2026-08-27",
        "date_from": "27/08/2026",
        "date_to": "27/08/2026",
        "bill_from": "SB-001",
        "bill_to": "SB-015",
        "gst_rates": [0.0, 5.0, 18.0],
        "rows": [
            {
                "date": "2026-08-27",
                "bill_from": "SB-001",
                "bill_to": "SB-015",
                "bill_count": 15,
                "amounts": {0.0: 200.0, 5.0: 1500.0, 18.0: 800.0},
                "total": 2500.0,
            }
        ],
        "totals": {"amounts": {0.0: 200.0, 5.0: 1500.0, 18.0: 800.0}, "total": 2500.0, "bill_count": 15},
        "payment_rows": [{"payment_mode": "Cash", "total": 1800.0}, {"payment_mode": "UPI", "total": 700.0}],
        "payment_total": 2500.0,
        "company_name": "Sample Traders",
        "company_address": "12 Market Street, Chennai, 600001",
        "company_address_lines": ["12 Market Street", "Chennai, 600001"],
        "company_phone": "044-12345678",
        "company_email": "shop@example.com",
        "company_website": "www.example.com",
        "company_gstin": "33BBBBB0000B1Z2",
    }
