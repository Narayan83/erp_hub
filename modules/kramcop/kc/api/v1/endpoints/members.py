from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.kramcop.kc.core.database import get_db
from modules.kramcop.kc.core.security import get_current_user
from modules.kramcop.kc.models.auth import User
from modules.kramcop.kc.models.masters import ShareType
from modules.kramcop.kc.models.member import Member, Transaction
from modules.kramcop.kc.schemas import (
    LabelMember,
    LabelSheetResponse,
    LedgerOut,
    MemberIn,
    MemberListResponse,
    MemberOut,
    SettingsIn,
    SettingsOut,
    TransactionIn,
    TransactionOut,
)
from modules.kramcop.kc.services.audit import write_audit
from modules.kramcop.kc.services.auth import get_setting, set_setting
from modules.kramcop.kc.services.ledger import account_totals, next_share_no, payment_drcr, share_type_to_legacy
from modules.kramcop.kc.services.members import fill_member, next_acno, search_filter, to_out
from modules.kramcop.kc.services.shares import (
    SHARE_ADD,
    SHARE_DEL,
    current_shares_by_acno,
    format_share_nos,
    kind_label,
    normalize_share_no,
)
from modules.kramcop.kc.services.uploads import resolve_member_file, save_member_file

router = APIRouter()


def _txn_out(row: Transaction) -> TransactionOut:
    data = TransactionOut.model_validate(row)
    data.kind_label = kind_label(row.kind or "other")
    return data


def _with_running_balance_oldest_first(rows: list[Transaction]) -> list[TransactionOut]:
    running = 0.0
    out: list[TransactionOut] = []
    for row in rows:
        if row.kind == SHARE_ADD:
            running += float(row.amount or 0)
        elif row.kind == SHARE_DEL:
            running -= float(row.amount or 0)
        item = _txn_out(row)
        item.running_balance = running
        out.append(item)
    return out


async def _member_or_404(session: AsyncSession, member_id: UUID) -> Member:
    m = (await session.execute(select(Member).where(Member.id == member_id))).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    return m


