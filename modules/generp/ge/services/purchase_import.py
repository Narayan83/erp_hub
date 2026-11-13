"""Parse a purchase Excel/CSV template and resolve product lines (does not save a bill)."""
from __future__ import annotations

import csv
import io
import zipfile
from xml.etree import ElementTree as ET

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.models.masters import GstRate, Product
from modules.generp.ge.services.tax import gst_pct_candidates, normalize_slabs, resolve_slab

SSML_NS = "urn:schemas-microsoft-com:office:spreadsheet"
XLSX_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

CODE_KEYS = {"code", "item code", "product code", "sku", "barcode", "item no", "itemcode"}
NAME_KEYS = {"product", "name", "item name", "product name", "description", "item"}
QTY_KEYS = {"qty", "quantity", "qty.", "qnty"}
RATE_KEYS = {"rate", "price", "purchase rate", "purchase_price", "cost", "unit rate"}
MRP_KEYS = {"mrp", "max retail price", "maximum retail price"}
SALE_KEYS = {"sale price", "sale_price", "selling price", "sp", "sales price", "retail price"}
PROFIT_KEYS = {
    "profit %",
    "profit%",
    "profit percent",
    "profit percentage",
    "profit_pct",
    "profit pct",
    "profit",
}
DISC_KEYS = {"disc%", "disc %", "discount%", "discount %", "disc", "discount", "disc pct"}
GST_KEYS = {"gst%", "gst %", "gst", "tax%", "tax %", "tax", "gst pct"}


def _norm_header(value: str) -> str:
    return " ".join(str(value or "").strip().lower().replace("_", " ").split())


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return str(value)
    return str(value).strip()


def _parse_number(value: str) -> float:
    text = str(value or "").replace(",", "").strip()
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _ss_attr(el: ET.Element, name: str) -> str | None:
    return el.attrib.get(name) or el.attrib.get(f"{{{SSML_NS}}}{name}")


def _parse_spreadsheetml(data: bytes) -> list[list[str]]:
    root = ET.fromstring(data)
    rows: list[list[str]] = []
    for row_el in root.iter(f"{{{SSML_NS}}}Row"):
        cells: dict[int, str] = {}
        col = 0
        for cell in row_el.findall(f"{{{SSML_NS}}}Cell"):
            idx = _ss_attr(cell, "Index")
            if idx and str(idx).isdigit():
                col = int(idx) - 1
            data_el = cell.find(f"{{{SSML_NS}}}Data")
            text = "".join(data_el.itertext()).strip() if data_el is not None else ""
            cells[col] = text
            col += 1
        if cells:
            width = max(cells) + 1
            rows.append([cells.get(i, "") for i in range(width)])
    return rows


def _xlsx_col_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in (cell_ref or "") if ch.isalpha())
    n = 0
    for ch in letters.upper():
        n = n * 26 + (ord(ch) - 64)
    return max(n - 1, 0)


