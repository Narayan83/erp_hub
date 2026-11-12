from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.models.auth import NotificationSetup, User


class NotificationService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_setup(self, event_code: str) -> dict:
        result = await self.session.execute(
            select(NotificationSetup).where(NotificationSetup.event_code == event_code)
        )
        rows = list(result.scalars().all())
        enabled_ids = {row.user_id for row in rows if row.is_enabled}

        result = await self.session.execute(
            select(User).where(User.is_active.is_(True)).order_by(User.full_name)
        )
        users = list(result.scalars().all())
        return {
            "event_code": event_code,
            "users": [
                {
                    "user_id": u.id,
                    "full_name": u.full_name,
                    "email": u.email,
                    "is_enabled": u.id in enabled_ids,
                }
                for u in users
            ],
        }

    async def save_setup(self, event_code: str, recipients: list[dict]) -> dict:
        await self.session.execute(
            delete(NotificationSetup).where(NotificationSetup.event_code == event_code)
        )
        for item in recipients:
            if not item.get("is_enabled"):
                continue
            self.session.add(
                NotificationSetup(
                    event_code=event_code,
                    user_id=item["user_id"],
                    is_enabled=True,
                )
            )
        await self.session.flush()
        return {"event_code": event_code, "recipient_count": len(recipients)}
