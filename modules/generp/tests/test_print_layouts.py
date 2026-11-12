from modules.generp.ge.reports.bill_context import apply_bill_format
from modules.generp.ge.reports.layout_render import render_document_html
from modules.generp.ge.reports.print_layouts import (
    default_document_layout,
    layout_for_format,
    normalize_layout,
    sample_bill_context,
    sample_report_context,
    visible_fields,
)


def test_default_sale_bill_has_all_formats():
    layout = default_document_layout("SALE_BILL")
    assert layout["kind"] == "bill"
    for fmt in ("A4", "A5", "THERMAL_80", "THERMAL_58"):
        assert fmt in layout["formats"]
        cols = [c["id"] for c in visible_fields(layout["formats"][fmt], "columns")]
        assert "name" in cols
        assert "amount" in cols


def test_thermal_58_hides_discount_column():
    layout = default_document_layout("SALE_BILL")
    cols_80 = [c["id"] for c in visible_fields(layout["formats"]["THERMAL_80"], "columns")]
    cols_58 = [c["id"] for c in visible_fields(layout["formats"]["THERMAL_58"], "columns")]
    assert "disc" in cols_80
    assert "disc" not in cols_58


def test_normalize_keeps_hidden_column_and_adds_new_catalog_ids():
    raw = {
        "kind": "bill",
        "formats": {
            "A4": {
                "header": [{"id": "company_name", "visible": True}],
                "columns": [
                    {"id": "name", "visible": True, "width": 40},
                    {"id": "amount", "visible": True, "width": 20},
                    {"id": "code", "visible": False},
                ],
            }
        },
    }
    layout = normalize_layout("SALE_BILL", raw)
    a4 = layout["formats"]["A4"]
    visible_cols = [c["id"] for c in visible_fields(a4, "columns")]
    assert visible_cols[0] == "name"
    assert "code" not in visible_cols
    all_cols = [c["id"] for c in a4["columns"]]
    assert "qty" in all_cols
    assert "gst" in all_cols
    header_ids = [f["id"] for f in a4["header"]]
    assert "company_logo" in header_ids
    logo = next(f for f in a4["header"] if f["id"] == "company_logo")
    assert logo["visible"] is False


def test_barcode_layout_roundtrip():
    layout = normalize_layout(
        "BARCODE_LABEL",
        {
            "fields": [
                {"id": "heading", "label": "", "source": "name", "enabled": True, "bold": True},
                {"id": "mrp", "label": "MRP", "source": "mrp", "enabled": False},
            ],
            "default_layout": "DOUBLE",
            "gaps": {
                "SINGLE": {
                    "gap_left_mm": 0,
                    "gap_right_mm": 0,
                    "gap_bottom_mm": 2,
                    "show_border": True,
                }
            },
        },
    )
    assert layout["kind"] == "barcode"
    assert layout["default_layout"] == "DOUBLE"
    assert layout["fields"][1]["enabled"] is False
    assert layout["gaps"]["SINGLE"]["gap_bottom_mm"] == 2
    assert layout["gaps"]["SINGLE"]["show_border"] is True
    assert layout["gaps"]["DOUBLE"]["gap_left_mm"] == 0
    assert layout["gaps"]["MINI"]["gap_bottom_mm"] == 0
    layout2 = normalize_layout(
        "BARCODE_LABEL",
        {
            **layout,
            "canvases": {
                "SINGLE": {
                    "fields": {
                        "heading": {
                            "xMm": 1,
                            "yMm": 1,
                            "widthMm": 48,
                            "heightMm": 4,
                            "fontFamily": "Arial",
                            "fontSizePt": 11,
                            "bold": True,
                            "align": "center",
                        }
                    },
                    "barcode": {"xMm": 2, "yMm": 8, "widthMm": 46, "heightMm": 14, "showText": True},
                    "border": {"enabled": True, "xMm": 0.4, "yMm": 0.4, "widthMm": 50, "heightMm": 24.6},
                }
            },
        },
    )
    assert layout2["canvases"]["SINGLE"]["border"]["enabled"] is True
    assert layout2["canvases"]["SINGLE"]["fields"]["heading"]["fontSizePt"] == 11


