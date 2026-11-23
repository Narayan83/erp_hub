import type { ReactNode } from 'react'
import { DashboardPage } from './pages/DashboardPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { PartyMasterPage } from './pages/core/PartyMasterPage'
import { CompanyProfilePage } from './pages/core/CompanyProfilePage'
import { LedgerMasterPage } from './pages/core/LedgerMasterPage'
import { PaymentModesPage } from './pages/core/PaymentModesPage'
import { CashbookPage } from './pages/core/CashbookPage'
import { PrintMasterPage } from './pages/core/PrintMasterPage'
import { BillTemplateDesignerPage } from './pages/core/billDesigner/BillTemplateDesignerPage'
import { PatientMasterPage } from './pages/hospital/PatientMasterPage'
import { OpdBillPage } from './pages/hospital/OpdBillPage'
import { OpdBillReprintPage } from './pages/hospital/OpdBillReprintPage'
import { DoctorMasterPage } from './pages/hospital/DoctorMasterPage'
import { DepartmentMasterPage } from './pages/hospital/DepartmentMasterPage'
import { CodeNameMasterPage } from './pages/hospital/CodeNameMasterPage'
import { IpdAdmissionPage } from './pages/hospital/IpdAdmissionPage'
import { IpdBillPage } from './pages/hospital/IpdBillPage'
import { IpdDischargePage } from './pages/hospital/IpdDischargePage'
import { IpdBillReprintPage } from './pages/hospital/IpdBillReprintPage'
import { ModifyBillPage } from './pages/hospital/ModifyBillPage'
import { CancelBillPage } from './pages/hospital/CancelBillPage'
import { DischargeSummaryPage } from './pages/hospital/DischargeSummaryPage'
import { PathologyBillPage } from './pages/hospital/PathologyBillPage'
import { PharmacyItemPage } from './pages/hospital/PharmacyItemPage'
import { PatientServiceMasterPage } from './pages/hospital/PatientServiceMasterPage'
import { HospitalProfilePage } from './pages/hospital/HospitalProfilePage'
import { DatabaseMigrationPage } from './pages/hospital/DatabaseMigrationPage'
import { MenuCreationPage } from './pages/hospital/MenuCreationPage'
import { PaymentModeMasterPage } from './pages/hospital/masters/PaymentModeMasterPage'
import { PatientIdFormatPage } from './pages/hospital/masters/PatientIdFormatPage'
import { Form3CReportPage } from './pages/hospital/reports/Form3CReportPage'
import { DoctorCollectionReportPage } from './pages/hospital/reports/DoctorCollectionReportPage'
import { PathologyCollectionReportPage } from './pages/hospital/reports/PathologyCollectionReportPage'
import { UserCashTransactionReportPage } from './pages/hospital/reports/UserCashTransactionReportPage'
import { CancellationBillReportPage } from './pages/hospital/reports/CancellationBillReportPage'
import { ModificationBillReportPage } from './pages/hospital/reports/ModificationBillReportPage'
import { UserManagementPage } from './pages/core/UserManagementPage'
import { UserTypePage } from './pages/hospital/users/UserTypePage'
import { RoleManagementPage } from './pages/hospital/users/RoleManagementPage'
import { RoleMenuPermissionsPage } from './pages/hospital/users/RoleMenuPermissionsPage'
import { UserRoleMappingPage } from './pages/hospital/users/UserRoleMappingPage'
import { ShortBillPage } from './pages/hospital/transactions/ShortBillPage'
import { SingleServiceOpdBillPage } from './pages/hospital/transactions/SingleServiceOpdBillPage'
import { ScanBillPage } from './pages/hospital/transactions/ScanBillPage'
import { ObservationBillPage } from './pages/hospital/transactions/ObservationBillPage'
import { ChangePatientDoctorPage } from './pages/hospital/transactions/ChangePatientDoctorPage'
import { DepartmentServiceEntryPage } from './pages/hospital/transactions/DepartmentServiceEntryPage'
import { PaymentModeEntryPage } from './pages/hospital/transactions/PaymentModeEntryPage'
import { AuthoriseDiscountPage } from './pages/hospital/transactions/AuthoriseDiscountPage'
import { RealisationDatePage } from './pages/hospital/transactions/RealisationDatePage'
import { BillingStructureMappingPage } from './pages/hospital/masters/BillingStructureMappingPage'
import { PackageMasterPage } from './pages/hospital/masters/PackageMasterPage'
import { AssignServicesPackagePage } from './pages/hospital/masters/AssignServicesPackagePage'
import { ServiceGroupPage } from './pages/hospital/masters/ServiceGroupPage'
import { AssignServicesGroupPage } from './pages/hospital/masters/AssignServicesGroupPage'
import { SingleServiceOpdSetupPage } from './pages/hospital/masters/SingleServiceOpdSetupPage'
import { ShortBillMasterPage } from './pages/hospital/masters/ShortBillMasterPage'
import { LetterMasterPage } from './pages/hospital/masters/LetterMasterPage'
import { SchemeMasterPage } from './pages/hospital/masters/SchemeMasterPage'
import { PatientHistoryOpdPage } from './pages/hospital/medical_records/PatientHistoryOpdPage'
import { PatientHistorySearchPage } from './pages/hospital/medical_records/PatientHistorySearchPage'
import { PharmacyPartyMasterPage } from './pages/hospital/pharmacy/PharmacyPartyMasterPage'
import { PharmacySaleBillPage } from './pages/hospital/pharmacy/PharmacySaleBillPage'
import { PharmacySaleReturnPage } from './pages/hospital/pharmacy/PharmacySaleReturnPage'
import { PharmacyPurchaseBillPage } from './pages/hospital/pharmacy/PharmacyPurchaseBillPage'
import { PharmacyPurchaseReturnPage } from './pages/hospital/pharmacy/PharmacyPurchaseReturnPage'
import { PharmacyRegisterPage } from './pages/hospital/pharmacy/PharmacyRegisterPage'
import { MedicineIndentPage } from './pages/hospital/pharmacy/MedicineIndentPage'
import { SupplierMasterPage } from './pages/hospital/pharmacy/SupplierMasterPage'
import { MedicineGroupPage } from './pages/hospital/pharmacy/MedicineGroupPage'
import { LabTestMasterPage } from './pages/hospital/pathology/LabTestMasterPage'
import { ParameterMappingPage } from './pages/hospital/pathology/ParameterMappingPage'
import { NormalRangePage } from './pages/hospital/pathology/NormalRangePage'
import { ResultTemplatePage } from './pages/hospital/pathology/ResultTemplatePage'
import { PathologyWorkListPage } from './pages/hospital/pathology/PathologyWorkListPage'
import { DocumentScanPage } from './pages/hospital/medical_records/DocumentScanPage'
import { DashboardShortcutPage } from './pages/hospital/masters/DashboardShortcutPage'
import { NotificationSetupPage } from './pages/hospital/users/NotificationSetupPage'
import { AssignMedicineGroupPage } from './pages/hospital/pharmacy/AssignMedicineGroupPage'
import { renderKramcopMenuPage } from './kramcop/menuPages'
import { renderContractFarmingMenuPage } from './contract_farming/menuPages'
import { renderGenerpMenuPage } from './pages/generp/menuPages'

