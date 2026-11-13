"""Seed masters + Balleruhundi sample data from Susthira Balaga phase 6/7 sheets."""

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

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
from modules.contract_farming.models.project import CfProject, CfProjectPartner
from modules.contract_farming.models.transaction import CfTransaction


async def _count(session: AsyncSession, model) -> int:
    return int((await session.execute(select(func.count()).select_from(model))).scalar() or 0)


async def seed_contract_farming_domain(session: AsyncSession) -> None:
    if await _count(session, CfPartner) > 0:
        return

    partners = {
        "Prashanth Vittal": CfPartner(name="Prashanth Vittal", phone="", notes="Partner — Susthira Balaga"),
        "Shamsundar": CfPartner(name="Shamsundar", phone="", notes="Partner / expense custodian"),
        "Deepak H.S / Veena": CfPartner(
            name="Deepak H.S / Veena", notes="Partner via Somashekar"
        ),
        "Padmasri / Sathyakumar": CfPartner(name="Padmasri / Sathyakumar"),
        "Somashekar": CfPartner(name="Somashekar"),
        "Shashi Naren": CfPartner(name="Shashi Naren"),
    }
    for p in partners.values():
        session.add(p)

    location = CfLocation(
        name="Balleruhundi",
        village="Balleruhundi",
        taluk="Nanjangud",
        district="Mysuru",
        state="Karnataka",
        address="Balleruhundi farm land — Susthira Balaga project site",
        contact_name="Shankara",
        contact_number="",
        notes="Primary contract farming site (BHP)",
    )
    session.add(location)

    phases = {
        "P5": CfPhase(code="P5", name="Phase 5", description="Prior phase (balance c/f)", end_date="2024-10"),
        "P6": CfPhase(
            code="P6",
            name="Phase 6",
            description="Balleruhundi Project Phase 6 (Sustira)",
            start_date="2024-10",
            end_date="2025-05",
        ),
        "P7": CfPhase(
            code="P7",
            name="Phase 7",
            description="Balleruhundi Project Phase 7 (Sustira)",
            start_date="2025-04",
            end_date="2026-06",
        ),
    }
    for ph in phases.values():
        session.add(ph)

    work_types = {
        "CONTRIB": CfWorkType(code="CONTRIB", name="Partner Contribution"),
        "SALARY": CfWorkType(code="SALARY", name="Salary"),
        "LABOUR": CfWorkType(code="LABOUR", name="Labour Charges"),
        "TRAVEL": CfWorkType(code="TRAVEL", name="Travel / Petrol"),
        "SEEDS": CfWorkType(code="SEEDS", name="Seeds Purchase"),
        "FERT": CfWorkType(code="FERT", name="Fertilizers / Organic Inputs"),
        "TRACTOR": CfWorkType(code="TRACTOR", name="Tractor / Hire"),
        "PLUMB": CfWorkType(code="PLUMB", name="Plumbing / Drip"),
        "VEHICLE": CfWorkType(code="VEHICLE", name="Vehicle Repair / Service"),
        "CROP_IN": CfWorkType(code="CROP_IN", name="Crop Sale Income"),
        "MISC": CfWorkType(code="MISC", name="Miscellaneous"),
        "BAL_CF": CfWorkType(code="BAL_CF", name="Balance Carry Forward"),
    }
    for wt in work_types.values():
        session.add(wt)

    labours = {
        "Krishne Gowda": CfLabour(name="Krishne Gowda", role="Farm caretaker", daily_rate=""),
        "Shankara": CfLabour(name="Shankara", role="Field supervisor / travel"),
        "Harish Goutham": CfLabour(name="Harish Goutham", role="Labour coordinator"),
        "Chandra K.S": CfLabour(name="Chandra K.S", role="Labour payments (phase 7)"),
    }
    for lb in labours.values():
        session.add(lb)

    vendors = {
        "Sahaja Seeds": CfVendor(name="Sahaja Seeds", notes="Desi / organic seeds"),
        "APMC Shivakumar": CfVendor(name="APMC Shivakumar", notes="Groundnut seed"),
        "Raja AD Shop Tumkur": CfVendor(name="Raja AD Shop Tumkur", notes="Organic fertilizers"),
        "Nithyadara Nursery": CfVendor(name="Nithyadara Nursery", notes="Saplings — Kotresh"),
        "Jai Vahini Pvt Ltd": CfVendor(name="Jai Vahini Pvt Ltd", notes="Turmeric plants"),
    }
    for v in vendors.values():
        session.add(v)

    ledgers = {
        "CASH": CfLedger(code="CASH", name="Cash", group_name="Cash-in-Hand", ledger_type="ASSET"),
        "BANK": CfLedger(code="BANK", name="Bank", group_name="Bank Accounts", ledger_type="ASSET"),
        "PARTNER_CAP": CfLedger(
            code="PARTNER_CAP", name="Partner Capital", group_name="Capital", ledger_type="LIABILITY"
        ),
        "SALARY_EXP": CfLedger(
            code="SALARY_EXP", name="Salary Expense", group_name="Expenses", ledger_type="EXPENSE"
        ),
        "LABOUR_EXP": CfLedger(
            code="LABOUR_EXP", name="Labour Expense", group_name="Expenses", ledger_type="EXPENSE"
        ),
        "TRAVEL_EXP": CfLedger(
            code="TRAVEL_EXP", name="Travel Expense", group_name="Expenses", ledger_type="EXPENSE"
        ),
        "FARM_PUR": CfLedger(
            code="FARM_PUR", name="Farm Purchases", group_name="Expenses", ledger_type="EXPENSE"
        ),
        "CROP_INC": CfLedger(
            code="CROP_INC", name="Crop Income", group_name="Income", ledger_type="INCOME"
        ),
    }
    for ld in ledgers.values():
        session.add(ld)

    modes = {
        "CASH_R": CfPaymentMode(code="CASH_R", name="Cash Receipt", entry_type="credit"),
        "CASH_P": CfPaymentMode(code="CASH_P", name="Cash Payment", entry_type="debit"),
        "GPAY_R": CfPaymentMode(code="GPAY_R", name="GPay Receipt", entry_type="credit"),
        "GPAY_P": CfPaymentMode(code="GPAY_P", name="GPay Payment", entry_type="debit"),
        "PPAY_P": CfPaymentMode(code="PPAY_P", name="PhonePe Payment", entry_type="debit"),
        "NEFT_R": CfPaymentMode(code="NEFT_R", name="NEFT Receipt", entry_type="credit"),
        "NEFT_P": CfPaymentMode(code="NEFT_P", name="NEFT Payment", entry_type="debit"),
        "IMPS_R": CfPaymentMode(code="IMPS_R", name="IMPS Receipt", entry_type="credit"),
        "BAL_CF": CfPaymentMode(code="BAL_CF", name="Balance C/F", entry_type="credit"),
    }
    for m in modes.values():
        session.add(m)

    await session.flush()

    project = CfProject(
        name="Balleruhundi Project (Susthira Balaga)",
        address="Balleruhundi, Nanjangud Taluk, Mysuru",
        location_id=location.id,
        description="Contract farming project — Sustira / Susthira Balaga families",
        start_date="2024-10",
        is_active=True,
    )
    session.add(project)
    await session.flush()

    for p in partners.values():
        session.add(CfProjectPartner(project_id=project.id, partner_id=p.id))

    # Sample transactions from Phase 6 FINAL sheet (partner contributions + key expenses/income)
    samples: list[tuple] = [
        # (phase, work, ledger, mode, party_type, party_key, date, amount, narration)
        (
            "P6",
            "BAL_CF",
            "CASH",
            "BAL_CF",
            "none",
            None,
            date(2024, 10, 1),
            Decimal("0"),
            "Balance c/f from Phase 5 (opening noted in sheet)",
        ),
        (
            "P6",
            "CONTRIB",
            "PARTNER_CAP",
            "GPAY_R",
            "partner",
            "Prashanth Vittal",
            date(2024, 11, 3),
            Decimal("100000"),
            "Partner contribution via GPay (1L; 70k transferred internally noted)",
        ),
        (
            "P6",
            "CONTRIB",
            "PARTNER_CAP",
            "CASH_R",
            "partner",
            "Shamsundar",
            date(2024, 11, 1),
            Decimal("100000"),
            "Partner contribution — cash + c/f expenses allocation",
        ),
        (
            "P6",
            "CONTRIB",
            "PARTNER_CAP",
            "IMPS_R",
            "partner",
            "Deepak H.S / Veena",
            date(2024, 11, 5),
            Decimal("100000"),
            "IMPS-433422116503 via Somashekar",
        ),
        (
            "P6",
            "CONTRIB",
            "PARTNER_CAP",
            "NEFT_R",
            "partner",
            "Padmasri / Sathyakumar",
            date(2025, 2, 6),
            Decimal("100000"),
            "NEFT 5037105340695",
        ),
        (
            "P6",
            "CONTRIB",
            "PARTNER_CAP",
            "CASH_R",
            "partner",
            "Somashekar",
            date(2024, 12, 25),
            Decimal("100000"),
            "Partner contribution by cash",
        ),
        (
            "P6",
            "CONTRIB",
            "PARTNER_CAP",
            "NEFT_R",
            "partner",
            "Shashi Naren",
            date(2024, 11, 14),
            Decimal("100000"),
            "ICICI ref 431911044040",
        ),
        (
            "P6",
            "CROP_IN",
            "CROP_INC",
            "CASH_R",
            "none",
            None,
            date(2025, 3, 2),
            Decimal("600"),
            "Sale of tomatoes",
        ),
        (
            "P6",
            "CROP_IN",
            "CROP_INC",
            "CASH_R",
            "none",
            None,
            date(2025, 3, 9),
            Decimal("500"),
            "Sale of tomatoes",
        ),
        (
            "P6",
            "CROP_IN",
            "CROP_INC",
            "CASH_R",
            "none",
            None,
            date(2025, 3, 15),
            Decimal("1725"),
            "Sale of ground nut seed cake",
        ),
        (
            "P6",
            "SALARY",
            "SALARY_EXP",
            "GPAY_P",
            "labour",
            "Krishne Gowda",
            date(2025, 5, 1),
            Decimal("132000"),
            "Salary — Krishne Gowda (phase 6 total)",
        ),
        (
            "P6",
            "SALARY",
            "SALARY_EXP",
            "GPAY_P",
            "labour",
            "Shankara",
            date(2025, 5, 1),
            Decimal("63600"),
            "Salary — Shankara 50% of total paid",
        ),
        (
            "P6",
            "SEEDS",
            "FARM_PUR",
            "PPAY_P",
            "vendor",
            "APMC Shivakumar",
            date(2024, 10, 21),
            Decimal("9800"),
            "Groundnut seed 100 kg",
        ),
        (
            "P6",
            "LABOUR",
            "LABOUR_EXP",
            "PPAY_P",
            "labour",
            "Harish Goutham",
            date(2024, 10, 20),
            Decimal("500"),
            "1m labour",
        ),
        (
            "P6",
            "FERT",
            "FARM_PUR",
            "PPAY_P",
            "vendor",
            "Raja AD Shop Tumkur",
            date(2024, 10, 28),
            Decimal("12500"),
            "Organic fertilizers DNC / Cropsudha / Bhumisuda",
        ),
        (
            "P6",
            "TRAVEL",
            "TRAVEL_EXP",
            "CASH_P",
            "labour",
            "Shankara",
            date(2025, 4, 1),
            Decimal("6745"),
            "Travel — two wheeler / bus",
        ),
        (
            "P6",
            "TRAVEL",
            "TRAVEL_EXP",
            "CASH_P",
            "labour",
            "Shankara",
            date(2025, 4, 1),
            Decimal("38205"),
            "Travel — Bolero Jeep 10 months",
        ),
        (
            "P6",
            "TRAVEL",
            "TRAVEL_EXP",
            "CASH_P",
            "partner",
            "Shamsundar",
            date(2025, 5, 1),
            Decimal("30600"),
            "Petrol / travel Sept-24 to May-25",
        ),
        # Phase 7 sample contributions
        (
            "P7",
            "BAL_CF",
            "CASH",
            "BAL_CF",
            "none",
            None,
            date(2025, 5, 15),
            Decimal("69934"),
            "Balance c/f from Phase 6",
        ),
        (
            "P7",
            "CONTRIB",
            "PARTNER_CAP",
            "CASH_R",
            "partner",
            "Prashanth Vittal",
            date(2025, 5, 29),
            Decimal("100000"),
            "Partner contribution by cash",
        ),
        (
            "P7",
            "CONTRIB",
            "PARTNER_CAP",
            "CASH_R",
            "partner",
            "Shamsundar",
            date(2025, 6, 1),
            Decimal("100000"),
            "Partner contribution",
        ),
        (
            "P7",
            "CONTRIB",
            "PARTNER_CAP",
            "CASH_R",
            "partner",
            "Deepak H.S / Veena",
            date(2025, 5, 20),
            Decimal("100000"),
            "Partner contribution (50k + 50k)",
        ),
        (
            "P7",
            "CONTRIB",
            "PARTNER_CAP",
            "CASH_R",
            "partner",
            "Padmasri / Sathyakumar",
            date(2025, 5, 22),
            Decimal("100000"),
            "Partner contribution (50k + 50k)",
        ),
        (
            "P7",
            "CONTRIB",
            "PARTNER_CAP",
            "NEFT_R",
            "partner",
            "Somashekar",
            date(2025, 9, 10),
            Decimal("100000"),
            "NEFT contributions (50k + 50k)",
        ),
        (
            "P7",
            "CONTRIB",
            "PARTNER_CAP",
            "CASH_R",
            "partner",
            "Shashi Naren",
            date(2025, 5, 31),
            Decimal("100000"),
            "Partner contribution by cash",
        ),
        (
            "P7",
            "SALARY",
            "SALARY_EXP",
            "GPAY_P",
            "labour",
            "Krishne Gowda",
            date(2026, 4, 1),
            Decimal("146001"),
            "Salary — Krishne Gowda (phase 7 total)",
        ),
        (
            "P7",
            "SALARY",
            "SALARY_EXP",
            "GPAY_P",
            "labour",
            "Shankara",
            date(2026, 4, 1),
            Decimal("105000"),
            "Salary — Shankara 50% of total paid",
        ),
        (
            "P7",
            "LABOUR",
            "LABOUR_EXP",
            "PPAY_P",
            "labour",
            "Chandra K.S",
            date(2025, 6, 10),
            Decimal("500"),
            "Labour via Chandra K.S",
        ),
        (
            "P7",
            "PLUMB",
            "FARM_PUR",
            "CASH_P",
            "none",
            None,
            date(2025, 6, 12),
            Decimal("8300"),
            "Drip pipe 2 bundles + transport",
        ),
        (
            "P7",
            "TRAVEL",
            "TRAVEL_EXP",
            "CASH_P",
            "partner",
            "Shamsundar",
            date(2026, 5, 1),
            Decimal("36000"),
            "Petrol expenses June-2025 to May-2026",
        ),
    ]

    for phase_code, wt_code, led_code, mode_code, party_type, party_key, txn_date, amount, narration in samples:
        if amount == 0 and wt_code == "BAL_CF" and phase_code == "P6":
            continue  # skip zero placeholder
        kwargs = dict(
            project_id=project.id,
            phase_id=phases[phase_code].id,
            work_type_id=work_types[wt_code].id,
            ledger_id=ledgers[led_code].id,
            payment_mode_id=modes[mode_code].id,
            party_type=party_type,
            txn_date=txn_date,
            amount=amount,
            entry_type=modes[mode_code].entry_type,
            narration=narration,
        )
        if party_type == "partner" and party_key:
            kwargs["partner_id"] = partners[party_key].id
        elif party_type == "labour" and party_key:
            kwargs["labour_id"] = labours[party_key].id
        elif party_type == "vendor" and party_key:
            kwargs["vendor_id"] = vendors[party_key].id
        session.add(CfTransaction(**kwargs))

    await session.flush()
