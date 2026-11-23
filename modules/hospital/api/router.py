"""Mount full Hospital HMS API (same routes as standalone hospital, under /hospital)."""

from fastapi import APIRouter

from modules.hospital.hms.api.v1.endpoints import (
    admin,
    authorities,
    backup,
    bill_identity,
    billing_packages,
    billing_structure,
    billing_types,
    cashbook,
    dashboard,
    dashboard_shortcuts,
    departments,
    doctors,
    hospital_profile,
    hospital_sections,
    ipd_admissions,
    ipd_discharge,
    ipd_discharge_summaries,
    lab_tests,
    legacy_migrate,
    mdb_migrate,
    previous_migrate,
    letter_templates,
    menus,
    notifications,
    opd_bills,
    pathology_bills,
    pathology_masters,
    patient_documents,
    patient_no_formats,
    patient_service_masters,
    patients,
    payment_modes,
    pharmacy,
    prefixes,
    procedure_types,
    reports,
    roles,
    service_groups,
    service_sub_categories,
    short_bills,
    single_service_opd,
    user_roles,
    user_types,
    users,
    wards,
)

hospital_api = APIRouter()
module_api = hospital_api
MOUNT_PREFIX = "/hospital"

# Domain APIs — auth / menus / ledgers / payment-modes / print-configs stay on core
hospital_api.include_router(dashboard.router, prefix="/dashboard", tags=["hospital-dashboard"])
hospital_api.include_router(
    dashboard_shortcuts.router, prefix="/dashboard", tags=["hospital-dashboard-shortcuts"]
)
hospital_api.include_router(menus.router, prefix="/menus", tags=["hospital-menus"])
hospital_api.include_router(users.router, prefix="/users", tags=["hospital-users"])
hospital_api.include_router(user_types.router, prefix="/user-types", tags=["hospital-user-types"])
hospital_api.include_router(roles.router, prefix="/roles", tags=["hospital-roles"])
hospital_api.include_router(user_roles.router, prefix="/user-roles", tags=["hospital-user-roles"])
hospital_api.include_router(
    notifications.router, prefix="/notifications", tags=["hospital-notifications"]
)
hospital_api.include_router(patients.router, prefix="/patients", tags=["hospital-patients"])
hospital_api.include_router(
    patient_documents.router, prefix="/patient-documents", tags=["hospital-patient-documents"]
)
hospital_api.include_router(
    patient_no_formats.router, prefix="/patient-no-formats", tags=["hospital-patient-no-formats"]
)
hospital_api.include_router(doctors.router, prefix="/doctors", tags=["hospital-doctors"])
hospital_api.include_router(
    patient_service_masters.router,
    prefix="/patient-services",
    tags=["hospital-patient-services"],
)
hospital_api.include_router(departments.router, prefix="/departments", tags=["hospital-departments"])
hospital_api.include_router(
    hospital_sections.router, prefix="/hospital-sections", tags=["hospital-sections"]
)
hospital_api.include_router(
    hospital_profile.router, prefix="/hospital-profile", tags=["hospital-profile"]
)
hospital_api.include_router(prefixes.router, prefix="/prefixes", tags=["hospital-prefixes"])
hospital_api.include_router(authorities.router, prefix="/authorities", tags=["hospital-authorities"])
hospital_api.include_router(
    letter_templates.router, prefix="/letter-templates", tags=["hospital-letter-templates"]
)
hospital_api.include_router(cashbook.router, prefix="/cashbook", tags=["hospital-cashbook"])
hospital_api.include_router(
    billing_types.router, prefix="/billing-types", tags=["hospital-billing-types"]
)
hospital_api.include_router(
    procedure_types.router, prefix="/procedure-types", tags=["hospital-procedure-types"]
)
hospital_api.include_router(
    billing_structure.router, prefix="/billing-structure", tags=["hospital-billing-structure"]
)
hospital_api.include_router(
    service_groups.router, prefix="/service-groups", tags=["hospital-service-groups"]
)
hospital_api.include_router(
    billing_packages.router, prefix="/billing-packages", tags=["hospital-billing-packages"]
)
hospital_api.include_router(
    service_sub_categories.router,
    prefix="/service-sub-categories",
    tags=["hospital-service-sub-categories"],
)
hospital_api.include_router(opd_bills.router, prefix="/opd-bills", tags=["hospital-opd-bills"])
hospital_api.include_router(
    bill_identity.router, prefix="/bill-identity", tags=["hospital-bill-identity"]
)
hospital_api.include_router(
    pathology_bills.router, prefix="/pathology-bills", tags=["hospital-pathology-bills"]
)
hospital_api.include_router(pathology_masters.router, prefix="/pathology", tags=["hospital-pathology"])
hospital_api.include_router(lab_tests.router, prefix="/pathology", tags=["hospital-pathology"])
hospital_api.include_router(pharmacy.router, prefix="/pharmacy", tags=["hospital-pharmacy"])
hospital_api.include_router(
    ipd_admissions.router, prefix="/ipd-admissions", tags=["hospital-ipd-admissions"]
)
hospital_api.include_router(ipd_discharge.router, prefix="/ipd-discharge", tags=["hospital-ipd-discharge"])
hospital_api.include_router(
    ipd_discharge_summaries.router,
    prefix="/ipd-discharge-summaries",
    tags=["hospital-ipd-discharge-summaries"],
)
hospital_api.include_router(wards.router, prefix="/wards", tags=["hospital-wards"])
hospital_api.include_router(
    payment_modes.router, prefix="/payment-modes", tags=["hospital-payment-modes"]
)
hospital_api.include_router(short_bills.router, prefix="/short-bills", tags=["hospital-short-bills"])
hospital_api.include_router(
    single_service_opd.router, prefix="/single-service-opd", tags=["hospital-single-service-opd"]
)
hospital_api.include_router(reports.router, prefix="/reports", tags=["hospital-reports"])
hospital_api.include_router(admin.router, prefix="/admin", tags=["hospital-admin"])
hospital_api.include_router(backup.router, prefix="/backup", tags=["hospital-backup"])
hospital_api.include_router(
    legacy_migrate.router, prefix="/admin", tags=["hospital-admin", "legacy-migrate"]
)
hospital_api.include_router(
    previous_migrate.router, prefix="/admin", tags=["hospital-admin", "previous-migrate"]
)
hospital_api.include_router(
    mdb_migrate.router, prefix="/admin", tags=["hospital-admin", "mdb-migrate"]
)
