from modules.generp.ge.services.product_codes import (
    allocate_import_codes,
    encode_own_barcode,
    parse_own_barcode,
    parse_product_code,
)
from modules.generp.ge.services.product_import import _find_gst, parse_product_template_rows
from modules.generp.ge.services.purchase_import import parse_tabular_file
from modules.generp.ge.services.tax import gst_pct_candidates, import_percent


def test_encode_own_barcode_rupees():
    assert encode_own_barcode(19, 250) == "000019000250"
    assert encode_own_barcode(1, 199) == "000001000199"
    assert encode_own_barcode("42", 199.4) == "000042000199"
    assert encode_own_barcode(7, 10000) == "000007010000"


def test_parse_own_barcode():
    assert parse_own_barcode("000019000250") == ("19", 250.0)
    assert parse_own_barcode("000001000199") == ("1", 199.0)
    assert parse_own_barcode("000007010000") == ("7", 10000.0)
    assert parse_own_barcode("000001") is None
    assert parse_own_barcode("ABC") is None


def test_parse_product_code():
    assert parse_product_code(None) is None
    assert parse_product_code("") is None
    assert parse_product_code("  ") is None
    assert parse_product_code("2001") == "2001"
    assert parse_product_code("02001") == "2001"
    assert parse_product_code(2001.0) == "2001"
    assert parse_product_code("2001.0") == "2001"
    try:
        parse_product_code("ABC")
        raise AssertionError("expected ValueError")
    except ValueError:
        pass
    try:
        parse_product_code(0)
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_allocate_import_codes_continues_from_file_max():
    assigned, errors = allocate_import_codes(
        ["2001", "2002", "2003", None],
        db_max=50,
    )
    assert errors == []
    assert assigned == ["2001", "2002", "2003", "2004"]


def test_allocate_import_codes_blank_uses_db_max_when_higher():
    assigned, errors = allocate_import_codes([None, None], db_max=3000)
    assert errors == []
    assert assigned == ["3001", "3002"]


def test_allocate_import_codes_skips_duplicate_explicit():
    assigned, errors = allocate_import_codes(
        ["2001", "2001", None],
        db_max=0,
        taken={"1999"},
        row_numbers=[2, 3, 4],
    )
    assert assigned == ["2001", None, "2002"]
    assert any("duplicated in this file" in e for e in errors)


def test_allocate_import_codes_skips_code_already_in_master():
    assigned, errors = allocate_import_codes(
        ["2001"],
        db_max=0,
        taken={"2001"},
        row_numbers=[2],
    )
    assert assigned == [None]
    assert any("already exists in Product Master" in e for e in errors)


def test_allocate_import_codes_blank_in_middle_avoids_later_explicit():
    assigned, errors = allocate_import_codes(["2001", None, "2003"], db_max=0)
    assert errors == []
    assert assigned == ["2001", "2004", "2003"]


def test_parse_product_template_rows_optional_code():
    table = [
        ["Code", "Name", "Sale", "Wholesale"],
        ["2001", "Rice", "50", "45"],
        ["", "Oil", "80", "70"],
    ]
    rows, errors = parse_product_template_rows(table)
    assert errors == []
    assert len(rows) == 2
    assert rows[0].code == "2001"
    assert rows[0].name == "Rice"
    assert rows[0].sale_price == 50
    assert rows[1].code is None
    assert rows[1].name == "Oil"


def test_parse_tabular_csv_and_xlsx():
    import io
    import zipfile

    csv_data = b"Code,Name,Sale\n2001,Rice,50\n"
    table = parse_tabular_file(csv_data, "products.csv")
    rows, errors = parse_product_template_rows(table)
    assert errors == []
    assert rows[0].code == "2001"
    assert rows[0].name == "Rice"

    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetData>'
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Code</t></is></c>'
        '<c r="B1" t="inlineStr"><is><t>Name</t></is></c>'
        '<c r="C1" t="inlineStr"><is><t>Sale</t></is></c></row>'
        '<row r="2"><c r="A2"><v>2002</v></c>'
        '<c r="B2" t="inlineStr"><is><t>Oil</t></is></c>'
        '<c r="C2"><v>80</v></c></row>'
        '</sheetData></worksheet>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '</Types>',
        )
        zf.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            '</Relationships>',
        )
        zf.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets></workbook>',
        )
        zf.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '</Relationships>',
        )
        zf.writestr("xl/worksheets/sheet1.xml", sheet)
    table = parse_tabular_file(buf.getvalue(), "products.xlsx")
    rows, errors = parse_product_template_rows(table)
    assert errors == []
    assert rows[0].code == "2002"
    assert rows[0].name == "Oil"


def test_gst_pct_candidates_excel_fraction():
    assert gst_pct_candidates("0.18") == [0.18, 18.0]
    assert gst_pct_candidates("18%") == [18.0]
    assert gst_pct_candidates("18") == [18.0]
    assert gst_pct_candidates("5") == [5.0]
    assert gst_pct_candidates("0") == [0.0]


def test_import_percent_excel_fraction():
    assert import_percent("0.2") == 20.0
    assert import_percent("20%") == 20.0
    assert import_percent("20") == 20.0
    assert import_percent(0.2) == 20.0
    assert import_percent("15") == 15.0
    assert import_percent("") == 0.0


def test_parse_product_max_discount_excel_percent():
    table = [
        ["Name", "Max disc %"],
        ["Shirt", "0.2"],
        ["Pant", "20%"],
        ["Cap", "15"],
    ]
    rows, errors = parse_product_template_rows(table)
    assert errors == []
    assert rows[0].max_discount_pct == 20.0
    assert rows[1].max_discount_pct == 20.0
    assert rows[2].max_discount_pct == 15.0


def test_parse_product_moq_last_column():
    table = [
        ["Name", "Sale", "MOQ"],
        ["Rice", "50", "12"],
        ["Oil", "80", ""],
    ]
    rows, errors = parse_product_template_rows(table)
    assert errors == []
    assert rows[0].moq == 12.0
    assert rows[1].moq == 0.0


def test_find_gst_accepts_excel_percent_fraction():
    from types import SimpleNamespace

    rates = [
        SimpleNamespace(name="GST 0%", code="GST0", rate=0),
        SimpleNamespace(name="GST 5%", code="GST5", rate=5),
        SimpleNamespace(name="GST 18%", code="GST18", rate=18),
    ]
    assert _find_gst(rates, "0.18").rate == 18
    assert _find_gst(rates, "18%").rate == 18
    assert _find_gst(rates, "18").rate == 18
    assert _find_gst(rates, "0.05").rate == 5
    assert _find_gst(rates, "GST 18%").rate == 18
    assert _find_gst(rates, "0.19") is None

