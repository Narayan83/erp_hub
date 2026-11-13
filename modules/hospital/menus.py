"""Full hospital menu tree — same codes as D:\\fullstack\\others\\hospital."""

from modules.hospital.hms.seeds.menu_definitions import MENU_DEFINITIONS

# (code, label, parent_code, sort_order) — used by erp_core seed
MENUS: list[tuple[str, str, str | None, int]] = [
    (code, label, parent_code, sort_order)
    for code, label, parent_code, sort_order, *_rest in MENU_DEFINITIONS
    # Core already seeds these shared roots / items — skip duplicates
    if code
    not in {
        "dashboard",
        "masters",
        "accounts",
        "user_management",
        "company_profile",
        "party_master",
        "print_master",
        "print_template_designer",
        "payment_mode_creation",
        "ledger_master",
        "advance_collection",
        "adjustment_entry",
        "receipt_voucher_adjustment_entry",
        "daybook",
        "balance_sheet",
        "user_addition_modification",
    }
]

# Prefer hospital label for hospital_profile over company_profile alias
MENUS = [row for row in MENUS if row[0] != "hospital_profile"] + [
    ("hospital_profile", "Hospital Profile / Settings", "masters", 44),
]
HOSPITAL_MENUS = MENUS
