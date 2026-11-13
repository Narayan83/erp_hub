"""Columns added after the first Kramcop release. Safe to run on every start."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def ensure_kramcop_schema(session: AsyncSession) -> None:
    statements = [
        "ALTER TABLE kc_members ADD COLUMN IF NOT EXISTS shac VARCHAR(40) DEFAULT ''",
        "ALTER TABLE kc_members ADD COLUMN IF NOT EXISTS share_type_code INTEGER DEFAULT 4",
        "ALTER TABLE kc_members ADD COLUMN IF NOT EXISTS photo_path VARCHAR(250) DEFAULT ''",
        "ALTER TABLE kc_members ADD COLUMN IF NOT EXISTS sign_path VARCHAR(250) DEFAULT ''",
        """
        UPDATE kc_members SET shac = share_no
        WHERE COALESCE(shac, '') = '' AND COALESCE(share_no, '') <> ''
        """,
        "UPDATE kc_members SET category = 'G' WHERE COALESCE(category, '') = ''",
        "ALTER TABLE kc_transactions ADD COLUMN IF NOT EXISTS kind VARCHAR(30) DEFAULT 'other'",
        "ALTER TABLE kc_transactions ADD COLUMN IF NOT EXISTS narration VARCHAR(250) DEFAULT ''",
        "ALTER TABLE kc_transactions ADD COLUMN IF NOT EXISTS board_meeting VARCHAR(80) DEFAULT ''",
        "ALTER TABLE kc_transactions ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 1",
        "ALTER TABLE kc_share_types ADD COLUMN IF NOT EXISTS prefix VARCHAR(10) DEFAULT ''",
        "UPDATE kc_share_types SET prefix = 'A' WHERE code = 1 AND COALESCE(prefix, '') = ''",
        "UPDATE kc_share_types SET prefix = 'B' WHERE code = 2 AND COALESCE(prefix, '') = ''",
        "UPDATE kc_share_types SET prefix = 'C' WHERE code = 3 AND COALESCE(prefix, '') = ''",
        "UPDATE kc_share_types SET prefix = 'D' WHERE code = 4 AND COALESCE(prefix, '') = ''",
        "CREATE INDEX IF NOT EXISTS ix_kc_transactions_kind ON kc_transactions (kind)",
        """
        UPDATE kc_transactions SET kind = CASE
            WHEN typ = 88 AND drcr IN (2, 3, 4) THEN 'share_deletion'
            WHEN typ = 88 THEN 'share_addition'
            ELSE 'other'
        END
        WHERE COALESCE(kind, '') IN ('', 'other') AND typ IS NOT NULL
        """,
        "UPDATE kc_app_settings SET value = 'D-' WHERE key = 'acno_prefix' AND COALESCE(value, '') = ''",
    ]
    for sql in statements:
        await session.execute(text(sql))
