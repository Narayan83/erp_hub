"""Administrative / database-maintenance endpoints.

These power the "Clear Database" tool in the desktop Settings screen, used when
handing the software to a new hospital (or re-using masters for a similar one).
All operations are admin-only and additionally guarded by a maintenance
password so they can never run by accident.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.api.deps import get_current_user, get_session
from modules.hospital.hms.models.user import User

router = APIRouter()

# Simple maintenance password gate. Anyone clearing the DB must type this.
CLEAR_DB_PASSWORD = "2015"

# Tables that must NEVER be cleared, even if asked. Hospital information lives
# in `hospital_profile`; `alembic_version` tracks the schema migration state.
# Users, roles, menus and permissions are also protected: without them nobody
# could log in or even reach Settings to use this tool.
PROTECTED_TABLES = {
    "hospital_profile",
    "alembic_version",
    "users",
    "user_types",
    "user_role_mappings",
    "roles",
    "role_menu_permissions",
    "menus",
}

# Group ordering for the UI (lower = shown first).
GROUP_ORDER = {
    "Patient Data": 10,
    "OPD / Billing": 20,
    "IPD / Admissions": 30,
    "Pathology Transactions": 40,
    "Pharmacy Transactions": 50,
    "Other Transactions": 60,
    "Patient & Number Setup": 70,
    "Service / Billing Masters": 80,
    "Pathology Masters": 90,
    "Pharmacy Masters": 100,
    "Hospital Configuration": 110,
    "Users & Security": 120,
    "Protected": 999,
    "Other": 500,
}

# table -> (Group, default_selected). default_selected=True means the table is
# pre-ticked for clearing (typically day-to-day transactional data). Master /
# configuration tables default to unticked so they survive a reset by default.
TABLE_CLASSIFICATION: dict[str, tuple[str, bool]] = {
    # --- Patient data -----------------------------------------------------
    "patients": ("Patient Data", True),
    "patient_documents": ("Patient Data", True),
    "patient_document_views": ("Patient Data", True),
    # --- OPD / billing ----------------------------------------------------
    "opd_bills": ("OPD / Billing", True),
    "opd_bill_lines": ("OPD / Billing", True),
    "opd_bill_payments": ("OPD / Billing", True),
    "opd_tokens": ("OPD / Billing", True),
    # --- IPD --------------------------------------------------------------
    "ipd_admissions": ("IPD / Admissions", True),
    "ipd_bills": ("IPD / Admissions", True),
    "ipd_bill_lines": ("IPD / Admissions", True),
    "ipd_bill_payments": ("IPD / Admissions", True),
    "ipd_discharge_summaries": ("IPD / Admissions", True),
    # --- Pathology transactions ------------------------------------------
    "pathology_bills": ("Pathology Transactions", True),
    "pathology_bill_lines": ("Pathology Transactions", True),
    "pathology_orders": ("Pathology Transactions", True),
    "pathology_results": ("Pathology Transactions", True),
    # --- Pharmacy transactions -------------------------------------------
    "pharmacy_sale_bills": ("Pharmacy Transactions", True),
    "pharmacy_sale_bill_lines": ("Pharmacy Transactions", True),
    "pharmacy_purchase_bills": ("Pharmacy Transactions", True),
    "pharmacy_purchase_bill_lines": ("Pharmacy Transactions", True),
    # --- Other transactions ----------------------------------------------
    "short_bills": ("Other Transactions", True),
    "cashbook_vouchers": ("Other Transactions", True),
    "cashbook_voucher_lines": ("Other Transactions", True),
    # --- Patient & number setup ------------------------------------------
    "number_sequences": ("Patient & Number Setup", False),
    "patient_no_formats": ("Patient & Number Setup", False),
    "prefixes": ("Patient & Number Setup", False),
    # --- Service / billing masters ---------------------------------------
    "service_groups": ("Service / Billing Masters", False),
    "service_sub_categories": ("Service / Billing Masters", False),
    "patient_service_masters": ("Service / Billing Masters", False),
    "billing_packages": ("Service / Billing Masters", False),
    "billing_package_items": ("Service / Billing Masters", False),
    "billing_structure_mappings": ("Service / Billing Masters", False),
    "billing_types": ("Service / Billing Masters", False),
    "procedure_types": ("Service / Billing Masters", False),
    "short_bill_types": ("Service / Billing Masters", False),
    "payment_modes": ("Service / Billing Masters", False),
    # --- Pathology masters -----------------------------------------------
    "pathology_units": ("Pathology Masters", False),
    "pathology_parameters": ("Pathology Masters", False),
    "pathology_service_parameters": ("Pathology Masters", False),
    "pathology_service_members": ("Pathology Masters", False),
    "pathology_normal_ranges": ("Pathology Masters", False),
    "pathology_result_templates": ("Pathology Masters", False),
    "service_notes": ("Pathology Masters", False),
    # --- Pharmacy masters -------------------------------------------------
    "pharmacy_code_masters": ("Pharmacy Masters", False),
    "pharmacy_items": ("Pharmacy Masters", False),
    "pharmacy_suppliers": ("Pharmacy Masters", False),
    "pharmacy_group_mappings": ("Pharmacy Masters", False),
    # --- Hospital configuration ------------------------------------------
    "hospital_sections": ("Hospital Configuration", False),
    "departments": ("Hospital Configuration", False),
    "wards": ("Hospital Configuration", False),
    "doctors": ("Hospital Configuration", False),
    "authorities": ("Hospital Configuration", False),
    "ledgers": ("Hospital Configuration", False),
    "letter_templates": ("Hospital Configuration", False),
    "print_configs": ("Hospital Configuration", False),
    "notification_setups": ("Hospital Configuration", False),
}


def _label(table_name: str) -> str:
    return table_name.replace("_", " ").title()


async def require_admin(user: User = Depends(get_current_user)) -> User:
    roles = {m.role.role_name for m in user.role_mappings if m.role}
    is_admin = "Super Admin" in roles or (
        user.user_type is not None and user.user_type.sort_order == 1
    )
    if not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator can perform database maintenance.",
        )
    return user


class TableInfo(BaseModel):
    name: str
    label: str
    group: str
    group_order: int
    row_count: int
    default_selected: bool
    protected: bool


class ClearTablesRequest(BaseModel):
    password: str = Field(..., description="Maintenance password")
    tables: list[str] = Field(default_factory=list)


class ClearTablesResponse(BaseModel):
    cleared: list[str]
    skipped_protected: list[str]
    total_rows_deleted: int
    message: str


async def _list_app_tables(session: AsyncSession) -> list[tuple[str, str]]:
    """Return (schema, table_name) for core + hospital schemas."""
    result = await session.execute(
        text(
            "SELECT table_schema, table_name FROM information_schema.tables "
            "WHERE table_schema IN ('core', 'hospital') AND table_type = 'BASE TABLE' "
            "ORDER BY table_schema, table_name"
        )
    )
    return [(row[0], row[1]) for row in result.fetchall()]


def _ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _qualified(schema: str, name: str) -> str:
    return f"{_ident(schema)}.{_ident(name)}"


# Schemas this screen can offer for reset. Other products share `core` masters
# (ledgers, parties, payment modes) and their foreign keys block TRUNCATE even
# when those other tables are empty.
_APP_SCHEMAS = frozenset({"core", "hospital"})

_FK_ACTION = {
    "a": "NO ACTION",
    "r": "RESTRICT",
    "c": "CASCADE",
    "n": "SET NULL",
    "d": "SET DEFAULT",
}


def _split_columns(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(part) for part in value if part]
    return [part for part in str(value).split(",") if part]


def _fk_action(code: object) -> str:
    if isinstance(code, memoryview):
        code = code.tobytes()
    if isinstance(code, (bytes, bytearray)):
        raw = bytes(code).decode()
    else:
        raw = "" if code is None else str(code)
    raw = raw.strip()
    return _FK_ACTION.get(raw[:1] or "a", "NO ACTION")


def _fk_definition(fk: dict) -> str:
    src_cols = ", ".join(_ident(column) for column in _split_columns(fk["src_columns"]))
    tgt_cols = ", ".join(_ident(column) for column in _split_columns(fk["tgt_columns"]))
    update = _fk_action(fk.get("update_action"))
    delete = _fk_action(fk.get("delete_action"))
    target = _qualified(fk["tgt_schema"], fk["tgt_table"])
    return (
        f"FOREIGN KEY ({src_cols}) REFERENCES {target} ({tgt_cols}) "
        f"ON UPDATE {update} ON DELETE {delete}"
    )


def _kept_table_message(blockers: list[dict]) -> str:
    lines: list[str] = []
    seen: set[tuple[str, str]] = set()
    for fk in blockers:
        key = (str(fk["src_table"]), str(fk["tgt_table"]))
        if key in seen:
            continue
        seen.add(key)
        src = _label(str(fk["src_table"]))
        tgt = _label(str(fk["tgt_table"]))
        if fk["src_table"] in PROTECTED_TABLES:
            lines.append(f"{src} is always kept, and it still points at {tgt}. Untick {tgt}.")
        else:
            lines.append(f"{src} still points at {tgt}. Tick {src} as well, or untick {tgt}.")
    detail = "\n".join(f"- {line}" for line in lines)
    return (
        "Could not clear the selected tables because another table still depends on them.\n"
        f"{detail}"
    )


async def _blocking_foreign_keys(
    session: AsyncSession, clearing: set[tuple[str, str]]
) -> list[dict]:
    """Foreign keys from a table we are keeping into a table we are clearing."""
    if not clearing:
        return []
    result = await session.execute(
        text(
            """
            SELECT
                src_ns.nspname AS src_schema,
                src_rel.relname AS src_table,
                tgt_ns.nspname AS tgt_schema,
                tgt_rel.relname AS tgt_table,
                con.conname AS conname,
                con.confupdtype AS update_action,
                con.confdeltype AS delete_action,
                (
                    SELECT string_agg(att.attname, ',' ORDER BY cols.ord)
                    FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ord)
                    JOIN pg_attribute att
                      ON att.attrelid = con.conrelid AND att.attnum = cols.attnum
                ) AS src_columns,
                (
                    SELECT string_agg(att.attname, ',' ORDER BY cols.ord)
                    FROM unnest(con.confkey) WITH ORDINALITY AS cols(attnum, ord)
                    JOIN pg_attribute att
                      ON att.attrelid = con.confrelid AND att.attnum = cols.attnum
                ) AS tgt_columns,
                (
                    SELECT bool_and(NOT att.attnotnull)
                    FROM unnest(con.conkey) AS cols(attnum)
                    JOIN pg_attribute att
                      ON att.attrelid = con.conrelid AND att.attnum = cols.attnum
                ) AS all_nullable
            FROM pg_constraint con
            JOIN pg_class src_rel ON src_rel.oid = con.conrelid
            JOIN pg_namespace src_ns ON src_ns.oid = src_rel.relnamespace
            JOIN pg_class tgt_rel ON tgt_rel.oid = con.confrelid
            JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt_rel.relnamespace
            WHERE con.contype = 'f'
            """
        )
    )
    found: list[dict] = []
    for row in result.mappings():
        src = (row["src_schema"], row["src_table"])
        tgt = (row["tgt_schema"], row["tgt_table"])
        if tgt in clearing and src not in clearing:
            found.append(dict(row))
    return found


async def _detach_external_foreign_keys(session: AsyncSession, foreign_keys: list[dict]) -> list[str]:
    """Drop foreign keys owned by other products so TRUNCATE can proceed.

    PostgreSQL refuses TRUNCATE when any foreign key points at the table, even
    if the referencing table is empty. Constraints are recreated after the
    truncate. Rows that would point at deleted masters are unlinked or removed.
    """
    notes: list[str] = []
    for fk in foreign_keys:
        qualified = _qualified(fk["src_schema"], fk["src_table"])
        columns = _split_columns(fk["src_columns"])
        if columns:
            where = " OR ".join(f"{_ident(column)} IS NOT NULL" for column in columns)
            count_result = await session.execute(text(f"SELECT COUNT(*) FROM {qualified} WHERE {where}"))
            row_count = int(count_result.scalar() or 0)
            if row_count:
                label = f"{fk['src_schema']}.{fk['src_table']}"
                if fk["all_nullable"]:
                    assignments = ", ".join(f"{_ident(column)} = NULL" for column in columns)
                    await session.execute(text(f"UPDATE {qualified} SET {assignments} WHERE {where}"))
                    notes.append(f"unlinked {row_count} row(s) in {label}")
                else:
                    await session.execute(text(f"DELETE FROM {qualified} WHERE {where}"))
                    notes.append(f"removed {row_count} dependent row(s) from {label}")
        await session.execute(
            text(f"ALTER TABLE {qualified} DROP CONSTRAINT {_ident(str(fk['conname']))}")
        )
    return notes


def _restore_external_foreign_keys_sql(foreign_keys: list[dict]) -> list[str]:
    statements: list[str] = []
    for fk in foreign_keys:
        qualified = _qualified(fk["src_schema"], fk["src_table"])
        statements.append(
            f"ALTER TABLE {qualified} ADD CONSTRAINT {_ident(str(fk['conname']))} {_fk_definition(fk)}"
        )
    return statements


@router.get("/db-tables", response_model=list[TableInfo])
async def list_db_tables(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> list[TableInfo]:
    """List every table with its current row count and a suggested selection."""
    tables = await _list_app_tables(session)
    out: list[TableInfo] = []
    for schema, name in tables:
        protected = name in PROTECTED_TABLES
        if protected:
            group, default_selected = "Protected", False
        else:
            group, default_selected = TABLE_CLASSIFICATION.get(name, ("Other", False))
        try:
            count_result = await session.execute(text(f"SELECT COUNT(*) FROM {_qualified(schema, name)}"))
            row_count = int(count_result.scalar() or 0)
        except Exception:
            row_count = -1
        out.append(
            TableInfo(
                name=name,
                label=_label(name),
                group=group,
                group_order=GROUP_ORDER.get(group, 500),
                row_count=row_count,
                default_selected=default_selected and not protected,
                protected=protected,
            )
        )
    out.sort(key=lambda t: (t.group_order, t.label))
    return out


@router.post("/clear-tables", response_model=ClearTablesResponse)
async def clear_tables(
    payload: ClearTablesRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin),
) -> ClearTablesResponse:
    """Empty the selected tables. Resets identity counters so numbering starts fresh.

    Tables are truncated together in a single statement so foreign keys between
    the selected tables are respected. Protected tables (hospital information,
    users, menus) are always skipped. Foreign keys from other products that
    share core masters are detached for the truncate and put back afterward.
    """
    if payload.password != CLEAR_DB_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Incorrect maintenance password.",
        )

    requested = {t.strip() for t in payload.tables if t and t.strip()}
    if not requested:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least one table to clear.",
        )

    app_tables = await _list_app_tables(session)
    schemas_for: dict[str, list[str]] = {}
    for schema, name in app_tables:
        schemas_for.setdefault(name, [])
        if schema not in schemas_for[name]:
            schemas_for[name].append(schema)
    existing = set(schemas_for)
    unknown = requested - existing
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown table(s): {', '.join(sorted(unknown))}",
        )

    skipped_protected = sorted(requested & PROTECTED_TABLES)
    to_clear = sorted(requested - PROTECTED_TABLES)
    if not to_clear:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only protected tables were selected; nothing to clear.",
        )

    clear_pairs = [
        (schema, name) for name in to_clear for schema in schemas_for[name]
    ]
    total_rows = 0
    for schema, name in clear_pairs:
        try:
            count_result = await session.execute(
                text(f"SELECT COUNT(*) FROM {_qualified(schema, name)}")
            )
            total_rows += int(count_result.scalar() or 0)
        except Exception:
            pass

    blockers = await _blocking_foreign_keys(session, set(clear_pairs))
    in_app = [fk for fk in blockers if fk["src_schema"] in _APP_SCHEMAS]
    external = [fk for fk in blockers if fk["src_schema"] not in _APP_SCHEMAS]
    if in_app:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_kept_table_message(in_app),
        )

    table_list = ", ".join(_qualified(schema, name) for schema, name in clear_pairs)
    external_notes: list[str] = []
    try:
        external_notes = await _detach_external_foreign_keys(session, external)
        await session.execute(text(f"TRUNCATE TABLE {table_list} RESTART IDENTITY"))
        for statement in _restore_external_foreign_keys_sql(external):
            await session.execute(text(statement))
        await session.commit()
    except Exception as exc:  # noqa: BLE001 - surface DB detail to the operator
        await session.rollback()
        orig = getattr(exc, "orig", exc)
        detail = str(orig).strip() or str(exc)
        extra = getattr(orig, "detail", None)
        if extra:
            extra_text = str(extra).strip()
            if extra_text and extra_text not in detail:
                detail = f"{detail}\n{extra_text}"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Could not clear the selected tables because another table still "
                f"depends on them.\n\nDatabase said: {detail}"
            ),
        ) from exc

    msg = f"Cleared {len(to_clear)} table(s); about {total_rows} row(s) removed."
    if skipped_protected:
        msg += f" Skipped protected: {', '.join(skipped_protected)}."
    if external_notes:
        msg += " " + "; ".join(external_notes) + "."
    return ClearTablesResponse(
        cleared=to_clear,
        skipped_protected=skipped_protected,
        total_rows_deleted=total_rows,
        message=msg,
    )
