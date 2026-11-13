"""Per-PC printer names stored in config/print.ini (this machine only)."""

from __future__ import annotations

import configparser
import os
import re
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from modules.generp.ge.generp_env import resolve_app_root
from modules.generp.ge.reports.bill_formats import DEFAULT_BILL_FORMAT, normalize_bill_format

_SECTION_PRINTERS = "printers"
_SECTION_FORMATS = "formats"
_SECTION_ORIENTATIONS = "orientations"
_SECTION_META = "meta"
_CHROME_LOCK = threading.Lock()


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


def list_installed_printers() -> dict:
    """Windows printers on this machine. Empty list on other OS / if listing fails."""
    names: list[str] = []
    default_name: str | None = None
    if sys.platform == "win32":
        names, default_name = _windows_printers()
    printers = [{"name": n, "is_default": n == default_name} for n in names]
    return {"printers": printers, "default": default_name}


def _windows_printers() -> tuple[list[str], str | None]:
    try:
        import win32print  # type: ignore

        flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        rows = win32print.EnumPrinters(flags)
        names = [row[2] for row in rows if row[2]]
        default = win32print.GetDefaultPrinter() or None
        return names, default
    except Exception:
        pass
    try:
        cmd = (
            "Get-CimInstance Win32_Printer | "
            "Select-Object Name, Default | ConvertTo-Json -Compress"
        )
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", cmd],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if result.returncode != 0 or not (result.stdout or "").strip():
            return [], None
        import json

        data = json.loads(result.stdout)
        if isinstance(data, dict):
            data = [data]
        names: list[str] = []
        default: str | None = None
        for row in data or []:
            name = str(row.get("Name") or "").strip()
            if not name:
                continue
            names.append(name)
            if row.get("Default") is True:
                default = name
        return names, default
    except Exception:
        return [], None


def _find_chromium() -> str | None:
    env = os.environ.get("GENERP_CHROME") or os.environ.get("GENERP_EDGE")
    if env and Path(env).is_file():
        return env
    roots = [
        os.environ.get("PROGRAMFILES", ""),
        os.environ.get("PROGRAMFILES(X86)", ""),
        os.environ.get("LOCALAPPDATA", ""),
    ]
    rels = [
        r"Microsoft\Edge\Application\msedge.exe",
        r"Google\Chrome\Application\chrome.exe",
    ]
    for root in roots:
        if not root:
            continue
        for rel in rels:
            candidate = Path(root) / rel
            if candidate.is_file():
                return str(candidate)
    return None


def _is_file_printer(name: str) -> bool:
    """Print to PDF / XPS: the app writes a slip-sized PDF instead of using A4."""
    n = (name or "").lower()
    return "print to pdf" in n or "xps document" in n or n.endswith(" to pdf")


def _resolve_printer_name(
    requested: str | None,
    names: list[str],
    default_name: str | None,
) -> str:
    """Use the selected printer. Never silently switch to the Windows default."""
    wanted = (requested or "").strip()
    if wanted:
        for name in names:
            if name == wanted:
                return name
        wanted_l = wanted.lower()
        for name in names:
            if name.lower() == wanted_l:
                return name
        if not names:
            return wanted
        raise RuntimeError(
            f'Printer not found: {wanted}. Pick a printer from the list and try again.'
        )
    printer = (default_name or "").strip()
    if not printer:
        for name in names:
            if name:
                printer = name
                break
    if not printer:
        raise RuntimeError("No printer is installed. Install a printer, then try again.")
    return printer


def _printer_uses_file_port(name: str) -> bool:
    """True when Windows would prompt for a filename (Print to PDF, XPS, FILE:)."""
    if sys.platform != "win32" or not (name or "").strip():
        return False
    try:
        import win32print  # type: ignore

        handle = win32print.OpenPrinter(name)
        try:
            info = win32print.GetPrinter(handle, 2)
        finally:
            win32print.ClosePrinter(handle)
        port = str(info.get("pPortName") or "").upper()
        return port in {"PORTPROMPT:", "FILE:", "XPS:"} or "PDF" in port
    except Exception:
        return False


def _should_save_pdf(name: str) -> bool:
    return _is_file_printer(name) or _printer_uses_file_port(name)


