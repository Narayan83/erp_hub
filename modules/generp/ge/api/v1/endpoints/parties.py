from pathlib import Path
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.config import get_settings
from modules.generp.ge.models.masters import Ledger, Party
from modules.generp.ge.schemas.common import MessageResponse
from modules.generp.ge.schemas.masters import PartyIn, PartyOut, PartyUpdate
from modules.generp.ge.services.ledger_codes import next_ledger_code
from modules.generp.ge.services.party_codes import (
    CUSTOMER_TYPES,
    VENDOR_TYPES,
    next_party_code,
    normalize_party_code,
    party_code_taken,
)

router = APIRouter()

VALID_PARTY_TYPES = ("customer", "vendor", "both")
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
BLANK_KEYS = (
    "phone",
    "gstin",
    "contact_person",
    "address_line1",
    "address_line2",
    "address_line3",
    "address_line4",
    "city",
    "state",
    "pin_code",
    "shipping_address_line1",
    "shipping_address_line2",
    "shipping_address_line3",
    "shipping_address_line4",
    "shipping_city",
    "shipping_state",
    "shipping_pin_code",
    "email",
)


class QuickPartyIn(BaseModel):
    party_type: str = "customer"
    name: str
    phone: str | None = None
    gstin: str | None = None
    contact_person: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    address_line3: str | None = None
    address_line4: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    shipping_address_line1: str | None = None
    shipping_address_line2: str | None = None
    shipping_address_line3: str | None = None
    shipping_address_line4: str | None = None
    shipping_city: str | None = None
    shipping_state: str | None = None
    shipping_pin_code: str | None = None
    same_as_billing: bool = True
    email: str | None = None
    opening_balance: float = 0
    opening_type: str | None = None


def _validate_party_type(party_type: str) -> str:
    value = (party_type or "").strip().lower()
    if value not in VALID_PARTY_TYPES:
        raise HTTPException(status_code=400, detail="party_type must be customer, vendor, or both")
    return value


def _is_customer(party_type: str) -> bool:
    return party_type in CUSTOMER_TYPES


def _type_filter(wanted: str):
    if wanted == "customer":
        return Party.party_type.in_(CUSTOMER_TYPES)
    if wanted == "vendor":
        return Party.party_type.in_(VENDOR_TYPES)
    return Party.party_type == wanted


def _party_images_dir() -> Path:
    path = get_settings().party_images_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def _delete_party_image_file(image_path: str | None) -> None:
    if not image_path:
        return
    full = _party_images_dir() / Path(image_path).name
    if full.exists():
        full.unlink()


async def _read_upload(file: UploadFile) -> tuple[bytes, str]:
    content_type = (file.content_type or "").lower()
    ext = ALLOWED_IMAGE_TYPES.get(content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="Image must be JPEG, PNG, or WebP")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 5 MB)")
    return data, ext


async def _next_party_code(session: AsyncSession, party_type: str, preferred: str | None = None) -> str:
    try:
        return await next_party_code(session, party_type, preferred)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


async def _ensure_ledger(session: AsyncSession, party: Party) -> Ledger:
    is_customer = _is_customer(party.party_type)
    group = "Sundry Debtors" if is_customer else "Sundry Creditors"
    try:
        code = await next_ledger_code(session)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    ledger = Ledger(
        code=code,
        name=party.name,
        group_name=group,
        ledger_type="ASSET" if is_customer else "LIABILITY",
        opening_balance=party.opening_balance or 0,
        opening_type=party.opening_type or ("Dr" if is_customer else "Cr"),
        is_active=True,
    )
    session.add(ledger)
    await session.flush()
    return ledger


