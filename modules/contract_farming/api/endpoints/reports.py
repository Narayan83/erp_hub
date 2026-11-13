from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.api.deps import get_current_user, get_session
from erp_core.models.auth import User
from modules.contract_farming.models.masters import CfPartner, CfPhase, CfWorkType
from modules.contract_farming.models.project import CfProject
from modules.contract_farming.models.transaction import CfTransaction
from modules.contract_farming.schemas import ChartPoint, ChartsOut, ReportSummary

router = APIRouter(prefix="/reports", tags=["cf-reports"])


def _d(v) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


@router.get("/summary", response_model=list[ReportSummary])
async def project_summary(
    project_id: UUID | None = None,
    by_phase: bool = Query(True),
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    projects = list(
        (
            await session.execute(
                select(CfProject).where(CfProject.id == project_id) if project_id else select(CfProject).order_by(CfProject.name)
            )
        )
        .scalars()
        .all()
    )
    out: list[ReportSummary] = []
    for project in projects:
        if by_phase:
            phases = list((await session.execute(select(CfPhase).order_by(CfPhase.code))).scalars().all())
            for phase in phases:
                credit = _d(
                    (
                        await session.execute(
                            select(func.coalesce(func.sum(CfTransaction.amount), 0)).where(
                                CfTransaction.project_id == project.id,
                                CfTransaction.phase_id == phase.id,
                                CfTransaction.entry_type == "credit",
                            )
                        )
                    ).scalar()
                )
                debit = _d(
                    (
                        await session.execute(
                            select(func.coalesce(func.sum(CfTransaction.amount), 0)).where(
                                CfTransaction.project_id == project.id,
                                CfTransaction.phase_id == phase.id,
                                CfTransaction.entry_type == "debit",
                            )
                        )
                    ).scalar()
                )
                count = int(
                    (
                        await session.execute(
                            select(func.count(CfTransaction.id)).where(
                                CfTransaction.project_id == project.id,
                                CfTransaction.phase_id == phase.id,
                            )
                        )
                    ).scalar()
                    or 0
                )
                if count == 0:
                    continue
                out.append(
                    ReportSummary(
                        project_id=project.id,
                        project_name=project.name,
                        phase_id=phase.id,
                        phase_name=phase.name,
                        receipts=credit,
                        payments=debit,
                        balance=credit - debit,
                        txn_count=count,
                    )
                )
        else:
            credit = _d(
                (
                    await session.execute(
                        select(func.coalesce(func.sum(CfTransaction.amount), 0)).where(
                            CfTransaction.project_id == project.id,
                            CfTransaction.entry_type == "credit",
                        )
                    )
                ).scalar()
            )
            debit = _d(
                (
                    await session.execute(
                        select(func.coalesce(func.sum(CfTransaction.amount), 0)).where(
                            CfTransaction.project_id == project.id,
                            CfTransaction.entry_type == "debit",
                        )
                    )
                ).scalar()
            )
            count = int(
                (
                    await session.execute(
                        select(func.count(CfTransaction.id)).where(CfTransaction.project_id == project.id)
                    )
                ).scalar()
                or 0
            )
            out.append(
                ReportSummary(
                    project_id=project.id,
                    project_name=project.name,
                    receipts=credit,
                    payments=debit,
                    balance=credit - debit,
                    txn_count=count,
                )
            )
    return out


@router.get("/ledger", response_model=list[dict])
async def ledger_report(
    ledger_id: UUID | None = None,
    project_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    q = (
        select(CfTransaction)
        .order_by(CfTransaction.txn_date, CfTransaction.created_at)
    )
    if ledger_id:
        q = q.where(CfTransaction.ledger_id == ledger_id)
    if project_id:
        q = q.where(CfTransaction.project_id == project_id)
    rows = list((await session.execute(q)).scalars().all())
    running = Decimal("0")
    result = []
    for t in rows:
        delta = _d(t.amount) if t.entry_type == "credit" else -_d(t.amount)
        running += delta
        result.append(
            {
                "id": str(t.id),
                "txn_date": t.txn_date.isoformat(),
                "entry_type": t.entry_type,
                "amount": float(t.amount),
                "running_balance": float(running),
                "narration": t.narration,
                "project_id": str(t.project_id),
                "phase_id": str(t.phase_id),
                "ledger_id": str(t.ledger_id),
            }
        )
    return result


@router.get("/charts", response_model=ChartsOut)
async def charts(
    project_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    base = select(CfTransaction)
    if project_id:
        base = base.where(CfTransaction.project_id == project_id)

    # by phase receipts/payments
    by_phase: list[ChartPoint] = []
    phases = list((await session.execute(select(CfPhase).order_by(CfPhase.code))).scalars().all())
    for phase in phases:
        for et, series in (("credit", "Receipts"), ("debit", "Payments")):
            q = select(func.coalesce(func.sum(CfTransaction.amount), 0)).where(
                CfTransaction.phase_id == phase.id,
                CfTransaction.entry_type == et,
            )
            if project_id:
                q = q.where(CfTransaction.project_id == project_id)
            val = _d((await session.execute(q)).scalar())
            if val:
                by_phase.append(ChartPoint(label=phase.name, value=val, series=series))

    by_work_type: list[ChartPoint] = []
    works = list((await session.execute(select(CfWorkType).order_by(CfWorkType.code))).scalars().all())
    for wt in works:
        q = select(func.coalesce(func.sum(CfTransaction.amount), 0)).where(
            CfTransaction.work_type_id == wt.id,
            CfTransaction.entry_type == "debit",
        )
        if project_id:
            q = q.where(CfTransaction.project_id == project_id)
        val = _d((await session.execute(q)).scalar())
        if val:
            by_work_type.append(ChartPoint(label=wt.name, value=val, series="Payments"))

    by_partner: list[ChartPoint] = []
    partners = list((await session.execute(select(CfPartner).order_by(CfPartner.name))).scalars().all())
    for p in partners:
        q = select(func.coalesce(func.sum(CfTransaction.amount), 0)).where(
            CfTransaction.partner_id == p.id,
            CfTransaction.entry_type == "credit",
        )
        if project_id:
            q = q.where(CfTransaction.project_id == project_id)
        val = _d((await session.execute(q)).scalar())
        if val:
            by_partner.append(ChartPoint(label=p.name, value=val, series="Contributions"))

    receipts_vs_payments: list[ChartPoint] = []
    for et, label in (("credit", "Receipts"), ("debit", "Payments")):
        q = select(func.coalesce(func.sum(CfTransaction.amount), 0)).where(CfTransaction.entry_type == et)
        if project_id:
            q = q.where(CfTransaction.project_id == project_id)
        receipts_vs_payments.append(
            ChartPoint(label=label, value=_d((await session.execute(q)).scalar()), series="Total")
        )

    return ChartsOut(
        by_phase=by_phase,
        by_work_type=by_work_type,
        by_partner=by_partner,
        receipts_vs_payments=receipts_vs_payments,
    )
