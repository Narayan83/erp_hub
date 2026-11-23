from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.product_config import get_product_name
from erp_core.schemas.print_configs import LayoutPreviewIn, LayoutSaveIn
from modules.generp.ge.api.deps import get_current_user, require_print_layout_editor, get_session, user_is_super_admin
from modules.generp.ge.models.auth import User
from modules.generp.ge.models.masters import CompanyProfile, PrintConfig
from modules.generp.ge.reports.bill_context import apply_bill_format, company_header_context
from modules.generp.ge.reports.bill_formats import formats_payload, normalize_bill_format
from modules.generp.ge.reports.layout_render import render_document_html
from modules.generp.ge.reports.print_layouts import (
    DOCUMENT_KINDS,
    KIND_BARCODE,
    KIND_BILL,
    catalog_payload,
    custom_pages_of,
    default_document_layout,
    fit_layout_to_page,
    normalize_layout,
    printable_inner_mm,
    resolve_layout_format,
    sample_bill_context,
    sample_report_context,
    set_layout_orientation,
)
from modules.generp.ge.schemas.masters import PrintConfigOut, PrintConfigUpdate
from modules.generp.ge.services.print_local import (
    BARCODE_LAYOUT_IDS,
    get_barcode_layout_printers,
    get_report_format,
    get_report_orientation,
    get_report_printer,
    list_installed_printers,
    migrate_db_printer,
    print_html_document,
    set_report_format,
    set_report_orientation,
    set_report_printer,
    sync_print_ini_codes,
)

router = APIRouter()


class PrintLayoutBody(BaseModel):
    layout: dict = Field(default_factory=dict)


class PrintLayoutPreviewBody(BaseModel):
    code: str
    bill_format: str | None = None
    layout: dict | None = None


class PrintLayoutPageBody(BaseModel):
    bill_format: str | None = None
    orientation: str = "portrait"


def _to_out(obj: PrintConfig) -> PrintConfigOut:
    data = PrintConfigOut.model_validate(obj)
    return data.model_copy(update={"printer_name": None})


class PrintJobIn(BaseModel):
    html: str
    printer_name: str | None = None
    copies: int = 1
    bill_format: str | None = None
    orientation: str | None = None


class BarcodePrinterIn(BaseModel):
    printer_name: str | None = None


@router.get("/printers")
async def list_printers(_u=Depends(get_current_user)):
    """Printers installed on THIS computer (the machine running the backend)."""
    return list_installed_printers()


@router.get("/barcode-printers")
async def barcode_printers(_u=Depends(get_current_user)):
    """Default printer per barcode sticker size, stored on this PC."""
    return get_barcode_layout_printers()


@router.put("/barcode-printers/{layout_id}")
async def save_barcode_printer(
    layout_id: str,
    data: BarcodePrinterIn,
    _u=Depends(get_current_user),
):
    layout = layout_id.strip().upper()
    if layout not in BARCODE_LAYOUT_IDS:
        raise HTTPException(status_code=400, detail="Unknown barcode layout")
    set_report_printer(f"BARCODE_LABEL_{layout}", data.printer_name)
    return {"layout": layout, "printer_name": get_report_printer(f"BARCODE_LABEL_{layout}")}


