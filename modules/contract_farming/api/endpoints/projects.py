from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from erp_core.api.deps import get_current_user, get_session
from erp_core.models.auth import User
from modules.contract_farming.models.masters import CfLocation, CfPartner
from modules.contract_farming.models.project import CfProject, CfProjectPartner
from modules.contract_farming.schemas import IdName, ProjectIn, ProjectOut

router = APIRouter(prefix="/projects", tags=["cf-projects"])


async def _to_out(session: AsyncSession, project: CfProject) -> ProjectOut:
    partner_ids = [pp.partner_id for pp in (project.partners or [])]
    partners: list[IdName] = []
    if partner_ids:
        rows = (
            await session.execute(select(CfPartner).where(CfPartner.id.in_(partner_ids)).order_by(CfPartner.name))
        ).scalars().all()
        partners = [IdName(id=r.id, name=r.name) for r in rows]
    location_name = None
    if project.location_id:
        loc = (
            await session.execute(select(CfLocation).where(CfLocation.id == project.location_id))
        ).scalar_one_or_none()
        location_name = loc.name if loc else None
    return ProjectOut(
        id=project.id,
        name=project.name,
        address=project.address or "",
        location_id=project.location_id,
        location_name=location_name,
        description=project.description or "",
        start_date=project.start_date or "",
        end_date=project.end_date or "",
        is_active=bool(project.is_active),
        partner_ids=partner_ids,
        partners=partners,
        created_at=project.created_at,
    )


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    rows = list(
        (
            await session.execute(
                select(CfProject).options(selectinload(CfProject.partners)).order_by(CfProject.name)
            )
        )
        .scalars()
        .all()
    )
    return [await _to_out(session, r) for r in rows]


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    row = (
        await session.execute(
            select(CfProject)
            .options(selectinload(CfProject.partners))
            .where(CfProject.id == project_id)
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    return await _to_out(session, row)


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    data: ProjectIn,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    exists = (await session.execute(select(CfProject).where(CfProject.name == name))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail=f"Project '{name}' already exists")
    if data.location_id:
        loc = (
            await session.execute(select(CfLocation).where(CfLocation.id == data.location_id))
        ).scalar_one_or_none()
        if not loc:
            raise HTTPException(status_code=400, detail="Invalid location")
    row = CfProject(
        name=name,
        address=data.address,
        location_id=data.location_id,
        description=data.description,
        start_date=data.start_date,
        end_date=data.end_date,
        is_active=data.is_active,
    )
    session.add(row)
    await session.flush()
    for pid in data.partner_ids:
        partner = (await session.execute(select(CfPartner).where(CfPartner.id == pid))).scalar_one_or_none()
        if not partner:
            raise HTTPException(status_code=400, detail=f"Invalid partner {pid}")
        session.add(CfProjectPartner(project_id=row.id, partner_id=pid))
    await session.flush()
    row = (
        await session.execute(
            select(CfProject).options(selectinload(CfProject.partners)).where(CfProject.id == row.id)
        )
    ).scalar_one()
    return await _to_out(session, row)


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: UUID,
    data: ProjectIn,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    row = (
        await session.execute(
            select(CfProject)
            .options(selectinload(CfProject.partners))
            .where(CfProject.id == project_id)
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    name = data.name.strip()
    exists = (
        await session.execute(select(CfProject).where(CfProject.name == name, CfProject.id != project_id))
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail=f"Project '{name}' already exists")
    row.name = name
    row.address = data.address
    row.location_id = data.location_id
    row.description = data.description
    row.start_date = data.start_date
    row.end_date = data.end_date
    row.is_active = data.is_active
    row.partners.clear()
    await session.flush()
    for pid in data.partner_ids:
        partner = (await session.execute(select(CfPartner).where(CfPartner.id == pid))).scalar_one_or_none()
        if not partner:
            raise HTTPException(status_code=400, detail=f"Invalid partner {pid}")
        session.add(CfProjectPartner(project_id=row.id, partner_id=pid))
    await session.flush()
    row = (
        await session.execute(
            select(CfProject).options(selectinload(CfProject.partners)).where(CfProject.id == project_id)
        )
    ).scalar_one()
    return await _to_out(session, row)


@router.delete("/{project_id}")
async def delete_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    row = (await session.execute(select(CfProject).where(CfProject.id == project_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    await session.delete(row)
    return {"ok": True}