def test_barcode_custom_sheet_roundtrip():
    layout = normalize_layout(
        "BARCODE_LABEL",
        {
            "default_layout": "CUSTOM",
            "sheet": {
                "totalWidthMm": 110,
                "columns": 3,
                "columnGapMm": 2,
                "heightMm": 30,
                "rowGapMm": 3,
            },
        },
    )
    assert layout["default_layout"] == "CUSTOM"
    assert layout["sheet"]["columns"] == 3
    assert layout["sheet"]["totalWidthMm"] == 110
    assert layout["sheet"]["rowGapMm"] == 3
    assert layout["gaps"]["CUSTOM"]["gap_bottom_mm"] == 3
    sticker = (110 - 2 * 2) / 3
    assert round(sticker, 1) == 35.3


def test_sale_bill_html_hides_removed_column():
    layout = default_document_layout("SALE_BILL")
    for col in layout["formats"]["A4"]["columns"]:
        if col["id"] == "code":
            col["visible"] = False
    context = apply_bill_format(sample_bill_context(), "A4")
    html = render_document_html(
        code="SALE_BILL", context=context, layout_raw=layout, bill_format="A4"
    )
    assert "Cotton Shirt" in html
    assert ">Code<" not in html
    assert "P001" not in html


def test_sale_bill_html_hides_removed_header_field():
    layout = default_document_layout("SALE_BILL")
    for field in layout["formats"]["A4"]["header"]:
        if field["id"] == "company_website":
            field["visible"] = False
    context = apply_bill_format(sample_bill_context(), "A4")
    html = render_document_html(
        code="SALE_BILL", context=context, layout_raw=layout, bill_format="A4"
    )
    assert "Sample Traders" in html
    assert "www.example.com" not in html


def test_thermal_default_html_keeps_thanks_and_slip_class():
    layout = default_document_layout("SALE_BILL")
    context = apply_bill_format(sample_bill_context(), "THERMAL_80")
    html = render_document_html(
        code="SALE_BILL", context=context, layout_raw=layout, bill_format="THERMAL_80"
    )
    assert "thermal-slip" in html
    assert "THANK YOU VISIT AGAIN" in html
    assert "TAX INVOICE" in html
    items_end = html.find("</tbody></table>")
    total_pos = html.find("Total")
    assert items_end > 0
    assert total_pos > items_end
    assert '<div class="rule"></div>' in html[items_end:total_pos]


def test_reorder_columns_changes_print_order():
    layout = default_document_layout("SALE_BILL")
    cols = layout["formats"]["A4"]["columns"]
    amount = next(c for c in cols if c["id"] == "amount")
    cols.remove(amount)
    cols.insert(0, amount)
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A4"),
        layout_raw=layout,
        bill_format="A4",
    )
    amount_pos = html.find(">Amount<")
    product_pos = html.find(">Product<")
    assert 0 <= amount_pos < product_pos


def test_daily_collection_can_hide_payment_summary():
    layout = default_document_layout("DAILY_COLLECTION_REPORT")
    for field in layout["formats"]["A4"]["footer"]:
        if field["id"] == "payment_summary":
            field["visible"] = False
    html = render_document_html(
        code="DAILY_COLLECTION_REPORT",
        context=sample_report_context(),
        layout_raw=layout,
        bill_format="A4",
    )
    assert "Daily Collection Report" in html
    assert "Collection by payment mode" not in html
    assert "SB-001" in html


def test_layout_for_format_falls_back():
    layout = normalize_layout("SALE_BILL", None)
    band = layout_for_format(layout, "THERMAL_80")
    assert any(f["id"] == "thanks" and f["visible"] for f in band["footer"])


def test_sale_bill_keeps_font_and_position():
    layout = default_document_layout("SALE_BILL")
    for field in layout["formats"]["A4"]["header"]:
        if field["id"] == "company_name":
            field["fontFamily"] = "Arial"
            field["fontSizePt"] = 16
            field["bold"] = True
            field["border"] = True
            field["xMm"] = 2
            field["yMm"] = 3
            field["widthMm"] = 190
            field["heightMm"] = 8
    saved = normalize_layout("SALE_BILL", layout)
    name = next(f for f in saved["formats"]["A4"]["header"] if f["id"] == "company_name")
    assert name["fontFamily"] == "Arial"
    assert name["fontSizePt"] == 16
    assert name["xMm"] == 2
    assert name["border"] is True
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A4"),
        layout_raw=saved,
        bill_format="A4",
    )
    assert "font-size:16pt" in html
    assert "left:2mm" in html
    assert 'class="placed-band"' in html
    assert "font-family:'Arial'" in html


