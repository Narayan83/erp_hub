"""Print configs + bill/print layout designer API (shared by all products).

Layout routes (`/layouts/...`) are registered BEFORE `/{config_id}` so FastAPI does not
treat "layouts" as a config id.
"""

from __future__ import annotations

from copy import deepcopy

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from erp_core.api.deps import get_current_user, get_session
from erp_core.models.auth import User
from erp_core.models.masters import PrintConfig
from erp_core.printing.layouts import (
    STANDARD_PAGES,
    apply_shared_pages,
    catalog_payload,
    collect_shared_pages,
    custom_pages_of,
    default_document_layout,
    normalize_layout,
    paper_mm,
    resolve_format,
    sample_context,
    single_service_option_id_from_layout_code,
)
from erp_core.printing.renderer import render_document_html
from erp_core.repositories.print_configs import PrintConfigRepository
from erp_core.schemas.print_configs import (
    LayoutPreviewIn,
    LayoutSaveIn,
    PrintConfigCreate,
    PrintConfigRead,
    PrintConfigUpdate,
)
from erp_core.services.print_configs import PrintConfigService

router = APIRouter()


async def _resolve_document(session: AsyncSession, code: str) -> tuple[str, str]:
    """Return the print-config code and the name shown in the designer for this product."""
    resolved = await PrintConfigService(session).resolve_document(code)
    if resolved is not None:
        return resolved
    raise HTTPException(status_code=404, detail="No template for this document")


async def _config_for_document(
    session: AsyncSession,
    code: str,
    *,
    name: str,
    create: bool,
) -> PrintConfig | None:
    repo = PrintConfigRepository(session)
    obj = await repo.get_by_code(code)
    if obj or not create:
        if obj is not None and create and not obj.is_active:
            obj.is_active = True
        # Keep Print Master names for fixed documents. Option templates follow the option name.
        if (
            obj is not None
            and create
            and name
            and obj.name != name
            and single_service_option_id_from_layout_code(code)
        ):
            obj.name = name
        return obj
    width, height = paper_mm(None, "A4")
    obj = PrintConfig(
        product=repo.product,
        code=code,
        name=name,
        paper_size="A4",
        custom_width_mm=width,
        custom_height_mm=height,
        orientation="portrait",
        print_mode="preview",
        is_active=True,
        sort_order=50,
    )
    session.add(obj)
    await session.flush()
    return obj


# ── Layout designer routes (must stay above /{config_id}) ─────────────────────


