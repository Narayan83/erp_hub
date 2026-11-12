from datetime import date

from modules.generp.ge.services.document_numbers import (
    NumberRule,
    YEAR_FY,
    YEAR_NONE,
    YEAR_CAL,
    display_no,
    full_no,
    fy_code,
    pad_seq,
    sanitize_token,
    year_part,
)


def test_fy_code_apr_mar():
    assert fy_code(date(2026, 8, 26)) == "2627"
    assert fy_code(date(2026, 4, 1)) == "2627"
    assert fy_code(date(2026, 3, 31)) == "2526"


def test_year_part_modes():
    d = date(2026, 8, 26)
    assert year_part(YEAR_NONE, d) == ""
    assert year_part(YEAR_FY, d) == "2627"
    assert year_part(YEAR_CAL, d) == "2026"


def test_display_vs_full():
    rule = NumberRule("INV", YEAR_FY, "01", "01", 6)
    assert display_no(rule, 1) == "INV000001"
    assert full_no(rule, 1, date(2026, 8, 26)) == "INV26270101000001"


def test_digits_and_blank_prefixes():
    rule = NumberRule("", YEAR_NONE, "", "", 7)
    assert display_no(rule, 1) == "0000001"
    assert full_no(rule, 1) == "0000001"
    assert pad_seq(12, 6) == "000012"


def test_sanitize_token():
    assert sanitize_token("inv-01") == "inv-01"
    assert sanitize_token("INV_A") == "INV_A"
    assert sanitize_token("") == ""