def test_sale_bill_flow_font_without_position():
    layout = default_document_layout("SALE_BILL")
    for field in layout["formats"]["A4"]["header"]:
        if field["id"] == "company_name":
            field["fontSizePt"] = 14
            field["fontFamily"] = "Calibri"
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A4"),
        layout_raw=layout,
        bill_format="A4",
    )
    assert "font-size:14pt" in html
    assert 'class="placed-band"' not in html
    assert "font-family:'Calibri'" in html


def test_page_border_roundtrip():
    layout = default_document_layout("SALE_BILL")
    layout["page_borders"] = {"A4": True}
    saved = normalize_layout("SALE_BILL", layout)
    assert saved["page_borders"]["A4"] is True
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A4"),
        layout_raw=saved,
        bill_format="A4",
    )
    assert "page-frame has-border" in html


def test_you_save_visible_on_sale_bill_formats():
    layout = default_document_layout("SALE_BILL")
    for fmt in ("A4", "A5", "THERMAL_80", "THERMAL_58"):
        footer_ids = [f["id"] for f in visible_fields(layout["formats"][fmt], "footer")]
        assert "you_save" in footer_ids
        if "thanks" in footer_ids:
            assert footer_ids.index("you_save") < footer_ids.index("thanks")


def test_you_save_inserted_before_thanks_on_existing_layout():
    raw = {
        "kind": "bill",
        "formats": {
            "A4": {
                "header": [{"id": "company_name", "visible": True}],
                "footer": [
                    {"id": "computer_note", "visible": True},
                    {"id": "thanks", "visible": True, "text": "THANK YOU VISIT AGAIN"},
                ],
            }
        },
    }
    layout = normalize_layout("SALE_BILL", raw)
    footer = layout["formats"]["A4"]["footer"]
    ids = [f["id"] for f in footer]
    assert "you_save" in ids
    assert next(f for f in footer if f["id"] == "you_save")["visible"] is True
    assert ids.index("you_save") < ids.index("thanks")


def test_you_save_prints_from_mrp():
    layout = default_document_layout("SALE_BILL")
    ctx = apply_bill_format(sample_bill_context(), "A4")
    html = render_document_html(
        code="SALE_BILL",
        context=ctx,
        layout_raw=layout,
        bill_format="A4",
    )
    assert "You Save" in html
    assert "355.00" in html
    assert "you-save" in html


def test_company_logo_field_renders_in_bill_and_report():
    from modules.generp.ge.reports.bill_context import company_header_context

    ctx = company_header_context({"name": "Acme", "logo_path": "logo_abc.png"})
    assert ctx["company_logo_url"] == "/media/company-logo/logo_abc.png"

    layout = default_document_layout("SALE_BILL")
    for field in layout["formats"]["A4"]["header"]:
        if field["id"] == "company_logo":
            field["visible"] = True
            field["xMm"] = 2
            field["yMm"] = 1
            field["widthMm"] = 22
            field["heightMm"] = 14
    bill_ctx = apply_bill_format(sample_bill_context(), "A4")
    bill_ctx["company_logo_src"] = "data:image/png;base64,AAAA"
    html = render_document_html(
        code="SALE_BILL",
        context=bill_ctx,
        layout_raw=layout,
        bill_format="A4",
    )
    assert "data:image/png;base64,AAAA" in html
    assert 'class="placed-band"' in html

    report = default_document_layout("DAILY_COLLECTION_REPORT")
    ids = [f["id"] for f in report["formats"]["A4"]["header"]]
    assert "company_logo" in ids
    assert next(f for f in report["formats"]["A4"]["header"] if f["id"] == "company_logo")["visible"] is False


def test_field_padding_survives_normalize_and_prints():
    layout = default_document_layout("SALE_BILL")
    for field in layout["formats"]["A4"]["header"]:
        if field["id"] == "company_name":
            field["xMm"] = 2
            field["yMm"] = 3
            field["widthMm"] = 80
            field["heightMm"] = 8
            field["paddingLeftMm"] = 4
            field["paddingTopMm"] = 2
            field["paddingRightMm"] = 1
            field["paddingBottomMm"] = 0.5
    saved = normalize_layout("SALE_BILL", layout)
    name = next(f for f in saved["formats"]["A4"]["header"] if f["id"] == "company_name")
    assert name["paddingLeftMm"] == 4
    assert name["paddingTopMm"] == 2
    assert name["paddingRightMm"] == 1
    assert name["paddingBottomMm"] == 0.5
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A4"),
        layout_raw=saved,
        bill_format="A4",
    )
    assert "padding:2mm 1mm 0.5mm 4mm" in html


