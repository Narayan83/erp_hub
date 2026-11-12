from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import User
from modules.generp.ge.services.menu import MenuService

router = APIRouter()


@router.get("")
async def list_menus(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    return await MenuService(session).get_user_menu_tree(user.id)
