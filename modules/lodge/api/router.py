from fastapi import APIRouter, Depends

from erp_core.api.deps import get_current_user
from erp_core.models.auth import User

lodge_api = APIRouter()
module_api = lodge_api
MOUNT_PREFIX = "/lodge"


@lodge_api.get("/status")
async def status(_: User = Depends(get_current_user)):
    return {
        "module": "lodge",
        "status": "stub",
        "message": "Migrate rooms/stays/staff from D:/fullstack/others/lodge after GenERP",
    }
