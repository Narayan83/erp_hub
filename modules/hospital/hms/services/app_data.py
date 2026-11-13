import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.schemas.app_data import AppDataResponse
from modules.hospital.hms.services.authority import AuthorityService
from modules.hospital.hms.services.billing_package import BillingPackageService
from modules.hospital.hms.services.billing_structure import BillingStructureService
from modules.hospital.hms.services.billing_type import BillingTypeService
from modules.hospital.hms.services.service_category import ServiceCategoryService
from modules.hospital.hms.services.service_sub_category import ServiceSubCategoryService
from modules.hospital.hms.services.department import DepartmentService
from modules.hospital.hms.services.doctor import DoctorService
from modules.hospital.hms.services.hospital_profile import HospitalProfileService
from modules.hospital.hms.services.hospital_section import HospitalSectionService
from modules.hospital.hms.services.patient_no_format import PatientNoFormatService
from modules.hospital.hms.services.patient_service_master import PatientServiceMasterService
from modules.hospital.hms.services.payment_mode import PaymentModeService
from modules.hospital.hms.services.prefix import PrefixService
from modules.hospital.hms.services.procedure_type import ProcedureTypeService
from modules.hospital.hms.services.role_mgmt import RoleManagementService
from modules.hospital.hms.services.user_mgmt import UserManagementService
from modules.hospital.hms.services.user_type import UserTypeService
from modules.hospital.hms.services.ward import WardService


class AppDataService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_app_data(self) -> AppDataResponse:
        (
            user_types,
            departments,
            billing_types,
            procedure_types,
            billing_structure,
            authorities,
            hospital_sections,
            prefixes,
            payment_modes,
            wards,
            doctors_page,
            users,
            roles,
            patient_no_formats,
            patient_services,
            service_categories,
            service_sub_categories,
            billing_packages,
            hospital_profile,
        ) = await asyncio.gather(
            UserTypeService(self.session).list_user_types(),
            DepartmentService(self.session).list_departments(),
            BillingTypeService(self.session).list_billing_types(),
            ProcedureTypeService(self.session).list_procedure_types(),
            BillingStructureService(self.session).list_mappings(),
            AuthorityService(self.session).list_authorities(),
            HospitalSectionService(self.session).list_sections(),
            PrefixService(self.session).list_prefixes(),
            PaymentModeService(self.session).list_payment_modes(),
            WardService(self.session).list_wards(),
            DoctorService(self.session).list_doctors_for_cache(),
            UserManagementService(self.session).list_users(),
            RoleManagementService(self.session).list_roles(),
            PatientNoFormatService(self.session).list_formats(),
            PatientServiceMasterService(self.session).list_services(),
            ServiceCategoryService(self.session).list_categories(),
            ServiceSubCategoryService(self.session).list_sub_categories(),
            BillingPackageService(self.session).list_packages(),
            HospitalProfileService(self.session).get_profile(),
        )

        return AppDataResponse(
            user_types=user_types,
            departments=departments,
            billing_types=billing_types,
            procedure_types=procedure_types,
            billing_structure=billing_structure,
            authorities=authorities,
            hospital_sections=hospital_sections,
            prefixes=prefixes,
            payment_modes=payment_modes,
            wards=wards,
            doctors=doctors_page,
            users=users,
            roles=roles,
            patient_no_formats=patient_no_formats,
            patient_services=patient_services,
            service_categories=service_categories,
            service_sub_categories=service_sub_categories,
            billing_packages=billing_packages,
            hospital_profile=hospital_profile,
        )