@router.post("/print")
async def print_now(data: PrintJobIn, _u=Depends(get_current_user)):
    """Send bill HTML to a Windows printer, or save a slip-sized PDF, without the browser print dialog."""
    try:
        return print_html_document(
            data.html, data.printer_name, data.copies, data.bill_format, data.orientation
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/formats")
async def list_bill_formats(
    code: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Layouts available on bill/report screens (A4, A5, thermal, plus custom pages)."""
    formats = formats_payload()
    code_u = (code or "").strip().upper()
    if code_u in DOCUMENT_KINDS:
        obj = (
            await session.execute(
                select(PrintConfig).where(
                    PrintConfig.product == get_product_name(),
                    PrintConfig.code == code_u,
                )
            )
        ).scalar_one_or_none()
        layout = normalize_layout(code_u, obj.layout_options if obj else None)
        for fmt_code, page in custom_pages_of(layout).items():
            formats.append(
                {
                    "code": fmt_code,
                    "name": page["name"],
                    "thermal": False,
                    "width_mm": page["widthMm"],
                    "height_mm": page["heightMm"],
                    "custom": True,
                }
            )
    return {"formats": formats}


@router.get("/layouts/catalog")
async def print_layout_catalog(
    user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Same catalog as the core designer: this product's menus and fields."""
    from erp_core.api.endpoints.print_configs import print_layout_catalog as core_catalog

    return await core_catalog(user, session)


@router.get("/layouts/by-code/{code}")
async def get_print_layout(
    code: str,
    user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    from erp_core.api.endpoints.print_configs import get_print_layout as core_get

    return await core_get(code, user, session)


@router.put("/layouts/by-code/{code}")
async def save_print_layout(
    code: str,
    data: LayoutSaveIn,
    user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    from erp_core.api.endpoints.print_configs import save_print_layout as core_save

    return await core_save(code, data, user, session)


@router.patch("/layouts/by-code/{code}/page")
async def save_print_layout_page(
    code: str,
    data: PrintLayoutPageBody,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Save paper orientation on the shared template and stretch fields to the new page."""
    code_u = code.upper()
    if code_u not in DOCUMENT_KINDS:
        raise HTTPException(status_code=404, detail="No template for this document")
    obj = (
        await session.execute(
            select(PrintConfig).where(
                PrintConfig.product == get_product_name(),
                PrintConfig.code == code_u,
            )
        )
    ).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Print config not found")
    layout = normalize_layout(code_u, obj.layout_options)
    fmt = resolve_layout_format(layout, data.bill_format)
    from_inner = printable_inner_mm(layout, fmt)
    layout = set_layout_orientation(layout, fmt, data.orientation)
    layout = fit_layout_to_page(layout, fmt, from_inner)
    layout = normalize_layout(code_u, layout)
    obj.layout_options = layout
    await session.flush()
    return {"id": obj.id, "code": code_u, "kind": DOCUMENT_KINDS[code_u], "layout": layout}


@router.post("/layouts/by-code/{code}/reset")
async def reset_print_layout(
    code: str,
    user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    from erp_core.api.endpoints.print_configs import reset_print_layout as core_reset

    return await core_reset(code, user, session)


@router.post("/layouts/preview")
async def preview_print_layout(
    data: LayoutPreviewIn,
    user=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    from erp_core.api.endpoints.print_configs import preview_print_layout as core_preview

    return await core_preview(data, user, session)


@router.get("", response_model=list[PrintConfigOut])
async def list_configs(_u=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(PrintConfig)
        .where(
            PrintConfig.product == get_product_name(),
            PrintConfig.is_active.is_(True),
        )
        .order_by(PrintConfig.sort_order)
    )
    rows = list(result.scalars().all())
    return [_to_out(r) for r in rows]


@router.get("/by-code/{code}", response_model=PrintConfigOut)
async def get_by_code(code: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    obj = (
        await session.execute(
            select(PrintConfig).where(
                PrintConfig.product == get_product_name(),
                PrintConfig.code == code.upper(),
            )
        )
    ).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return _to_out(obj)


@router.patch("/{config_id}", response_model=PrintConfigOut)
async def update_config(
    config_id: str,
    data: PrintConfigUpdate,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (
        await session.execute(
            select(PrintConfig).where(
                PrintConfig.product == get_product_name(),
                PrintConfig.id == config_id,
            )
        )
    ).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    payload = data.model_dump(exclude_unset=True)
    payload.pop("printer_name", None)
    payload.pop("bill_format", None)
    if "layout_options" in payload and not user_is_super_admin(_u):
        # Same gate as the dedicated layout APIs (Super Admin / designer permission).
        await require_print_layout_editor(_u, session)
    if "layout_options" in payload and payload["layout_options"] is not None:
        payload["layout_options"] = normalize_layout(obj.code, payload["layout_options"])
    for k, v in payload.items():
        setattr(obj, k, v)
    obj.printer_name = None
    await session.flush()
    return _to_out(obj)