def _page_size_from_html(html: str) -> tuple[float | None, float | None]:
    text = html or ""
    attr_w = re.search(r"data-page-w=['\"]([\d.]+)['\"]", text, re.IGNORECASE)
    attr_h = re.search(r"data-page-h=['\"]([\d.]+)['\"]", text, re.IGNORECASE)
    match = re.search(
        r"@page\s*\{[^}]*size:\s*([\d.]+)\s*mm(?:\s+([\d.]+)\s*mm)?",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    width = None
    height = None
    if attr_w:
        try:
            width = float(attr_w.group(1))
        except ValueError:
            width = None
    if attr_h:
        try:
            height = float(attr_h.group(1))
        except ValueError:
            height = None
    if match:
        if width is None:
            try:
                width = float(match.group(1))
            except ValueError:
                width = None
        if height is None and match.group(2):
            try:
                height = float(match.group(2))
            except ValueError:
                height = None
    return width, height


def _page_width_from_html(html: str) -> float | None:
    width, _height = _page_size_from_html(html)
    return width


def _is_barcode_html(html: str) -> bool:
    text = html or ""
    return 'data-generp-print="barcode"' in text or ('class="label"' in text and "@page" in text)


def _slip_width_mm(html: str, bill_format: str | None) -> float:
    page_w = _page_width_from_html(html or "")
    if page_w:
        return page_w
    raw = (bill_format or "").upper()
    if "58" in raw:
        return 58.0
    if "80" in raw or "THERMAL" in raw:
        return 80.0
    if "58mm" in (html or "") or "width: 58" in (html or ""):
        return 58.0
    if "thermal-slip" in (html or "") or "80mm" in (html or ""):
        return 80.0
    return 80.0 if "thermal-slip" in (html or "") else 210.0


def _screenshot_window_px(
    html: str, width_mm: float, height_mm: float | None = None
) -> tuple[int, int]:
    text = html or ""
    barcode = _is_barcode_html(text)
    page_w, page_h = _page_size_from_html(text)
    w_mm = page_w or width_mm
    h_mm = height_mm or page_h
    css_w = max(80 if barcode else 220, int(round(w_mm / 25.4 * 96)))
    if "thermal-slip" in text:
        return css_w, 1600
    if barcode and h_mm and h_mm > 0:
        css_h = max(1, int(round(h_mm / 25.4 * 96)))
        return css_w, css_h
    if 'class="label"' in text or 'class="row"' in text:
        rows = max(1, text.count('class="row"'))
        label_h = page_h or 25.4
        extra = 2 if barcode else 8
        total_h_mm = rows * label_h + extra
        css_h = max(120, min(12000, int(round(total_h_mm / 25.4 * 96)) + (8 if barcode else 80)))
        return css_w, css_h
    if h_mm and h_mm > 0:
        css_h = max(1, int(round(h_mm / 25.4 * 96)))
        return css_w, min(css_h, 4000)
    return css_w, 1600


def jpeg_slip_pdf(jpeg: bytes, width_px: int, height_px: int, width_mm: float) -> bytes:
    """Embed a JPEG on a page whose width is the slip (e.g. 80mm), height follows content."""
    w_px = max(1, int(width_px))
    h_px = max(1, int(height_px))
    w_pt = float(width_mm) / 25.4 * 72.0
    h_pt = (h_px / w_px) * w_pt
    content = f"q\n{w_pt:.2f} 0 0 {h_pt:.2f} 0 0 cm\n/Im0 Do\nQ\n".encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w_pt:.2f} {h_pt:.2f}] "
            f"/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"
        ).encode("ascii"),
        (
            f"<< /Type /XObject /Subtype /Image /Width {w_px} /Height {h_px} "
            f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode "
            f"/Length {len(jpeg)} >>\nstream\n"
        ).encode("ascii")
        + jpeg
        + b"\nendstream",
        f"<< /Length {len(content)} >>\nstream\n".encode("ascii") + content + b"endstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{index} 0 obj\n".encode("ascii"))
        out.extend(body)
        out.extend(b"\nendobj\n")
    xref_at = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    out.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        out.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    out.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_at}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(out)


def _pdf_filename(html: str) -> str:
    match = re.search(r"<title>([^<]+)</title>", html or "", re.IGNORECASE)
    raw = (match.group(1) if match else "bill").strip() or "bill"
    safe = re.sub(r"[^\w.\-]+", "_", raw).strip("._")[:60] or "bill"
    return f"{safe}.pdf"


def _downloads_dir() -> Path:
    home = Path.home()
    for candidate in (home / "Downloads", Path(os.environ.get("USERPROFILE") or home) / "Downloads"):
        if candidate.is_dir():
            return candidate
    return Path(tempfile.gettempdir())


def _unique_path(folder: Path, name: str) -> Path:
    dest = folder / name
    if not dest.exists():
        return dest
    stem, suffix = dest.stem, dest.suffix
    for i in range(2, 50):
        alt = folder / f"{stem}_{i}{suffix}"
        if not alt.exists():
            return alt
    return folder / f"{stem}_{os.getpid()}{suffix}"


