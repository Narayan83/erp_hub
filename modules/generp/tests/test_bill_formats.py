from modules.generp.ge.reports.bill_context import split_gst
from modules.generp.ge.reports.bill_formats import is_thermal, normalize_bill_format, oriented_paper_mm, resolve_bill_format
from modules.generp.ge.reports.money_words import amount_in_words


def test_normalize_bill_format_aliases():
    assert normalize_bill_format("thermal") == "THERMAL_80"
    assert normalize_bill_format("80mm") == "THERMAL_80"
    assert normalize_bill_format("58mm") == "THERMAL_58"
    assert normalize_bill_format("a5") == "A5"
    assert normalize_bill_format(None) == "A4"
    assert normalize_bill_format("nope") == "A4"


def test_resolve_prefers_first_non_empty():
    assert resolve_bill_format("THERMAL_58", "A4") == "THERMAL_58"
    assert resolve_bill_format("", "A5") == "A5"


def test_is_thermal():
    assert is_thermal("THERMAL_80")
    assert not is_thermal("A4")


def test_oriented_paper_mm_swaps_for_landscape():
    assert oriented_paper_mm("A4", "portrait") == (210.0, 297.0)
    assert oriented_paper_mm("A4", "landscape") == (297.0, 210.0)
    assert oriented_paper_mm("A5", "portrait") == (210.0, 148.0)
    assert oriented_paper_mm("A5", "landscape") == (148.0, 210.0)
    assert oriented_paper_mm("THERMAL_80", "landscape")[0] == 80.0


def test_amount_in_words():
    assert amount_in_words(100) == "Rupees One Hundred only"
    assert amount_in_words("150.50").startswith("Rupees One Hundred Fifty")


def test_split_gst_intra_and_inter_state():
    cgst, sgst, igst = split_gst(38.14, "33AAAAA0000A1Z5", "33BBBBB0000B1Z2")
    assert igst == 0
    assert round(cgst + sgst, 2) == 38.14
    cgst, sgst, igst = split_gst(38.14, "33AAAAA0000A1Z5", "29CCCCC0000C1Z5")
    assert igst == 38.14
    assert cgst == 0 and sgst == 0
    assert split_gst(0, "33AAAAA0000A1Z5", "") == (0.0, 0.0, 0.0)
