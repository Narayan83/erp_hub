from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.api.deps import get_current_user, get_session
from erp_core.models.auth import User
from modules.contract_farming.models.masters import (
    CfLabour,
    CfLedger,
    CfLocation,
    CfPartner,
    CfPaymentMode,
    CfPhase,
    CfVendor,
    CfWorkType,
)
from modules.contract_farming.schemas import (
    LabourIn,
    LabourOut,
    LedgerIn,
    LedgerOut,
    LocationIn,
    LocationOut,
    PartnerIn,
    PartnerOut,
    PaymentModeIn,
    PaymentModeOut,
    PhaseIn,
    PhaseOut,
    VendorIn,
    VendorOut,
    WorkTypeIn,
    WorkTypeOut,
)
from modules.contract_farming.services.balances import ledger_balance

router = APIRouter(tags=["cf-masters"])


def _register_crud(
    *,
    prefix: str,
    model,
    in_schema,
    out_schema,
    order_by,
    unique_fields: list[str] | None = None,
) -> None:
    unique_fields = unique_fields or []

    async def list_rows(
        session: AsyncSession = Depends(get_session),
        _user: User = Depends(get_current_user),
    ):
        return list((await session.execute(select(model).order_by(order_by))).scalars().all())

    async def create_row(
        data: in_schema,
        session: AsyncSession = Depends(get_session),
        _user: User = Depends(get_current_user),
    ):
        payload = data.model_dump()
        for field in unique_fields:
            val = str(payload.get(field) or "").strip()
            if not val:
                raise HTTPException(status_code=400, detail=f"{field} is required")
            payload[field] = val
            exists = (
                await session.execute(select(model).where(getattr(model, field) == val))
            ).scalar_one_or_none()
            if exists:
                raise HTTPException(status_code=400, detail=f"{field} '{val}' already exists")
        if "entry_type" in payload:
            et = str(payload["entry_type"]).strip().lower()
            if et not in ("credit", "debit"):
                raise HTTPException(status_code=400, detail="entry_type must be credit or debit")
            payload["entry_type"] = et
        if "name" in payload and isinstance(payload["name"], str):
            payload["name"] = payload["name"].strip()
            if not payload["name"]:
                raise HTTPException(status_code=400, detail="name is required")
        row = model(**payload)
        session.add(row)
        await session.flush()
        return row

    async def update_row(
        row_id: UUID,
        data: in_schema,
        session: AsyncSession = Depends(get_session),
        _user: User = Depends(get_current_user),
    ):
        row = (await session.execute(select(model).where(model.id == row_id))).scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        payload = data.model_dump()
        for field in unique_fields:
            val = str(payload.get(field) or "").strip()
            if not val:
                raise HTTPException(status_code=400, detail=f"{field} is required")
            payload[field] = val
            exists = (
                await session.execute(
                    select(model).where(getattr(model, field) == val, model.id != row_id)
                )
            ).scalar_one_or_none()
            if exists:
                raise HTTPException(status_code=400, detail=f"{field} '{val}' already exists")
        if "entry_type" in payload:
            et = str(payload["entry_type"]).strip().lower()
            if et not in ("credit", "debit"):
                raise HTTPException(status_code=400, detail="entry_type must be credit or debit")
            payload["entry_type"] = et
        if "name" in payload and isinstance(payload["name"], str):
            payload["name"] = payload["name"].strip()
        for k, v in payload.items():
            setattr(row, k, v)
        await session.flush()
        return row

    async def delete_row(
        row_id: UUID,
        session: AsyncSession = Depends(get_session),
        _user: User = Depends(get_current_user),
    ):
        row = (await session.execute(select(model).where(model.id == row_id))).scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        await session.delete(row)
        return {"ok": True}

    router.add_api_route(prefix, list_rows, methods=["GET"], response_model=list[out_schema])
    router.add_api_route(prefix, create_row, methods=["POST"], response_model=out_schema, status_code=201)
    router.add_api_route(
        f"{prefix}/{{row_id}}", update_row, methods=["PUT"], response_model=out_schema
    )
    router.add_api_route(f"{prefix}/{{row_id}}", delete_row, methods=["DELETE"])


_register_crud(
    prefix="/partners",
    model=CfPartner,
    in_schema=PartnerIn,
    out_schema=PartnerOut,
    order_by=CfPartner.name,
    unique_fields=["name"],
)
_register_crud(
    prefix="/locations",
    model=CfLocation,
    in_schema=LocationIn,
    out_schema=LocationOut,
    order_by=CfLocation.name,
    unique_fields=["name"],
)
_register_crud(
    prefix="/phases",
    model=CfPhase,
    in_schema=PhaseIn,
    out_schema=PhaseOut,
    order_by=CfPhase.code,
    unique_fields=["code"],
)
_register_crud(
    prefix="/work-types",
    model=CfWorkType,
    in_schema=WorkTypeIn,
    out_schema=WorkTypeOut,
    order_by=CfWorkType.code,
    unique_fields=["code"],
)
_register_crud(
    prefix="/labours",
    model=CfLabour,
    in_schema=LabourIn,
    out_schema=LabourOut,
    order_by=CfLabour.name,
    unique_fields=["name"],
)
_register_crud(
    prefix="/vendors",
    model=CfVendor,
    in_schema=VendorIn,
    out_schema=VendorOut,
    order_by=CfVendor.name,
    unique_fields=["name"],
)
_register_crud(
    prefix="/payment-modes",
    model=CfPaymentMode,
    in_schema=PaymentModeIn,
    out_schema=PaymentModeOut,
    order_by=CfPaymentMode.code,
    unique_fields=["code"],
)


@router.get("/ledgers", response_model=list[LedgerOut])
async def list_ledgers(
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    rows = list((await session.execute(select(CfLedger).order_by(CfLedger.code))).scalars().all())
    out: list[LedgerOut] = []
    for row in rows:
        bal = await ledger_balance(session, row.id)
        item = LedgerOut.model_validate(row)
        item.balance = bal.balance
        out.append(item)
    return out


@router.post("/ledgers", response_model=LedgerOut, status_code=201)
async def create_ledger(
    data: LedgerIn,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    code = data.code.strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    exists = (await session.execute(select(CfLedger).where(CfLedger.code == code))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail=f"code '{code}' already exists")
    row = CfLedger(**{**data.model_dump(), "code": code, "name": data.name.strip()})
    session.add(row)
    await session.flush()
    item = LedgerOut.model_validate(row)
    item.balance = (await ledger_balance(session, row.id)).balance
    return item


@router.put("/ledgers/{row_id}", response_model=LedgerOut)
async def update_ledger(
    row_id: UUID,
    data: LedgerIn,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    row = (await session.execute(select(CfLedger).where(CfLedger.id == row_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    code = data.code.strip().upper()
    exists = (
        await session.execute(select(CfLedger).where(CfLedger.code == code, CfLedger.id != row_id))
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail=f"code '{code}' already exists")
    for k, v in {**data.model_dump(), "code": code, "name": data.name.strip()}.items():
        setattr(row, k, v)
    await session.flush()
    item = LedgerOut.model_validate(row)
    item.balance = (await ledger_balance(session, row.id)).balance
    return item


@router.delete("/ledgers/{row_id}")
async def delete_ledger(
    row_id: UUID,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    row = (await session.execute(select(CfLedger).where(CfLedger.id == row_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    await session.delete(row)
    return {"ok": True}
