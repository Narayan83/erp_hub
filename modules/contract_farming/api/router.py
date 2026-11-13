from fastapi import APIRouter

from modules.contract_farming.api.endpoints import masters, projects, reports, transactions

module_api = APIRouter()
module_api.include_router(masters.router)
module_api.include_router(projects.router)
module_api.include_router(transactions.router)
module_api.include_router(reports.router)

MOUNT_PREFIX = "/contract-farming"
contract_farming_api = module_api