const PAGES: Record<string, () => ReactNode> = {
  dashboard: () => <DashboardPage />,
  party_master: () => <PartyMasterPage />,
  company_profile: () => <CompanyProfilePage />,
  hospital_profile: () => <HospitalProfilePage />,
  print_master: () => <PrintMasterPage />,
  ledger_master: () => <LedgerMasterPage />,
  advance_collection: () => <CashbookPage kind="advance" />,
  advance_reprint: () => <CashbookPage kind="list" />,
  adjustment_entry: () => <CashbookPage kind="payment" />,
  receipt_voucher_adjustment_entry: () => <CashbookPage kind="contra" />,
  daybook: () => <CashbookPage kind="list" />,
  cash_book: () => <CashbookPage kind="list" />,
  cashbook: () => <CashbookPage kind="list" />,
  ledger_details: () => <CashbookPage kind="list" />,
  balance_sheet: () => (
    <PlaceholderPage title="Balance Sheet" note="Stub — GenERP financial_reports next" />
  ),

  // Clinical / setup masters
  patient_master: () => <PatientMasterPage />,
  patient_list: () => <PatientMasterPage />,
  doctor_master: () => <DoctorMasterPage />,
  department_master: () => <DepartmentMasterPage />,
  patient_service_creation: () => <PatientServiceMasterPage />,
  menu_creation: () => <MenuCreationPage />,
  ward_master: () => <CodeNameMasterPage title="Ward Master" listPath="/hospital/wards" />,
  hospital_sections: () => (
    <CodeNameMasterPage title="Hospital Sections" listPath="/hospital/hospital-sections" />
  ),
  prefix_creation: () => (
    <CodeNameMasterPage title="Prefix Creation" listPath="/hospital/prefixes" />
  ),
  bill_types_creation: () => (
    <CodeNameMasterPage title="Bill Types" listPath="/hospital/billing-types" />
  ),
  procedure_type_master: () => (
    <CodeNameMasterPage title="Procedure Types" listPath="/hospital/procedure-types" />
  ),
  authority_creation_master: () => (
    <CodeNameMasterPage title="Authority Master" listPath="/hospital/authorities" />
  ),
  scheme_master: () => <SchemeMasterPage />,
  service_sub_category_master: () => (
    <CodeNameMasterPage title="Service Sub Categories" listPath="/hospital/service-sub-categories" />
  ),
  service_groups: () => <ServiceGroupPage />,
  package_creation_master: () => <PackageMasterPage />,
  billing_structure_mapping: () => <BillingStructureMappingPage />,
  ipd_type_creation: () => (
    <CodeNameMasterPage title="IPD Type Creation" listPath="/hospital/billing-types" />
  ),
  diagnose_create: () => (
    <CodeNameMasterPage title="Diagnose Create" listPath="/hospital/pathology/notes" />
  ),
  investigation_creation: () => (
    <CodeNameMasterPage title="Investigation Creation" listPath="/hospital/pathology/lab-tests" />
  ),
  patient_id_format: () => <PatientIdFormatPage />,
  payment_mode_creation: () => <PaymentModeMasterPage />,
  letter_master: () => <LetterMasterPage />,
  short_bill_master: () => <ShortBillMasterPage />,
  single_service_opd_setup: () => <SingleServiceOpdSetupPage />,
  unit_creation: () => (
    <CodeNameMasterPage title="Pathology Units" listPath="/hospital/pathology/units" />
  ),
  pathology_notes_master: () => (
    <CodeNameMasterPage title="Notes Master" listPath="/hospital/pathology/notes" />
  ),
  normal_range_creation: () => <NormalRangePage />,
  service_creation_pathology: () => <LabTestMasterPage />,
  parameter_mapping: () => <ParameterMappingPage />,
  custom_template_creation: () => <ResultTemplatePage />,
  medicine_group_creation: () => <MedicineGroupPage />,
  manufacturer_master: () => (
    <PharmacyPartyMasterPage title="Manufacturer Master" typeCode="MF" />
  ),
  marketing_agency_master: () => (
    <PharmacyPartyMasterPage title="Marketing Agency Master" typeCode="MK" />
  ),
  distributors_master: () => (
    <PharmacyPartyMasterPage title="Distributors Master" typeCode="DM" />
  ),
  drug_category_master: () => (
    <PharmacyPartyMasterPage title="Drug Category Master" typeCode="DC" />
  ),
  supplier_master: () => <SupplierMasterPage />,

  // OPD / IPD
  opd_bill: () => <OpdBillPage />,
  opd_bill_reprint: () => <OpdBillReprintPage />,
  modify_bill: () => <ModifyBillPage />,
  change_patient_doctor: () => <ChangePatientDoctorPage />,
  cancel_bill: () => <CancelBillPage />,
  in_patient_admission: () => <IpdAdmissionPage />,
  ipd_bill: () => <IpdBillPage />,
  in_patient_discharge: () => <IpdDischargePage />,
  ipd_bill_reprint: () => <IpdBillReprintPage />,
  diagnose_management: () => <DischargeSummaryPage />,
  scan_bill: () => <ScanBillPage />,
  observation_bill: () => <ObservationBillPage />,
  xray_bill: () => <ShortBillPage menuCode="xray_bill" title="XRay Bill" />,
  immunization_bill: () => <ShortBillPage menuCode="immunization_bill" title="Immunization Bill" />,
  ambulance: () => <ShortBillPage menuCode="ambulance" title="Ambulance" />,
  medical_gas: () => <ShortBillPage menuCode="medical_gas" title="Medical Gas" />,

  // Pathology / Pharmacy
  pathology_bill: () => <PathologyBillPage />,
  pathology_bill_reprint: () => <PathologyBillPage mode="reprint" />,
  pathology_bill_cancel: () => <PathologyBillPage mode="cancel" />,
  pathology_work_list: () => <PathologyWorkListPage />,
  medicine_master: () => <PharmacyItemPage itemType="MD" title="Medicine Master" />,
  surgicals_master: () => <PharmacyItemPage itemType="SG" title="Surgicals Master" />,
  disposables_master: () => <PharmacyItemPage itemType="DS" title="Disposables Master" />,
  consumables_master: () => <PharmacyItemPage itemType="CS" title="Consumables Master" />,
  implants_master: () => <PharmacyItemPage itemType="IM" title="Implants Master" />,
  medicine_sale_bill: () => <PharmacySaleBillPage />,
  medicine_sales_return: () => <PharmacySaleReturnPage />,
  medicine_purchase_bill_109: () => <PharmacyPurchaseBillPage />,
  medicine_purchase_return: () => <PharmacyPurchaseReturnPage />,
  medicine_indent: () => <MedicineIndentPage />,
  used_medicine_entry: () => <MedicineIndentPage />,
  sales_register: () => <PharmacyRegisterPage reportKind="sales" />,
  purchase_register: () => <PharmacyRegisterPage reportKind="purchase" />,
  sales_return_register: () => <PharmacyRegisterPage reportKind="sales-return" />,
  purchase_return_register: () => <PharmacyRegisterPage reportKind="purchase-return" />,
  sales_summary: () => <PharmacyRegisterPage reportKind="sales-summary" />,
  schedule_h_drug_report: () => <PharmacyRegisterPage reportKind="schedule-h" />,
  consolidated_stock_report: () => <PharmacyRegisterPage reportKind="stock" />,

  // Reports
  form_3c_report: () => <Form3CReportPage />,
  doctor_wise_collection_report: () => <DoctorCollectionReportPage />,
  pathology_doctor_wise_collection_report: () => <PathologyCollectionReportPage />,
  user_wise_cash_transaction_report: () => <UserCashTransactionReportPage />,
  cancellation_bill_report: () => <CancellationBillReportPage />,
  modification_bill_report: () => <ModificationBillReportPage />,
  token_number_userwise_report: () => <UserCashTransactionReportPage />,
  user_wise_report: () => <UserCashTransactionReportPage />,

  // Users
  user_addition_modification: () => <UserManagementPage />,
  user_type_creation: () => <UserTypePage />,
  role_management: () => <RoleManagementPage />,
  role_menu_permissions: () => <RoleMenuPermissionsPage />,
  user_role_mapping: () => <UserRoleMappingPage />,
  notification_setup: () => <NotificationSetupPage />,
  database_migration: () => <DatabaseMigrationPage />,
  print_template_designer: () => <BillTemplateDesignerPage />,

  // Shortcuts / assignments
  dashboard_shortcut_setup: () => <DashboardShortcutPage />,
  assign_medicine_to_group: () => <AssignMedicineGroupPage />,
  assign_services_to_group: () => <AssignServicesGroupPage />,
  assign_services_to_package: () => <AssignServicesPackagePage />,

  // Transactions extras
  department_wise_service_entry: () => <DepartmentServiceEntryPage />,
  unbilled_token_entry: () => <OpdBillPage />,
  realisation_date_entry_menu: () => <RealisationDatePage />,
  authorise_discount: () => <AuthoriseDiscountPage />,
  payment_mode_entry: () => <PaymentModeEntryPage />,

  // Medical records / scanning
  patient_history_opd: () => <PatientHistoryOpdPage />,
  patient_history_search: () => <PatientHistorySearchPage />,
  scanning_patient_documents: () => (
    <DocumentScanPage title="Scanning Patient Documents" scannerName="SD" />
  ),
  scanning_pathology_department: () => (
    <DocumentScanPage title="Scanning Pathology Department" scannerName="SP" />
  ),
  scanning_radiology_department: () => (
    <DocumentScanPage title="Scanning Radiology Department" scannerName="SR" />
  ),
  scanning_medicine_prescription: () => (
    <DocumentScanPage title="Scanning Medicine Prescription" scannerName="SM" />
  ),
  scanning_other_documents: () => (
    <DocumentScanPage title="Scanning Other Documents" scannerName="SO" />
  ),
  scanned_document_date_modification: () => (
    <DocumentScanPage title="Scanned Document Date Modification" scannerName="SD" />
  ),
  alter_scanned_document_id: () => (
    <DocumentScanPage title="Alter Scanned Document ID" scannerName="SD" />
  ),
}