def test_column_mm_table_fills_printable_width():
    layout = default_document_layout("SALE_BILL")
    x = 1.0
    for col in layout["formats"]["A4"]["columns"]:
        if not col.get("visible"):
            continue
        if col["id"] == "name":
            col["widthMm"] = 20
        elif col["id"] == "qty":
            col["widthMm"] = 12
        else:
            col["widthMm"] = 15
        col["xMm"] = x
        col["yMm"] = 1
        col["heightMm"] = 7
        x += col["widthMm"]
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A4"),
        layout_raw=layout,
        bill_format="A4",
    )
    assert '<table class="items-mm"' in html
    assert 'style="width:100%;max-width:100%' in html
    assert "width:auto" not in html.split('<table class="items-mm"', 1)[1][:200].lower()


def test_page_padding_roundtrip_and_preview_frame():
    layout = default_document_layout("SALE_BILL")
    layout["page_paddings"] = {
        "A4": {
            "paddingLeftMm": 4,
            "paddingRightMm": 5,
            "paddingTopMm": 3,
            "paddingBottomMm": 6,
        }
    }
    saved = normalize_layout("SALE_BILL", layout)
    assert saved["page_paddings"]["A4"]["paddingLeftMm"] == 4
    assert saved["page_paddings"]["A4"]["paddingRightMm"] == 5
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A4"),
        layout_raw=saved,
        bill_format="A4",
    )
    assert "padding:3mm 5mm 6mm 4mm" in html
    assert "page-frame" in html


def test_page_orientation_landscape_sets_page_size():
    layout = default_document_layout("SALE_BILL")
    layout["page_orientations"] = {"A4": "landscape", "THERMAL_80": "landscape"}
    saved = normalize_layout("SALE_BILL", layout)
    assert saved["page_orientations"]["A4"] == "landscape"
    assert "THERMAL_80" not in saved.get("page_orientations", {})
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A4"),
        layout_raw=saved,
        bill_format="A4",
    )
    assert "data-page-orientation='landscape'" in html
    assert "data-page-w='297'" in html
    assert "297mm 210mm" in html
    portrait = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A4"),
        layout_raw=default_document_layout("SALE_BILL"),
        bill_format="A4",
    )
    assert "data-page-orientation='portrait'" in portrait
    assert "210mm 297mm" in portrait


def test_a5_portrait_html_uses_width_210_by_height_148():
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A5"),
        layout_raw=default_document_layout("SALE_BILL"),
        bill_format="A5",
    )
    assert "data-page-orientation='portrait'" in html
    assert "data-page-w='210'" in html
    assert "data-page-h='148'" in html
    assert "210mm 148mm" in html


def test_a5_landscape_html_uses_width_148_by_height_210():
    layout = default_document_layout("SALE_BILL")
    layout["page_orientations"] = {"A5": "landscape"}
    saved = normalize_layout("SALE_BILL", layout)
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A5"),
        layout_raw=saved,
        bill_format="A5",
    )
    assert "data-page-orientation='landscape'" in html
    assert "data-page-w='148'" in html
    assert "data-page-h='210'" in html
    assert "148mm 210mm" in html


def test_a5_landscape_mm_table_fills_page():
    layout = default_document_layout("SALE_BILL")
    layout["page_orientations"] = {"A5": "landscape"}
    x = 1.0
    for col in layout["formats"]["A5"]["columns"]:
        if not col.get("visible"):
            continue
        col["widthMm"] = 10
        col["xMm"] = x
        col["yMm"] = 1
        col["heightMm"] = 7
        x += 10
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A5"),
        layout_raw=layout,
        bill_format="A5",
    )
    assert "data-page-w='148'" in html
    assert '<table class="items-mm"' in html
    assert 'style="width:100%;max-width:100%' in html
    assert "width:auto" not in html.split('<table class="items-mm"', 1)[1][:200].lower()


