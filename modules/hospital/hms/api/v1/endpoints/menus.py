from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.api.deps import get_current_user, get_session
from modules.hospital.hms.models.user import User
from modules.hospital.hms.schemas.menu import MenuCreate, MenuRead, MenuUpdate
from modules.hospital.hms.services.menu import MenuService

router = APIRouter()


@router.get("", response_model=list[MenuRead])
async def list_menus(
    include_inactive: bool = Query(False),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await MenuService(session).list_menus(include_inactive=include_inactive)


@router.get("/{menu_id}", response_model=MenuRead)
async def get_menu(
    menu_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await MenuService(session).get_menu(menu_id)


@router.post("", response_model=MenuRead, status_code=201)
async def create_menu(
    data: MenuCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await MenuService(session).create_menu(data)


@router.patch("/{menu_id}", response_model=MenuRead)
async def update_menu(
    menu_id: str,
    data: MenuUpdate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await MenuService(session).update_menu(menu_id, data)


@router.delete("/{menu_id}", response_model=MenuRead)
async def delete_menu(
    menu_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await MenuService(session).delete_menu(menu_id)
