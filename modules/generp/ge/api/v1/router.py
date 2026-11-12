from fastapi import APIRouter

from modules.generp.ge.api.v1.endpoints import (
    audit,
    auth,
    cashbook,
    categories,
    company_profile,
    dashboard,
    dashboard_shortcuts,
    discounts,
    document_number_rules,
    financial_reports,
    gst,
    ledgers,
    menus,
    notifications,
    orders,
    parties,
    payment_modes,
    print_configs,
    products,
    reports,
    role_menu_permissions,
    roles,
    sale_entry_config,
    shop,
    shop_analytics,
    stock,
    sub_categories,
    user_roles,
    user_types,
    users,
    vouchers,
)

api_router = APIRouter()

# Auth & navigation
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(
    dashboard_shortcuts.router, prefix="/dashboard-shortcuts", tags=["dashboard-shortcuts"]
)
api_router.include_router(menus.router, prefix="/menus", tags=["menus"])

# User management
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(user_types.router, prefix="/user-types", tags=["user-types"])
api_router.include_router(roles.router, prefix="/roles", tags=["roles"])
api_router.include_router(user_roles.router, prefix="/user-roles", tags=["user-roles"])
api_router.include_router(
    role_menu_permissions.router, prefix="/role-menu-permissions", tags=["permissions"]
)
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(audit.router, prefix="/audit-logs", tags=["audit"])

# Settings & print
api_router.include_router(company_profile.router, prefix="/company-profile", tags=["settings"])
api_router.include_router(print_configs.router, prefix="/print-configs", tags=["print"])
api_router.include_router(
    sale_entry_config.router, prefix="/sale-entry-config", tags=["settings"]
)
api_router.include_router(
    document_number_rules.router, prefix="/document-number-rules", tags=["settings"]
)

# Masters
api_router.include_router(ledgers.router, prefix="/ledgers", tags=["ledgers"])
api_router.include_router(payment_modes.router, prefix="/payment-modes", tags=["payment-modes"])
api_router.include_router(gst.router, prefix="/gst", tags=["gst"])
api_router.include_router(categories.router, prefix="/categories", tags=["categories"])
api_router.include_router(sub_categories.router, prefix="/sub-categories", tags=["sub-categories"])
api_router.include_router(products.router, prefix="/products", tags=["products"])
api_router.include_router(shop.router, prefix="/shop/banners", tags=["shop"])
api_router.include_router(shop_analytics.router, prefix="/shop", tags=["shop"])
api_router.include_router(parties.router, prefix="/parties", tags=["parties"])
api_router.include_router(stock.router, prefix="/stock", tags=["stock"])
api_router.include_router(orders.router, prefix="/orders", tags=["orders"])
api_router.include_router(discounts.router, prefix="/discounts", tags=["discounts"])

# Transactions & reports
api_router.include_router(vouchers.router, prefix="/vouchers", tags=["vouchers"])
api_router.include_router(cashbook.router, prefix="/cashbook", tags=["cashbook"])
api_router.include_router(
    financial_reports.router, prefix="/financial-reports", tags=["financial-reports"]
)
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
