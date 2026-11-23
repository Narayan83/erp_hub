from io import BytesIO
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.kramcop.kc.core.database import get_db
from modules.kramcop.kc.core.security import get_current_user
from modules.kramcop.kc.models.auth import User
from modules.kramcop.kc.models.masters import Category, Company, Role, RoleMenu, ShareType, UserRole
from modules.kramcop.kc.models.member import Member
from modules.kramcop.kc.schemas import (
    AuditOut,
    CategoryIn,
    CategoryOut,
    CompanyIn,
    CompanyOut,
    RoleIn,
    RoleMenuIn,
    RoleOut,
    ScheduleList,
    ScheduleRow,
    ShareTypeIn,
    ShareTypeOut,
    SummaryList,
    SummaryRow,
    UserIn,
    UserInfo,
)
from modules.kramcop.kc.services.access import MENU_CATALOG, set_role_menus
from modules.kramcop.kc.services.audit import list_audit, write_audit
from modules.kramcop.kc.services.auth import create_user, get_setting, list_users, set_setting, to_user_info, update_user
from modules.kramcop.kc.services.ledger import balances_by_acno, balances_by_acno_share_type
from modules.kramcop.kc.services.members import compose_name_en, compose_name_kn

router = APIRouter()


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(session: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    return list((await session.execute(select(Category).order_by(Category.code))).scalars().all())


@router.post("/categories", response_model=CategoryOut, status_code=201)
async def create_category(data: CategoryIn, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    code = data.code.strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")
    exists = (await session.execute(select(Category).where(Category.code == code))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail=f"Category {code} already exists")
    if data.is_default:
        for row in (await session.execute(select(Category))).scalars().all():
            row.is_default = False
    row = Category(code=code, name_en=data.name_en.strip(), name_kn=data.name_kn.strip(), is_default=data.is_default)
    session.add(row)
    await session.flush()
    await write_audit(session, user, "create", "category", code, data.name_en)
    return row


@router.put("/categories/{cat_id}", response_model=CategoryOut)
async def update_category(
    cat_id: UUID, data: CategoryIn, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    row = (await session.execute(select(Category).where(Category.id == cat_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")
    if data.is_default:
        for other in (await session.execute(select(Category))).scalars().all():
            other.is_default = False
    row.code = data.code.strip().upper()
    row.name_en = data.name_en.strip()
    row.name_kn = data.name_kn.strip()
    row.is_default = data.is_default
    await write_audit(session, user, "update", "category", row.code, row.name_en)
    return row


@router.delete("/categories/{cat_id}")
async def delete_category(cat_id: UUID, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row = (await session.execute(select(Category).where(Category.id == cat_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")
    used = int((await session.execute(select(func.count(Member.id)).where(Member.category == row.code))).scalar() or 0)
    if used:
        raise HTTPException(status_code=400, detail=f"Category {row.code} is used by {used} members")
    await write_audit(session, user, "delete", "category", row.code, "")
    await session.delete(row)
    return {"ok": True}


@router.get("/share-types", response_model=list[ShareTypeOut])
async def list_share_types(session: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    return list((await session.execute(select(ShareType).order_by(ShareType.code))).scalars().all())


@router.post("/share-types", response_model=ShareTypeOut, status_code=201)
async def create_share_type(data: ShareTypeIn, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    exists = (await session.execute(select(ShareType).where(ShareType.code == data.code))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail=f"Share type {data.code} already exists")
    row = ShareType(
        code=data.code,
        prefix=data.prefix.strip().upper(),
        name=data.name.strip(),
        legacy_code=data.legacy_code,
        is_active=data.is_active,
    )
    session.add(row)
    await session.flush()
    await write_audit(session, user, "create", "share_type", str(data.code), data.name)
    return row


@router.put("/share-types/{st_id}", response_model=ShareTypeOut)
async def update_share_type(
    st_id: UUID, data: ShareTypeIn, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    row = (await session.execute(select(ShareType).where(ShareType.id == st_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Share type not found")
    other = (
        await session.execute(select(ShareType).where(ShareType.code == data.code, ShareType.id != st_id))
    ).scalar_one_or_none()
    if other:
        raise HTTPException(status_code=400, detail=f"Share type {data.code} already exists")
    row.code = data.code
    row.prefix = data.prefix.strip().upper()
    row.name = data.name.strip()
    row.legacy_code = data.legacy_code
    row.is_active = data.is_active
    await write_audit(session, user, "update", "share_type", str(row.code), row.name)
    return row


@router.delete("/share-types/{st_id}")
async def delete_share_type(st_id: UUID, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row = (await session.execute(select(ShareType).where(ShareType.id == st_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Share type not found")
    used = int((await session.execute(select(func.count(Member.id)).where(Member.share_type_code == row.code))).scalar() or 0)
    if used:
        raise HTTPException(status_code=400, detail=f"Share type {row.code} is used by {used} members")
    await write_audit(session, user, "delete", "share_type", str(row.code), "")
    await session.delete(row)
    return {"ok": True}


def _role_out(row: Role, menus: list[RoleMenu]) -> RoleOut:
    return RoleOut(
        id=row.id,
        name=row.name,
        description=row.description,
        menus=[
            RoleMenuIn(
                menu_key=m.menu_key,
                can_view=m.can_view,
                can_add=m.can_add,
                can_edit=m.can_edit,
                can_delete=m.can_delete,
            )
            for m in menus
        ],
    )


@router.get("/menus")
async def list_menus(_user: User = Depends(get_current_user)):
    return [{"key": key, "label": label} for key, label in MENU_CATALOG]


@router.get("/roles", response_model=list[RoleOut])
async def list_roles(session: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    roles = list((await session.execute(select(Role).order_by(Role.name))).scalars().all())
    menus = list((await session.execute(select(RoleMenu))).scalars().all())
    by_role: dict[UUID, list[RoleMenu]] = {}
    for m in menus:
        by_role.setdefault(m.role_id, []).append(m)
    return [_role_out(r, by_role.get(r.id, [])) for r in roles]


@router.post("/roles", response_model=RoleOut, status_code=201)
async def create_role(data: RoleIn, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Role name is required")
    exists = (await session.execute(select(Role).where(func.lower(Role.name) == name.lower()))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail="Role already exists")
    row = Role(name=name, description=data.description.strip())
    session.add(row)
    await session.flush()
    await set_role_menus(session, row.id, [m.model_dump() for m in data.menus])
    await write_audit(session, user, "create", "role", name, "")
    menus = list((await session.execute(select(RoleMenu).where(RoleMenu.role_id == row.id))).scalars().all())
    return _role_out(row, menus)


@router.put("/roles/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: UUID, data: RoleIn, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    row = (await session.execute(select(Role).where(Role.id == role_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Role not found")
    other = (
        await session.execute(select(Role).where(func.lower(Role.name) == data.name.strip().lower(), Role.id != role_id))
    ).scalar_one_or_none()
    if other:
        raise HTTPException(status_code=400, detail="Role already exists")
    row.name = data.name.strip()
    row.description = data.description.strip()
    await set_role_menus(session, row.id, [m.model_dump() for m in data.menus])
    await write_audit(session, user, "update", "role", row.name, "")
    menus = list((await session.execute(select(RoleMenu).where(RoleMenu.role_id == row.id))).scalars().all())
    return _role_out(row, menus)


@router.delete("/roles/{role_id}")
async def delete_role(role_id: UUID, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row = (await session.execute(select(Role).where(Role.id == role_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Role not found")
    if row.name.lower() == "admin":
        raise HTTPException(status_code=400, detail="Admin role cannot be deleted")
    await session.execute(delete(RoleMenu).where(RoleMenu.role_id == role_id))
    await session.execute(delete(UserRole).where(UserRole.role_id == role_id))
    await write_audit(session, user, "delete", "role", row.name, "")
    await session.delete(row)
    return {"ok": True}


@router.get("/company", response_model=CompanyOut)
async def get_company(session: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    row = (await session.execute(select(Company).limit(1))).scalar_one_or_none()
    count = int((await session.execute(select(func.count(Member.id)))).scalar() or 0)
    if not row:
        return CompanyOut(name_en=await get_setting(session, "society_name", "Kramcop"), member_count=count)
    data = CompanyOut.model_validate(row)
    data.member_count = count
    return data


async def _sync_platform_company(session: AsyncSession, row: Company) -> None:
    """Keep the shared company profile in step with the society letterhead."""
    from erp_core.models.masters import CompanyProfile

    profile = (
        await session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
    ).scalar_one_or_none()
    if profile is None:
        return
    if row.name_en:
        profile.name = row.name_en
    profile.address_line1 = row.address_en or profile.address_line1
    profile.city = row.village or row.district or profile.city
    profile.state = row.state or profile.state
    profile.pin_code = row.pin or profile.pin_code
    profile.phone = row.phone or profile.phone
    profile.mobile = row.mobile or profile.mobile
    profile.email = row.email or profile.email
    profile.website = row.website or profile.website
    profile.gstin = row.gstin or profile.gstin


@router.put("/company", response_model=CompanyOut)
async def save_company(data: CompanyIn, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row = (await session.execute(select(Company).limit(1))).scalar_one_or_none()
    if not row:
        row = Company()
        session.add(row)
    for key, value in data.model_dump().items():
        setattr(row, key, value.strip() if isinstance(value, str) else value)
    await set_setting(session, "society_name", row.name_en or "Kramcop")
    await _sync_platform_company(session, row)
    await write_audit(session, user, "update", "company", row.name_en, "")
    await session.flush()
    count = int((await session.execute(select(func.count(Member.id)))).scalar() or 0)
    out = CompanyOut.model_validate(row)
    out.member_count = count
    return out


@router.get("/users", response_model=list[UserInfo])
async def users_list(session: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    return [await to_user_info(session, u) for u in await list_users(session)]


@router.post("/users", response_model=UserInfo, status_code=201)
async def users_create(data: UserIn, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    created = await create_user(session, data)
    await write_audit(session, user, "create", "user", created.username, created.email)
    return await to_user_info(session, created)


@router.put("/users/{user_id}", response_model=UserInfo)
async def users_update(
    user_id: UUID, data: UserIn, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    target = (await session.execute(select(User).where(User.id == str(user_id)))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == user.id and not data.is_active:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own login")
    updated = await update_user(session, target, data)
    await write_audit(session, user, "update", "user", updated.username, "")
    return await to_user_info(session, updated)


@router.delete("/users/{user_id}")
async def users_delete(user_id: UUID, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    target = (await session.execute(select(User).where(User.id == str(user_id)))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own login")
    await session.execute(delete(UserRole).where(UserRole.user_id == target.id))
    await write_audit(session, user, "delete", "user", target.username, "")
    await session.delete(target)
    return {"ok": True}


@router.get("/audit")
async def audit_list(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    rows, total = await list_audit(session, page, page_size)
    return {"items": [AuditOut.model_validate(r) for r in rows], "total": total, "page": page}


@router.get("/reports/share-schedule", response_model=ScheduleList)
async def share_schedule(
    q: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    from modules.kramcop.kc.services.members import search_filter

    stmt = select(Member)
    count_stmt = select(func.count(Member.id))
    if q.strip():
        filt = search_filter(q)
        stmt = stmt.where(filt)
        count_stmt = count_stmt.where(filt)
    total = int((await session.execute(count_stmt)).scalar() or 0)
    rows = (
        await session.execute(stmt.order_by(Member.acno).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    bals = await balances_by_acno(session, [m.acno for m in rows])
    items = []
    for m in rows:
        add, delete, balance, shares = bals.get(m.acno, (0.0, 0.0, 0.0, []))
        items.append(
            ScheduleRow(
                acno=m.acno,
                name_en=compose_name_en(m),
                name_kn=compose_name_kn(m),
                mobile=m.mobile,
                category=m.category,
                share_nos=", ".join(shares),
                addition_amount=add,
                deletion_amount=delete,
                balance=balance,
            )
        )
    return ScheduleList(items=items, total=total, page=page, page_size=page_size)


def _lang_text(language: str, en: str, kn: str) -> str:
    if language == "kn":
        return (kn or en or "").strip()
    return (en or kn or "").strip()


def _share_type_label(code: int, prefix: str, name: str) -> str:
    parts = [p for p in ((prefix or "").strip(), (name or "").strip()) if p]
    if parts:
        return " · ".join(parts)
    return str(code) if code else ""


_SUMMARY_EXPORT_COLUMNS: tuple[tuple[str, str], ...] = (
    ("acno", "ACNO"),
    ("name", "Name"),
    ("share_no", "Share no"),
    ("village", "Village"),
    ("post", "Post"),
    ("taluk", "Taluk"),
    ("district", "District"),
    ("category", "Category"),
    ("sex", "Sex"),
    ("mobile", "Mobile"),
    ("phone", "Phone"),
    ("share_type", "Share type"),
    ("balance", "Balance"),
)


def _summary_export_columns(raw: str) -> list[tuple[str, str]]:
    if (raw or "").strip() == "-":
        return []
    by_key = dict(_SUMMARY_EXPORT_COLUMNS)
    wanted = [part.strip() for part in (raw or "").split(",") if part.strip()]
    if not wanted:
        return list(_SUMMARY_EXPORT_COLUMNS)
    picked: list[tuple[str, str]] = []
    seen: set[str] = set()
    for key in wanted:
        if key in by_key and key not in seen:
            picked.append((key, by_key[key]))
            seen.add(key)
    return picked or list(_SUMMARY_EXPORT_COLUMNS)


def _summary_export_value(row: SummaryRow, key: str, language: str):
    if key == "acno":
        return row.acno
    if key == "balance":
        return row.balance
    if key == "share_type":
        return row.share_type_label or (str(row.share_type_code) if row.share_type_code else "")
    return _summary_filter_text(row, key, language)


def _summary_filter_text(row: SummaryRow, key: str, language: str) -> str:
    if key == "acno":
        return str(row.acno)
    if key == "name":
        return _lang_text(language, row.name_en, row.name_kn)
    if key == "share_no":
        return row.share_no
    if key == "village":
        return _lang_text(language, row.village_en, row.village_kn)
    if key == "post":
        return _lang_text(language, row.post_en, row.post_kn)
    if key == "taluk":
        return _lang_text(language, row.taluk_en, row.taluk_kn)
    if key == "district":
        return _lang_text(language, row.district_en, row.district_kn)
    if key == "category":
        return row.category
    if key == "sex":
        return row.sex
    if key == "mobile":
        return row.mobile
    if key == "phone":
        return row.phone
    if key == "share_type":
        code = str(row.share_type_code) if row.share_type_code else ""
        return " ".join(p for p in (row.share_type_label, code) if p)
    if key == "balance":
        return f"{row.balance:.2f}"
    return ""


def _apply_summary_view(
    items: list[SummaryRow],
    *,
    language: str,
    share_type: int | None,
    text_filters: dict[str, str],
    sort: str,
    sort_dir: str,
) -> list[SummaryRow]:
    out: list[SummaryRow] = []
    for row in items:
        if share_type is not None and row.share_type_code != share_type:
            continue
        matched = True
        for key, needle in text_filters.items():
            query = (needle or "").strip().lower()
            if not query:
                continue
            text = _summary_filter_text(row, key, language).strip().lower()
            if key == "taluk":
                if text != query:
                    matched = False
                    break
            elif query not in text:
                matched = False
                break
        if matched:
            out.append(row)
    reverse = sort_dir == "desc"
    if sort == "acno":
        out.sort(key=lambda r: r.acno, reverse=reverse)
    elif sort == "balance":
        out.sort(key=lambda r: r.balance, reverse=reverse)
    elif sort == "share_type":
        out.sort(key=lambda r: (r.share_type_code, (r.share_type_label or "").lower()), reverse=reverse)
    elif sort:
        out.sort(key=lambda r: _summary_filter_text(r, sort, language).lower(), reverse=reverse)
    else:
        out.sort(key=lambda r: r.acno)
    return out


async def _build_share_summary(
    session: AsyncSession,
    as_on: str | None,
    balance: str,
) -> tuple:
    from datetime import date as date_cls

    as_on_d = date_cls.fromisoformat(as_on) if as_on else date_cls.today()
    members = {m.acno: m for m in (await session.execute(select(Member))).scalars().all()}
    type_rows = list((await session.execute(select(ShareType))).scalars().all())
    types = {t.code: t for t in type_rows}
    legacy_to_code = {int(t.legacy_code): t.code for t in type_rows if t.legacy_code is not None}
    prefix_to_code = {(t.prefix or "").strip().upper(): t.code for t in type_rows if (t.prefix or "").strip()}
    bals = await balances_by_acno_share_type(
        session,
        as_on_d,
        legacy_to_code=legacy_to_code,
        prefix_to_code=prefix_to_code,
        known_codes=set(types),
    )
    items: list[SummaryRow] = []
    for (acno, code), (_add, _delete, bal, shares) in bals.items():
        if balance == "positive" and bal <= 0:
            continue
        if balance == "zero" and bal != 0:
            continue
        if balance == "negative" and bal >= 0:
            continue
        m = members.get(acno)
        if not m:
            continue
        st = types.get(code)
        prefix = (st.prefix or "").strip() if st else ""
        type_name = (st.name or "").strip() if st else ""
        items.append(
            SummaryRow(
                acno=acno,
                name_en=compose_name_en(m),
                name_kn=compose_name_kn(m),
                balance=bal,
                share_nos=", ".join(shares),
                share_no=(m.share_no or m.shac or "").strip(),
                village_en=(m.village_en or "").strip(),
                village_kn=(m.village_kn or "").strip(),
                post_en=(m.post_en or "").strip(),
                post_kn=(m.post_kn or "").strip(),
                taluk_en=(m.taluk_en or "").strip(),
                taluk_kn=(m.taluk_kn or "").strip(),
                district_en=(m.dist_en or "").strip(),
                district_kn=(m.dist_kn or "").strip(),
                category=(m.category or "").strip(),
                sex=(m.sex or "").strip(),
                mobile=(m.mobile or "").strip(),
                phone=(m.phone or "").strip(),
                share_type_code=code,
                share_type_name=type_name,
                share_type_prefix=prefix,
                share_type_label=_share_type_label(code, prefix, type_name),
            )
        )
    society = await get_setting(session, "society_name", "Kramcop")
    return as_on_d, society, items


def _summary_text_filters(
    f_acno: str,
    f_name: str,
    f_share_no: str,
    f_village: str,
    f_post: str,
    f_taluk: str,
    f_district: str,
    f_category: str,
    f_sex: str,
    f_mobile: str,
    f_phone: str,
    f_share_type: str,
    f_balance: str,
) -> dict[str, str]:
    return {
        "acno": f_acno,
        "name": f_name,
        "share_no": f_share_no,
        "village": f_village,
        "post": f_post,
        "taluk": f_taluk,
        "district": f_district,
        "category": f_category,
        "sex": f_sex,
        "mobile": f_mobile,
        "phone": f_phone,
        "share_type": f_share_type,
        "balance": f_balance,
    }


@router.get("/reports/share-summary", response_model=SummaryList)
async def share_summary(
    as_on: str | None = None,
    balance: str = "positive",
    language: str = "kn",
    session: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    as_on_d, society, items = await _build_share_summary(session, as_on, balance)
    items.sort(key=lambda r: r.acno)
    return SummaryList(
        society_name=society,
        as_on=as_on_d,
        language=language,
        items=items,
        total=len(items),
    )


@router.get("/reports/share-summary/export")
async def share_summary_export(
    as_on: str | None = None,
    balance: str = "positive",
    language: str = "kn",
    fmt: str = "xlsx",
    share_type: int | None = None,
    sort: str = "acno",
    sort_dir: str = "asc",
    f_acno: str = "",
    f_name: str = "",
    f_share_no: str = "",
    f_village: str = "",
    f_post: str = "",
    f_taluk: str = "",
    f_district: str = "",
    f_category: str = "",
    f_sex: str = "",
    f_mobile: str = "",
    f_phone: str = "",
    f_share_type: str = "",
    f_balance: str = "",
    columns: str = "",
    header1: str = "",
    header2: str = "",
    member_acno: int | None = None,
    session: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    as_on_d, society, items = await _build_share_summary(session, as_on, balance)
    items = _apply_summary_view(
        items,
        language=language,
        share_type=share_type,
        text_filters=_summary_text_filters(
            f_acno, f_name, f_share_no, f_village, f_post, f_taluk, f_district,
            f_category, f_sex, f_mobile, f_phone, f_share_type, f_balance,
        ),
        sort=sort,
        sort_dir=sort_dir,
    )
    if member_acno is not None:
        items = [row for row in items if row.acno == member_acno]
    data = SummaryList(society_name=society, as_on=as_on_d, language=language, items=items, total=len(items))
    export_columns = _summary_export_columns(columns)
    headers = [label for _key, label in export_columns]
    rows = [[_summary_export_value(r, key, language) for key, _label in export_columns] for r in data.items]
    title = header1.strip() or data.society_name
    subtitle = header2.strip() or f"As on {data.as_on.strftime('%d/%m/%Y')}"
    if fmt == "csv":
        def _csv_cell(value: object) -> str:
            text = "" if value is None else str(value)
            return '"' + text.replace('"', '""') + '"'

        lines = [_csv_cell(title), _csv_cell(subtitle), ",".join(_csv_cell(label) for label in headers)]
        for row in rows:
            lines.append(",".join(_csv_cell(c) for c in row))
        content = ("\ufeff" + "\n".join(lines)).encode("utf-8")
        return StreamingResponse(
            BytesIO(content),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=share-summary.csv"},
        )
    wb = Workbook()
    ws = wb.active
    ws.title = "Share summary"
    ws.append([title])
    ws.append([subtitle])
    ws.append([])
    ws.append(headers)
    for row in rows:
        ws.append(row)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=share-summary.xlsx"},
    )
