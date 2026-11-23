"""Add hospital columns that create_all will not alter onto an existing database."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

_SQL = """
DO $$
DECLARE
  sch text;
BEGIN
  FOREACH sch IN ARRAY ARRAY['public', 'hospital']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = sch AND table_name = 'single_service_opd_options'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.single_service_opd_options ADD COLUMN IF NOT EXISTS services_start_unselected BOOLEAN NOT NULL DEFAULT FALSE',
        sch
      );
    END IF;
  END LOOP;
END $$;
"""


async def ensure_hospital_columns(conn: AsyncConnection) -> None:
    await conn.execute(text(_SQL))
