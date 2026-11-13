from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.kramcop.kc.models.member import Member, Transaction
from modules.kramcop.kc.schemas import MemberIn, MemberOut
from modules.kramcop.kc.services.nudi import looks_like_nudi, nudi_to_unicode
from modules.kramcop.kc.services.transliterate import english_to_kannada


def _clean(value: str | None) -> str:
    if value is None:
        return ""
    return str(value).strip()


def compose_name_kn(m: Member) -> str:
    return " ".join(p for p in (m.first_kn, m.second_kn, m.third_kn) if p).strip()


def compose_name_en(m: Member) -> str:
    return " ".join(p for p in (m.first_en, m.second_en, m.third_en) if p).strip()


def to_out(m: Member, share_nos: str = "") -> MemberOut:
    data = MemberOut.model_validate(m)
    data.name_kn = compose_name_kn(m)
    data.name_en = compose_name_en(m)
    data.shac = (m.shac or m.share_no or "").strip()
    data.share_nos = share_nos
    data.has_photo = bool(m.photo_path)
    data.has_sign = bool(m.sign_path)
    data.share_type_code = int(m.share_type_code or 4)
    return data


def normalize_kn(value: str | None) -> str:
    text = _clean(value)
    if not text:
        return ""
    if looks_like_nudi(text):
        return nudi_to_unicode(text)
    if any(ch.isascii() and ch.isalpha() for ch in text):
        return english_to_kannada(text)
    return text


def apply_kannada(payload: MemberIn) -> MemberIn:
    pairs = [
        ("first_en", "first_kn"),
        ("second_en", "second_kn"),
        ("third_en", "third_kn"),
        ("village_en", "village_kn"),
        ("post_en", "post_kn"),
        ("taluk_en", "taluk_kn"),
        ("dist_en", "dist_kn"),
    ]
    data = payload.model_dump()
    for _en_key, kn_key in pairs:
        data[kn_key] = normalize_kn(data.get(kn_key))
    if payload.auto_kannada:
        for en_key, kn_key in pairs:
            en_val = _clean(data.get(en_key))
            kn_val = _clean(data.get(kn_key))
            if en_val and not kn_val:
                data[kn_key] = english_to_kannada(en_val)
    return MemberIn(**data)


def fill_member(m: Member, payload: MemberIn) -> None:
    payload = apply_kannada(payload)
    m.acno = payload.acno
    m.shac = _clean(payload.shac)
    m.share_no = _clean(payload.shac)
    m.first_en = _clean(payload.first_en)
    m.first_kn = _clean(payload.first_kn)
    m.second_en = _clean(payload.second_en)
    m.second_kn = _clean(payload.second_kn)
    m.third_en = _clean(payload.third_en)
    m.third_kn = _clean(payload.third_kn)
    m.village_en = _clean(payload.village_en)
    m.village_kn = _clean(payload.village_kn)
    m.post_en = _clean(payload.post_en)
    m.post_kn = _clean(payload.post_kn)
    m.taluk_en = _clean(payload.taluk_en)
    m.taluk_kn = _clean(payload.taluk_kn)
    m.dist_en = _clean(payload.dist_en)
    m.dist_kn = _clean(payload.dist_kn)
    m.pin = _clean(payload.pin)
    m.category = _clean(payload.category)
    m.sex = _clean(payload.sex)
    m.mobile = _clean(payload.mobile)
    m.phone = _clean(payload.phone)
    m.closed = bool(payload.closed)
    m.share_type_code = int(payload.share_type_code or 4)
    if not m.category:
        m.category = "G"


async def next_acno(session: AsyncSession) -> int:
    result = await session.execute(select(func.coalesce(func.max(Member.acno), 0)))
    return int(result.scalar() or 0) + 1


def search_filter(query: str):
    q = f"%{query.strip()}%"
    filt = or_(
        Member.first_en.ilike(q),
        Member.first_kn.ilike(q),
        Member.second_en.ilike(q),
        Member.second_kn.ilike(q),
        Member.third_en.ilike(q),
        Member.third_kn.ilike(q),
        Member.village_en.ilike(q),
        Member.village_kn.ilike(q),
        Member.post_en.ilike(q),
        Member.post_kn.ilike(q),
        Member.mobile.ilike(q),
        Member.phone.ilike(q),
        Member.shac.ilike(q),
        Member.share_no.ilike(q),
    )
    digits = query.strip()
    if digits.isdigit():
        return or_(
            filt,
            Member.acno == int(digits),
            Member.acno.in_(select(Transaction.acno).where(Transaction.rno == digits)),
        )
    return filt
