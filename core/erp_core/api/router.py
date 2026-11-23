from fastapi import APIRouter

from erp_core.api.endpoints import (
    accounts,
    auth,
    company,
    dashboard_shortcuts,
    parties,
    print_configs,
    user_types,
    users,
)

core_router = APIRouter()
core_router.include_router(auth.router, prefix="/auth", tags=["auth"])
core_router.include_router(company.router, prefix="/company-profile", tags=["company"])
core_router.include_router(print_configs.router, prefix="/print-configs", tags=["print"])
core_router.include_router(parties.router, prefix="/parties", tags=["parties"])
core_router.include_router(accounts.router, prefix="/accounts", tags=["accounts"])
# Same paths as GenERP user management. A product that mounts its own /users
# router first (GenERP) keeps that implementation.
core_router.include_router(users.router, prefix="/users", tags=["users"])
core_router.include_router(user_types.router, prefix="/user-types", tags=["user-types"])
core_router.include_router(dashboard_shortcuts.router, prefix="/dashboard", tags=["shortcuts"])
