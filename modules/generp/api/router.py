"""GenERP routes at /api/v1 (same paths as the original app). Auth stays on core."""

from fastapi import APIRouter

from modules.generp.ge.api.v1.endpoints import (
    audit,
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

generp_api = APIRouter()
module_api = generp_api
# Empty prefix: pages call /api/v1/products, /api/v1/vouchers, and so on.
MOUNT_PREFIX = ""

generp_api.include_router(dashboard.router, prefix="/dashboard", tags=["generp-dashboard"])
generp_api.include_router(
    dashboard_shortcuts.router, prefix="/dashboard-shortcuts", tags=["generp-shortcuts"]
)
generp_api.include_router(menus.router, prefix="/menus", tags=["generp-menus"])
generp_api.include_router(users.router, prefix="/users", tags=["generp-users"])
generp_api.include_router(user_types.router, prefix="/user-types", tags=["generp-user-types"])
generp_api.include_router(roles.router, prefix="/roles", tags=["generp-roles"])
generp_api.include_router(user_roles.router, prefix="/user-roles", tags=["generp-user-roles"])
generp_api.include_router(
    role_menu_permissions.router, prefix="/role-menu-permissions", tags=["generp-permissions"]
)
generp_api.include_router(notifications.router, prefix="/notifications", tags=["generp-notifications"])
generp_api.include_router(audit.router, prefix="/audit-logs", tags=["generp-audit"])
generp_api.include_router(company_profile.router, prefix="/company-profile", tags=["generp-company"])
generp_api.include_router(print_configs.router, prefix="/print-configs", tags=["generp-print"])
generp_api.include_router(
    sale_entry_config.router, prefix="/sale-entry-config", tags=["generp-sale-entry"]
)
generp_api.include_router(
    document_number_rules.router, prefix="/document-number-rules", tags=["generp-doc-numbers"]
)
generp_api.include_router(ledgers.router, prefix="/ledgers", tags=["generp-ledgers"])
generp_api.include_router(payment_modes.router, prefix="/payment-modes", tags=["generp-payment-modes"])
generp_api.include_router(gst.router, prefix="/gst", tags=["generp-gst"])
generp_api.include_router(categories.router, prefix="/categories", tags=["generp-categories"])
generp_api.include_router(sub_categories.router, prefix="/sub-categories", tags=["generp-sub-categories"])
generp_api.include_router(products.router, prefix="/products", tags=["generp-products"])
generp_api.include_router(shop.router, prefix="/shop/banners", tags=["generp-shop"])
generp_api.include_router(shop_analytics.router, prefix="/shop", tags=["generp-shop"])
generp_api.include_router(parties.router, prefix="/parties", tags=["generp-parties"])
generp_api.include_router(stock.router, prefix="/stock", tags=["generp-stock"])
generp_api.include_router(orders.router, prefix="/orders", tags=["generp-orders"])
generp_api.include_router(discounts.router, prefix="/discounts", tags=["generp-discounts"])
generp_api.include_router(vouchers.router, prefix="/vouchers", tags=["generp-vouchers"])
generp_api.include_router(cashbook.router, prefix="/cashbook", tags=["generp-cashbook"])
generp_api.include_router(
    financial_reports.router, prefix="/financial-reports", tags=["generp-financial-reports"]
)
generp_api.include_router(reports.router, prefix="/reports", tags=["generp-reports"])