const CORE_CODES = new Set([
  'dashboard',
  'party_master',
  'company_profile',
  'print_master',
  'print_template_designer',
  'ledger_master',
  'advance_collection',
  'advance_reprint',
  'adjustment_entry',
  'receipt_voucher_adjustment_entry',
  'daybook',
  'cash_book',
  'cashbook',
  'ledger_details',
  'balance_sheet',
  'payment_mode_creation',
  'user_addition_modification',
])

export function renderMenuPage(code: string, product = '') {
  if (product === 'generp') return renderGenerpMenuPage(code)
  if (product === 'kramcop') {
    const page = renderKramcopMenuPage(code)
    if (page) return page
  }
  if (product === 'contract_farming') {
    const page = renderContractFarmingMenuPage(code)
    if (page) return page
  }
  if (code === 'payment_mode_creation' && product !== 'hospital') {
    return <PaymentModesPage />
  }
  if (product !== 'hospital' && !CORE_CODES.has(code)) {
    return (
      <PlaceholderPage
        title={code.replaceAll('_', ' ')}
        note="This screen is not part of the current product."
      />
    )
  }
  const render = PAGES[code]
  if (render) return render()
  // Dynamic short-bill / SSO menus generated at runtime (sbt_*, sso_*)
  if (code.startsWith('sbt_')) {
    return <ShortBillPage menuCode={code} />
  }
  if (code.startsWith('sso_')) {
    return <SingleServiceOpdBillPage menuCode={code} />
  }
  return (
    <PlaceholderPage
      title={code.replaceAll('_', ' ')}
      note="This menu is not available in the current product."
    />
  )
}
