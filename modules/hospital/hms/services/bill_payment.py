from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.models.ipd_bill import IpdBillPayment
from modules.hospital.hms.models.opd_bill import OpdBillPayment
from modules.hospital.hms.models.payment_mode import PaymentMode
from modules.hospital.hms.repositories.payment_mode import PaymentModeRepository
from modules.hospital.hms.schemas.bill_payment import BillPaymentCreate, BillPaymentRead

PAYMENT_TOTAL_TOLERANCE = Decimal("0.01")

PaymentEntry = tuple[str, Decimal, str | None]


def payment_to_read(payment: OpdBillPayment | IpdBillPayment) -> BillPaymentRead:
    mode = payment.payment_mode
    ledger = mode.ledger if mode else None
    return BillPaymentRead(
        id=payment.id,
        payment_mode_id=payment.payment_mode_id,
        payment_mode_code=mode.code if mode else None,
        payment_mode_name=mode.name if mode else None,
        ledger_id=ledger.id if ledger else None,
        ledger_code=ledger.code if ledger else None,
        ledger_name=ledger.name if ledger else None,
        amount=payment.amount,
        document_no=getattr(payment, "document_no", None),
        sort_order=payment.sort_order,
    )


async def resolve_payment_entries(
    session: AsyncSession,
    *,
    net_amount: Decimal,
    payments: list[BillPaymentCreate],
    legacy_payment_mode_id: str | None,
) -> tuple[list[PaymentEntry], str | None, bool]:
    """Return [(payment_mode_id, amount, document_no), ...], primary mode id, and is_cash flag."""
    entries: list[PaymentEntry] = []
    net = Decimal(str(net_amount or 0))
    if net < 0:
        net = Decimal("0")

    if payments:
        for item in payments:
            entries.append((item.payment_mode_id, item.amount, item.document_no))
    elif legacy_payment_mode_id and net > PAYMENT_TOTAL_TOLERANCE:
        entries.append((legacy_payment_mode_id, net, None))
    elif net <= PAYMENT_TOTAL_TOLERANCE:
        # Fully settled by advance (or other adjustments) — no payment modes needed.
        return [], None, True
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one payment entry is required",
        )

    if not entries:
        if net <= PAYMENT_TOTAL_TOLERANCE:
            return [], None, True
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one payment entry is required",
        )

    repo = PaymentModeRepository(session)
    total = Decimal("0")
    validated: list[PaymentEntry] = []
    modes: list[PaymentMode] = []
    for mode_id, amount, document_no in entries:
        mode = await repo.get_by_id(mode_id)
        if not mode or not mode.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payment mode not found: {mode_id}",
            )
        if amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Each payment amount must be greater than zero",
            )
        total += amount
        doc = (document_no or "").strip() or None
        validated.append((mode.id, amount, doc))
        modes.append(mode)

    if abs(total - net) > PAYMENT_TOTAL_TOLERANCE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Payment total ({total:.2f}) must equal net amount ({net:.2f})",
        )

    is_cash = all(mode.is_cash for mode in modes)
    return validated, validated[0][0], is_cash


def build_opd_payment_rows(
    bill_id: str,
    entries: list[PaymentEntry],
) -> list[OpdBillPayment]:
    rows: list[OpdBillPayment] = []
    for index, (mode_id, amount, document_no) in enumerate(entries):
        rows.append(
            OpdBillPayment(
                bill_id=bill_id,
                payment_mode_id=mode_id,
                amount=amount,
                document_no=document_no,
                sort_order=index,
                is_active=True,
            )
        )
    return rows


def build_ipd_payment_rows(
    bill_id: str,
    entries: list[PaymentEntry],
) -> list[IpdBillPayment]:
    rows: list[IpdBillPayment] = []
    for index, (mode_id, amount, document_no) in enumerate(entries):
        rows.append(
            IpdBillPayment(
                bill_id=bill_id,
                payment_mode_id=mode_id,
                amount=amount,
                document_no=document_no,
                sort_order=index,
                is_active=True,
            )
        )
    return rows


def summarize_payment_names(payments: list[BillPaymentRead]) -> str:
    if not payments:
        return "—"
    parts = []
    for payment in payments:
        label = payment.payment_mode_name or payment.payment_mode_code or "Payment"
        if payment.document_no:
            label = f"{label} [{payment.document_no}]"
        parts.append(f"{label} ({payment.amount:.2f})")
    return ", ".join(parts)