@router.get("", response_model=list[PartyOut])
async def list_parties(
    party_type: str | None = None,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    q = select(Party).where(Party.is_active.is_(True))
    if party_type:
        q = q.where(_type_filter(party_type))
    result = await session.execute(q)
    rows = list(result.scalars().all())

    def _party_sort(p: Party) -> tuple:
        code = str(p.code or "").strip()
        if code.isdigit():
            return (0, int(code), (p.name or "").lower())
        return (1, 0, (p.name or "").lower())

    rows.sort(key=_party_sort)
    return rows


@router.get("/next-code")
async def peek_next_code(
    party_type: str = "customer",
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    party_type = _validate_party_type(party_type)
    return {"next_code": await _next_party_code(session, party_type)}


@router.get("/{party_id}", response_model=PartyOut)
async def get_party(party_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    obj = (await session.execute(select(Party).where(Party.id == party_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return obj


async def _create_party_row(session: AsyncSession, data: PartyIn | QuickPartyIn, *, code: str | None = None) -> Party:
    party_type = _validate_party_type(data.party_type)
    payload = data.model_dump()
    payload["party_type"] = party_type
    payload["name"] = (payload.get("name") or "").strip()
    if not payload["name"]:
        raise HTTPException(status_code=400, detail="Name is required")
    payload["code"] = await _next_party_code(session, party_type, code or payload.get("code"))
    payload["opening_type"] = payload.get("opening_type") or ("Dr" if _is_customer(party_type) else "Cr")
    payload["same_as_billing"] = bool(payload.get("same_as_billing", True))
    for key in BLANK_KEYS:
        val = payload.get(key)
        payload[key] = (str(val).strip() or None) if val is not None else None
    if payload["same_as_billing"]:
        payload["shipping_address_line1"] = payload.get("address_line1")
        payload["shipping_address_line2"] = payload.get("address_line2")
        payload["shipping_address_line3"] = payload.get("address_line3")
        payload["shipping_address_line4"] = payload.get("address_line4")
        payload["shipping_city"] = payload.get("city")
        payload["shipping_state"] = payload.get("state")
        payload["shipping_pin_code"] = payload.get("pin_code")
    obj = Party(**payload)
    session.add(obj)
    await session.flush()
    ledger = await _ensure_ledger(session, obj)
    obj.ledger_id = ledger.id
    await session.flush()
    return obj


@router.post("/quick", response_model=PartyOut)
async def quick_create_party(
    data: QuickPartyIn, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    """Create a customer/vendor on the fly from the billing screen with an auto code."""
    return await _create_party_row(session, data)


@router.post("", response_model=PartyOut)
async def create_party(
    data: PartyIn, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    return await _create_party_row(session, data, code=data.code)


@router.patch("/{party_id}", response_model=PartyOut)
async def update_party(
    party_id: str,
    data: PartyUpdate,
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (await session.execute(select(Party).where(Party.id == party_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    updates = data.model_dump(exclude_unset=True)
    if "party_type" in updates and updates["party_type"] is not None:
        updates["party_type"] = _validate_party_type(updates["party_type"])
    if "code" in updates and updates["code"] is not None:
        updates["code"] = normalize_party_code(updates["code"])
        check_type = updates.get("party_type") or obj.party_type
        if await party_code_taken(session, check_type, updates["code"], exclude_id=obj.id):
            raise HTTPException(status_code=400, detail="Code already exists")
    for k, v in updates.items():
        if isinstance(v, str):
            v = v.strip() or None
        setattr(obj, k, v)
    if obj.same_as_billing:
        obj.shipping_address_line1 = obj.address_line1
        obj.shipping_address_line2 = obj.address_line2
        obj.shipping_address_line3 = obj.address_line3
        obj.shipping_address_line4 = obj.address_line4
        obj.shipping_city = obj.city
        obj.shipping_state = obj.state
        obj.shipping_pin_code = obj.pin_code
    if obj.ledger_id:
        ledger = (await session.execute(select(Ledger).where(Ledger.id == obj.ledger_id))).scalar_one_or_none()
        if ledger:
            ledger.name = obj.name
            ledger.opening_balance = obj.opening_balance or 0
            ledger.opening_type = obj.opening_type or ledger.opening_type
    await session.flush()
    return obj


@router.post("/{party_id}/image", response_model=PartyOut)
async def upload_party_image(
    party_id: str,
    file: UploadFile = File(...),
    _u=Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = (await session.execute(select(Party).where(Party.id == party_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    data, ext = await _read_upload(file)
    _delete_party_image_file(obj.image_path)
    filename = f"{obj.id}_{uuid.uuid4().hex[:8]}{ext}"
    dest = _party_images_dir() / filename
    dest.write_bytes(data)
    obj.image_path = filename
    await session.flush()
    return obj


@router.delete("/{party_id}/image", response_model=PartyOut)
async def delete_party_image(
    party_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = (await session.execute(select(Party).where(Party.id == party_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    _delete_party_image_file(obj.image_path)
    obj.image_path = None
    await session.flush()
    return obj


@router.delete("/{party_id}", response_model=MessageResponse)
async def delete_party(
    party_id: str, _u=Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    obj = (await session.execute(select(Party).where(Party.id == party_id))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    obj.is_active = False
    await session.flush()
    return MessageResponse(message="Party deactivated")
