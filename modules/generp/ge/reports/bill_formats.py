"""Bill / report print layouts. Selection is per PC (print.ini), not shared in DB."""

from __future__ import annotations

from typing import Any

DEFAULT_BILL_FORMAT = "A4"

BILL_FORMATS: tuple[tuple[str, str], ...] = (
    ("A4", "A4 Standard"),
    ("A5", "A5"),
    ("THERMAL_80", "Thermal 80mm"),
    ("THERMAL_58", "Thermal 58mm"),
)

_ALLOWED = {code for code, _label in BILL_FORMATS}

_ALIASES = {
    "STANDARD": "A4",
    "NORMAL": "A4",
    "LETTER": "A4",
    "THERMAL": "THERMAL_80",
    "80MM": "THERMAL_80",
    "58MM": "THERMAL_58",
    "3INCH": "THERMAL_80",
    "4INCH": "THERMAL_80",
}

_WIDTH_MM = {
    "A4": 210.0,
    "A5": 210.0,
    "THERMAL_80": 80.0,
    "THERMAL_58": 58.0,
}

_HEIGHT_MM = {
    "A4": 297.0,
    "A5": 148.0,
}


def normalize_bill_format(value: str | None) -> str:
    raw = (value or "").strip().upper().replace("-", "_").replace(" ", "")
    raw = _ALIASES.get(raw, raw)
    if raw in _ALLOWED:
        return raw
    if raw.startswith("CUSTOM_") and len(raw) > 7:
        return raw
    return DEFAULT_BILL_FORMAT


def is_thermal(value: str | None) -> bool:
    raw = (value or "").strip().upper().replace("-", "_").replace(" ", "")
    raw = _ALIASES.get(raw, raw)
    return raw.startswith("THERMAL_")


def paper_width_mm(value: str | None) -> float:
    fmt = normalize_bill_format(value)
    return _WIDTH_MM.get(fmt, _WIDTH_MM[DEFAULT_BILL_FORMAT])


def paper_height_mm(value: str | None) -> float | None:
    fmt = normalize_bill_format(value)
    if fmt.startswith("CUSTOM_"):
        return None
    return _HEIGHT_MM.get(fmt)


def normalize_orientation(value: str | None) -> str:
    raw = (value or "").strip().lower()
    return "landscape" if raw == "landscape" else "portrait"


def oriented_paper_mm(
    value: str | None,
    orientation: str | None = None,
    size: tuple[float, float] | None = None,
) -> tuple[float, float]:
    """Width × height in millimetres after applying portrait / landscape."""
    if size is not None:
        width, height = float(size[0]), float(size[1])
    else:
        fmt = normalize_bill_format(value)
        width = paper_width_mm(fmt)
        height = paper_height_mm(fmt)
        if height is None:
            height = round(width * 1.414, 1)
    if normalize_orientation(orientation) == "landscape" and not is_thermal(value):
        return height, width
    return width, height


def format_label(value: str | None) -> str:
    fmt = normalize_bill_format(value)
    for code, label in BILL_FORMATS:
        if code == fmt:
            return label
    return fmt


def resolve_bill_format(*candidates: str | None) -> str:
    for raw in candidates:
        if raw and str(raw).strip():
            return normalize_bill_format(raw)
    return DEFAULT_BILL_FORMAT


def formats_payload() -> list[dict[str, Any]]:
    return [
        {
            "code": code,
            "name": label,
            "thermal": is_thermal(code),
            "width_mm": paper_width_mm(code),
            "height_mm": paper_height_mm(code),
        }
        for code, label in BILL_FORMATS
    ]
