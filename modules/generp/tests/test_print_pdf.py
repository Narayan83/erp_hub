from modules.generp.ge.services.print_local import (
    _is_file_printer,
    _page_size_from_html,
    _pdf_filename,
    _prepare_print_html,
    _resolve_printer_name,
    _screenshot_window_px,
    _slip_width_mm,
    get_barcode_layout_printers,
    jpeg_slip_pdf,
    set_report_printer,
)

import pytest


def test_print_to_pdf_is_a_file_printer():
    assert _is_file_printer("Microsoft Print to PDF") is True
    assert _is_file_printer("Microsoft XPS Document Writer") is True
    assert _is_file_printer("EPSON TM-T82") is False


def test_thermal_html_uses_80mm_slip():
    html = '<body class="thermal-slip" style="width: 80mm">'
    assert _slip_width_mm(html, "THERMAL_80") == 80.0
    assert _slip_width_mm(html, "THERMAL_58") == 58.0


def test_barcode_html_uses_label_page_width():
    html = "@page { size: 50.8mm auto; margin: 0; }"
    assert _slip_width_mm(html, "A4") == 50.8
    html2 = '@page { size: 101.6mm auto; } <div class="row"></div>'
    assert _slip_width_mm(html2, None) == 101.6


def test_barcode_screenshot_grows_with_label_rows():
    one = (
        '@page { size: 50.8mm 25.4mm; margin: 0; } '
        '<div class="label" style="height:25.4mm;"></div><div class="row"></div>'
        '<body data-generp-print="barcode" data-page-h="25.4">'
    )
    many = (
        '@page { size: 50.8mm 508mm; margin: 0; } '
        + '<div class="label" style="height:25.4mm;"></div><div class="row"></div>' * 20
        + '<body data-generp-print="barcode" data-page-h="508">'
    )
    _w1, h1 = _screenshot_window_px(one, 50.8)
    _w2, h2 = _screenshot_window_px(many, 50.8)
    assert h2 > h1
    assert h2 <= 12000
    assert h1 == 96


def test_barcode_screenshot_uses_page_height_not_field_height():
    html = (
        "<!doctype html><html><head>"
        "<style>@page { size: 50.8mm 25.4mm; margin: 0; }</style></head>"
        '<body data-generp-print="barcode" data-page-w="50.8" data-page-h="25.4">'
        '<div class="item" style="height:3.8mm"></div>'
        '<div class="label" style="height:25.4mm"></div>'
        '<div class="row"></div>'
        "</body></html>"
    )
    w, h = _screenshot_window_px(html, 50.8)
    assert w == 192
    assert h == 96


def test_barcode_layout_printers_are_per_template(tmp_path, monkeypatch):
    monkeypatch.setenv("GENERP_PRINT_INI", str(tmp_path / "print.ini"))
    set_report_printer("BARCODE_LABEL", "Office Laser")
    unset = get_barcode_layout_printers()
    assert unset["SINGLE"] == "Office Laser"
    assert unset["DOUBLE"] == "Office Laser"
    set_report_printer("BARCODE_LABEL_MINI", "Godex Label")
    set_report_printer("BARCODE_LABEL_SINGLE", "")
    saved = get_barcode_layout_printers()
    assert saved["MINI"] == "Godex Label"
    assert saved["SINGLE"] is None
    assert saved["DOUBLE"] == "Office Laser"


def test_print_to_pdf_is_a_file_printer():
    assert _is_file_printer("Microsoft Print to PDF") is True
    assert _is_file_printer("Microsoft XPS Document Writer") is True
    assert _is_file_printer("EPSON TM-T82") is False


def test_thermal_html_uses_80mm_slip():
    html = '<body class="thermal-slip" style="width: 80mm">'
    assert _slip_width_mm(html, "THERMAL_80") == 80.0
    assert _slip_width_mm(html, "THERMAL_58") == 58.0


def test_slip_pdf_page_is_80mm_wide_not_letter():
    # Letter is 612x792 pt. An 80mm slip is ~226.77 pt wide.
    pdf = jpeg_slip_pdf(b"\xff\xd8\xff\xd9", 100, 250, 80.0)
    assert pdf.startswith(b"%PDF-")
    assert b"/MediaBox [0 0 226.77 566.93]" in pdf
    assert b"612" not in pdf
    assert b"792" not in pdf


def test_pdf_filename_from_title():
    assert _pdf_filename("<title>TAX INVOICE - SB-19</title>") == "TAX_INVOICE_-_SB-19.pdf"


def test_resolve_printer_uses_selected_not_windows_default():
    names = ["Microsoft Print to PDF", "TSC TE244"]
    assert _resolve_printer_name("Microsoft Print to PDF", names, "TSC TE244") == "Microsoft Print to PDF"
    assert _resolve_printer_name("tsc te244", names, "Microsoft Print to PDF") == "TSC TE244"


def test_resolve_printer_does_not_fallback_when_name_missing():
    names = ["Microsoft Print to PDF", "TSC TE244"]
    with pytest.raises(RuntimeError, match="Printer not found"):
        _resolve_printer_name("Office Laser", names, "TSC TE244")


def test_resolve_printer_empty_uses_windows_default():
    names = ["Microsoft Print to PDF", "TSC TE244"]
    assert _resolve_printer_name("", names, "TSC TE244") == "TSC TE244"
    assert _resolve_printer_name(None, names, "TSC TE244") == "TSC TE244"


def test_prepare_print_html_does_not_swap_landscape_box():
    html = (
        "<html><head></head>"
        "<body data-page-w='210' data-page-h='148' data-page-orientation='landscape'></body></html>"
    )
    pinned = _prepare_print_html(html, 210, 148, landscape=True)
    assert "size:210mm 148mm" in pinned
    assert "size:148mm 210mm" not in pinned
    assert "box-sizing:border-box!important" in pinned
    assert "padding:0!important" in pinned
    assert "padding:2mm" not in pinned


def test_page_size_from_html_reads_single_quoted_attrs():
    html = "<body data-page-w='210' data-page-h='148' data-page-orientation='landscape'>"
    assert _page_size_from_html(html) == (210.0, 148.0)


def test_screenshot_window_matches_a5_landscape_page():
    html = (
        "<html><head><style>@page { size: 210mm 148mm; margin: 0; }</style></head>"
        "<body data-page-w='210' data-page-h='148' data-page-orientation='landscape'></body></html>"
    )
    w, h = _screenshot_window_px(html, 210, 148)
    assert w == round(210 / 25.4 * 96)
    assert h == round(148 / 25.4 * 96)
    assert w > h
