from datetime import date

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from erp_core.models.cashbook import CashbookVoucher, CashbookVoucherLine
from erp_core.models.masters import Ledger
from modules.hospital.models.clinical import OpdBill, OpdBillLine, Patient
from modules.hospital.schemas.clinical import OpdBillCreate, OpdBillOut


class OpdBillService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list(self, limit: int = 50) -> list[OpdBill]:
        return (
            await self.session.execute(
                select(OpdBill)
                .options(selectinload(OpdBill.lines))
                .where(OpdBill.is_active.is_(True))
                .order_by(OpdBill.bill_date.desc())
                .limit(limit)
            )
        ).scalars().all()

    async def create(self, data: OpdBillCreate) -> OpdBillOut:
        patient = (
            await self.session.execute(select(Patient).where(Patient.id == data.patient_id))
        ).scalar_one_or_none()
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")

        count = (await self.session.execute(select(func.count()).select_from(OpdBill))).scalar_one()
        bill_no = f"OPD-{date.today().strftime('%Y%m%d')}-{int(count) + 1:04d}"

        lines: list[OpdBillLine] = []
        gross = 0.0
        for i, line in enumerate(data.lines):
            amount = float(line.rate) * int(line.quantity)
            gross += amount
            lines.append(
                OpdBillLine(
                    service_code=line.service_code,
                    service_name=line.service_name,
                    rate=line.rate,
                    quantity=line.quantity,
                    amount=amount,
                    sort_order=i + 1,
                )
            )

        bill = OpdBill(
            bill_no=bill_no,
            bill_date=data.bill_date,
            patient_id=patient.id,
            patient_no=patient.patient_no,
            doctor_id=data.doctor_id,
            department_id=data.department_id,
            payment_mode_id=data.payment_mode_id,
            gross_amount=gross,
            net_amount=gross,
            remarks=data.remarks,
            status="saved",
            lines=lines,
        )
        self.session.add(bill)
        await self.session.flush()

        # Post to cashbook (simplified vs hospital cashbook_posting)
        cash = (
            await self.session.execute(select(Ledger).where(Ledger.system_key == "CASH"))
        ).scalar_one_or_none()
        income = (
            await self.session.execute(select(Ledger).where(Ledger.system_key == "OPD_RECEIPT"))
        ).scalar_one_or_none()
        if cash and income and gross > 0:
            self.session.add(
                CashbookVoucher(
                    voucher_no=f"OPD-{bill.bill_no}",
                    voucher_date=bill.bill_date,
                    source_type="opd_bill",
                    source_id=bill.id,
                    party_id=patient.party_id,
                    party_code=patient.patient_no,
                    narration=f"OPD bill {bill.bill_no}",
                    kind="receipt",
                    lines=[
                        CashbookVoucherLine(
                            ledger_id=cash.id, debit_amount=gross, credit_amount=0, sort_order=1
                        ),
                        CashbookVoucherLine(
                            ledger_id=income.id, debit_amount=0, credit_amount=gross, sort_order=2
                        ),
                    ],
                )
            )
            await self.session.flush()

        return OpdBillOut.model_validate(bill)
