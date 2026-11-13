"""Write and query audit trail rows."""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.models.audit import AuditLog
from modules.generp.ge.models.auth import Menu, User
from modules.generp.ge.seeds.menu_definitions import MENU_DEFINITIONS

SECRET_KEYS = frozenset(
    {
        "password",
        "hashed_password",
        "secret",
        "secret_key",
        "access_token",
        "token",
        "refresh_token",
    }
)

SKIP_PATH_PARTS = (
    "/auth/refresh",
    "/audit-logs",
    "/health",
    "/print-configs/print",
    "/print-configs/layouts/preview",
    "/discount-schemes/apply",
    "/reports/",
    "/company-profile/reset-company",
)

PATH_MENU: list[tuple[str, str]] = [
    ("/stock/stock-vouchers", ""),
    ("/stock/branches", "branch_master"),
    ("/vouchers", ""),
    ("/orders", ""),
    ("/products", "product_creation"),
    ("/parties", ""),
    ("/ledgers", "ledger_master"),
    ("/company-profile", "company_profile"),
    ("/sale-entry-config", "sale_bill_settings"),
    ("/document-number-rules", "bill_prefix"),
    ("/print-configs", "print_master"),
    ("/dashboard-shortcuts", "dashboard_shortcuts"),
    ("/discounts", "discount_master"),
    ("/shop/banners", "shopping_banner"),
    ("/cashbook/vouchers", ""),
    ("/cashbook/advance", "advance_collection"),
    ("/cashbook/payment", "adjustment_entry"),
    ("/cashbook/contra", "contra_entry"),
    ("/users", "user_addition_modification"),
    ("/user-types", "user_type_creation"),
    ("/roles", "role_management"),
    ("/user-roles", "user_role_mapping"),
    ("/role-menu-permissions", "role_menu_permissions"),
    ("/notifications", "notification_setup"),
    ("/categories", "category_creation"),
    ("/sub-categories", "sub_category_creation"),
    ("/gst", "gst_creation"),
    ("/payment-modes", "payment_mode_creation"),
    ("/auth/login", "dashboard"),
]

UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)

MENU_LABELS = {row[0]: row[1] for row in MENU_DEFINITIONS}


def should_skip_path(path: str) -> bool:
    p = path.lower()
    return any(part in p for part in SKIP_PATH_PARTS)


def action_from_method(method: str, path: str) -> str:
    m = method.upper()
    if path.rstrip("/").endswith("/auth/login"):
        return "LOGIN"
    if m == "POST":
        return "CREATE"
    if m in ("PUT", "PATCH"):
        return "UPDATE"
    if m == "DELETE":
        if "/vouchers/" in path or "/stock/stock-vouchers/" in path or "/orders/" in path:
            return "DELETE"
        return "DELETE"
    return m


def menu_from_path(path: str) -> str | None:
    lower = path.lower()
    for prefix, code in PATH_MENU:
        if prefix in lower:
            return code or None
    return None


def entity_id_from_path(path: str) -> str | None:
    found = UUID_RE.findall(path)
    return found[-1] if found else None


def entity_type_from_path(path: str) -> str | None:
    parts = [p for p in path.split("/") if p and p != "api" and p != "v1"]
    if not parts:
        return None
    if parts[-1] and UUID_RE.fullmatch(parts[-1]):
        parts = parts[:-1]
    return parts[-1] if parts else None


def _clean_value(value: Any, *, max_str: int = 8000) -> Any:
    if isinstance(value, dict):
        return {
            k: "***" if str(k).lower() in SECRET_KEYS else _clean_value(v, max_str=max_str)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_clean_value(v, max_str=max_str) for v in value]
    if isinstance(value, str) and len(value) > max_str:
        return value[: max_str - 3] + "..."
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)


