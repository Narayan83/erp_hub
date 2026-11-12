from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.kramcop.kc.models.auth import User
from modules.kramcop.kc.models.masters import AuditLog


async def write_audit(
    session: AsyncSession,
    user: User | None,
    action: str,
    entity: str,
    entity_id: str = "",
    detail: str = "",
) -> None:
    session.add(
        AuditLog(
            user_id=str(user.id) if user and user.id else "",
            username=(user.username if user else "") or "",
            action=action,
            entity=entity,
            entity_id=str(entity_id or ""),
            detail=detail[:2000],
        )
    )


async def list_audit(session: AsyncSession, page: int = 1, page_size: int = 80):
    total = int((await session.execute(select(func.count(AuditLog.id)))).scalar() or 0)
    rows = (
        await session.execute(
            select(AuditLog)
            .order_by(AuditLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    return rows, total