def _first_worksheet_path(zf: zipfile.ZipFile, names: list[str]) -> str | None:
    """First tab in workbook.xml. Zip entry order is not sheet order."""
    rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    doc_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    try:
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        sheets = list(wb.iter(f"{{{XLSX_NS}}}sheet"))
        rid = sheets[0].attrib.get(f"{{{doc_ns}}}id") if sheets else None
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        for rel in rels.iter(f"{{{rel_ns}}}Relationship"):
            if rel.attrib.get("Id") != rid:
                continue
            target = (rel.attrib.get("Target") or "").lstrip("/")
            path = target if target.startswith("xl/") else f"xl/{target}"
            if path in names:
                return path
    except (KeyError, ET.ParseError, IndexError):
        pass
    sheets = [n for n in names if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")]
    return sheets[0] if sheets else None


def _parse_xlsx(data: bytes) -> list[list[str]]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = zf.namelist()
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            ss_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in ss_root.findall(f"{{{XLSX_NS}}}si"):
                shared.append("".join(si.itertext()))
        sheet_name = _first_worksheet_path(zf, names)
        if not sheet_name:
            return []
        sheet = ET.fromstring(zf.read(sheet_name))
        rows: list[list[str]] = []
        for row_el in sheet.iter(f"{{{XLSX_NS}}}row"):
            cells: dict[int, str] = {}
            for cell in row_el.findall(f"{{{XLSX_NS}}}c"):
                ref = cell.attrib.get("r") or ""
                col = _xlsx_col_index(ref)
                kind = cell.attrib.get("t")
                if kind == "s":
                    v = cell.find(f"{{{XLSX_NS}}}v")
                    idx = int(v.text) if v is not None and v.text else 0
                    text = shared[idx] if 0 <= idx < len(shared) else ""
                elif kind == "inlineStr":
                    is_el = cell.find(f"{{{XLSX_NS}}}is")
                    text = "".join(is_el.itertext()) if is_el is not None else ""
                else:
                    v = cell.find(f"{{{XLSX_NS}}}v")
                    text = v.text if v is not None and v.text else ""
                cells[col] = _cell_text(text)
            if cells:
                width = max(cells) + 1
                rows.append([cells.get(i, "") for i in range(width)])
        return rows


def _parse_csv(data: bytes) -> list[list[str]]:
    text = data.decode("utf-8-sig", errors="replace")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    return [[_cell_text(c) for c in row] for row in reader]


def parse_tabular_file(data: bytes, filename: str) -> list[list[str]]:
    name = (filename or "").lower()
    head = data[:200].lstrip()
    if head.startswith(b"PK"):
        return _parse_xlsx(data)
    if b"urn:schemas-microsoft-com:office:spreadsheet" in data[:4000] or head.startswith(b"<?xml"):
        try:
            return _parse_spreadsheetml(data)
        except ET.ParseError:
            pass
    if name.endswith(".xlsx"):
        return _parse_xlsx(data)
    if name.endswith(".xls"):
        try:
            return _parse_spreadsheetml(data)
        except ET.ParseError:
            return _parse_csv(data)
    return _parse_csv(data)


def _header_map(header: list[str]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for i, raw in enumerate(header):
        key = _norm_header(raw)
        if key in CODE_KEYS and "code" not in mapping:
            mapping["code"] = i
        elif key in NAME_KEYS and "name" not in mapping:
            mapping["name"] = i
        elif key in QTY_KEYS and "qty" not in mapping:
            mapping["qty"] = i
        elif key in RATE_KEYS and "rate" not in mapping:
            mapping["rate"] = i
        elif key in MRP_KEYS and "mrp" not in mapping:
            mapping["mrp"] = i
        elif key in SALE_KEYS and "sale" not in mapping:
            mapping["sale"] = i
        elif key in PROFIT_KEYS and "profit" not in mapping:
            mapping["profit"] = i
        elif key in DISC_KEYS and "disc" not in mapping:
            mapping["disc"] = i
        elif key in GST_KEYS and "gst" not in mapping:
            mapping["gst"] = i
    return mapping


def _looks_like_header(row: list[str]) -> bool:
    joined = " ".join(_norm_header(c) for c in row)
    return "qty" in joined or "quantity" in joined or "code" in joined or "product" in joined


def _col(row: list[str], idx: int | None) -> str:
    if idx is None or idx < 0 or idx >= len(row):
        return ""
    return _cell_text(row[idx])


async def preview_purchase_import(
    session: AsyncSession, data: bytes, filename: str
) -> dict:
    table = parse_tabular_file(data, filename)
    table = [row for row in table if any(_cell_text(c) for c in row)]
    if not table:
        return {
            "lines": [],
            "errors": ["The file is empty."],
            "imported": 0,
            "skipped": 0,
        }

    start = 0
    mapping = _header_map(table[0])
    if mapping.get("code") is not None or mapping.get("name") is not None or _looks_like_header(table[0]):
        start = 1
        if "code" not in mapping:
            mapping["code"] = 0
        if "name" not in mapping:
            mapping["name"] = 1
        if "qty" not in mapping:
            mapping["qty"] = 2
        if "rate" not in mapping:
            mapping["rate"] = 3
        if "disc" not in mapping:
            mapping["disc"] = 4
        if "gst" not in mapping:
            mapping["gst"] = 5
    else:
        mapping = {"code": 0, "name": 1, "qty": 2, "rate": 3, "disc": 4, "gst": 5}

    gst_rates = list(
        (await session.execute(select(GstRate).where(GstRate.is_active.is_(True)))).scalars().all()
    )
    gst_by_rate = {round(float(g.rate or 0), 2): g for g in gst_rates}

    keys: set[str] = set()
    parsed_rows: list[dict] = []
    for row in table[start:]:
        code = _col(row, mapping.get("code"))
        name = _col(row, mapping.get("name"))
        qty = _parse_number(_col(row, mapping.get("qty")))
        rate = _parse_number(_col(row, mapping.get("rate")))
        mrp = _parse_number(_col(row, mapping.get("mrp")))
        sale = _parse_number(_col(row, mapping.get("sale")))
        profit = _parse_number(_col(row, mapping.get("profit")))
        disc = _parse_number(_col(row, mapping.get("disc")))
        gst_raw = _parse_number(_col(row, mapping.get("gst")))
        gst = 0.0
        matched_gst = False
        for cand in gst_pct_candidates(gst_raw):
            hit = gst_by_rate.get(round(cand, 2))
            if hit:
                gst = float(hit.rate or 0)
                matched_gst = True
                break
        if not matched_gst:
            cands = gst_pct_candidates(gst_raw)
            gst = cands[-1] if cands else 0.0
        if not code and not name:
            continue
        parsed_rows.append(
            {
                "code": code,
                "name": name,
                "qty": qty,
                "rate": rate,
                "mrp": mrp,
                "sale": sale,
                "profit": profit,
                "disc": disc,
                "gst": gst,
            }
        )
        if code:
            keys.add(code)
            keys.add(code.lower())
        if name:
            keys.add(name.lower())

    products: list[Product] = []
    if keys:
        lowered = list({k.lower() for k in keys if k})
        products = list(
            (
                await session.execute(
                    select(Product).where(
                        Product.is_active.is_(True),
                        or_(
                            func.lower(func.coalesce(Product.code, "")).in_(lowered),
                            func.lower(func.coalesce(Product.barcode, "")).in_(lowered),
                            func.lower(func.coalesce(Product.name, "")).in_(lowered),
                        ),
                    )
                )
            ).scalars().all()
        )
    by_code: dict[str, Product] = {}
    by_barcode: dict[str, Product] = {}
    by_name: dict[str, Product] = {}
    for p in products:
        if p.code:
            by_code[str(p.code).strip().lower()] = p
        if p.barcode:
            by_barcode[str(p.barcode).strip().lower()] = p
        if p.name:
            by_name[str(p.name).strip().lower()] = p

    def find_product(code: str, name: str) -> Product | None:
        c = code.strip().lower()
        n = name.strip().lower()
        if c and c in by_code:
            return by_code[c]
        if c and c in by_barcode:
            return by_barcode[c]
        if n and n in by_name:
            return by_name[n]
        if c.isdigit():
            stripped = str(int(c))
            if stripped in by_code:
                return by_code[stripped]
        return None

    lines: list[dict] = []
    errors: list[str] = []
    skipped = 0
    for i, raw in enumerate(parsed_rows, start=start + 1):
        product = find_product(raw["code"], raw["name"])
        if not product:
            skipped += 1
            label = raw["code"] or raw["name"] or f"row {i}"
            errors.append(f"Row {i}: product not found ({label}).")
            continue
        qty = raw["qty"] if raw["qty"] > 0 else 1.0
        rate = raw["rate"] if raw["rate"] > 0 else float(product.purchase_price or 0)
        mrp = raw["mrp"] if raw["mrp"] > 0 else float(product.mrp or 0)
        last_cost = float(product.purchase_price or 0)
        last_sale = float(product.sale_price or 0)
        profit_pct = raw["profit"]
        if profit_pct <= 0 and last_cost > 0 and last_sale > 0:
            profit_pct = round((last_sale - last_cost) / last_cost * 100.0, 2)
        if raw["sale"] > 0:
            sale_price = raw["sale"]
            if rate > 0 and profit_pct <= 0:
                profit_pct = round((sale_price - rate) / rate * 100.0, 2)
        elif profit_pct != 0 and rate > 0:
            sale_price = round(rate * (1 + profit_pct / 100.0))
        else:
            sale_price = last_sale
            if rate > 0 and last_sale <= 0 and profit_pct != 0:
                sale_price = round(rate * (1 + profit_pct / 100.0))
            elif rate > 0 and last_sale > 0 and profit_pct > 0:
                sale_price = round(rate * (1 + profit_pct / 100.0))
        disc = min(max(raw["disc"], 0.0), 100.0)
        slabs = normalize_slabs(getattr(product, "tax_slabs", None))
        slab = resolve_slab(slabs, rate) if slabs else None
        gst_id = (slab.get("gst_id") if slab else None) or product.gst_id
        gst_rate = float(slab["rate"]) if slab else 0.0
        if raw["gst"] > 0:
            gst_rate = raw["gst"]
            hit = gst_by_rate.get(round(gst_rate, 2))
            if hit:
                gst_id = hit.id
        elif gst_id:
            gst = next((g for g in gst_rates if g.id == gst_id), None)
            if gst:
                gst_rate = float(gst.rate or 0)
        lines.append(
            {
                "product_id": product.id,
                "code": product.code or raw["code"],
                "name": product.name or raw["name"],
                "qty": qty,
                "rate": rate,
                "mrp": mrp,
                "sale_price": sale_price,
                "profit_pct": profit_pct,
                "disc_pct": disc,
                "gst_rate": gst_rate,
                "gst_id": gst_id,
            }
        )

    imported = len(lines)
    return {
        "lines": lines,
        "errors": errors,
        "imported": imported,
        "skipped": skipped,
        "message": (
            f"Imported {imported} line(s)"
            + (f", skipped {skipped}" if skipped else "")
            + ". Review the bill, then save."
        ),
    }
