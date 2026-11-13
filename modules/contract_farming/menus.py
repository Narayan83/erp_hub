"""Contract Farming menu tree (menu_mode: complete)."""

MENUS: list[tuple[str, str, str | None, int]] = [
    ("dashboard", "Dashboard", None, 1),
    ("cf_operations", "Operations", None, 10),
    ("cf_masters", "Masters", None, 20),
    ("cf_reports", "Reports", None, 30),
    ("user_management", "User Management", None, 100),
    # Operations
    ("cf_projects", "Projects", "cf_operations", 1),
    ("cf_transactions", "Transactions", "cf_operations", 2),
    # Masters
    ("cf_partner_master", "Partner Master", "cf_masters", 1),
    ("cf_location_master", "Location Master", "cf_masters", 2),
    ("cf_phase_master", "Phase Master", "cf_masters", 3),
    ("cf_work_type_master", "Work Type", "cf_masters", 4),
    ("cf_labour_master", "Labour Master", "cf_masters", 5),
    ("cf_vendor_master", "Vendor Master", "cf_masters", 6),
    ("cf_ledger_master", "Ledger Master", "cf_masters", 7),
    ("cf_payment_mode_master", "Payment Modes", "cf_masters", 8),
    # Reports
    ("cf_report_summary", "Project Summary", "cf_reports", 1),
    ("cf_report_ledger", "Ledger Report", "cf_reports", 2),
    ("cf_report_charts", "Charts", "cf_reports", 3),
    # Users (shared core screen)
    ("user_addition_modification", "Users", "user_management", 1),
]
CONTRACT_FARMING_MENUS = MENUS
