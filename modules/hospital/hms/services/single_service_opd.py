import re
from datetime import date
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.models.doctor import Doctor
from modules.hospital.hms.models.menu import Menu
from modules.hospital.hms.models.patient_service_master import PatientServiceMaster
from modules.hospital.hms.models.payment_mode import PaymentMode
from modules.hospital.hms.models.role_menu_permission import RoleMenuPermission
from modules.hospital.hms.models.single_service_opd import (
    SingleServiceOpdBill,
    SingleServiceOpdBillLine,
    SingleServiceOpdOption,
    SingleServiceOpdOptionService,
)
from modules.hospital.hms.repositories.patient import PatientRepository
from modules.hospital.hms.repositories.single_service_opd import (
    SingleServiceOpdBillRepository,
    SingleServiceOpdOptionRepository,
)
from modules.hospital.hms.schemas.single_service_opd import (
    SingleServiceOpdBillCreate,
    SingleServiceOpdBillRead,
    SingleServiceOpdBillReportRead,
    SingleServiceOpdBillReportRow,
    SingleServiceOpdBillServiceRead,
    SingleServiceOpdBillUpdate,
    SingleServiceOpdOptionCreate,
    SingleServiceOpdOptionRead,
    SingleServiceOpdOptionServiceRead,
    SingleServiceOpdOptionUpdate,
)
from modules.hospital.hms.services.bill_number import BillNumberService

MENU_CODE_PREFIX = "sso_"


