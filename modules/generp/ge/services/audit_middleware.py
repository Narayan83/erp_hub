"""HTTP middleware: record create / update / delete after a successful API call."""

from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from modules.generp.ge.core.database import AsyncSessionLocal
from modules.generp.ge.core.security import decode_access_token
from modules.generp.ge.services.audit import load_user, parse_json_body, record_audit_from_http, should_skip_path

logger = logging.getLogger(__name__)

MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class AuditTrailMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        method = request.method.upper()
        path = request.url.path
        if method not in MUTATING or should_skip_path(path):
            return await call_next(request)

        body_bytes = b""
        ctype = (request.headers.get("content-type") or "").lower()
        if "application/json" in ctype:
            try:
                body_bytes = await request.body()
            except Exception:
                body_bytes = b""

        response = await call_next(request)
        if not (200 <= response.status_code < 300):
            return response

        try:
            await _write(request, path, method, body_bytes)
        except Exception:
            logger.exception("Audit trail write failed")
        return response


async def _write(request: Request, path: str, method: str, body_bytes: bytes) -> None:
    auth = request.headers.get("authorization") or ""
    token = auth.split(" ", 1)[1].strip() if auth.lower().startswith("bearer ") else None
    user_id = decode_access_token(token) if token else None
    body = parse_json_body(body_bytes)
    menu_header = request.headers.get("x-menu-code")
    client = request.client.host if request.client else None
    async with AsyncSessionLocal() as session:
        user = await load_user(session, user_id)
        if method == "POST" and path.rstrip("/").endswith("/auth/login") and isinstance(body, dict):
            ident = str(body.get("email") or "").strip().lower()
            if ident and not user:
                from sqlalchemy import func, or_, select

                from modules.generp.ge.models.auth import User

                user = (
                    await session.execute(
                        select(User).where(
                            or_(func.lower(User.username) == ident, func.lower(User.email) == ident)
                        )
                    )
                ).scalars().first()
        extra: dict = {}
        if method == "DELETE" and "/vouchers/" in path:
            from modules.generp.ge.services.audit import entity_id_from_path
            from modules.generp.ge.services.posting import dump_voucher_trace, load_voucher

            vid = entity_id_from_path(path)
            if vid:
                if "/cashbook/vouchers/" in path:
                    from modules.generp.ge.services.accounting_voucher import AccountingVoucherService
                    from modules.generp.ge.services.cashbook_posting import dump_cashbook_trace

                    svc = AccountingVoucherService(session)
                    try:
                        cv = await svc.load_voucher(vid)
                        extra["snapshot"] = dump_cashbook_trace(cv)
                    except Exception:
                        extra["snapshot"] = {"id": vid}
                else:
                    voucher = await load_voucher(session, vid)
                    if voucher:
                        extra["snapshot"] = dump_voucher_trace(voucher)
        await record_audit_from_http(
            session,
            method=method,
            path=path,
            user=user,
            menu_header=menu_header,
            body=body if isinstance(body, dict) else {},
            ip_address=client,
            extra_details=extra,
        )
        await session.commit()
