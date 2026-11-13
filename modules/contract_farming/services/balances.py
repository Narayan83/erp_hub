from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.contract_farming.models.masters import CfLabour, CfLedger, CfPartner, CfVendor
from modules.contract_farming.models.transaction import CfTransaction
from modules.contract_farming.schemas import BalanceOut


def _d(v) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


async def _sum_side(
    session: AsyncSession,
    *,
    entry_type: str,
    ledger_id: UUID | None = None,
    partner_id: UUID | None = None,
    labour_id: UUID | None = None,
    vendor_id: UUID | None = None,
    project_id: UUID | None = None,
) -> Decimal:
    q = select(func.coalesce(func.sum(CfTransaction.amount), 0)).where(
        CfTransaction.entry_type == entry_type
    )
    if ledger_id:
        q = q.where(CfTransaction.ledger_id == ledger_id)
    if partner_id:
        q = q.where(CfTransaction.partner_id == partner_id)
    if labour_id:
        q = q.where(CfTransaction.labour_id == labour_id)
    if vendor_id:
        q = q.where(CfTransaction.vendor_id == vendor_id)
    if project_id:
        q = q.where(CfTransaction.project_id == project_id)
    return _d((await session.execute(q)).scalar())


async def ledger_balance(session: AsyncSession, ledger_id: UUID) -> BalanceOut:
    row = (await session.execute(select(CfLedger).where(CfLedger.id == ledger_id))).scalar_one_or_none()
    if not row:
        return BalanceOut(
            entity="ledger",
            entity_id=ledger_id,
            name="?",
            credit_total=Decimal("0"),
            debit_total=Decimal("0"),
            balance=Decimal("0"),
        )
    opening = _d(row.opening_balance or "0")
    credit = await _sum_side(session, entry_type="credit", ledger_id=ledger_id)
    debit = await _sum_side(session, entry_type="debit", ledger_id=ledger_id)
    return BalanceOut(
        entity="ledger",
        entity_id=ledger_id,
        name=row.name,
        credit_total=credit,
        debit_total=debit,
        balance=opening + credit - debit,
    )


async def partner_balance(session: AsyncSession, partner_id: UUID) -> BalanceOut:
    row = (await session.execute(select(CfPartner).where(CfPartner.id == partner_id))).scalar_one_or_none()
    name = row.name if row else "?"
    credit = await _sum_side(session, entry_type="credit", partner_id=partner_id)
    debit = await _sum_side(session, entry_type="debit", partner_id=partner_id)
    return BalanceOut(
        entity="partner",
        entity_id=partner_id,
        name=name,
        credit_total=credit,
        debit_total=debit,
        balance=credit - debit,
    )


async def labour_balance(session: AsyncSession, labour_id: UUID) -> BalanceOut:
    row = (await session.execute(select(CfLabour).where(CfLabour.id == labour_id))).scalar_one_or_none()
    name = row.name if row else "?"
    credit = await _sum_side(session, entry_type="credit", labour_id=labour_id)
    debit = await _sum_side(session, entry_type="debit", labour_id=labour_id)
    # Debits are payments to labour; balance is net paid (debit - credit)
    return BalanceOut(
        entity="labour",
        entity_id=labour_id,
        name=name,
        credit_total=credit,
        debit_total=debit,
        balance=debit - credit,
    )


async def vendor_balance(session: AsyncSession, vendor_id: UUID) -> BalanceOut:
    row = (await session.execute(select(CfVendor).where(CfVendor.id == vendor_id))).scalar_one_or_none()
    name = row.name if row else "?"
    credit = await _sum_side(session, entry_type="credit", vendor_id=vendor_id)
    debit = await _sum_side(session, entry_type="debit", vendor_id=vendor_id)
    return BalanceOut(
        entity="vendor",
        entity_id=vendor_id,
        name=name,
        credit_total=credit,
        debit_total=debit,
        balance=debit - credit,
    )