def test_item_columns_never_exceed_printable_width():
    """Cell padding and borders must fit inside the mm width, or the last column falls off the page."""
    import re

    from modules.generp.ge.reports.print_layouts import printable_inner_mm

    layout = default_document_layout("SALE_BILL")
    layout["page_orientations"] = {"A5": "landscape"}
    x = 1.0
    for col in layout["formats"]["A5"]["columns"]:
        if not col.get("visible"):
            continue
        col["widthMm"] = 21.7
        col["xMm"] = x
        col["yMm"] = 1
        col["heightMm"] = 7
        x += 21.7
    layout = normalize_layout("SALE_BILL", layout)
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A5"),
        layout_raw=layout,
        bill_format="A5",
    )
    assert "table.items-mm td, table.items-mm th { box-sizing: border-box" in html
    first_row = html.split('<table class="items-mm"', 1)[1].split("</tr>", 1)[0]
    widths = [float(w) for w in re.findall(r"(?<!max-)width:([0-9.]+)mm", first_row)]
    assert widths
    assert sum(widths) <= printable_inner_mm(layout, "A5") + 0.01


def test_fit_layout_to_page_stretches_columns_on_landscape():
    from modules.generp.ge.reports.print_layouts import fit_layout_to_page, printable_inner_mm, set_layout_orientation

    layout = default_document_layout("SALE_BILL")
    cols = []
    x = 1.0
    for field in layout["formats"]["A5"]["columns"]:
        item = dict(field)
        if item.get("visible"):
            item["xMm"] = x
            item["widthMm"] = 10.0
            item["width"] = 10
            x += 10
        cols.append(item)
    layout["formats"]["A5"]["columns"] = cols
    from_inner = printable_inner_mm(layout, "A5")
    next_layout = set_layout_orientation(layout, "A5", "landscape")
    fitted = fit_layout_to_page(next_layout, "A5", from_inner)
    to_inner = printable_inner_mm(fitted, "A5")
    visible = [c for c in fitted["formats"]["A5"]["columns"] if c.get("visible")]
    right = max(float(c["xMm"]) + float(c["widthMm"]) for c in visible)
    assert right <= to_inner + 0.01
    assert right >= to_inner - 4


def test_column_width_above_legacy_clamp_is_kept():
    raw = {
        "kind": "bill",
        "formats": {
            "A4": {
                "header": [{"id": "company_name", "visible": True}],
                "columns": [
                    {"id": "name", "visible": True, "width": 80, "widthMm": 80},
                    {"id": "qty", "visible": True, "width": 12, "widthMm": 12},
                ],
            }
        },
    }
    layout = normalize_layout("SALE_BILL", raw)
    name = next(c for c in layout["formats"]["A4"]["columns"] if c["id"] == "name")
    assert name["width"] == 80
    assert name["widthMm"] == 80


def test_custom_page_survives_normalize_and_sets_html_size():
    from modules.generp.ge.reports.print_layouts import paper_mm_of, resolve_layout_format

    layout = default_document_layout("SALE_BILL")
    layout["custom_pages"] = {"CUSTOM_HALF": {"name": "Half page", "widthMm": 210, "heightMm": 140}}
    layout["formats"]["CUSTOM_HALF"] = layout["formats"]["A4"]
    saved = normalize_layout("SALE_BILL", layout)
    assert "CUSTOM_HALF" in saved["custom_pages"]
    assert saved["custom_pages"]["CUSTOM_HALF"]["widthMm"] == 210
    assert resolve_layout_format(saved, "CUSTOM_HALF") == "CUSTOM_HALF"
    assert paper_mm_of(saved, "CUSTOM_HALF") == (210.0, 140.0)
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "CUSTOM_HALF"),
        layout_raw=saved,
        bill_format="CUSTOM_HALF",
    )
    assert "data-page-w='210'" in html
    assert "data-page-h='140'" in html
    assert "210mm 140mm" in html


def test_custom_page_landscape_swaps_dimensions():
    from modules.generp.ge.reports.print_layouts import paper_mm_of

    layout = default_document_layout("SALE_BILL")
    layout["custom_pages"] = {"CUSTOM_CARD": {"name": "Card", "widthMm": 100, "heightMm": 150}}
    layout["page_orientations"] = {"CUSTOM_CARD": "landscape"}
    layout["formats"]["CUSTOM_CARD"] = layout["formats"]["A4"]
    saved = normalize_layout("SALE_BILL", layout)
    assert paper_mm_of(saved, "CUSTOM_CARD") == (150.0, 100.0)
    html = render_document_html(
        code="SALE_BILL",
        context=apply_bill_format(sample_bill_context(), "A4"),
        layout_raw=saved,
        bill_format="CUSTOM_CARD",
    )
    assert "data-page-w='150'" in html
    assert "data-page-h='100'" in html
    assert "data-page-orientation='landscape'" in html