@router.get("/members", response_model=MemberListResponse)
async def list_members(
    q: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    category: str = "",
    session: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    stmt = select(Member)
    count_stmt = select(func.count(Member.id))
    if q.strip():
        filt = search_filter(q)
        stmt = stmt.where(filt)
        count_stmt = count_stmt.where(filt)
    if category.strip():
        stmt = stmt.where(Member.category == category.strip())
        count_stmt = count_stmt.where(Member.category == category.strip())
    total = int((await session.execute(count_stmt)).scalar() or 0)
    rows = (
        await session.execute(
            stmt.order_by(Member.acno).offset((page - 1) * page_size).limit(page_size)
        )
    ).scalars().all()
    shares = await current_shares_by_acno(session, [m.acno for m in rows])
    return MemberListResponse(
        items=[to_out(m, format_share_nos(shares.get(m.acno))) for m in rows],
        total=total,
        page=page,
        page_size=page_size,
        next_acno=await next_acno(session),
    )


@router.get("/members/next-acno")
async def get_next_acno(session: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    return {"next_acno": await next_acno(session)}


@router.get("/members/by-acno/{acno}", response_model=MemberOut)
async def get_member_by_acno(acno: int, session: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    m = (await session.execute(select(Member).where(Member.acno == acno))).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail=f"ACNO {acno} not found")
    return to_out(m, format_share_nos((await current_shares_by_acno(session, [m.acno])).get(m.acno)))


@router.get("/members/labels", response_model=LabelSheetResponse)
async def label_sheet(
    q: str = "",
    acno_from: int | None = None,
    acno_to: int | None = None,
    session: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    types = {t.code: (t.prefix or "").strip() for t in (await session.execute(select(ShareType))).scalars().all()}
    stmt = select(Member).where(Member.closed.is_(False)).order_by(Member.acno)
    if q.strip():
        stmt = stmt.where(search_filter(q))
    if acno_from is not None:
        stmt = stmt.where(Member.acno >= acno_from)
    if acno_to is not None:
        stmt = stmt.where(Member.acno <= acno_to)
    rows = (await session.execute(stmt)).scalars().all()
    shares = await current_shares_by_acno(session, [m.acno for m in rows])
    items = [
        LabelMember(
            acno=m.acno,
            acno_display=_acno_display(types.get(m.share_type_code or 4, ""), m.acno),
            share_no=format_share_nos(shares.get(m.acno)),
            name_kn=" ".join(p for p in (m.first_kn, m.second_kn, m.third_kn) if p).strip(),
            name_en=" ".join(p for p in (m.first_en, m.second_en, m.third_en) if p).strip(),
            village_kn=m.village_kn,
            village_en=m.village_en,
            post_kn=m.post_kn,
            post_en=m.post_en,
            taluk_kn=m.taluk_kn,
            taluk_en=m.taluk_en,
            dist_kn=m.dist_kn,
            dist_en=m.dist_en,
            pin=m.pin,
        )
        for m in rows
    ]
    return LabelSheetResponse(prefix="", items=items)


def _acno_display(prefix: str, acno: int) -> str:
    text = (prefix or "").strip().rstrip("-")
    return f"{text}-{acno}" if text else str(acno)


@router.get("/members/{member_id}", response_model=MemberOut)
async def get_member(member_id: UUID, session: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    m = await _member_or_404(session, member_id)
    return to_out(m, format_share_nos((await current_shares_by_acno(session, [m.acno])).get(m.acno)))


@router.post("/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
async def create_member(data: MemberIn, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    exists = (await session.execute(select(Member).where(Member.acno == data.acno))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail=f"ACNO {data.acno} already exists")
    m = Member(acno=data.acno)
    fill_member(m, data)
    session.add(m)
    await session.flush()
    await write_audit(session, user, "create", "member", str(m.acno), m.first_en or m.first_kn)
    return to_out(m)


@router.put("/members/{member_id}", response_model=MemberOut)
async def update_member(
    member_id: UUID,
    data: MemberIn,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    m = await _member_or_404(session, member_id)
    other = (
        await session.execute(select(Member).where(Member.acno == data.acno, Member.id != member_id))
    ).scalar_one_or_none()
    if other:
        raise HTTPException(status_code=400, detail=f"ACNO {data.acno} already exists")
    fill_member(m, data)
    await session.flush()
    await write_audit(session, user, "update", "member", str(m.acno), m.first_en or m.first_kn)
    return to_out(m, format_share_nos((await current_shares_by_acno(session, [m.acno])).get(m.acno)))


@router.delete("/members/{member_id}")
async def delete_member(member_id: UUID, session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    m = await _member_or_404(session, member_id)
    acno = m.acno
    for row in (await session.execute(select(Transaction).where(Transaction.member_id == m.id))).scalars().all():
        row.member_id = None
    await session.delete(m)
    await write_audit(session, user, "delete", "member", str(acno), "")
    return {"ok": True}


@router.post("/members/{member_id}/photo")
async def upload_photo(
    member_id: UUID,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    m = await _member_or_404(session, member_id)
    m.photo_path = await save_member_file(m.id, "photo", file)
    await write_audit(session, user, "upload", "member_photo", str(m.acno), "")
    return {"ok": True, "has_photo": True}


@router.post("/members/{member_id}/sign")
async def upload_sign(
    member_id: UUID,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    m = await _member_or_404(session, member_id)
    m.sign_path = await save_member_file(m.id, "sign", file)
    await write_audit(session, user, "upload", "member_sign", str(m.acno), "")
    return {"ok": True, "has_sign": True}


@router.get("/members/{member_id}/photo")
async def get_photo(member_id: UUID, session: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    m = await _member_or_404(session, member_id)
    path = resolve_member_file(m.photo_path)
    if not path:
        raise HTTPException(status_code=404, detail="Photo not found")
    return FileResponse(path)


@router.get("/members/{member_id}/sign")
async def get_sign(member_id: UUID, session: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    m = await _member_or_404(session, member_id)
    path = resolve_member_file(m.sign_path)
    if not path:
        raise HTTPException(status_code=404, detail="Signature not found")
    return FileResponse(path)


@router.get("/ledger/{acno}", response_model=LedgerOut)
async def get_ledger(
    acno: int,
    session: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    member = (await session.execute(select(Member).where(Member.acno == acno))).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail=f"ACNO {acno} not found")
    rows = (
        await session.execute(
            select(Transaction)
            .where(Transaction.acno == acno, Transaction.kind.in_([SHARE_ADD, SHARE_DEL]))
            .order_by(Transaction.txn_date.asc().nullsfirst(), Transaction.created_at.asc(), Transaction.id.asc())
        )
    ).scalars().all()
    add, delete, balance, shares = await account_totals(session, acno)
    return LedgerOut(
        member=to_out(member, format_share_nos(shares)),
        items=list(reversed(_with_running_balance_oldest_first(rows))),
        addition_amount=add,
        deletion_amount=delete,
        balance=balance,
        share_nos=format_share_nos(shares),
        next_rno=await next_share_no(session),
    )


@router.get("/transactions", response_model=list[TransactionOut])
async def list_transactions(
    acno: int | None = None,
    kind: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    session: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    if acno is None:
        return []
    stmt = select(Transaction).where(Transaction.acno == acno)
    if kind:
        stmt = stmt.where(Transaction.kind == kind)
    rows = (
        await session.execute(
            stmt.order_by(Transaction.txn_date.desc().nullslast(), Transaction.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    return [_txn_out(r) for r in rows]


@router.get("/transactions/current-shares")
async def current_shares(
    acno: int,
    session: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    held = (await current_shares_by_acno(session, [acno])).get(acno, [])
    add, delete, balance, _shares = await account_totals(session, acno)
    return {
        "acno": acno,
        "share_nos": format_share_nos(held),
        "shares": held,
        "addition_amount": add,
        "deletion_amount": delete,
        "balance": balance,
        "next_rno": await next_share_no(session),
    }


@router.get("/transactions/next-rno")
async def get_next_rno(session: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    return {"next_rno": await next_share_no(session)}


@router.post("/transactions", response_model=list[TransactionOut], status_code=status.HTTP_201_CREATED)
async def create_transaction(
    data: TransactionIn,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    member = (await session.execute(select(Member).where(Member.acno == data.acno))).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=400, detail=f"ACNO {data.acno} not found in customer master")
    if data.shac.strip():
        member.shac = data.shac.strip()
    qty = max(1, int(data.share_count or 1))
    add, delete, balance, held = await account_totals(session, data.acno)
    if data.kind == SHARE_DEL:
        if balance <= 0:
            raise HTTPException(status_code=400, detail="Deletion not allowed: this account has no share balance")
        if balance - float(data.amount or 0) < 0:
            raise HTTPException(status_code=400, detail="Deletion not allowed: balance cannot go negative")
        share = normalize_share_no(data.rno)
        if not share:
            raise HTTPException(status_code=400, detail="Share number (RNO) is required for deletion")
        if share not in held:
            raise HTTPException(status_code=400, detail=f"Share {share} is not held on ACNO {data.acno}")
        qty = 1
        numbers = [share]
    else:
        if balance + float(data.amount or 0) * qty < 0:
            raise HTTPException(status_code=400, detail="Balance cannot go negative")
        start = normalize_share_no(data.rno) or await next_share_no(session)
        numbers = []
        try:
            n = int(start)
            numbers = [str(n + i) for i in range(qty)]
        except ValueError:
            numbers = [start] if qty == 1 else [f"{start}-{i + 1}" for i in range(qty)]
        for share in numbers:
            if share in held:
                raise HTTPException(status_code=400, detail=f"Share {share} is already held on ACNO {data.acno}")

    typ = share_type_to_legacy(data.share_type_code or member.share_type_code or 4)
    created: list[Transaction] = []
    for share in numbers:
        row = Transaction(
            member_id=member.id,
            acno=data.acno,
            typ=typ,
            astyp=str(data.share_type_code or member.share_type_code or 4),
            txn_date=data.txn_date,
            rno=share,
            amount=data.amount,
            drcr=payment_drcr(data.kind, data.payment_mode),
            kind=data.kind,
            narration=data.narration.strip(),
            board_meeting=data.board_meeting.strip(),
            share_count=1,
        )
        session.add(row)
        created.append(row)
    await session.flush()
    await write_audit(session, user, "create", "transaction", str(data.acno), f"{data.kind} {', '.join(numbers)}")
    return [_txn_out(r) for r in created]


@router.delete("/transactions/{txn_id}")
async def delete_transaction(
    txn_id: UUID,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = (await session.execute(select(Transaction).where(Transaction.id == txn_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found")
    acno = row.acno
    await session.delete(row)
    await write_audit(session, user, "delete", "transaction", str(acno), row.rno)
    return {"ok": True}


@router.get("/settings", response_model=SettingsOut)
async def get_settings_api(session: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    count = int((await session.execute(select(func.count(Member.id)))).scalar() or 0)
    return SettingsOut(
        society_name=await get_setting(session, "society_name", "Kramcop"),
        acno_prefix=await get_setting(session, "acno_prefix", "D-"),
        member_count=count,
    )


@router.put("/settings", response_model=SettingsOut)
async def save_settings(
    data: SettingsIn,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await set_setting(session, "society_name", data.society_name.strip() or "Kramcop")
    await set_setting(session, "acno_prefix", data.acno_prefix)
    await write_audit(session, user, "update", "settings", "settings", data.society_name)
    count = int((await session.execute(select(func.count(Member.id)))).scalar() or 0)
    return SettingsOut(society_name=data.society_name, acno_prefix=data.acno_prefix, member_count=count)
