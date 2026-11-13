from pydantic import BaseModel

from modules.hospital.hms.schemas.authority import AuthorityRead
from modules.hospital.hms.schemas.billing_package import BillingPackageRead
from modules.hospital.hms.schemas.billing_type import BillingTypeRead
from modules.hospital.hms.schemas.service_category import ServiceCategoryRead
from modules.hospital.hms.schemas.service_sub_category import ServiceSubCategoryRead
from modules.hospital.hms.schemas.department import DepartmentRead
from modules.hospital.hms.schemas.hospital_section import HospitalSectionRead
from modules.hospital.hms.schemas.billing_structure import BillingStructureRead
from modules.hospital.hms.schemas.payment_mode import PaymentModeRead
from modules.hospital.hms.schemas.patient_no_format import PatientNoFormatRead
from modules.hospital.hms.schemas.patient_service_master import PatientServiceMasterRead
from modules.hospital.hms.schemas.prefix import PrefixRead
from modules.hospital.hms.schemas.procedure_type import ProcedureTypeRead
from modules.hospital.hms.schemas.doctor import DoctorRead
from modules.hospital.hms.schemas.hospital_profile import HospitalProfileRead
from modules.hospital.hms.schemas.role import RoleRead
from modules.hospital.hms.schemas.user_mgmt import UserRead
from modules.hospital.hms.schemas.user_type import UserTypeRead
from modules.hospital.hms.schemas.ward import WardRead


class AppDataResponse(BaseModel):
    user_types: list[UserTypeRead]
    departments: list[DepartmentRead]
    billing_types: list[BillingTypeRead]
    procedure_types: list[ProcedureTypeRead]
    billing_structure: list[BillingStructureRead]
    authorities: list[AuthorityRead]
    hospital_sections: list[HospitalSectionRead]
    prefixes: list[PrefixRead]
    payment_modes: list[PaymentModeRead]
    wards: list[WardRead]
    doctors: list[DoctorRead]
    users: list[UserRead]
    roles: list[RoleRead]
    patient_no_formats: list[PatientNoFormatRead]
    patient_services: list[PatientServiceMasterRead]
    service_categories: list[ServiceCategoryRead]
    service_sub_categories: list[ServiceSubCategoryRead]
    billing_packages: list[BillingPackageRead]
    hospital_profile: HospitalProfileRead
