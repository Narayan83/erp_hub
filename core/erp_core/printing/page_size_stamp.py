"""Stamp printable page size onto report HTML for the desktop preview engine."""

from __future__ import annotations

import re
from typing import Any


def _template_orientation(layout: dict[str, Any] | None, fmt: str, fallback: str) -> str:
    """Use the orientation shown in Print Master. That is what the designer saves."""
    saved = str(fallback or "").lower()
    if saved in {"portrait", "landscape"}:
        return saved
    page_meta = ((layout or {}).get("page") or {}).get(fmt) or {}
    meta_orientation = str(page_meta.get("orientation") or "").lower()
    if meta_orientation in {"portrait", "landscape"}:
        return meta_orientation
    return "portrait"


def orient_page_mm(
    width: float, height: float, orientation: str, fmt: str = ""
) -> tuple[float, float, str]:
    """Match the designer sheet.

    A stock size such as A4 is stored tall. Landscape on that stock size is the
    wide sheet (297 × 210). A custom page already has the millimetres you typed,
    so those are not swapped again.
    """
    orientation = orientation if orientation in {"portrait", "landscape"} else "portrait"
    code = str(fmt or "").upper()
    if orientation == "landscape" and not code.startswith("CUSTOM"):
        return float(height), float(width), orientation
    return float(width), float(height), orientation


def lock_designer_orientation(layout: dict[str, Any] | None, fmt: str, saved: str | None) -> dict[str, Any] | None:
    """Write the designer's orientation onto the page that will be printed."""
    if not isinstance(layout, dict):
        return layout
    code = str(fmt or "").strip().upper()
    if not code or code == "CUSTOM":
        return layout
    orientation = _template_orientation(layout, code, str(saved or ""))
    updated = dict(layout)
    page = dict(updated.get("page") or {})
    meta = dict(page.get(code) or {})
    meta["orientation"] = orientation
    page[code] = meta
    updated["page"] = page
    return updated


def resolve_print_format(cfg: Any, layout: dict[str, Any] | None = None) -> str:
    """Page selected in the bill template. A leftover A4 label does not hide it."""
    from erp_core.printing.layouts import STANDARD_PAGES, custom_pages_of, resolve_format

    layout = layout if isinstance(layout, dict) else None
    active = str((layout or {}).get("active_format") or "").strip().upper()
    paper = str(getattr(cfg, "paper_size", None) or "").strip().upper()
    pages = custom_pages_of(layout)
    if active in pages:
        return active
    if paper in pages:
        return paper
    custom_w = getattr(cfg, "custom_width_mm", None)
    custom_h = getattr(cfg, "custom_height_mm", None)
    if custom_w and custom_h and (paper == "CUSTOM" or active in {"", "A4", "CUSTOM"}):
        try:
            width = float(custom_w)
            height = float(custom_h)
        except (TypeError, ValueError):
            width = height = 0
        if width >= 40 and height >= 40 and (
            abs(width - 210.0) > 1.0 or abs(height - 297.0) > 1.0
        ):
            for code, page in pages.items():
                if (
                    abs(float(page["width_mm"]) - width) < 0.6
                    and abs(float(page["height_mm"]) - height) < 0.6
                ):
                    return code
            return "CUSTOM"
    if active in STANDARD_PAGES and not (active == "A4" and paper == "CUSTOM"):
        return active
    if paper in STANDARD_PAGES:
        return paper
    return resolve_format(layout, active or paper or "A4")


def resolve_print_page_mm(cfg: Any, layout: dict[str, Any] | None = None) -> tuple[float, float, str]:
    """Return (width_mm, height_mm, orientation) from the template page, not a default A4."""
    from erp_core.printing.layouts import paper_mm

    orientation = str(getattr(cfg, "orientation", None) or "portrait").lower()
    if orientation not in {"portrait", "landscape"}:
        orientation = "portrait"
    layout = layout if isinstance(layout, dict) else None
    fmt = resolve_print_format(cfg, layout)
    if fmt == "CUSTOM":
        width = float(getattr(cfg, "custom_width_mm", None) or 0)
        height = float(getattr(cfg, "custom_height_mm", None) or 0)
    else:
        width, height = paper_mm(layout, fmt)
    orientation = _template_orientation(layout, fmt, orientation)
    return orient_page_mm(width, height, orientation, fmt)


