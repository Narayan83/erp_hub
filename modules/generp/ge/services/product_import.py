"""Create products from an Excel/CSV template (Product Master)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.models.masters import Category, GstRate, Product, ProductBarcode, SubCategory
from modules.generp.ge.schemas.masters import ProductImportResult
from modules.generp.ge.services.product_codes import (
    allocate_import_codes,
    encode_own_barcode,
    format_internal_barcode,
    max_numeric_product_code,
    parse_product_code,
)
from modules.generp.ge.services.purchase_import import (
    _cell_text,
    _norm_header,
    _parse_number,
    parse_tabular_file,
)
from modules.generp.ge.services.stock_lots import add_lot
from modules.generp.ge.services.tax import gst_pct_candidates, import_percent

DEFAULT_CATEGORY_NAME = "General"
MAX_IMPORT_BYTES = 8 * 1024 * 1024
MAX_IMPORT_ROWS = 5000

CODE_KEYS = {"code", "item code", "product code", "sku", "item no", "itemcode"}
NAME_KEYS = {"name", "product", "item name", "product name", "description", "item", "cname"}
TYPE_KEYS = {"item type", "type", "goods service", "kind"}
CATEGORY_KEYS = {"category", "category name"}
SUB_KEYS = {"sub category", "subcategory", "sub category name"}
GST_KEYS = {"gst", "gst%", "gst %", "gst rate", "tax", "tax%", "tax %"}
HSN_KEYS = {"hsn", "hsn code", "sac", "sac code"}
UNIT_KEYS = {"unit", "uom"}
PURCHASE_KEYS = {"purchase", "purchase price", "cost", "rate"}
SALE_KEYS = {"sale", "sale price", "srate", "selling price", "retail"}
WS_KEYS = {"wholesale", "wholesale price", "wsrate", "ws rate", "ws"}
MRP_KEYS = {"mrp", "max retail price"}
DISC_KEYS = {"max disc %", "max disc", "max discount", "max discount %", "disc %"}
MOQ_KEYS = {"moq", "min order qty", "minimum order quantity", "min qty", "minimum qty"}
OPENING_KEYS = {"opening stock", "opening", "op stock", "stock"}
SHOP_KEYS = {"shop", "in shop", "shopping cart", "is in shop"}
OWN_KEYS = {"own barcode", "own", "shop barcode"}


@dataclass
class _Row:
    row_no: int
    code: str | None
    name: str
    item_type: str
    category: str
    sub_category: str
    gst: str
    hsn_code: str
    unit: str
    purchase_price: float
    sale_price: float
    wholesale_price: float
    mrp: float
    max_discount_pct: float
    moq: float
    opening_stock: float
    is_in_shop: bool
    own_barcode: bool


def _col(row: list[str], idx: int | None) -> str:
    if idx is None or idx < 0 or idx >= len(row):
        return ""
    return _cell_text(row[idx])


def _header_map(header: list[str]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    groups = (
        ("code", CODE_KEYS),
        ("name", NAME_KEYS),
        ("item_type", TYPE_KEYS),
        ("category", CATEGORY_KEYS),
        ("sub_category", SUB_KEYS),
        ("gst", GST_KEYS),
        ("hsn", HSN_KEYS),
        ("unit", UNIT_KEYS),
        ("purchase", PURCHASE_KEYS),
        ("sale", SALE_KEYS),
        ("wholesale", WS_KEYS),
        ("mrp", MRP_KEYS),
        ("disc", DISC_KEYS),
        ("moq", MOQ_KEYS),
        ("opening", OPENING_KEYS),
        ("shop", SHOP_KEYS),
        ("own", OWN_KEYS),
    )
    for i, raw in enumerate(header):
        key = _norm_header(raw)
        for dest, aliases in groups:
            if dest not in mapping and key in aliases:
                mapping[dest] = i
                break
    return mapping


def _looks_like_header(row: list[str]) -> bool:
    joined = " ".join(_norm_header(c) for c in row)
    return "name" in joined or "product" in joined or "code" in joined or "cname" in joined


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "y", "yes", "true", "t", "on"}


def _parse_item_type(value: str) -> str:
    raw = value.strip().lower()
    if raw in {"service", "services", "s"}:
        return "service"
    return "goods"


def _find_by_name(rows: list, raw: str):
    key = raw.strip().lower()
    if not key:
        return None
    for obj in rows:
        if (obj.name or "").strip().lower() == key or (obj.code or "").strip().lower() == key:
            return obj
    return None


def _master_code_from_name(name: str, used: set[str]) -> str:
    base = "".join(ch for ch in (name or "").upper() if ch.isalnum())[:24] or "CAT"
    candidate = base[:30]
    n = 2
    used_upper = {u.upper() for u in used}
    while candidate.upper() in used_upper:
        suffix = str(n)
        candidate = (base[: 30 - len(suffix)] + suffix)[:30]
        n += 1
    used.add(candidate)
    return candidate


async def ensure_category(
    session: AsyncSession, name: str, categories: list[Category]
) -> Category:
    label = (name or "").strip() or DEFAULT_CATEGORY_NAME
    found = _find_by_name(categories, label)
    if found:
        if not found.is_active:
            found.is_active = True
        return found
    used = {str(c.code or "").strip() for c in categories if c.code}
    preferred = "GENERAL" if label.lower() == DEFAULT_CATEGORY_NAME.lower() else label
    code = _master_code_from_name(preferred, used)
    obj = Category(code=code, name=label[:150], sort_order=len(categories), is_active=True)
    session.add(obj)
    await session.flush()
    categories.append(obj)
    return obj


async def ensure_sub_category(
    session: AsyncSession,
    category: Category,
    name: str,
    sub_categories: list[SubCategory],
) -> SubCategory:
    label = (name or "").strip() or DEFAULT_CATEGORY_NAME
    key = label.lower()
    for sub in sub_categories:
        if sub.category_id != category.id:
            continue
        if (sub.name or "").strip().lower() == key or (sub.code or "").strip().lower() == key:
            if not sub.is_active:
                sub.is_active = True
            return sub
    used = {
        str(s.code or "").strip()
        for s in sub_categories
        if s.category_id == category.id and s.code
    }
    preferred = "GENERAL" if label.lower() == DEFAULT_CATEGORY_NAME.lower() else label
    code = _master_code_from_name(preferred, used)
    obj = SubCategory(
        category_id=category.id,
        code=code,
        name=label[:150],
        sort_order=len([s for s in sub_categories if s.category_id == category.id]),
        is_active=True,
    )
    session.add(obj)
    await session.flush()
    sub_categories.append(obj)
    return obj


async def ensure_default_categories(session: AsyncSession) -> tuple[Category, SubCategory]:
    categories = list((await session.execute(select(Category))).scalars().all())
    sub_categories = list((await session.execute(select(SubCategory))).scalars().all())
    category = await ensure_category(session, DEFAULT_CATEGORY_NAME, categories)
    sub = await ensure_sub_category(session, category, DEFAULT_CATEGORY_NAME, sub_categories)
    return category, sub


async def _ensure_own_barcode(session: AsyncSession, product: Product) -> None:
    if not bool(getattr(product, "own_barcode", False)):
        return
    mrp = float(product.mrp or 0)
    if mrp <= 0:
        return
    try:
        barcode = encode_own_barcode(product.code, mrp)
    except ValueError:
        return
    existing = (
        await session.execute(
            select(ProductBarcode).where(
                ProductBarcode.barcode == barcode, ProductBarcode.is_active.is_(True)
            )
        )
    ).scalar_one_or_none()
    if existing:
        return
    session.add(
        ProductBarcode(
            product_id=product.id,
            barcode=barcode,
            sale_rate=float(product.sale_price or mrp),
            ws_rate=float(product.wholesale_price or 0) or None,
            mrp=mrp,
            kind="own",
            is_active=True,
        )
    )


def _find_gst(rows: list[GstRate], raw: str) -> GstRate | None:
    text = raw.strip()
    if not text:
        return None
    for candidate in gst_pct_candidates(text):
        for g in rows:
            if abs(float(g.rate or 0) - candidate) < 0.001:
                return g
    return _find_by_name(rows, text)


def parse_product_template_rows(table: list[list[str]]) -> tuple[list[_Row], list[str]]:
    errors: list[str] = []
    if not table:
        return [], ["The file has no rows."]
    start = 0
    mapping = _header_map(table[0])
    if mapping.get("name") is not None or _looks_like_header(table[0]):
        start = 1
    if mapping.get("name") is None:
        mapping["name"] = mapping.get("name", 1 if len(table[0]) > 1 else 0)
        if "code" not in mapping:
            mapping["code"] = 0

    out: list[_Row] = []
    for offset, raw in enumerate(table[start:]):
        row_no = start + offset + 1
        if not any(_cell_text(c) for c in raw):
            continue
        name = _col(raw, mapping.get("name")).strip()
        code_raw = _col(raw, mapping.get("code"))
        if not name and not code_raw:
            continue
        if not name:
            errors.append(f"Row {row_no}: product name is required")
            continue
        try:
            code = parse_product_code(code_raw)
        except ValueError as exc:
            errors.append(f"Row {row_no}: {exc}")
            continue
        out.append(
            _Row(
                row_no=row_no,
                code=code,
                name=name[:200],
                item_type=_parse_item_type(_col(raw, mapping.get("item_type"))),
                category=_col(raw, mapping.get("category")),
                sub_category=_col(raw, mapping.get("sub_category")),
                gst=_col(raw, mapping.get("gst")),
                hsn_code=_col(raw, mapping.get("hsn"))[:20],
                unit=_col(raw, mapping.get("unit")).strip() or "NOS",
                purchase_price=_parse_number(_col(raw, mapping.get("purchase"))),
                sale_price=_parse_number(_col(raw, mapping.get("sale"))),
                wholesale_price=_parse_number(_col(raw, mapping.get("wholesale"))),
                mrp=_parse_number(_col(raw, mapping.get("mrp"))),
                max_discount_pct=import_percent(_col(raw, mapping.get("disc"))),
                moq=_parse_number(_col(raw, mapping.get("moq"))),
                opening_stock=_parse_number(_col(raw, mapping.get("opening"))),
                is_in_shop=_parse_bool(_col(raw, mapping.get("shop"))),
                own_barcode=_parse_bool(_col(raw, mapping.get("own"))),
            )
        )
        if len(out) >= MAX_IMPORT_ROWS:
            errors.append(f"Stopped at {MAX_IMPORT_ROWS} product rows (file limit).")
            break
    return out, errors


async def import_products_from_file(
    session: AsyncSession, data: bytes, filename: str
) -> ProductImportResult:
    if not data:
        return ProductImportResult(skipped=0, errors=["The uploaded file is empty."], message="Nothing imported.")
    if len(data) > MAX_IMPORT_BYTES:
        return ProductImportResult(errors=["File is too large (max 8 MB)."], message="Nothing imported.")

    table = parse_tabular_file(data, filename)
    rows, errors = parse_product_template_rows(table)
    if not rows:
        msg = "No product rows found." if not errors else "Nothing imported."
        return ProductImportResult(skipped=0, errors=errors or [msg], message=msg)

    categories = list((await session.execute(select(Category))).scalars().all())
    sub_categories = list((await session.execute(select(SubCategory))).scalars().all())
    gst_rates = (
        await session.execute(select(GstRate).where(GstRate.is_active.is_(True)).order_by(GstRate.sort_order))
    ).scalars().all()
    existing = (await session.execute(select(Product.code, Product.barcode))).all()
    taken: set[str] = set()
    taken_barcodes: set[str] = set()
    for code, barcode in existing:
        if code:
            raw = str(code).strip()
            taken.add(raw)
            parsed = None
            try:
                parsed = parse_product_code(raw)
            except ValueError:
                parsed = None
            if parsed:
                taken.add(parsed)
        if barcode:
            taken_barcodes.add(str(barcode).strip())

    db_max = await max_numeric_product_code(session)
    assigned, code_errors = allocate_import_codes(
        [r.code for r in rows],
        db_max=db_max,
        taken=taken,
        row_numbers=[r.row_no for r in rows],
    )
    errors.extend(code_errors)

    created = 0
    skipped = 0
    for row, code in zip(rows, assigned, strict=True):
        if not code:
            skipped += 1
            continue
        try:
            barcode = format_internal_barcode(code)
        except ValueError as exc:
            errors.append(f"Row {row.row_no}: {exc}")
            skipped += 1
            continue
        if code in taken or barcode in taken_barcodes:
            errors.append(
                f"Row {row.row_no}: product code {code} already exists in Product Master "
                "(this is the product code, not the table id)"
            )
            skipped += 1
            continue

        cat_name = (row.category or "").strip() or DEFAULT_CATEGORY_NAME
        sub_name = (row.sub_category or "").strip() or DEFAULT_CATEGORY_NAME
        category = await ensure_category(session, cat_name, categories)
        sub = await ensure_sub_category(session, category, sub_name, sub_categories)
        gst = _find_gst(list(gst_rates), row.gst) if row.gst else None
        if row.gst and gst is None:
            errors.append(f"Row {row.row_no}: GST {row.gst!r} not found")
            skipped += 1
            continue

        tax_slabs = None
        if gst is not None:
            tax_slabs = [{"min_amount": 0, "rate": float(gst.rate or 0), "gst_id": gst.id}]

        obj = Product(
            code=code,
            barcode=barcode,
            name=row.name,
            category_id=category.id if category else None,
            sub_category_id=sub.id if sub else None,
            gst_id=gst.id if gst else None,
            tax_slabs=tax_slabs,
            unit=row.unit[:20],
            hsn_code=row.hsn_code or None,
            item_type=row.item_type,
            purchase_price=row.purchase_price,
            sale_price=row.sale_price,
            wholesale_price=row.wholesale_price,
            mrp=row.mrp,
            max_discount_pct=row.max_discount_pct,
            moq=row.moq,
            opening_stock=row.opening_stock,
            current_stock=row.opening_stock,
            is_active=True,
            is_in_shop=row.is_in_shop,
            own_barcode=row.own_barcode,
        )
        session.add(obj)
        await session.flush()
        if row.opening_stock > 0:
            await add_lot(session, obj, row.opening_stock, date.today(), source_type="OPENING")
        await _ensure_own_barcode(session, obj)
        taken.add(code)
        taken_barcodes.add(barcode)
        created += 1

    if created:
        message = f"Created {created} product(s)."
        if skipped:
            message += f" {skipped} row(s) skipped."
    else:
        message = "Nothing imported."
        skipped = max(skipped, len(rows) - created)
    return ProductImportResult(created=created, skipped=skipped, errors=errors, message=message)