_CROP_PS = r"""
param($PngPath, $OutPng, $OutJpg, $DimsPath)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile($PngPath)
$rect = New-Object System.Drawing.Rectangle 0, 0, $img.Width, $img.Height
$data = $img.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$stride = $data.Stride
$len = $stride * $img.Height
$bytes = New-Object byte[] $len
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $len)
$img.UnlockBits($data)
$minX = $img.Width; $maxX = 0; $minY = $img.Height; $maxY = 0
$found = $false
$w = $img.Width; $h = $img.Height
for ($y = 0; $y -lt $h; $y += 2) {
  $row = $y * $stride
  for ($x = 0; $x -lt $w; $x += 2) {
    $i = $row + $x * 3
    if ($bytes[$i] -lt 248 -or $bytes[$i+1] -lt 248 -or $bytes[$i+2] -lt 248) {
      $found = $true
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
if (-not $found) {
  $minX = 0; $minY = 0; $maxX = $w - 1; $maxY = $h - 1
}
$pad = 6
$x0 = [Math]::Max(0, $minX - $pad)
$y0 = [Math]::Max(0, $minY - $pad)
$x1 = [Math]::Min($w - 1, $maxX + $pad)
$y1 = [Math]::Min($h - 1, $maxY + $pad)
$cropRect = New-Object System.Drawing.Rectangle $x0, $y0, ($x1 - $x0 + 1), ($y1 - $y0 + 1)
$crop = $img.Clone($cropRect, $img.PixelFormat)
$img.Dispose()
$crop.Save($OutPng, [System.Drawing.Imaging.ImageFormat]::Png)
$rgb = New-Object System.Drawing.Bitmap $crop.Width, $crop.Height
$g = [System.Drawing.Graphics]::FromImage($rgb)
$g.Clear([System.Drawing.Color]::White)
$g.DrawImage($crop, 0, 0)
$g.Dispose()
$rgb.Save($OutJpg, [System.Drawing.Imaging.ImageFormat]::Jpeg)
"$($crop.Width) $($crop.Height)" | Set-Content -Path $DimsPath -Encoding ASCII
$rgb.Dispose()
$crop.Dispose()
"""


_NOCROP_PS = r"""
param($PngPath, $OutPng, $OutJpg, $DimsPath)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile($PngPath)
$img.Save($OutPng, [System.Drawing.Imaging.ImageFormat]::Png)
$rgb = New-Object System.Drawing.Bitmap $img.Width, $img.Height
$g = [System.Drawing.Graphics]::FromImage($rgb)
$g.Clear([System.Drawing.Color]::White)
$g.DrawImage($img, 0, 0)
$g.Dispose()
$rgb.Save($OutJpg, [System.Drawing.Imaging.ImageFormat]::Jpeg)
"$($img.Width) $($img.Height)" | Set-Content -Path $DimsPath -Encoding ASCII
$rgb.Dispose()
$img.Dispose()
"""


_PRINT_PS = r"""
param($PrinterFile, $PngPath, $WidthMm, $HeightMm, $Copies, $Landscape)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$Printer = (Get-Content -LiteralPath $PrinterFile -Raw -Encoding UTF8).Trim()
if (-not $Printer) { throw "Printer name is required" }
$crop = [System.Drawing.Bitmap]::FromFile($PngPath)
$settings = New-Object System.Drawing.Printing.PrinterSettings
$settings.PrinterName = $Printer
if (-not $settings.IsValid) { throw "Printer is not valid: $Printer" }
$settings.Copies = [int16]$Copies
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.DocumentName = "GenERP Bill"
$doc.PrinterSettings = $settings
$doc.DefaultPageSettings = $settings.DefaultPageSettings.Clone()
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins 0, 0, 0, 0
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$w = [int][Math]::Round($WidthMm / 25.4 * 100)
$hMm = 0
try { $hMm = [double]$HeightMm } catch { $hMm = 0 }
if ($hMm -gt 0) {
  $h = [int][Math]::Round($hMm / 25.4 * 100)
} else {
  $h = [int][Math]::Max(80, ($crop.Height / [double]$crop.Width) * $w)
}
# Prefer a paper size exposed by the printer driver. Windows drivers commonly
# reject an arbitrary 210x148 custom form and silently fall back to default A4.
# Standard A5 is stored as 148x210; selecting it with Landscape gives 210x148.
$matchedPaper = $null
$matchedLandscape = $false
$bestScore = [int]::MaxValue
foreach ($paper in $settings.PaperSizes) {
  $directScore = [Math]::Abs([int]$paper.Width - $w) + [Math]::Abs([int]$paper.Height - $h)
  # Prefer a direct/transverse form on a tie so the printer can feed the
  # physical sheet 210x148 instead of rotating standard 148x210 A5.
  if ($directScore -le 8 -and $directScore -le $bestScore) {
    $matchedPaper = $paper
    $matchedLandscape = $false
    $bestScore = $directScore
  }
  $swappedScore = [Math]::Abs([int]$paper.Width - $h) + [Math]::Abs([int]$paper.Height - $w)
  if ($swappedScore -le 8 -and $swappedScore -lt $bestScore) {
    $matchedPaper = $paper
    $matchedLandscape = $true
    $bestScore = $swappedScore
  }
}
if ($null -ne $matchedPaper) {
  $doc.DefaultPageSettings.PaperSize = $matchedPaper
  $doc.DefaultPageSettings.Landscape = $matchedLandscape
} else {
  # Thermal and genuinely custom forms may not be listed by the driver.
  $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize "GenERP Custom", $w, $h
  $doc.DefaultPageSettings.Landscape = $false
}
$active = [string]$doc.PrinterSettings.PrinterName
if ($active -ne $Printer) {
  throw "Windows would print to '$active' instead of '$Printer'"
}
$script:bmp = $crop
$doc.add_PrintPage({
  param($sender, $e)
  $e.Graphics.DrawImage($script:bmp, $e.PageBounds)
  $e.HasMorePages = $false
})
$doc.Print()
$crop.Dispose()
"""


