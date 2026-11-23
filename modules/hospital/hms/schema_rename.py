"""Rename the billing service-category table to service groups on existing databases.

create_all does not rename tables or columns. This runs before create_all so
existing rows stay attached to the new names.
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

_RENAME_SQL = """
DO $$
DECLARE
  sch text;
  old_count bigint;
  new_count bigint;
BEGIN
  FOREACH sch IN ARRAY ARRAY['public', 'hospital']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = sch AND table_name = 'service_categories'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = sch AND table_name = 'service_groups'
    ) THEN
      EXECUTE format('SELECT count(*) FROM %I.service_categories', sch) INTO old_count;
      -- A reload can create service_groups before this rename. Drop that copy only
      -- when nothing points at it, then keep the original service_categories rows.
      IF old_count > 0 AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = sch AND table_name = 'patient_service_masters' AND column_name = 'group_id'
      ) THEN
        EXECUTE format('DROP TABLE %I.service_groups CASCADE', sch);
      ELSIF old_count > 0 THEN
        EXECUTE format(
          'SELECT count(*) FROM %I.patient_service_masters WHERE group_id IN (SELECT id FROM %I.service_groups)',
          sch, sch
        ) INTO new_count;
        IF new_count = 0 THEN
          EXECUTE format('DROP TABLE %I.service_groups CASCADE', sch);
        END IF;
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = sch AND table_name = 'service_categories'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = sch AND table_name = 'service_groups'
    ) THEN
      EXECUTE format('ALTER TABLE %I.service_categories RENAME TO service_groups', sch);
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = sch
        AND table_name = 'patient_service_masters'
        AND column_name = 'category_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = sch
        AND table_name = 'patient_service_masters'
        AND column_name = 'group_id'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.patient_service_masters RENAME COLUMN category_id TO group_id',
        sch
      );
    END IF;
  END LOOP;
END $$;
"""


async def rename_service_categories_to_groups(conn: AsyncConnection) -> None:
    await conn.execute(text(_RENAME_SQL))
