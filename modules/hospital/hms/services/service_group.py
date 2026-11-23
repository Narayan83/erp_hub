from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.models.service_group import ServiceGroup
from modules.hospital.hms.repositories.service_group import ServiceGroupRepository
from modules.hospital.hms.schemas.service_group import (
    ServiceGroupCreate,
    ServiceGroupRead,
    ServiceGroupUpdate,
)


class ServiceGroupService:
    def __init__(self, session: AsyncSession):
        self.repo = ServiceGroupRepository(session)

    async def list_groups(self) -> list[ServiceGroupRead]:
        items = await self.repo.list_active()
        return [ServiceGroupRead.model_validate(item) for item in items]

    async def get_group(self, group_id: str) -> ServiceGroupRead:
        item = await self.repo.get_by_id(group_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service group not found")
        return ServiceGroupRead.model_validate(item)

    async def create_group(self, data: ServiceGroupCreate) -> ServiceGroupRead:
        raw_code = (data.code or "").strip()
        code = raw_code.upper() if raw_code else await self.repo.next_numeric_code()
        existing = await self.repo.get_by_code(code)
        if existing:
            if existing.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Service group code already exists",
                )
            existing.name = data.name.strip()
            existing.sort_order = data.sort_order
            existing.is_active = True
            await self.repo.session.flush()
            await self.repo.session.refresh(existing)
            return ServiceGroupRead.model_validate(existing)

        item = ServiceGroup(
            code=code,
            name=data.name.strip(),
            sort_order=data.sort_order,
            is_active=True,
        )
        self.repo.session.add(item)
        await self.repo.session.flush()
        await self.repo.session.refresh(item)
        return ServiceGroupRead.model_validate(item)

    async def update_group(self, group_id: str, data: ServiceGroupUpdate) -> ServiceGroupRead:
        item = await self.repo.get_by_id(group_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service group not found")
        for field, value in data.model_dump(exclude_unset=True).items():
            if field == "name" and value is not None:
                value = value.strip()
            setattr(item, field, value)
        await self.repo.session.flush()
        await self.repo.session.refresh(item)
        return ServiceGroupRead.model_validate(item)

    async def delete_group(self, group_id: str) -> ServiceGroupRead:
        item = await self.repo.get_by_id(group_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service group not found")
        item.is_active = False
        await self.repo.session.flush()
        await self.repo.session.refresh(item)
        return ServiceGroupRead.model_validate(item)
