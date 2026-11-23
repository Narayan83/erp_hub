"""Per-PC printer names stored in config/print.ini (this machine only).

Printer discovery and direct print live in ``erp_core.printing.local`` so every
product (including Hospital EXE builds) can use them. This module keeps GenERP's
INI path + barcode/format helpers and re-exports the shared print helpers.
"""

from __future__ import annotations

import configparser
import os
from pathlib import Path

from modules.generp.ge.generp_env import resolve_app_root
from modules.generp.ge.reports.bill_formats import DEFAULT_BILL_FORMAT, normalize_bill_format

# Shared Windows printer list + direct print (no GenERP packaging dependency).
from erp_core.printing.local import (  # noqa: F401
    _is_file_printer,
    _page_size_from_html,
    _pdf_filename,
    _prepare_print_html,
    _resolve_printer_name,
    _screenshot_window_px,
    _slip_width_mm,
    jpeg_slip_pdf,
    list_installed_printers,
    print_html_document,
)

_SECTION_PRINTERS = "printers"
_SECTION_FORMATS = "formats"
_SECTION_ORIENTATIONS = "orientations"
_SECTION_META = "meta"


class _IniParser(configparser.ConfigParser):
    def optionxform(self, optionstr: str) -> str:
        return optionstr


def _new_parser() -> _IniParser:
    return _IniParser()


def print_ini_path() -> Path:
    explicit = os.environ.get("GENERP_PRINT_INI", "").strip()
    if explicit:
        return Path(explicit)
    root = resolve_app_root()
    if root is not None:
        return root / "config" / "print.ini"
    # Dev: repo root / config / print.ini
    return Path(__file__).resolve().parents[3] / "config" / "print.ini"


def _default_ini_text() -> str:
    return "\n".join(
        [
            "; GenERP — print settings for THIS PC only.",
            "; Printer names must match Windows Settings → Printers exactly.",
            "; Leave a printer blank to use the Windows default printer.",
            "; [formats] stores the bill layout for this PC (A4 / A5 / Thermal).",
            "; [orientations] stores Portrait / Landscape for this PC.",
            "",
            f"[{_SECTION_PRINTERS}]",
            "",
            f"[{_SECTION_FORMATS}]",
            "",
            f"[{_SECTION_ORIENTATIONS}]",
            "",
            f"[{_SECTION_META}]",
            "version = 1",
            "",
        ]
    )


def _write_ini(path: Path, parser: _IniParser) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        parser.write(handle)


def _read_or_create_parser(path: Path) -> _IniParser:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.is_file():
        path.write_text(_default_ini_text(), encoding="utf-8")
    parser = _new_parser()
    parser.read(path, encoding="utf-8")
    if _SECTION_PRINTERS not in parser:
        parser[_SECTION_PRINTERS] = {}
    if _SECTION_FORMATS not in parser:
        parser[_SECTION_FORMATS] = {}
    if _SECTION_ORIENTATIONS not in parser:
        parser[_SECTION_ORIENTATIONS] = {}
    if _SECTION_META not in parser:
        parser[_SECTION_META] = {"version": "1"}
    return parser


def sync_print_ini_codes(report_codes: list[str]) -> Path:
    path = print_ini_path()
    parser = _read_or_create_parser(path)
    section = parser[_SECTION_PRINTERS]
    existing_upper = {key.upper() for key in section}
    changed = False
    for raw in report_codes:
        code = (raw or "").strip().upper()
        if not code or code in existing_upper:
            continue
        section[code] = ""
        existing_upper.add(code)
        changed = True
    if changed:
        _write_ini(path, parser)
    return path


def _section_value(section: configparser.SectionProxy, code: str) -> str:
    if code in section:
        return str(section[code])
    upper = code.upper()
    for key, value in section.items():
        if key.upper() == upper:
            return str(value)
    return ""


def _has_section_key(section: configparser.SectionProxy, code: str) -> bool:
    upper = code.upper()
    return any(key.upper() == upper for key in section)