def summary_from_body(body: Any, action: str, menu_label: str | None) -> tuple[str | None, str | None]:
    if not isinstance(body, dict):
        label = menu_label or "record"
        return None, f"{action.title()} {label}"
    ref = (
        body.get("voucher_no")
        or body.get("order_no")
        or body.get("code")
        or body.get("name")
        or body.get("email")
        or body.get("full_name")
        or body.get("username")
        or body.get("role_name")
        or None
    )
    vtype = body.get("voucher_type")
    items = body.get("items") or body.get("lines") or body.get("pairs")
    extra = ""
    if isinstance(items, list) and items:
        extra = f" · {len(items)} line(s)"
    bits = [action.title(), menu_label or "record"]
    if vtype:
        bits.append(str(vtype))
    kind = body.get("kind") or body.get("entry_type")
    if kind:
        bits.append(str(kind))
    if ref:
        bits.append(str(ref))
    return (str(ref) if ref else None), " ".join(str(b) for b in bits if b) + extra


async def record_audit(
    session: AsyncSession,
    *,
    user: User | None,
    action: str,
    menu_code: str | None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    ref_no: str | None = None,
    summary: str | None = None,
    ip_address: str | None = None,
    details: dict | None = None,
) -> None:
    label = None
    code = (menu_code or "").strip() or None
    if code:
        label = MENU_LABELS.get(code)
        if not label:
            menu = (
                await session.execute(select(Menu).where(Menu.code == code))
            ).scalar_one_or_none()
            label = menu.label if menu else code.replace("_", " ").title()
    session.add(
        AuditLog(
            user_id=user.id if user else None,
            user_name=(user.full_name if user else None) or (user.username if user else None),
            user_email=user.email if user else None,
            menu_code=code,
            menu_label=label,
            action=action.upper(),
            entity_type=entity_type,
            entity_id=entity_id,
            ref_no=(str(ref_no)[:120] if ref_no else None),
            summary=(summary[:2000] if summary else None),
            ip_address=ip_address,
            details=details,
        )
    )


async def record_audit_from_http(
    session: AsyncSession,
    *,
    method: str,
    path: str,
    user: User | None,
    menu_header: str | None,
    body: Any,
    ip_address: str | None,
    extra_details: dict | None = None,
) -> None:
    if should_skip_path(path):
        return
    action = action_from_method(method, path)
    menu_code = (menu_header or "").strip().lower() or None
    if menu_code in ("", "login"):
        menu_code = None
    if not menu_code:
        menu_code = menu_from_path(path)
    if action == "LOGIN":
        menu_code = menu_code or "dashboard"
    menu_label = MENU_LABELS.get(menu_code or "") if menu_code else None
    request_body = body if isinstance(body, dict) else {}
    ref_no, summary = summary_from_body(request_body, action, menu_label)
    if action == "LOGIN" and user:
        ref_no = user.username or user.email
        summary = f"Login {user.full_name or user.email}"
    snapshot = (extra_details or {}).get("snapshot") if extra_details else None
    if isinstance(snapshot, dict):
        if not ref_no:
            ref_no = snapshot.get("voucher_no") or snapshot.get("order_no") or snapshot.get("code")
        vno = snapshot.get("voucher_no")
        if vno and summary and str(vno) not in str(summary):
            summary = f"{summary} {vno}"
    details = {
        "method": method.upper(),
        "path": path,
        "request": request_body if isinstance(request_body, dict) else {},
    }
    if extra_details:
        details.update(extra_details)
    entity_id = entity_id_from_path(path)
    if not entity_id and isinstance(snapshot, dict):
        entity_id = snapshot.get("id")
    await record_audit(
        session,
        user=user,
        action=action,
        menu_code=menu_code,
        entity_type=entity_type_from_path(path),
        entity_id=entity_id,
        ref_no=ref_no,
        summary=summary,
        ip_address=ip_address,
        details=details,
    )


def parse_json_body(raw: bytes | None) -> Any:
    if not raw:
        return None
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    return _clean_value(data)


async def load_user(session: AsyncSession, user_id: str | None) -> User | None:
    if not user_id:
        return None
    return (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
