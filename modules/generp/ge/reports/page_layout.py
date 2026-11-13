"""Normalize report HTML so tables and headers use the full printable page width."""

from __future__ import annotations

import re

from modules.generp.ge.reports.bill_formats import is_thermal, normalize_bill_format, oriented_paper_mm, paper_width_mm

_PAGE_SHELL_MARKER = 'class="page-shell"'


def _default_page_margin(bill_format: str | None) -> str:
    fmt = normalize_bill_format(bill_format)
    if is_thermal(fmt):
        return "2mm"
    if fmt == "A5":
        return "6mm"
    return "8mm"


def _page_layout_styles(
    *,
    bill_format: str | None = None,
    page_margin: str | None = None,
    orientation: str | None = None,
    paper_mm: tuple[float, float] | None = None,
) -> str:
    margin = page_margin if page_margin is not None else _default_page_margin(bill_format)
    width_mm, height_mm = paper_mm if paper_mm is not None else oriented_paper_mm(bill_format, orientation)
    width = f"{width_mm:g}"
    height = f"{height_mm:g}"
    return f"""
<style id="generp-page-layout">
@page {{
  size: {width}mm {height}mm;
  margin: {margin};
}}
html, body {{
  margin: 0;
  padding: 0;
  width: {width}mm;
  max-width: {width}mm;
  min-height: {height}mm;
  height: auto;
  color: #000000;
  background: #fff;
  overflow-x: hidden;
}}
body {{
  font-family: "Times New Roman", Times, serif;
  color: #000000;
}}
.page-frame {{
  width: {width}mm;
  min-height: {height}mm;
  box-sizing: border-box;
}}
table.page-shell {{
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}}
table.page-shell > tbody > tr > td {{
  width: 100%;
  vertical-align: top;
  text-align: left;
}}
table {{
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}}
table.items-mm {{
  width: 100% !important;
  max-width: 100%;
  table-layout: fixed;
}}
table.items-mm td, table.items-mm th {{
  box-sizing: border-box;
  overflow: hidden;
}}
td, th, p, span {{
  color: #000000;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}}
.header-title, .header-sub, .header-meta {{
  text-align: center;
  width: 100%;
  color: #000000;
}}
</style>
"""


def _thermal_layout_styles(bill_format: str, page_margin: str | None = None) -> str:
    width = paper_width_mm(bill_format)
    margin = page_margin if page_margin is not None else "2mm"
    return f"""
<style id="generp-page-layout">
@page {{
  size: {width:.0f}mm auto;
  margin: {margin};
}}
@media print {{
  html, body {{
    width: {width:.0f}mm !important;
    max-width: {width:.0f}mm !important;
  }}
}}
html, body {{
  margin: 0;
  padding: 0;
  width: {width:.0f}mm;
  max-width: {width:.0f}mm;
  height: auto;
  color: #000000;
}}
table {{
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
}}
table.items-mm {{
  width: 100% !important;
  max-width: 100%;
  table-layout: fixed;
}}
table.items-mm td, table.items-mm th {{
  box-sizing: border-box;
  overflow: hidden;
}}
td, th, p {{
  color: #000000;
}}
</style>
"""


def _inject_layout_styles(
    html: str,
    *,
    bill_format: str | None = None,
    page_margin: str | None = None,
    orientation: str | None = None,
    paper_mm: tuple[float, float] | None = None,
) -> str:
    styles = (
        _thermal_layout_styles(bill_format, page_margin)
        if is_thermal(bill_format)
        else _page_layout_styles(
            bill_format=bill_format, page_margin=page_margin, orientation=orientation, paper_mm=paper_mm
        )
    )
    if "generp-page-layout" in html:
        html = re.sub(
            r'<style id="generp-page-layout">.*?</style>',
            styles.strip(),
            html,
            count=1,
            flags=re.DOTALL | re.IGNORECASE,
        )
        return html
    match = re.search(r"</head>", html, re.IGNORECASE)
    if not match:
        return styles + html
    return html[: match.start()] + styles + html[match.start() :]


def _wrap_body_content(html: str) -> str:
    if _PAGE_SHELL_MARKER in html:
        return html
    match = re.search(r"(<body[^>]*>)(.*?)(</body>)", html, re.DOTALL | re.IGNORECASE)
    if not match:
        return html
    inner = match.group(2).strip()
    wrapped = (
        f"{match.group(1)}"
        f'<table {_PAGE_SHELL_MARKER} width="100%" border="0" cellspacing="0" cellpadding="0">'
        f'<tr><td width="100%" style="width:100%;">'
        f"{inner}"
        f"</td></tr></table>"
        f"{match.group(3)}"
    )
    return html[: match.start()] + wrapped + html[match.end() :]


def _ensure_table_widths(html: str) -> str:
    def repl(match: re.Match[str]) -> str:
        tag = match.group(0)
        if re.search(r"\bwidth\s*=", tag, re.IGNORECASE):
            return tag
        if re.search(r"items-mm", tag, re.IGNORECASE):
            if re.search(r"\bwidth\s*=", tag, re.IGNORECASE) or re.search(
                r'style="[^"]*width\s*:', tag, re.IGNORECASE
            ):
                return tag
            return tag[:-1] + ' width="100%">'
        if re.search(r'style="[^"]*width\s*:', tag, re.IGNORECASE):
            return tag
        return tag[:-1] + ' width="100%">'

    return re.sub(r"<table\b[^>]*>", repl, html, flags=re.IGNORECASE)


def prepare_report_html(
    html: str,
    *,
    bill_format: str | None = None,
    page_margin: str | None = None,
    orientation: str | None = None,
    paper_mm: tuple[float, float] | None = None,
) -> str:
    prepared = _inject_layout_styles(
        html,
        bill_format=bill_format,
        page_margin=page_margin,
        orientation=orientation,
        paper_mm=paper_mm,
    )
    if is_thermal(bill_format):
        return prepared
    wrapped = _wrap_body_content(prepared)
    return _ensure_table_widths(wrapped)
