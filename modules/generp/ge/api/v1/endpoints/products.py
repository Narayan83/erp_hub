from __future__ import annotations
import itertools
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.config import get_settings
from modules.generp.ge.models.masters import Product, ProductBarcode, ProductImage
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.masters import (
    GenerateVariantsIn,
    OwnBarcodeIn,
    ProductBarcodeIn,
    ProductBarcodeOut,
    ProductBarcodeUpdate,
    ProductImageOut,
    ProductImageUpdate,
    ProductImportResult,
    ProductIn,
    ProductOut,
    ProductPageOut,
    ProductUpdate,
)
from modules.generp.ge.services.product_codes import (
    encode_own_barcode,
    format_internal_barcode,
    next_product_code,
    normalize_lookup,
    parse_own_barcode,
    parse_product_code,
)
from modules.generp.ge.services.product_import import import_products_from_file
from modules.generp.ge.services.sale_pricing import apply_barcode_rates, apply_fallback_rates
from modules.generp.ge.services.stock_lots import add_lot
from modules.generp.ge.services.tax import normalize_slabs

router = APIRouter()


def _as_uuid(product_id: str) -> str:
    try:
        uuid.UUID(str(product_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Not found") from exc
    return product_id
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_PRODUCT_IMAGES = 12


def _base():
    return select(Product).options(
        selectinload(Product.category),
        selectinload(Product.sub_category),
        selectinload(Product.gst),
        selectinload(Product.images),
    )


def _image_url(image_path: str | None) -> str | None:
    if not image_path:
        return None
    return f"/media/products/{Path(image_path).name}"


def _active_images(obj: Product) -> list[ProductImage]:
    rows = [img for img in (obj.images or []) if img.is_active]
    rows.sort(key=lambda r: (0 if r.is_primary else 1, r.sort_order, str(r.id)))
    return rows


def _image_out(img: ProductImage) -> ProductImageOut:
    return ProductImageOut(
        id=img.id,
        product_id=img.product_id,
        file_path=img.file_path,
        image_url=_image_url(img.file_path) or "",
        is_primary=bool(img.is_primary),
        sort_order=int(img.sort_order or 0),
    )


def _to_out(obj: Product) -> ProductOut:
    gallery = _active_images(obj)
    primary = next((g for g in gallery if g.is_primary), gallery[0] if gallery else None)
    primary_path = primary.file_path if primary else obj.image_path
    return ProductOut(
        id=obj.id,
        code=obj.code,
        barcode=obj.barcode,
        name=obj.name,
        category_id=obj.category_id,
        sub_category_id=obj.sub_category_id,
        gst_id=obj.gst_id,
        tax_slabs=list(obj.tax_slabs or []) if getattr(obj, "tax_slabs", None) else None,
        unit=obj.unit,
        hsn_code=obj.hsn_code,
        item_type=getattr(obj, "item_type", None) or "goods",
        purchase_price=float(obj.purchase_price or 0),
        sale_price=float(obj.sale_price or 0),
        wholesale_price=float(obj.wholesale_price or 0),
        mrp=float(obj.mrp or 0),
        max_discount_pct=float(getattr(obj, "max_discount_pct", 0) or 0),
        moq=float(getattr(obj, "moq", 0) or 0),
        opening_stock=float(obj.opening_stock or 0),
        current_stock=float(obj.current_stock or 0),
        is_active=obj.is_active,
        is_in_shop=bool(getattr(obj, "is_in_shop", False)),
        own_barcode=bool(getattr(obj, "own_barcode", False)),
        category_name=obj.category.name if obj.category else None,
        sub_category_name=obj.sub_category.name if obj.sub_category else None,
        gst_name=obj.gst.name if obj.gst else None,
        gst_rate=float(obj.gst.rate) if obj.gst else None,
        image_path=primary_path,
        image_url=_image_url(primary_path),
        parent_id=obj.parent_id,
        images=[_image_out(g) for g in gallery],
    )

def _barcode_out(obj: ProductBarcode) -> ProductBarcodeOut:
    return ProductBarcodeOut(
        id=obj.id,
        product_id=obj.product_id,
        barcode=obj.barcode,
        sale_rate=float(obj.sale_rate) if obj.sale_rate is not None else None,
        ws_rate=float(obj.ws_rate) if obj.ws_rate is not None else None,
        mrp=float(obj.mrp) if obj.mrp is not None else None,
        kind=getattr(obj, "kind", None) or "company",
        is_active=obj.is_active,
    )


async def _ensure_own_barcode(session: AsyncSession, product: Product) -> ProductBarcode | None:
    """Create code+MRP barcode when Own barcode is on and MRP is set."""
    own = bool(getattr(product, "own_barcode", False))
    mrp = float(product.mrp or 0)
    if not own or mrp <= 0:
        return None
    try:
        barcode = encode_own_barcode(product.code, mrp)
    except ValueError:
        return None
    existing = (
        await session.execute(
            select(ProductBarcode).where(
                ProductBarcode.barcode == barcode, ProductBarcode.is_active.is_(True)
            )
        )
    ).scalar_one_or_none()
    if existing:
        return existing if existing.product_id == product.id else None
    row = ProductBarcode(
        product_id=product.id,
        barcode=barcode,
        sale_rate=float(product.sale_price or mrp),
        ws_rate=float(product.wholesale_price or 0) or None,
        mrp=mrp,
        kind="own",
        is_active=True,
    )
    session.add(row)
    await session.flush()
    return row

async def _code_taken(session: AsyncSession, code: str, barcode: str) -> bool:
    existing = (
        await session.execute(
            select(Product.id).where(or_(Product.code == code, Product.barcode == barcode)).limit(1)
        )
    ).scalar_one_or_none()
    return existing is not None


async def _resolve_create_code(session: AsyncSession, raw_code: str | None) -> tuple[str, str]:
    try:
        parsed = parse_product_code(raw_code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if parsed is None:
        code = await next_product_code(session)
    else:
        code = parsed
    try:
        barcode = format_internal_barcode(code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if parsed is not None and await _code_taken(session, code, barcode):
        raise HTTPException(status_code=400, detail=f"Product code {code} already exists")
    return code, barcode

def _product_images_dir() -> Path:
    path = get_settings().product_images_dir
    path.mkdir(parents=True, exist_ok=True)
    return path

def _delete_product_image_file(image_path: str | None) -> None:
    if not image_path:
        return
    full = _product_images_dir() / Path(image_path).name
    if full.is_file():
        full.unlink(missing_ok=True)

def _product_filters(
    q: str | None,
    is_in_shop: bool | None,
    category_id: str | None,
    price_min: float | None,
    price_max: float | None,
):
    clauses = [Product.is_active.is_(True)]
    if is_in_shop is not None:
        clauses.append(Product.is_in_shop.is_(is_in_shop))
    if category_id:
        clauses.append(Product.category_id == category_id)
    if price_min is not None:
        clauses.append(Product.sale_price >= price_min)
    if price_max is not None:
        clauses.append(Product.sale_price <= price_max)
    query = normalize_lookup(q or "")
    if query:
        like = f"%{query}%"
        alt_ids = (
            select(ProductBarcode.product_id)
            .where(ProductBarcode.is_active.is_(True), ProductBarcode.barcode.ilike(like))
            .scalar_subquery()
        )
        clauses.append(
            or_(
                Product.code.ilike(like),
                Product.barcode.ilike(like),
                Product.name.ilike(like),
                Product.id.in_(alt_ids),
            )
        )
    return clauses


@router.get("", response_model=list[ProductOut])
async def list_products(
    q: str | None = Query(None, description="Search code, name, internal or company barcode"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    is_in_shop: bool | None = Query(None, description="Filter shopping-cart catalog products"),
    category_id: str | None = Query(None),
    price_min: float | None = Query(None, ge=0),
    price_max: float | None = Query(None, ge=0),
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """With `q`: fast typeahead search (max `limit`). Without `q`: active products."""
    stmt = (
        _base()
        .where(*_product_filters(q, is_in_shop, category_id, price_min, price_max))
        .order_by(Product.name)
        .offset(skip)
        .limit(limit)
    )
    result = await session.execute(stmt)
    return [_to_out(o) for o in result.scalars().all()]


@router.get("/paged", response_model=ProductPageOut)
async def list_products_paged(
    q: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    filters = _product_filters(q, None, None, None, None)
    total = int((await session.execute(select(func.count()).select_from(Product).where(*filters))).scalar_one())
    stmt = _base().where(*filters).order_by(Product.name).offset(skip).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    return ProductPageOut(items=[_to_out(o) for o in rows], total=total, skip=skip, limit=limit)

@router.get("/lookup", response_model=ProductOut)

async def lookup_product(
    q: str = Query(..., min_length=1),
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Scan/Enter: barcode (own or company) first, then code / internal 6-digit / name."""
    raw = normalize_lookup(q)
    if "—" in raw:
        raw = raw.split("—", 1)[0].strip()

    async def priced(obj: Product, *, alt: ProductBarcode | None = None, decoded_mrp: float | None = None):
        out = _to_out(obj)
        set_fields = apply_barcode_rates(out, alt, decoded_mrp)
        return await apply_fallback_rates(session, out, set_fields)

    alt = (
        await session.execute(
            select(ProductBarcode)
            .where(ProductBarcode.is_active.is_(True), ProductBarcode.barcode == raw)
            .options(selectinload(ProductBarcode.product))
        )
    ).scalar_one_or_none()
    if alt and alt.product and alt.product.is_active:
        obj = (await session.execute(_base().where(Product.id == alt.product_id))).scalar_one()
        decoded = None
        parsed = parse_own_barcode(raw)
        if parsed and (getattr(alt, "kind", None) == "own" or getattr(obj, "own_barcode", False)):
            decoded = parsed[1]
        return await priced(obj, alt=alt, decoded_mrp=decoded)

    parsed = parse_own_barcode(raw)
    if parsed:
        code, decoded_mrp = parsed
        try:
            prefix = format_internal_barcode(code)
        except ValueError:
            prefix = None
        obj = None
        if prefix:
            obj = (
                await session.execute(
                    _base().where(Product.is_active.is_(True), Product.barcode == prefix)
                )
            ).scalar_one_or_none()
        if not obj:
            obj = (
                await session.execute(
                    _base().where(Product.is_active.is_(True), Product.code == code)
                )
            ).scalar_one_or_none()
        if obj and getattr(obj, "own_barcode", False):
            return await priced(obj, decoded_mrp=decoded_mrp)

    obj = (
        await session.execute(_base().where(Product.is_active.is_(True), Product.code == raw))
    ).scalar_one_or_none()
    if obj:
        return await priced(obj)

    candidates = [raw]
    if raw.isdigit() and len(raw) <= 6:
        try:
            candidates.append(format_internal_barcode(raw))
            candidates.append(str(int(raw)))
        except ValueError:
            pass
    for cand in candidates:
        obj = (
            await session.execute(
                _base().where(Product.is_active.is_(True), Product.barcode == cand)
            )
        ).scalar_one_or_none()
        if obj:
            return await priced(obj)
        obj = (
            await session.execute(_base().where(Product.is_active.is_(True), Product.code == cand))
        ).scalar_one_or_none()
        if obj:
            return await priced(obj)

    obj = (
        await session.execute(
            _base().where(Product.is_active.is_(True), Product.barcode.ilike(raw))
        )
    ).scalar_one_or_none()
    if obj:
        return await priced(obj)
    obj = (
        await session.execute(
            _base().where(Product.is_active.is_(True), Product.name.ilike(raw))
        )
    ).scalar_one_or_none()
    if obj:
        return await priced(obj)
    raise HTTPException(status_code=404, detail="Product not found")

@router.post("/generate-variants", response_model=list[ProductOut])

async def generate_variants(
    data: GenerateVariantsIn,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    parent = (
        await session.execute(_base().where(Product.id == data.product_id))
    ).scalar_one_or_none()
    if not parent or not parent.is_active:
        raise HTTPException(status_code=404, detail="Base product not found")
    axes = []
    for axis in data.axes:
        name = (axis.name or "").strip()
        values = [v.strip() for v in axis.values if str(v).strip()]
        if not name or not values:
            continue
        # de-dupe preserving order
        seen: set[str] = set()
        uniq: list[str] = []
        for v in values:
            key = v.lower()
            if key in seen:
                continue
            seen.add(key)
            uniq.append(v)
        axes.append((name, uniq))
    if not axes:
        raise HTTPException(status_code=400, detail="Add at least one attribute with values")
    if len(axes) > 3:
        raise HTTPException(status_code=400, detail="Maximum 3 variant attributes")
    combos = list(itertools.product(*(vals for _, vals in axes)))
    if len(combos) > 100:
        raise HTTPException(status_code=400, detail="Too many combinations (max 100)")
    created: list[Product] = []
    for combo in combos:
        label = " / ".join(combo)
        variant_name = f"{parent.name} - {label}"
        existing = (
            await session.execute(
                select(Product).where(Product.is_active.is_(True), Product.name == variant_name)
            )
        ).scalar_one_or_none()
        if existing:
            continue
        code, barcode = await _resolve_create_code(session, None)
        obj = Product(
            code=code,
            barcode=barcode,
            name=variant_name,
            category_id=parent.category_id,
            sub_category_id=parent.sub_category_id,
            gst_id=parent.gst_id,
            tax_slabs=list(parent.tax_slabs or []) if getattr(parent, "tax_slabs", None) else None,
            unit=parent.unit,
            hsn_code=parent.hsn_code,
            item_type=getattr(parent, "item_type", None) or "goods",
            purchase_price=parent.purchase_price,
            sale_price=parent.sale_price,
            wholesale_price=parent.wholesale_price,
            mrp=parent.mrp,
            max_discount_pct=float(getattr(parent, "max_discount_pct", 0) or 0),
            moq=float(getattr(parent, "moq", 0) or 0),
            opening_stock=0,
            current_stock=0,
            image_path=parent.image_path,
            parent_id=parent.id,
            is_active=True,
            is_in_shop=bool(getattr(parent, "is_in_shop", False)),
            own_barcode=bool(getattr(parent, "own_barcode", False)),
        )
        session.add(obj)
        # Flush each variant so next_product_code sees the new max code.
        await session.flush()
        await _ensure_own_barcode(session, obj)
        created.append(obj)

    if not created:
        raise HTTPException(
            status_code=400,
            detail="No new variants created (names may already exist)",
        )

    outs: list[ProductOut] = []
    for obj in created:
        loaded = (await session.execute(_base().where(Product.id == obj.id))).scalar_one()
        outs.append(_to_out(loaded))
    return outs


@router.post("/import", response_model=ProductImportResult)
async def import_products(
    file: UploadFile = File(...),
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    return await import_products_from_file(session, raw, file.filename or "products.xlsx")


@router.post("", response_model=ProductOut)

async def create_product(
    data: ProductIn, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    try:
        code, barcode = await _resolve_create_code(session, data.code)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    payload = data.model_dump()
    payload["code"] = code
    payload["barcode"] = barcode
    payload["current_stock"] = payload.get("opening_stock", 0)
    payload["tax_slabs"] = normalize_slabs(payload.get("tax_slabs")) or None
    payload["own_barcode"] = bool(data.own_barcode)
    obj = Product(**payload)
    session.add(obj)
    await session.flush()
    opening = float(obj.opening_stock or 0)
    if opening > 0:
        from datetime import date as _date

        await add_lot(session, obj, opening, _date.today(), source_type="OPENING")
    obj = (await session.execute(_base().where(Product.id == obj.id))).scalar_one()
    await _ensure_own_barcode(session, obj)
    return _to_out(obj)

@router.get("/{product_id}", response_model=ProductOut)

async def get_product(
    product_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    product_id = _as_uuid(product_id)
    obj = (await session.execute(_base().where(Product.id == product_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return _to_out(obj)

@router.patch("/{product_id}", response_model=ProductOut)

async def update_product(
    product_id: str,
    data: ProductUpdate,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    product_id = _as_uuid(product_id)
    obj = (await session.execute(_base().where(Product.id == product_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    updates = data.model_dump(exclude_unset=True)
    if "tax_slabs" in updates:
        updates["tax_slabs"] = normalize_slabs(updates.get("tax_slabs")) or None
    for k, v in updates.items():
        setattr(obj, k, v)
    if "own_barcode" in updates:
        obj.own_barcode = bool(updates["own_barcode"])
    await session.flush()
    await _ensure_own_barcode(session, obj)
    obj = (await session.execute(_base().where(Product.id == obj.id))).scalar_one()
    return _to_out(obj)

@router.delete("/{product_id}", response_model=MessageResponse)

async def delete_product(
    product_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    product_id = _as_uuid(product_id)
    obj = (await session.execute(select(Product).where(Product.id == product_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    obj.is_active = False
    await session.flush()
    return MessageResponse(message="Product deactivated")

async def _read_upload(file: UploadFile) -> tuple[bytes, str]:
    content_type = (file.content_type or "").lower()
    ext = ALLOWED_IMAGE_TYPES.get(content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="Image must be JPEG, PNG, or WebP")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 5 MB)")
    return data, ext


async def _sync_primary_path(session: AsyncSession, product: Product) -> None:
    gallery = _active_images(product)
    primary = next((g for g in gallery if g.is_primary), None)
    if gallery and primary is None:
        gallery[0].is_primary = True
        primary = gallery[0]
    product.image_path = primary.file_path if primary else None
    await session.flush()


async def _add_gallery_image(
    session: AsyncSession,
    product: Product,
    data: bytes,
    ext: str,
    *,
    make_primary: bool = False,
) -> ProductImage:
    active = _active_images(product)
    if len(active) >= MAX_PRODUCT_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {MAX_PRODUCT_IMAGES} images per product",
        )
    image_id = str(uuid.uuid4())
    filename = f"{product.id}_{image_id}{ext}"
    dest = _product_images_dir() / filename
    dest.write_bytes(data)
    is_first = len(active) == 0
    if make_primary or is_first:
        for img in active:
            img.is_primary = False
    row = ProductImage(
        id=image_id,
        product_id=product.id,
        file_path=filename,
        is_primary=make_primary or is_first,
        sort_order=len(active),
        is_active=True,
    )
    session.add(row)
    await session.flush()
    await session.refresh(product, attribute_names=["images"])
    await _sync_primary_path(session, product)
    return row


@router.get("/{product_id}/images", response_model=list[ProductImageOut])
async def list_product_images(
    product_id: str,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (await session.execute(_base().where(Product.id == product_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return [_image_out(img) for img in _active_images(obj)]


@router.post("/{product_id}/images", response_model=ProductOut)
async def upload_product_gallery_image(
    product_id: str,
    file: UploadFile = File(...),
    make_primary: bool = Query(False),
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Add an image to the product gallery (does not replace existing images)."""
    obj = (await session.execute(_base().where(Product.id == product_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    data, ext = await _read_upload(file)
    await _add_gallery_image(session, obj, data, ext, make_primary=make_primary)
    obj = (await session.execute(_base().where(Product.id == product_id))).scalar_one()
    return _to_out(obj)


@router.patch("/{product_id}/images/{image_id}", response_model=ProductOut)
async def update_product_image(
    product_id: str,
    image_id: str,
    data: ProductImageUpdate,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (await session.execute(_base().where(Product.id == product_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    target = next((img for img in _active_images(obj) if img.id == image_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Image not found")
    if data.sort_order is not None:
        target.sort_order = data.sort_order
    if data.is_primary is True:
        for img in _active_images(obj):
            img.is_primary = img.id == image_id
    await _sync_primary_path(session, obj)
    obj = (await session.execute(_base().where(Product.id == product_id))).scalar_one()
    return _to_out(obj)


@router.delete("/{product_id}/images/{image_id}", response_model=ProductOut)
async def delete_product_gallery_image(
    product_id: str,
    image_id: str,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (await session.execute(_base().where(Product.id == product_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    target = next((img for img in (obj.images or []) if img.id == image_id and img.is_active), None)
    if not target:
        raise HTTPException(status_code=404, detail="Image not found")
    _delete_product_image_file(target.file_path)
    target.is_active = False
    target.is_primary = False
    await session.flush()
    await session.refresh(obj, attribute_names=["images"])
    await _sync_primary_path(session, obj)
    obj = (await session.execute(_base().where(Product.id == product_id))).scalar_one()
    return _to_out(obj)


@router.post("/{product_id}/image", response_model=ProductOut)
async def upload_product_image(
    product_id: str,
    file: UploadFile = File(...),
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Legacy: add image and make it the main/primary image."""
    obj = (await session.execute(_base().where(Product.id == product_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    data, ext = await _read_upload(file)
    await _add_gallery_image(session, obj, data, ext, make_primary=True)
    obj = (await session.execute(_base().where(Product.id == product_id))).scalar_one()
    return _to_out(obj)


@router.delete("/{product_id}/image", response_model=ProductOut)
async def delete_product_image(
    product_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    """Legacy: remove the current primary image (or all if only one)."""
    obj = (await session.execute(_base().where(Product.id == product_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    gallery = _active_images(obj)
    primary = next((g for g in gallery if g.is_primary), gallery[0] if gallery else None)
    if primary:
        _delete_product_image_file(primary.file_path)
        primary.is_active = False
        primary.is_primary = False
        await session.flush()
        await session.refresh(obj, attribute_names=["images"])
        await _sync_primary_path(session, obj)
    else:
        _delete_product_image_file(obj.image_path)
        obj.image_path = None
        await session.flush()
    obj = (await session.execute(_base().where(Product.id == obj.id))).scalar_one()
    return _to_out(obj)

@router.get("/{product_id}/barcodes", response_model=list[ProductBarcodeOut])

async def list_product_barcodes(
    product_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    product = (
        await session.execute(
            select(Product)
            .where(Product.id == product_id)
            .options(selectinload(Product.alt_barcodes))
        )
    ).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    await _ensure_own_barcode(session, product)
    rows = (
        await session.execute(
            select(ProductBarcode)
            .where(ProductBarcode.product_id == product_id, ProductBarcode.is_active.is_(True))
            .order_by(ProductBarcode.barcode)
        )
    ).scalars().all()
    return [_barcode_out(r) for r in rows]

@router.post("/{product_id}/barcodes", response_model=ProductBarcodeOut)

async def add_product_barcode(
    product_id: str,
    data: ProductBarcodeIn,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    product = (
        await session.execute(select(Product).where(Product.id == product_id))
    ).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if getattr(product, "own_barcode", False):
        raise HTTPException(
            status_code=400,
            detail="This product uses own barcodes. Generate them from Barcode Generation.",
        )
    barcode = data.barcode.strip()
    if not barcode:
        raise HTTPException(status_code=400, detail="Barcode required")
    as_code = (barcode.lstrip("0") or "0") if barcode.isdigit() else None
    if barcode == product.barcode or as_code == product.code:
        raise HTTPException(
            status_code=400, detail="Use company barcode here; internal barcode is automatic"
        )
    taken = (
        await session.execute(
            select(ProductBarcode).where(
                ProductBarcode.barcode == barcode, ProductBarcode.is_active.is_(True)
            )
        )
    ).scalar_one_or_none()
    if taken:
        raise HTTPException(status_code=400, detail="Barcode already linked to a product")
    obj = ProductBarcode(
        product_id=product_id,
        barcode=barcode,
        sale_rate=data.sale_rate,
        ws_rate=data.ws_rate,
        mrp=data.mrp,
        kind="company",
        is_active=data.is_active,
    )
    session.add(obj)
    await session.flush()
    return _barcode_out(obj)

@router.post("/{product_id}/own-barcodes", response_model=ProductBarcodeOut)

async def add_own_barcode(
    product_id: str,
    data: OwnBarcodeIn,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    product = (
        await session.execute(select(Product).where(Product.id == product_id))
    ).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if not getattr(product, "own_barcode", False):
        raise HTTPException(
            status_code=400,
            detail="Tick Own barcode on the product to generate shop barcodes.",
        )
    try:
        barcode = encode_own_barcode(product.code, data.mrp)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    existing = (
        await session.execute(
            select(ProductBarcode).where(
                ProductBarcode.barcode == barcode, ProductBarcode.is_active.is_(True)
            )
        )
    ).scalar_one_or_none()
    if existing:
        if existing.product_id == product_id:
            return _barcode_out(existing)
        raise HTTPException(status_code=400, detail="Barcode already linked to another product")
    sale = data.sale_rate if data.sale_rate is not None else float(data.mrp)
    obj = ProductBarcode(
        product_id=product_id,
        barcode=barcode,
        sale_rate=sale,
        ws_rate=data.ws_rate,
        mrp=float(data.mrp),
        kind="own",
        is_active=True,
    )
    session.add(obj)
    await session.flush()
    return _barcode_out(obj)

@router.patch("/barcodes/{barcode_id}", response_model=ProductBarcodeOut)

async def update_product_barcode(
    barcode_id: str,
    data: ProductBarcodeUpdate,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (
        await session.execute(select(ProductBarcode).where(ProductBarcode.id == barcode_id))
    ).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        if k == "barcode" and v is not None:
            v = str(v).strip()
        setattr(obj, k, v)
    await session.flush()
    return _barcode_out(obj)

@router.delete("/barcodes/{barcode_id}", response_model=MessageResponse)

async def delete_product_barcode(
    barcode_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = (
        await session.execute(select(ProductBarcode).where(ProductBarcode.id == barcode_id))
    ).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    obj.is_active = False
    await session.flush()
    return MessageResponse(message="Barcode deactivated")