def _png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        if handle.read(8) != b"\x89PNG\r\n\x1a\n":
            raise RuntimeError("Invalid print image")
        handle.read(4)
        if handle.read(4) != b"IHDR":
            raise RuntimeError("Invalid print image")
        width = int.from_bytes(handle.read(4), "big")
        height = int.from_bytes(handle.read(4), "big")
        if width < 1 or height < 1:
            raise RuntimeError("Invalid print image")
        return width, height


def _subprocess_flags() -> int:
    if sys.platform == "win32" and hasattr(subprocess, "CREATE_NO_WINDOW"):
        return int(subprocess.CREATE_NO_WINDOW)
    return 0


def _chrome_profile_dir() -> Path:
    folder = Path(tempfile.gettempdir()) / "generp-chrome-profile"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _prepare_print_html(html: str, width_mm: float, height_mm: float | None = None, landscape: bool = False) -> str:
    """Pin the slip to the designed page box so screenshot and printer match the template.

    ``landscape`` is ignored. Width and height already describe the printed page;
    swapping them again would print a portrait sheet of a landscape bill.
    """
    _ = landscape
    text = re.sub(
        r"<script>\s*window\.onload\s*=\s*function\s*\(\s*\)\s*\{\s*window\.print\s*\(\s*\)\s*;\s*\}\s*;?\s*</script>",
        "",
        html or "",
        flags=re.IGNORECASE,
    )
    width = f"{width_mm:.1f}".rstrip("0").rstrip(".")
    if height_mm and height_mm > 0:
        height = f"{height_mm:.1f}".rstrip("0").rstrip(".")
        size_css = f"{width}mm {height}mm"
        height_css = f"min-height:{height}mm!important;"
    else:
        size_css = f"{width}mm auto"
        height_css = ""
    pin = (
        f"<style id=\"generp-print-pin\">"
        f"html,body{{box-sizing:border-box!important;margin:0!important;padding:0!important;"
        f"width:{width}mm!important;max-width:{width}mm!important;"
        f"{height_css}background:#fff;}}"
        f"@page{{size:{size_css};}}"
        f"</style>"
    )
    match = re.search(r"</head>", text, re.IGNORECASE)
    if not match:
        return pin + text
    return text[: match.start()] + pin + text[match.start() :]


