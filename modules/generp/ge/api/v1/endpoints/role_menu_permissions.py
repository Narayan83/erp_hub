from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import RoleMenuPermission
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.services.menu import MenuService

router = APIRouter()


class PermissionIn(BaseModel):
    menu_id: str
    can_view: bool = False
    can_create: bool = False
    can_update: bool = False
    can_delete: bool = False


class RolePermissionsIn(BaseModel):
    role_id: str
    permissions: list[PermissionIn]


@router.get("/menus")
async def all_menus(_u=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    menus = await MenuService(session).list_packaged()
    menus.sort(key=lambda m: m.sort_order)
    return [
        {"id": m.id, "code": m.code, "label": m.label, "parent_id": m.parent_id, "sort_order": m.sort_order}
        for m in menus
    ]


@router.get("/{role_id}")
async def role_permissions(
    role_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    result = await session.execute(
        select(RoleMenuPermission).where(RoleMenuPermission.role_id == role_id)
    )
    return [
        {
            "menu_id": p.menu_id,
            "can_view": p.can_view,
            "can_create": p.can_create,
            "can_update": p.can_update,
            "can_delete": p.can_delete,
        }
        for p in result.scalars().all()
    ]


@router.put("", response_model=MessageResponse)
async def save_permissions(
    data: RolePermissionsIn,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    existing = {
        p.menu_id: p
        for p in (
            await session.execute(
                select(RoleMenuPermission).where(RoleMenuPermission.role_id == data.role_id)
            )
        ).scalars().all()
    }
    for perm in data.permissions:
        row = existing.get(perm.menu_id)
        if row:
            row.can_view = perm.can_view
            row.can_create = perm.can_create
            row.can_update = perm.can_update
            row.can_delete = perm.can_delete
        else:
            session.add(
                RoleMenuPermission(
                    role_id=data.role_id,
                    menu_id=perm.menu_id,
                    can_view=perm.can_view,
                    can_create=perm.can_create,
                    can_update=perm.can_update,
                    can_delete=perm.can_delete,
                )
            )
    await session.flush()
    return MessageResponse(message="Permissions saved")
