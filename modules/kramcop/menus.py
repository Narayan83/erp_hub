"""Society screens from the Kramcop app. Shared login, users, and accounts stay in core."""

MENUS: list[tuple[str, str, str | None, int]] = [
    ("society", "Society", None, 12),
    ("kc_reports", "Reports", None, 20),
    ("customer_master", "Customer Master", "masters", 10),
    ("category_master", "Category Master", "masters", 11),
    ("share_type_master", "Share Type Master", "masters", 12),
    ("society_profile", "Society master", "masters", 13),
    ("share_entry", "Share addition / deletion", "society", 1),
    ("share_schedule", "Share Schedule", "society", 2),
    ("share_summary", "Share Summary", "kc_reports", 1),
    ("address_labels", "Address Labels", "kc_reports", 2),
    ("category_members", "Category members", "kc_reports", 3),
    ("kc_roles", "Roles", "user_management", 2),
    ("kc_audit", "Audit trail", "user_management", 3),
]
KRAMCOP_MENUS = MENUS
