"""Platform designed-document rendering (all products).

Any product — including ones added later — should load a Print Master layout and
render through this helper (or ``erp_core.printing.renderer`` directly) so:

- per-PC printers stay in ``config/print.ini`` (see ``erp_core.printing.local``)
- saved bill designs paint absolute field boxes (``.hms-sheet``)
- built-in HTML templates are only a fallback when no design exists
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.printing.layouts import apply_shared_pages, collect_shared_pages, resolve_format
from erp_core.printing.page_size_stamp import (
    lock_designer_orientation,
    resolve_print_format,
    resolve_print_page_mm,
    stamp_page_size_attrs,
)
from erp_core.printing.renderer import render_document_html
from erp_core.schemas.print_configs import PrintConfigRead
from erp_core.services.print_configs import PrintConfigService


async def load_designed_layout(
    session: AsyncSession,
    code: str,
) -> tuple[dict[str, Any] | None, str, PrintConfigRead | None]:
    """Return ``(layout_or_none, paper_format, config_or_none)`` for ``code``."""
    service = PrintConfigService(session)
    try:
        cfg = await service.get_config_by_code(code)
    except HTTPException:
        return None, "A4", None
    layout = cfg.layout_options if isinstance(cfg.layout_options, dict) else None
    if not layout or not layout.get("designed"):
        return None, (cfg.paper_size or "A4"), cfg
    paper = resolve_print_format(cfg, layout)
    return layout, resolve_format(layout, paper), cfg


async def render_designed_or_fallback(
    session: AsyncSession,
    *,
    code: str,
    context: dict[str, Any],
    fallback_html: str | Callable[[], str] | Callable[[], Awaitable[str]],
) -> str:
    """Render a designed Print Master layout, or the product's built-in HTML.

    Designed output is returned as-is (no legacy page-shell wrap). Page size from
    Print Master / the designer is stamped on the HTML for preview and direct print.
    """
    layout, paper, cfg = await load_designed_layout(session, code)
    if layout:
        service = PrintConfigService(session)
        saved = await service.designed_layout_entries()
        layout = apply_shared_pages(layout, collect_shared_pages(saved)) or layout
        layout = lock_designer_orientation(
            layout,
            paper,
            getattr(cfg, "orientation", None) if cfg is not None else None,
        )
        html = render_document_html(
            code=code,
            context=context,
            layout_raw=layout,
            bill_format=paper,
        )
    else:
        if callable(fallback_html):
            result = fallback_html()
            if hasattr(result, "__await__"):
                html = await result  # type: ignore[misc]
            else:
                html = result  # type: ignore[assignment]
        else:
            html = fallback_html

    if cfg is not None:
        saved_layout = layout if isinstance(layout, dict) else cfg.layout_options
        width, height, orientation = resolve_print_page_mm(cfg, saved_layout)
        html = stamp_page_size_attrs(
            html,
            width_mm=width,
            height_mm=height,
            orientation=orientation,
            paper=resolve_print_format(cfg, saved_layout if isinstance(saved_layout, dict) else None),
            code=code,
        )
    return html