@router.get("/layouts/catalog")
async def print_layout_catalog(
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    service = PrintConfigService(session)
    documents = await service.product_documents()
    saved = await service.designed_layout_entries()
    payload = catalog_payload(documents=documents)
    payload["shared_pages"] = collect_shared_pages(saved)
    return payload


@router.get("/layouts/by-code/{code}")
async def get_print_layout(
    code: str,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    code_u, name = await _resolve_document(session, code)
    obj = await _config_for_document(session, code_u, name=name, create=False)
    raw = obj.layout_options if obj else None
    if isinstance(raw, dict):
        saved = await PrintConfigService(session).designed_layout_entries()
        raw = apply_shared_pages(raw, collect_shared_pages(saved))
    layout = normalize_layout(code_u, raw)
    paper = obj.paper_size if obj else "A4"
    # Surface the designer page key (incl. CUSTOM_*) so the UI can reselect it.
    active = resolve_format(layout, (layout.get("active_format") if layout else None) or paper)
    return {
        "id": obj.id if obj else None,
        "code": code_u,
        "name": name,
        "paper_size": active if active.startswith("CUSTOM_") else paper,
        "custom_width_mm": obj.custom_width_mm if obj else None,
        "custom_height_mm": obj.custom_height_mm if obj else None,
        "orientation": (
            obj.orientation
            if obj
            else ((layout.get("page") or {}).get(active) or {}).get("orientation") or "portrait"
        ),
        "layout": layout,
    }


@router.put("/layouts/by-code/{code}")
async def save_print_layout(
    code: str,
    data: LayoutSaveIn,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    code_u, name = await _resolve_document(session, code)
    obj = await _config_for_document(session, code_u, name=name, create=True)
    assert obj is not None
    layout = normalize_layout(code_u, data.layout)
    layout["designed"] = True
    paper = (data.paper_size or "").strip().upper()
    pages = custom_pages_of(layout)
    if paper in STANDARD_PAGES or paper in pages or paper == "CUSTOM":
        if paper in pages:
            page = pages[paper]
            obj.paper_size = "CUSTOM"
            obj.custom_width_mm = page["width_mm"]
            obj.custom_height_mm = page["height_mm"]
            layout["active_format"] = paper
        elif paper == "CUSTOM" and data.custom_width_mm and data.custom_height_mm:
            obj.paper_size = "CUSTOM"
            obj.custom_width_mm = data.custom_width_mm
            obj.custom_height_mm = data.custom_height_mm
            # Keep whatever custom page matches these dimensions, else first custom page.
            match = next(
                (
                    page_code
                    for page_code, page in pages.items()
                    if abs(float(page["width_mm"]) - float(data.custom_width_mm)) < 0.6
                    and abs(float(page["height_mm"]) - float(data.custom_height_mm)) < 0.6
                ),
                next(iter(pages), "A4") if pages else "A4",
            )
            layout["active_format"] = match
        elif paper in STANDARD_PAGES:
            obj.paper_size = paper
            obj.custom_width_mm = None
            obj.custom_height_mm = None
            layout["active_format"] = paper
    else:
        layout["active_format"] = resolve_format(layout, paper or layout.get("active_format") or "A4")
    if data.orientation in {"portrait", "landscape"}:
        obj.orientation = data.orientation
        fmt = resolve_format(layout, layout.get("active_format") or paper or obj.paper_size)
        page = dict(layout.get("page") or {})
        current = dict(page.get(fmt) or {})
        current["orientation"] = data.orientation
        page[fmt] = current
        layout["page"] = page
    # Deep copy + flag_modified: JSONB in-place edits were not always written.
    obj.layout_options = deepcopy(layout)
    flag_modified(obj, "layout_options")
    await session.flush()
    return {
        "id": obj.id,
        "code": code_u,
        "name": name,
        "layout": layout,
        "paper_size": obj.paper_size,
        "custom_width_mm": obj.custom_width_mm,
        "custom_height_mm": obj.custom_height_mm,
        "orientation": obj.orientation,
    }


@router.post("/layouts/by-code/{code}/reset")
async def reset_print_layout(
    code: str,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    code_u, name = await _resolve_document(session, code)
    obj = await _config_for_document(session, code_u, name=name, create=True)
    assert obj is not None
    layout = default_document_layout(code_u)
    obj.layout_options = layout
    flag_modified(obj, "layout_options")
    await session.flush()
    return {"id": obj.id, "code": code_u, "layout": layout}


@router.post("/layouts/preview")
async def preview_print_layout(
    data: LayoutPreviewIn,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    code_u, name = await _resolve_document(session, data.code)
    layout = normalize_layout(code_u, data.layout)
    context = sample_context(code_u, title=name)
    html = render_document_html(
        code=code_u,
        context=context,
        layout_raw=layout,
        bill_format=data.bill_format,
    )
    return {"html": html}


# ── Print config CRUD ─────────────────────────────────────────────────────────


@router.get("", response_model=list[PrintConfigRead])
async def list_print_configs(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await PrintConfigService(session).list_configs()


class _PdfJobIn(BaseModel):
    html: str
    title: str = "Document"


@router.post("/pdf")
async def download_pdf(data: _PdfJobIn, _u: User = Depends(get_current_user)):
    """PDF of the exact HTML shown in the print preview, for every product."""
    from io import BytesIO

    html = (data.html or "").strip()
    if not html:
        raise HTTPException(status_code=400, detail="HTML content required")
    try:
        from xhtml2pdf import pisa
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="PDF generation is unavailable") from exc
    buffer = BytesIO()
    result = pisa.CreatePDF(html, dest=buffer, encoding="utf-8")
    if result.err:
        raise HTTPException(status_code=400, detail="PDF generation failed")
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in (data.title or "Document"))[:60] or "Document"
    return Response(
        content=buffer.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe}.pdf"'},
    )


class _PrintJobIn(BaseModel):
    html: str
    printer_name: str | None = None
    copies: int = Field(default=1, ge=1, le=10)
    bill_format: str | None = None
    orientation: str | None = None


@router.get("/printers")
async def list_printers(_u: User = Depends(get_current_user)):
    """Printers installed on THIS computer (the machine running the backend)."""
    from erp_core.printing.local import list_installed_printers

    return list_installed_printers()


@router.post("/print")
async def print_document(data: _PrintJobIn, _u: User = Depends(get_current_user)):
    """Send report HTML to a selected Windows printer at the page size stamped on the HTML."""
    from erp_core.printing.local import print_html_document

    try:
        return print_html_document(
            data.html,
            data.printer_name,
            data.copies,
            data.bill_format,
            data.orientation,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/by-code/{code}", response_model=PrintConfigRead)
async def get_print_config_by_code(
    code: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await PrintConfigService(session).get_config_by_code(code)


@router.get("/{config_id}", response_model=PrintConfigRead)
async def get_print_config(
    config_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await PrintConfigService(session).get_config(config_id)


@router.post("", response_model=PrintConfigRead, status_code=201)
async def create_print_config(
    data: PrintConfigCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await PrintConfigService(session).create_config(data)


@router.patch("/{config_id}", response_model=PrintConfigRead)
async def update_print_config(
    config_id: str,
    data: PrintConfigUpdate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await PrintConfigService(session).update_config(config_id, data)


@router.delete("/{config_id}", response_model=PrintConfigRead)
async def delete_print_config(
    config_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await PrintConfigService(session).delete_config(config_id)
