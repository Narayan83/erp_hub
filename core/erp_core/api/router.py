from fastapi import APIRouter

from erp_core.api.endpoints import accounts, auth, company, parties, print_configs

core_router = APIRouter()
core_router.include_router(auth.router, prefix="/auth", tags=["auth"])
core_router.include_router(company.router, prefix="/company-profile", tags=["company"])
core_router.include_router(print_configs.router, prefix="/print-configs", tags=["print"])
core_router.include_router(parties.router, prefix="/parties", tags=["parties"])
core_router.include_router(accounts.router, prefix="/accounts", tags=["accounts"])