def suggest_prefix(name: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", (name or "").upper())
    if not words:
        return "SSO"
    if len(words) == 1:
        return words[0][:6]
    return "".join(word[0] for word in words)[:6] or "SSO"


def suggest_menu_code(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (name or "").strip().lower()).strip("_")
    slug = (slug[:40] or "bill")
    return f"{MENU_CODE_PREFIX}{slug}"


class SingleServiceOpdService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.option_repo = SingleServiceOpdOptionRepository(session)
        self.bill_repo = SingleServiceOpdBillRepository(session)
        self.patient_repo = PatientRepository(session)
        self.bill_no_svc = BillNumberService(session)

    @staticmethod
    def _service_rows(item: SingleServiceOpdOption) -> list[SingleServiceOpdOptionServiceRead]:
        rows: list[SingleServiceOpdOptionServiceRead] = []
        for link in item.services or []:
            master = link.service
            rows.append(
                SingleServiceOpdOptionServiceRead(
                    service_id=link.service_id,
                    service_code=master.code if master else None,
                    service_name=(master.name if master else "") or "",
                    rate=SingleServiceOpdService._catalog_rate(master),
                    service_charge=(
                        Decimal(str(master.service_charge))
                        if master and master.service_charge is not None
                        else None
                    ),
                    sort_order=int(link.sort_order or 0),
                )
            )
        if rows:
            return rows
        # Legacy rows before the junction table was populated.
        if item.service_id:
            master = item.service
            return [
                SingleServiceOpdOptionServiceRead(
                    service_id=item.service_id,
                    service_code=master.code if master else None,
                    service_name=item.service_name
                    or (master.name if master else "")
                    or "",
                    rate=SingleServiceOpdService._catalog_rate(master),
                    service_charge=(
                        Decimal(str(master.service_charge))
                        if master and master.service_charge is not None
                        else None
                    ),
                    sort_order=0,
                )
            ]
        return []

    @staticmethod
    def _catalog_rate(master: PatientServiceMaster | None) -> Decimal | None:
        """Rate entered on the service. Service charge is used when rate was left at zero."""
        if master is None:
            return None
        rate = Decimal(str(master.rate or 0))
        charge = Decimal(str(master.service_charge or 0))
        if rate > 0:
            return rate
        if charge > 0:
            return charge
        return rate

    @classmethod
    def _option_to_read(cls, item: SingleServiceOpdOption) -> SingleServiceOpdOptionRead:
        services = cls._service_rows(item)
        if services:
            service_id = services[0].service_id
            service_name = ", ".join(
                row.service_name for row in services if row.service_name
            ) or item.service_name
        else:
            service_id = item.service_id
            service_name = item.service_name or (item.service.name if item.service else "")
        return SingleServiceOpdOptionRead(
            id=item.id,
            name=item.name,
            menu_code=item.menu_code,
            service_id=service_id,
            service_name=service_name,
            services=services,
            doctor_id=item.doctor_id,
            doctor_name=item.doctor.full_name if item.doctor else None,
            use_patient_id=item.use_patient_id,
            default_rate=Decimal(str(item.default_rate or 0)),
            bill_prefix=item.bill_prefix,
            sort_order=item.sort_order,
            is_active=item.is_active,
        )

    @staticmethod
    def _bill_service_rows(bill: SingleServiceOpdBill) -> list[SingleServiceOpdBillServiceRead]:
        rows = [
            SingleServiceOpdBillServiceRead(
                service_id=line.service_id,
                service_name=line.service_name,
                rate=Decimal(str(line.rate or 0)),
                sort_order=int(line.sort_order or 0),
            )
            for line in (bill.lines or [])
        ]
        if rows:
            return rows
        if bill.service_id or bill.service_name:
            return [
                SingleServiceOpdBillServiceRead(
                    service_id=bill.service_id or "",
                    service_name=bill.service_name or "",
                    rate=Decimal(str(bill.rate or 0)),
                    sort_order=0,
                )
            ]
        return []

    @classmethod
    def _bill_to_read(cls, bill: SingleServiceOpdBill) -> SingleServiceOpdBillRead:
        services = cls._bill_service_rows(bill)
        return SingleServiceOpdBillRead(
            id=bill.id,
            bill_no=bill.bill_no,
            bill_date=bill.bill_date,
            option_id=bill.option_id,
            option_name=bill.option.name if bill.option else None,
            patient_id=bill.patient_id,
            patient_no=bill.patient_no,
            patient_name=bill.patient_name,
            doctor_id=bill.doctor_id,
            doctor_name=bill.doctor.full_name if bill.doctor else None,
            service_id=services[0].service_id if services else bill.service_id,
            service_name=bill.service_name,
            services=services,
            rate=Decimal(str(bill.rate)),
            payment_mode_id=bill.payment_mode_id,
            payment_mode_name=bill.payment_mode_name or "Cash",
        )

    async def list_options(self) -> list[SingleServiceOpdOptionRead]:
        items = await self.option_repo.list_all()
        return [self._option_to_read(item) for item in items]

    async def get_option_by_menu(self, menu_code: str) -> SingleServiceOpdOptionRead:
        item = await self.option_repo.get_by_menu_code(menu_code)
        if not item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="This billing option is not set up or is inactive.",
            )
        return self._option_to_read(item)

    async def create_option(self, data: SingleServiceOpdOptionCreate) -> SingleServiceOpdOptionRead:
        name = data.name.strip()
        if await self.option_repo.get_by_name(name):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Option name already exists")
        masters = await self._require_services(data.service_ids or [])
        primary = masters[0]
        doctor = await self._require_doctor(data.doctor_id)
        prefix = await self._unique_prefix(data.bill_prefix or suggest_prefix(name))
        menu_code = await self._unique_menu_code(suggest_menu_code(name))
        item = SingleServiceOpdOption(
            name=name,
            menu_code=menu_code,
            service_id=primary.id,
            service_name=primary.name,
            doctor_id=doctor.id,
            use_patient_id=data.use_patient_id,
            default_rate=float(data.default_rate),
            bill_prefix=prefix,
            sort_order=await self.option_repo.next_sort_order(),
            is_active=data.is_active,
        )
        self.session.add(item)
        await self.session.flush()
        await self._replace_option_services(item, masters)
        await self._sync_menu(item, grant_permissions=True)
        loaded = await self.option_repo.get_by_id(item.id)
        return self._option_to_read(loaded)  # type: ignore[arg-type]

    async def update_option(
        self, option_id: str, data: SingleServiceOpdOptionUpdate
    ) -> SingleServiceOpdOptionRead:
        item = await self.option_repo.get_by_id(option_id)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Option not found")
        payload = data.model_dump(exclude_unset=True)
        if "name" in payload and payload["name"]:
            other = await self.option_repo.get_by_name(payload["name"])
            if other and other.id != item.id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="Option name already exists"
                )
            item.name = payload["name"].strip()
        if "service_ids" in payload and payload["service_ids"]:
            masters = await self._require_services(payload["service_ids"])
            primary = masters[0]
            item.service_id = primary.id
            item.service_name = primary.name
            await self._replace_option_services(item, masters)
        if "doctor_id" in payload and payload["doctor_id"]:
            doctor = await self._require_doctor(payload["doctor_id"])
            item.doctor_id = doctor.id
        if "use_patient_id" in payload and payload["use_patient_id"] is not None:
            item.use_patient_id = payload["use_patient_id"]
        if "default_rate" in payload and payload["default_rate"] is not None:
            item.default_rate = float(payload["default_rate"])
        if "bill_prefix" in payload and payload["bill_prefix"]:
            prefix = payload["bill_prefix"].strip().upper()
            self._validate_prefix(prefix)
            other = await self.option_repo.get_by_prefix(prefix)
            if other and other.id != item.id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="Bill prefix already used"
                )
            item.bill_prefix = prefix
        if "is_active" in payload and payload["is_active"] is not None:
            item.is_active = payload["is_active"]
        if "sort_order" in payload and payload["sort_order"] is not None:
            item.sort_order = int(payload["sort_order"])
        await self.session.flush()
        await self._sync_menu(item, grant_permissions=False)
        loaded = await self.option_repo.get_by_id(item.id)
        return self._option_to_read(loaded)  # type: ignore[arg-type]

    async def reorder_options(self, option_ids: list[str]) -> list[SingleServiceOpdOptionRead]:
        """Apply list order as sort_order (0..n) and keep Billing menu order in sync."""
        existing = {item.id: item for item in await self.option_repo.list_all()}
        unknown = [oid for oid in option_ids if oid not in existing]
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more billing options were not found",
            )
        if len(option_ids) != len(existing):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Reorder list must include every billing option",
            )
        for index, option_id in enumerate(option_ids):
            item = existing[option_id]
            if item.sort_order != index:
                item.sort_order = index
            await self._sync_menu(item, grant_permissions=False)
        await self.session.flush()
        return [self._option_to_read(existing[oid]) for oid in option_ids]

    async def delete_option(self, option_id: str) -> SingleServiceOpdOptionRead:
        item = await self.option_repo.get_by_id(option_id)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Option not found")
        snapshot = self._option_to_read(item)
        bill_count = await self.bill_repo.count_for_option(option_id)
        if bill_count:
            item.is_active = False
            await self._set_generated_menu_active(item.menu_code, False)
            await self.session.flush()
            return snapshot
        await self._remove_generated_menu(item.menu_code)
        await self.session.delete(item)
        await self.session.flush()
        return snapshot

    async def create_bill(
        self, data: SingleServiceOpdBillCreate, *, user_id: str | None
    ) -> SingleServiceOpdBillRead:
        option = await self.option_repo.get_by_id(data.option_id)
        if not option or not option.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Billing option not found")
        doctor = await self._optional_doctor(data.doctor_id)

        services, line_rates = await self._bill_services_and_rates(
            option,
            lines=data.lines,
            service_ids=data.service_ids,
            service_id=data.service_id,
            total=Decimal(str(data.rate or 0)),
        )
        patient_id, patient_no, patient_name = await self._resolve_patient(option, data)
        payment_mode_id, payment_mode_name = await self._resolve_payment_mode(data.payment_mode_id)
        bill_no = await self.bill_no_svc.generate_single_service_opd_no(
            option.id,
            option.bill_prefix,
            data.bill_date,
        )
        bill = SingleServiceOpdBill(
            bill_no=bill_no,
            bill_date=data.bill_date,
            option_id=option.id,
            patient_id=patient_id,
            patient_no=patient_no,
            patient_name=patient_name,
            doctor_id=doctor.id if doctor else None,
            service_id=services[0].id,
            service_name=self._summary_service_name(services),
            rate=float(sum(line_rates, Decimal("0"))),
            payment_mode_id=payment_mode_id,
            payment_mode_name=payment_mode_name,
            created_by_user_id=user_id,
        )
        self.session.add(bill)
        await self.session.flush()
        await self._replace_bill_lines(bill, services, line_rates)
        loaded = await self.bill_repo.get_by_id(bill.id)
        return self._bill_to_read(loaded)  # type: ignore[arg-type]

    async def update_bill(
        self, bill_id: str, data: SingleServiceOpdBillUpdate
    ) -> SingleServiceOpdBillRead:
        bill = await self.bill_repo.get_by_id(bill_id)
        if not bill or not bill.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found")
        option = await self.option_repo.get_by_id(bill.option_id)
        if not option:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Billing option not found")

        payload = data.model_dump(exclude_unset=True)
        if "bill_date" in payload and payload["bill_date"] is not None:
            bill.bill_date = payload["bill_date"]
        if "doctor_id" in payload:
            doctor = await self._optional_doctor(payload.get("doctor_id"))
            bill.doctor_id = doctor.id if doctor else None
        services_changed = bool(payload.get("lines")) or "service_ids" in payload or (
            "service_id" in payload and payload["service_id"]
        )
        selected: list[PatientServiceMaster] | None = None
        line_rates: list[Decimal] | None = None
        if services_changed:
            selected, line_rates = await self._bill_services_and_rates(
                option,
                lines=payload.get("lines"),
                service_ids=payload.get("service_ids"),
                service_id=payload.get("service_id") or bill.service_id,
                total=Decimal(str(payload.get("rate") if payload.get("rate") is not None else bill.rate)),
            )
            bill.service_id = selected[0].id
            bill.service_name = self._summary_service_name(selected)
            bill.rate = float(sum(line_rates, Decimal("0")))
        elif "rate" in payload and payload["rate"] is not None:
            bill.rate = float(payload["rate"])
        if selected is not None and line_rates is not None:
            await self._replace_bill_lines(bill, selected, line_rates)
        if "payment_mode_id" in payload:
            payment_mode_id, payment_mode_name = await self._resolve_payment_mode(
                payload.get("payment_mode_id")
            )
            bill.payment_mode_id = payment_mode_id
            bill.payment_mode_name = payment_mode_name

        # Patient updates — honour option mode when any patient field is present.
        touching_patient = any(
            key in payload for key in ("patient_id", "patient_no", "patient_name")
        )
        if touching_patient:
            pseudo = SingleServiceOpdBillCreate(
                option_id=option.id,
                bill_date=bill.bill_date,
                doctor_id=bill.doctor_id,
                patient_id=payload.get("patient_id", bill.patient_id),
                patient_no=payload.get("patient_no", bill.patient_no),
                patient_name=payload.get("patient_name", bill.patient_name or ""),
                service_id=bill.service_id,
                rate=Decimal(str(bill.rate)),
            )
            patient_id, patient_no, patient_name = await self._resolve_patient(option, pseudo)
            bill.patient_id = patient_id
            bill.patient_no = patient_no
            bill.patient_name = patient_name

        await self.session.flush()
        loaded = await self.bill_repo.get_by_id(bill_id)
        return self._bill_to_read(loaded)  # type: ignore[arg-type]

    async def list_bills(self, option_id: str, bill_date: date) -> list[SingleServiceOpdBillRead]:
        option = await self.option_repo.get_by_id(option_id)
        if not option:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Billing option not found")
        bills = await self.bill_repo.list_for_option_on_date(option_id, bill_date)
        return [self._bill_to_read(bill) for bill in bills]

    async def get_bill(self, bill_id: str) -> SingleServiceOpdBillRead:
        bill = await self.bill_repo.get_by_id(bill_id)
        if not bill or not bill.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found")
        return self._bill_to_read(bill)

    async def search_bills(self, *, option_id: str, query: str) -> list[SingleServiceOpdBillRead]:
        text = query.strip()
        if not text:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Enter a bill number or name"
            )
        option = await self.option_repo.get_by_id(option_id)
        if not option:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Billing option not found")
        bills = await self.bill_repo.search(option_id, text)
        return [self._bill_to_read(bill) for bill in bills]

    async def build_report(
        self,
        *,
        option_id: str,
        from_date: date,
        to_date: date,
    ) -> SingleServiceOpdBillReportRead:
        if from_date > to_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="From date cannot be after To date",
            )
        option = await self.option_repo.get_by_id(option_id)
        if not option:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Billing option not found")
        bills = await self.bill_repo.list_by_option_and_dates(option_id, from_date, to_date)
        rows = [
            SingleServiceOpdBillReportRow(
                serial_no=index,
                bill_id=bill.id,
                bill_no=bill.bill_no,
                bill_date=bill.bill_date,
                patient_name=bill.patient_name,
                amount=Decimal(str(bill.rate)),
            )
            for index, bill in enumerate(bills, start=1)
        ]
        grand_total = sum((row.amount for row in rows), Decimal("0"))
        return SingleServiceOpdBillReportRead(
            option_id=option.id,
            option_name=option.name,
            from_date=from_date,
            to_date=to_date,
            rows=rows,
            grand_total=grand_total,
        )

    async def cancel_bill(self, bill_id: str) -> SingleServiceOpdBillRead:
        bill = await self.bill_repo.get_by_id(bill_id)
        if not bill or not bill.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found")
        bill.is_active = False
        await self.session.flush()
        return self._bill_to_read(bill)

    async def _resolve_patient(
        self, option: SingleServiceOpdOption, data: SingleServiceOpdBillCreate
    ) -> tuple[str | None, str | None, str]:
        if option.use_patient_id:
            patient_no = (data.patient_no or "").strip()
            patient = None
            if data.patient_id:
                patient = await self.patient_repo.get_by_id(data.patient_id)
            if patient is None and patient_no:
                patient = await self.patient_repo.get_by_patient_no(patient_no)
            if patient is None or not patient.is_active:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
            return patient.id, patient.patient_no, patient.full_name
        name = (data.patient_name or "").strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Patient name is required"
            )
        return None, None, name

    async def _require_services(self, service_ids: list[str]) -> list[PatientServiceMaster]:
        if not service_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="At least one service is required"
            )
        masters: list[PatientServiceMaster] = []
        seen: set[str] = set()
        for service_id in service_ids:
            if service_id in seen:
                continue
            seen.add(service_id)
            service = await self.session.get(PatientServiceMaster, service_id)
            if not service or not service.is_active:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")
            masters.append(service)
        return masters

    async def _require_doctor(self, doctor_id: str) -> Doctor:
        doctor = await self.session.get(Doctor, doctor_id)
        if not doctor or not doctor.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Doctor not found")
        return doctor

    async def _optional_doctor(self, doctor_id: str | None) -> Doctor | None:
        if not doctor_id:
            return None
        return await self._require_doctor(doctor_id)

    async def _replace_option_services(
        self, option: SingleServiceOpdOption, masters: list[PatientServiceMaster]
    ) -> None:
        await self.session.execute(
            delete(SingleServiceOpdOptionService).where(
                SingleServiceOpdOptionService.option_id == option.id
            )
        )
        await self.session.flush()
        for index, master in enumerate(masters):
            self.session.add(
                SingleServiceOpdOptionService(
                    option_id=option.id,
                    service_id=master.id,
                    sort_order=index,
                )
            )
        await self.session.flush()
        # Drop any cached collection so the next load sees the new rows.
        self.session.expire(option, ["services"])

    def _allowed_services(
        self, option: SingleServiceOpdOption
    ) -> dict[str, PatientServiceMaster | None]:
        allowed = {link.service_id: link.service for link in (option.services or [])}
        if not allowed and option.service_id:
            allowed = {option.service_id: option.service}
        return allowed

    async def _bill_services_and_rates(
        self,
        option: SingleServiceOpdOption,
        *,
        lines: list | None,
        service_ids: list[str] | None,
        service_id: str | None,
        total: Decimal,
    ) -> tuple[list[PatientServiceMaster], list[Decimal]]:
        written: list[tuple[str, Decimal]] = []
        for raw in lines or []:
            if isinstance(raw, dict):
                sid = str(raw.get("service_id") or "").strip()
                amount = Decimal(str(raw.get("rate") or 0))
            else:
                sid = str(getattr(raw, "service_id", "") or "").strip()
                amount = Decimal(str(getattr(raw, "rate", 0) or 0))
            if sid:
                written.append((sid, amount))
        if written:
            services = await self._resolve_bill_services(
                option, [sid for sid, _amount in written], None
            )
            rate_by_id = {sid: amount for sid, amount in written}
            return services, [rate_by_id[service.id] for service in services]
        services = await self._resolve_bill_services(option, service_ids, service_id)
        return services, self._split_line_rates(services, total)

    async def _resolve_bill_services(
        self,
        option: SingleServiceOpdOption,
        service_ids: list[str] | None,
        service_id: str | None,
    ) -> list[PatientServiceMaster]:
        allowed = self._allowed_services(option)
        ids: list[str] = []
        for raw in service_ids or []:
            sid = str(raw or "").strip()
            if sid and sid not in ids:
                ids.append(sid)
        if not ids and service_id:
            ids.append(str(service_id).strip())
        if not ids and len(allowed) == 1:
            ids.append(next(iter(allowed)))
        if not ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Select at least one service",
            )
        masters: list[PatientServiceMaster] = []
        for sid in ids:
            if sid not in allowed:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Selected service is not part of this billing option",
                )
            service = allowed[sid]
            if service is None:
                service = await self.session.get(PatientServiceMaster, sid)
            if not service or not service.is_active:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")
            masters.append(service)
        return masters

    @staticmethod
    def _summary_service_name(services: list[PatientServiceMaster]) -> str:
        text = ", ".join(service.name for service in services if service.name)
        return (text or "Service")[:200]

    @staticmethod
    def _split_line_rates(
        services: list[PatientServiceMaster], total: Decimal
    ) -> list[Decimal]:
        """Line amounts that add up to the amount collected on the bill."""
        total = Decimal(str(total or 0)).quantize(Decimal("0.01"))
        if not services:
            return []
        if len(services) == 1:
            return [total]
        catalog = [Decimal(str(service.rate or 0)) for service in services]
        catalog_sum = sum(catalog, Decimal("0"))
        if catalog_sum == total:
            return [amount.quantize(Decimal("0.01")) for amount in catalog]
        if catalog_sum == 0:
            share = (total / len(services)).quantize(Decimal("0.01"))
            rates = [share] * (len(services) - 1)
            rates.append((total - share * (len(services) - 1)).quantize(Decimal("0.01")))
            return rates
        rates: list[Decimal] = []
        running = Decimal("0")
        for index, amount in enumerate(catalog):
            if index == len(catalog) - 1:
                rates.append((total - running).quantize(Decimal("0.01")))
            else:
                part = (total * amount / catalog_sum).quantize(Decimal("0.01"))
                rates.append(part)
                running += part
        return rates

    async def _replace_bill_lines(
        self,
        bill: SingleServiceOpdBill,
        services: list[PatientServiceMaster],
        rates: list[Decimal],
    ) -> None:
        await self.session.execute(
            delete(SingleServiceOpdBillLine).where(SingleServiceOpdBillLine.bill_id == bill.id)
        )
        await self.session.flush()
        for index, service in enumerate(services):
            rate = rates[index] if index < len(rates) else Decimal("0")
            self.session.add(
                SingleServiceOpdBillLine(
                    bill_id=bill.id,
                    service_id=service.id,
                    service_name=service.name,
                    rate=float(rate),
                    sort_order=index,
                )
            )
        await self.session.flush()
        self.session.expire(bill, ["lines"])

    async def _cash_payment_mode(self) -> tuple[str | None, str]:
        result = await self.session.execute(
            select(PaymentMode)
            .where(PaymentMode.is_active.is_(True), PaymentMode.is_cash.is_(True))
            .order_by(PaymentMode.sort_order, PaymentMode.name)
        )
        mode = result.scalars().first()
        if mode:
            return mode.id, mode.name
        return None, "Cash"

    async def _resolve_payment_mode(self, payment_mode_id: str | None) -> tuple[str | None, str]:
        if payment_mode_id:
            mode = await self.session.get(PaymentMode, payment_mode_id)
            if not mode or not mode.is_active:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Payment mode not found"
                )
            return mode.id, mode.name
        return await self._cash_payment_mode()

    @staticmethod
    def _validate_prefix(prefix: str) -> None:
        if not re.fullmatch(r"[A-Z0-9]{1,10}", prefix):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Bill prefix must be 1–10 letters or digits",
            )

    async def _unique_prefix(self, prefix: str) -> str:
        base = re.sub(r"[^A-Z0-9]", "", (prefix or "SSO").upper())[:6] or "SSO"
        candidate = base
        suffix = 2
        while await self.option_repo.get_by_prefix(candidate):
            tail = str(suffix)
            candidate = f"{base[: 10 - len(tail)]}{tail}"
            suffix += 1
        self._validate_prefix(candidate)
        return candidate

    async def _unique_menu_code(self, menu_code: str) -> str:
        candidate = menu_code[:80]
        suffix = 2
        while True:
            taken_option = await self.option_repo.get_by_menu(candidate)
            menu_result = await self.session.execute(select(Menu).where(Menu.code == candidate))
            if taken_option is None and menu_result.scalar_one_or_none() is None:
                return candidate
            tail = f"_{suffix}"
            candidate = f"{menu_code[: 80 - len(tail)]}{tail}"
            suffix += 1

    async def _sync_menu(self, option: SingleServiceOpdOption, *, grant_permissions: bool) -> None:
        parent_result = await self.session.execute(select(Menu).where(Menu.code == "billing"))
        parent = parent_result.scalar_one_or_none()
        if parent is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Billing menu is not available",
            )
        menu_result = await self.session.execute(select(Menu).where(Menu.code == option.menu_code))
        menu = menu_result.scalar_one_or_none()
        if menu is None:
            menu = Menu(
                code=option.menu_code,
                label=option.name,
                parent_id=parent.id,
                sort_order=100 + option.sort_order,
                is_active=option.is_active,
            )
            self.session.add(menu)
            await self.session.flush()
            if grant_permissions:
                await self._copy_opd_permissions(menu.id)
        else:
            menu.label = option.name
            menu.parent_id = parent.id
            menu.sort_order = 100 + option.sort_order
            menu.is_active = option.is_active
        await self.session.flush()

    async def _set_generated_menu_active(self, menu_code: str, active: bool) -> None:
        if not (menu_code or "").startswith(MENU_CODE_PREFIX):
            return
        result = await self.session.execute(select(Menu).where(Menu.code == menu_code))
        menu = result.scalar_one_or_none()
        if menu is not None:
            menu.is_active = active

    async def _remove_generated_menu(self, menu_code: str) -> None:
        if not (menu_code or "").startswith(MENU_CODE_PREFIX):
            return
        result = await self.session.execute(select(Menu).where(Menu.code == menu_code))
        menu = result.scalar_one_or_none()
        if menu is None:
            return
        await self.session.execute(
            delete(RoleMenuPermission).where(RoleMenuPermission.menu_id == menu.id)
        )
        await self.session.delete(menu)

    async def _copy_opd_permissions(self, menu_id: str) -> None:
        opd_result = await self.session.execute(select(Menu).where(Menu.code == "opd_bill"))
        opd = opd_result.scalar_one_or_none()
        if opd is None:
            return
        perm_result = await self.session.execute(
            select(RoleMenuPermission).where(RoleMenuPermission.menu_id == opd.id)
        )
        for perm in perm_result.scalars().all():
            self.session.add(
                RoleMenuPermission(
                    role_id=perm.role_id,
                    menu_id=menu_id,
                    can_view=perm.can_view,
                    can_create=perm.can_create,
                    can_update=perm.can_update,
                    can_delete=perm.can_delete,
                )
            )
        await self.session.flush()
