from fastapi import APIRouter

from modules.kramcop.kc.api.v1.endpoints.masters import router as masters_router
from modules.kramcop.kc.api.v1.endpoints.members import router as members_router
from modules.kramcop.kc.api.v1.endpoints.misc import router as misc_router

api_router = APIRouter()
api_router.include_router(misc_router, tags=["auth"])
api_router.include_router(members_router, tags=["members"])
api_router.include_router(masters_router, tags=["masters"])