def _page_margin_css(html: str) -> str:
    """Keep a margin already written on the bill. Otherwise use the 5mm default."""
    match = re.search(r"@page\s*\{[^}]*margin\s*:\s*([^;}]+)", html or "", re.IGNORECASE)
    if not match:
        return "5mm"
    margin = " ".join(match.group(1).split())
    if re.fullmatch(r"[0-9]+(?:\.[0-9]+)?mm(?:\s+[0-9]+(?:\.[0-9]+)?mm){0,3}", margin):
        return margin
    return "5mm"


def stamp_page_size_attrs(
    html: str,
    *,
    width_mm: float,
    height_mm: float,
    orientation: str = "portrait",
    paper: str | None = None,
    code: str | None = None,
) -> str:
    """Ensure body data-page-* and @page size exist so desktop preview uses exact mm."""
    if not html or width_mm < 40 or height_mm < 40:
        return html
    orientation = orientation if orientation in {"portrait", "landscape"} else "portrait"
    paper_code = re.sub(r"[^A-Za-z0-9_]", "", (paper or "").strip().upper())[:32]
    report_code = re.sub(r"[^A-Za-z0-9_]", "", (code or "").strip().upper())[:40]
    w = f"{width_mm:g}"
    h = f"{height_mm:g}"

    if re.search(r"data-page-w=", html, re.IGNORECASE):
        html = re.sub(
            r"data-page-w=['\"][^'\"]*['\"]",
            f"data-page-w='{w}'",
            html,
            count=1,
            flags=re.IGNORECASE,
        )
        html = re.sub(
            r"data-page-h=['\"][^'\"]*['\"]",
            f"data-page-h='{h}'",
            html,
            count=1,
            flags=re.IGNORECASE,
        )
        html = re.sub(
            r"data-page-orientation=['\"][^'\"]*['\"]",
            f"data-page-orientation='{orientation}'",
            html,
            count=1,
            flags=re.IGNORECASE,
        )
    else:
        html = re.sub(
            r"<body\b([^>]*)>",
            rf"<body\1 data-page-w='{w}' data-page-h='{h}' data-page-orientation='{orientation}'>",
            html,
            count=1,
            flags=re.IGNORECASE,
        )

    if report_code:
        if re.search(r"data-report-code=", html, re.IGNORECASE):
            html = re.sub(
                r"data-report-code=['\"][^'\"]*['\"]",
                f"data-report-code='{report_code}'",
                html,
                count=1,
                flags=re.IGNORECASE,
            )
        else:
            html = re.sub(
                r"<body\b",
                f"<body data-report-code='{report_code}'",
                html,
                count=1,
                flags=re.IGNORECASE,
            )

    if paper_code:
        if re.search(r"data-page-size=", html, re.IGNORECASE):
            html = re.sub(
                r"data-page-size=['\"][^'\"]*['\"]",
                f"data-page-size='{paper_code}'",
                html,
                count=1,
                flags=re.IGNORECASE,
            )
        else:
            html = re.sub(
                r"<body\b",
                f"<body data-page-size='{paper_code}'",
                html,
                count=1,
                flags=re.IGNORECASE,
            )

    page_rule = f"@page{{size:{w}mm {h}mm;margin:{_page_margin_css(html)};}}"
    if re.search(r"@page\s*\{[^}]*size\s*:", html, re.IGNORECASE):
        html = re.sub(
            r"@page\s*\{[^}]*\}",
            page_rule,
            html,
            count=1,
            flags=re.IGNORECASE,
        )
    elif re.search(r"</head>", html, re.IGNORECASE):
        html = re.sub(
            r"</head>",
            f"<style id='hms-page-size'>{page_rule}</style></head>",
            html,
            count=1,
            flags=re.IGNORECASE,
        )
    else:
        html = f"<style id='hms-page-size'>{page_rule}</style>" + html
    return html