def get_report_printer(report_code: str) -> str | None:
    code = report_code.strip().upper()
    parser = _read_or_create_parser(print_ini_path())
    if _SECTION_PRINTERS not in parser:
        return None
    value = _section_value(parser[_SECTION_PRINTERS], code).strip()
    return value or None


BARCODE_LAYOUT_IDS = ("DOUBLE", "SINGLE", "MINI", "CUSTOM")


def get_barcode_layout_printers() -> dict[str, str | None]:
    """Per-sticker-size printers for this PC. Unset layouts fall back to BARCODE_LABEL."""
    fallback = get_report_printer("BARCODE_LABEL")
    parser = _read_or_create_parser(print_ini_path())
    section = parser[_SECTION_PRINTERS] if _SECTION_PRINTERS in parser else None
    out: dict[str, str | None] = {}
    for layout in BARCODE_LAYOUT_IDS:
        code = f"BARCODE_LABEL_{layout}"
        if section is not None and _has_section_key(section, code):
            value = _section_value(section, code).strip()
            out[layout] = value or None
        else:
            out[layout] = fallback
    return out


def _set_section_value(section: configparser.SectionProxy, code: str, value: str) -> None:
    target_key = code
    for key in list(section):
        if key.upper() == code:
            target_key = key
            break
    if target_key not in section and code not in section:
        section[code] = ""
        target_key = code
    section[target_key] = value


def get_report_format(report_code: str) -> str:
    code = report_code.strip().upper()
    parser = _read_or_create_parser(print_ini_path())
    if _SECTION_FORMATS not in parser:
        return DEFAULT_BILL_FORMAT
    value = _section_value(parser[_SECTION_FORMATS], code).strip()
    return normalize_bill_format(value) if value else DEFAULT_BILL_FORMAT


def set_report_format(report_code: str, bill_format: str | None) -> Path:
    code = report_code.strip().upper()
    path = print_ini_path()
    parser = _read_or_create_parser(path)
    if _SECTION_FORMATS not in parser:
        parser[_SECTION_FORMATS] = {}
    _set_section_value(parser[_SECTION_FORMATS], code, normalize_bill_format(bill_format))
    _write_ini(path, parser)
    return path


def set_report_printer(report_code: str, printer_name: str | None) -> Path:
    code = report_code.strip().upper()
    path = print_ini_path()
    parser = _read_or_create_parser(path)
    section = parser[_SECTION_PRINTERS]
    _set_section_value(section, code, (printer_name or "").strip())
    _write_ini(path, parser)
    return path


def _normalize_orientation(value: str | None) -> str:
    raw = (value or "").strip().upper()
    if raw in {"LANDSCAPE", "LANDSCAPE_LEFT", "LANDSCAPE_RIGHT"}:
        return "LANDSCAPE"
    return "PORTRAIT"


def get_report_orientation(report_code: str) -> str | None:
    code = report_code.strip().upper()
    parser = _read_or_create_parser(print_ini_path())
    if _SECTION_ORIENTATIONS not in parser:
        return None
    value = _section_value(parser[_SECTION_ORIENTATIONS], code).strip()
    return _normalize_orientation(value) if value else None


def set_report_orientation(report_code: str, orientation: str | None) -> Path:
    code = report_code.strip().upper()
    path = print_ini_path()
    parser = _read_or_create_parser(path)
    if _SECTION_ORIENTATIONS not in parser:
        parser[_SECTION_ORIENTATIONS] = {}
    _set_section_value(
        parser[_SECTION_ORIENTATIONS],
        code,
        _normalize_orientation(orientation) if orientation else "",
    )
    _write_ini(path, parser)
    return path


def migrate_db_printer(report_code: str, db_printer: str | None) -> None:
    if not db_printer:
        return
    if get_report_printer(report_code):
        return
    set_report_printer(report_code, db_printer)
