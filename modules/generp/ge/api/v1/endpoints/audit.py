from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.audit import AuditLog
from modules.generp.ge.models.auth import Menu, User
from modules.generp.ge.schemas.audit import AuditFilterMenu, AuditFiltersOut, AuditFilterUser, AuditLogOut
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.seeds.menu_definitions import MENU_DEFINITIONS
from modules.generp.ge.services.audit import record_audit
from modules.generp.ge.services.posting import restore_cancelled_voucher

router = APIRouter()

ACTIONS = ("CREATE", "UPDATE", "DELETE", "LOGIN", "RESTORE")


def _day_start(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def _day_end(d: date) -> datetime:
    return datetime.combine(d, time.max, tzinfo=timezone.utc)


@router.get("", response_model=list[AuditLogOut])
async def list_audit_logs(
    date_from: date | None = None,
    date_to: date | None = None,
    menu_code: str | None = None,
    user_id: str | None = None,
    action: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    q = select(AuditLog).order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc())
    if date_from:
        q = q.where(AuditLog.occurred_at >= _day_start(date_from))
    if date_to:
        q = q.where(AuditLog.occurred_at <= _day_end(date_to))
    if menu_code and menu_code.strip():
        q = q.where(AuditLog.menu_code == menu_code.strip())
    if user_id and user_id.strip():
        q = q.where(AuditLog.user_id == user_id.strip())
    if action and action.strip():
        q = q.where(AuditLog.action == action.strip().upper())
    q = q.limit(limit)
    rows = list((await session.execute(q)).scalars().all())
    return rows


@router.get("/filters", response_model=AuditFiltersOut)
async def audit_filters(
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    users = list(
        (await session.execute(select(User).where(User.is_active.is_(True)).order_by(User.full_name)))
        .scalars()
        .all()
    )
    db_menus = list(
        (await session.execute(select(Menu).where(Menu.is_active.is_(True)).order_by(Menu.label)))
        .scalars()
        .all()
    )
    by_code = {m.code: m.label for m in db_menus}
    for code, label, parent, *_rest in MENU_DEFINITIONS:
        if parent and code not in by_code:
            by_code[code] = label
    menus = [
        AuditFilterMenu(code=code, label=label)
        for code, label in sorted(by_code.items(), key=lambda x: x[1].lower())
        if code not in ("dashboard", "shopping", "masters", "transactions", "accounts", "reports", "stock", "user_management")
    ]
    return AuditFiltersOut(
        users=[
            AuditFilterUser(
                id=u.id,
                name=u.full_name or u.username or u.email,
                email=u.email,
            )
            for u in users
        ],
        menus=menus,
        actions=list(ACTIONS),
    )


@router.post("/{log_id}/restore", response_model=MessageResponse)
async def restore_from_audit(
    log_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    log = (await session.execute(select(AuditLog).where(AuditLog.id == log_id))).scalar_one_or_none()
    if not log:
        raise HTTPException(status_code=404, detail="Audit entry not found")
    if (log.action or "").upper() != "DELETE":
        raise HTTPException(status_code=400, detail="Only deleted records can be restored")
    details = log.details if isinstance(log.details, dict) else {}
    path = str(details.get("path") or "")
    snapshot = details.get("snapshot") if isinstance(details.get("snapshot"), dict) else {}
    voucher_id = log.entity_id or snapshot.get("id")
    if not voucher_id:
        raise HTTPException(status_code=400, detail="This audit entry cannot be restored")

    if "/cashbook/vouchers/" in path or (log.entity_type or "") in ("vouchers", "cashbook"):
        if "/cashbook/vouchers/" in path:
            from modules.generp.ge.services.accounting_voucher import AccountingVoucherService

            restored = await AccountingVoucherService(session).restore_voucher(str(voucher_id))
            await record_audit(
                session,
                user=user,
                action="RESTORE",
                menu_code=log.menu_code or "adjustment_entry",
                entity_type="vouchers",
                entity_id=restored.id,
                ref_no=restored.voucher_no,
                summary=f"Restore {restored.kind} {restored.voucher_no}",
                details={
                    "method": "POST",
                    "path": f"/api/v1/audit-logs/{log_id}/restore",
                    "request": {"audit_log_id": log_id},
                    "snapshot": snapshot or None,
                    "restored": {
                        "id": restored.id,
                        "kind": restored.kind,
                        "voucher_no": restored.voucher_no,
                        "is_active": restored.is_active,
                    },
                },
            )
            return MessageResponse(message=f"Restored {restored.voucher_no}")

    if "/vouchers/" not in path and (log.entity_type or "") not in ("vouchers", "voucher"):
        raise HTTPException(status_code=400, detail="This audit entry cannot be restored")
    voucher = await restore_cancelled_voucher(session, str(voucher_id))
    await record_audit(
        session,
        user=user,
        action="RESTORE",
        menu_code=log.menu_code or "purchase_bill_details",
        entity_type="vouchers",
        entity_id=voucher.id,
        ref_no=voucher.voucher_no,
        summary=f"Restore {voucher.voucher_type} {voucher.voucher_no}",
        details={
            "method": "POST",
            "path": f"/api/v1/audit-logs/{log_id}/restore",
            "request": {"audit_log_id": log_id},
            "snapshot": snapshot or None,
            "restored": {
                "id": voucher.id,
                "voucher_type": voucher.voucher_type,
                "voucher_no": voucher.voucher_no,
                "is_cancelled": voucher.is_cancelled,
            },
        },
    )
    return MessageResponse(message=f"Restored {voucher.voucher_no}")