def print_html_document(
    html: str,
    printer_name: str | None = None,
    copies: int = 1,
    bill_format: str | None = None,
    orientation: str | None = None,
) -> dict:
    """Render the bill at slip width and print or save a slip-sized PDF (no browser dialog)."""
    if sys.platform != "win32":
        raise RuntimeError("Direct print is only available on Windows")
    info = list_installed_printers()
    names = [p["name"] for p in info["printers"]]
    default_name = info.get("default")
    requested = (printer_name or "").strip()
    # Print to PDF must not fall through to the Windows default printer.
    if requested and _should_save_pdf(requested):
        printer = requested
    else:
        printer = _resolve_printer_name(requested, names, default_name)
    browser = _find_chromium()
    if not browser:
        raise RuntimeError("Microsoft Edge or Chrome is required for direct print")
    copies = max(1, min(10, int(copies or 1)))
    _ = orientation
    is_barcode = _is_barcode_html(html or "")
    is_thermal = "thermal-slip" in (html or "") or (bill_format or "").upper().startswith("THERMAL")
    width_mm = _slip_width_mm(html, bill_format)
    page_w, page_h = _page_size_from_html(html or "")
    print_w = page_w or width_mm
    print_h = None if is_thermal else page_h

    import shutil
    import time
    import uuid

    folder = Path(tempfile.gettempdir()) / f"generp-print-{uuid.uuid4().hex}"
    folder.mkdir(parents=True, exist_ok=True)
    html_path = folder / "bill.html"
    png_path = folder / "bill.png"
    crop_png = folder / "crop.png"
    crop_jpg = folder / "crop.jpg"
    dims_path = folder / "dims.txt"
    crop_ps = folder / "crop.ps1"
    print_ps = folder / "print.ps1"
    pinned = _prepare_print_html(html or "", print_w, print_h)
    html_path.write_text(pinned, encoding="utf-8")
    css_w, css_h = _screenshot_window_px(pinned, print_w, print_h)
    scale = 2 if (is_barcode or is_thermal) else 1
    flags = _subprocess_flags()
    cmd = [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        f"--user-data-dir={_chrome_profile_dir()}",
        f"--force-device-scale-factor={scale}",
        f"--window-size={css_w},{css_h}",
        f"--screenshot={png_path}",
        html_path.resolve().as_uri(),
    ]
    with _CHROME_LOCK:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=45, check=False, creationflags=flags
        )
    if result.returncode != 0 or not png_path.is_file() or png_path.stat().st_size < 80:
        shutil.rmtree(folder, ignore_errors=True)
        detail = (result.stderr or result.stdout or "Could not render bill for print").strip()
        raise RuntimeError(detail[:400] or "Could not render bill for print")

    skip_content_crop = not is_barcode and not is_thermal
    if skip_content_crop and not _should_save_pdf(printer):
        img_w, img_h = _png_size(png_path)
        print_png = png_path
    else:
        crop_ps.write_text(_NOCROP_PS if (is_barcode or skip_content_crop) else _CROP_PS, encoding="utf-8")
        crop = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(crop_ps),
                "-PngPath",
                str(png_path),
                "-OutPng",
                str(crop_png),
                "-OutJpg",
                str(crop_jpg),
                "-DimsPath",
                str(dims_path),
            ],
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
            creationflags=flags,
        )
        if crop.returncode != 0 or not crop_jpg.is_file() or not dims_path.is_file():
            shutil.rmtree(folder, ignore_errors=True)
            detail = (crop.stderr or crop.stdout or "Could not crop bill for print").strip()
            raise RuntimeError(detail[:400] or "Could not crop bill for print")
        parts = dims_path.read_text(encoding="ascii").split()
        img_w, img_h = int(parts[0]), int(parts[1])
        print_png = crop_png

    def _cleanup() -> None:
        time.sleep(20)
        shutil.rmtree(folder, ignore_errors=True)

    if _should_save_pdf(printer):
        pdf = jpeg_slip_pdf(crop_jpg.read_bytes(), img_w, img_h, print_w)
        dest = _unique_path(_downloads_dir(), _pdf_filename(html or ""))
        dest.write_bytes(pdf)
        try:
            os.startfile(str(dest))  # type: ignore[attr-defined]
        except OSError:
            pass
        threading.Thread(target=_cleanup, daemon=True).start()
        return {
            "ok": True,
            "printer": printer,
            "copies": 1,
            "pdf_path": str(dest),
            "page_width_mm": print_w,
            "message": f"Saved {print_w:.0f}mm slip PDF to {dest}",
        }

    printer_file = folder / "printer.txt"
    printer_file.write_text(printer, encoding="utf-8")
    print_ps.write_text(_PRINT_PS, encoding="utf-8")
    ps = subprocess.run(
        [
            "powershell",
            "-STA",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(print_ps),
            "-PrinterFile",
            str(printer_file),
            "-PngPath",
            str(print_png),
            "-WidthMm",
            str(print_w),
            "-HeightMm",
            str(print_h or 0),
            "-Copies",
            str(copies),
            "-Landscape",
            "0",
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
        creationflags=flags,
    )
    if ps.returncode != 0:
        shutil.rmtree(folder, ignore_errors=True)
        detail = (ps.stderr or ps.stdout or "Print failed").strip()
        raise RuntimeError(detail[:400] or "Print failed")

    threading.Thread(target=_cleanup, daemon=True).start()
    return {
        "ok": True,
        "printer": printer,
        "copies": copies,
        "message": f"Sent to {printer}",
    }

