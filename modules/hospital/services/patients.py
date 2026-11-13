from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.models.masters import Party
from modules.hospital.models.clinical import Patient
from modules.hospital.schemas.clinical import PatientCreate, PatientOut


class PatientService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list(self, q: str | None = None, limit: int = 50) -> list[PatientOut]:
        stmt = select(Patient).where(Patient.is_active.is_(True))
        if q:
            like = f"%{q.strip()}%"
            stmt = stmt.where(
                (Patient.patient_no.ilike(like))
                | (Patient.first_name.ilike(like))
                | (Patient.mobile.ilike(like))
            )
        rows = (await self.session.execute(stmt.order_by(Patient.patient_no).limit(limit))).scalars().all()
        return [self._to_out(p) for p in rows]

    async def create(self, data: PatientCreate) -> PatientOut:
        patient_no = data.patient_no
        if not patient_no:
            count = (await self.session.execute(select(func.count()).select_from(Patient))).scalar_one()
            patient_no = str(int(count) + 1).zfill(6)

        full_name = " ".join(
            p for p in [data.first_name, data.middle_name, data.last_name] if p
        )
        party = Party(
            party_type="customer",
            code=patient_no,
            name=full_name,
            phone=data.phone,
            mobile=data.mobile,
            address_line1=data.address_line1,
            city=data.city,
        )
        self.session.add(party)
        await self.session.flush()

        patient = Patient(
            party_id=party.id,
            patient_no=patient_no,
            first_name=data.first_name,
            middle_name=data.middle_name,
            last_name=data.last_name,
            gender=data.gender,
            age=data.age,
            date_of_birth=data.date_of_birth,
            mobile=data.mobile,
            phone=data.phone,
            scheme=data.scheme,
            address_line1=data.address_line1,
            city=data.city,
            aadhar_no=data.aadhar_no,
        )
        self.session.add(patient)
        await self.session.flush()
        return self._to_out(patient)

    def _to_out(self, p: Patient) -> PatientOut:
        return PatientOut(
            id=p.id,
            party_id=p.party_id,
            patient_no=p.patient_no,
            first_name=p.first_name,
            middle_name=p.middle_name,
            last_name=p.last_name,
            full_name=p.full_name,
            gender=p.gender,
            age=p.age,
            mobile=p.mobile,
            phone=p.phone,
            scheme=p.scheme,
            city=p.city,
            is_active=p.is_active,
        )
