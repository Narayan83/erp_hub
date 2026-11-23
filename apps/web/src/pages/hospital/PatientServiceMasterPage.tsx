import { ActionSelectMaster } from './masters/ActionSelectMaster'

export function PatientServiceMasterPage() {
  return (
    <ActionSelectMaster
      title="Patient Service Creation"
      hint="Download the Excel template, fill Code, Name, and Rate, then import. Leave Code blank and one is created. Service Charge is optional and uses Rate when the cell is empty."
      listPath="/hospital/patient-services"
      spreadsheet={{
        importPath: '/hospital/patient-services/import',
        templatePath: '/hospital/patient-services/import-template',
        templateFilename: 'patient-service-template.xlsx',
      }}
      codeKey="code"
      labelKey="name"
      defaults={{ code: '', name: '', rate: 0, service_charge: 0 }}
      fields={[
        { key: 'code', label: 'Code', placeholder: 'Auto', readOnlyOnModify: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'rate', label: 'Rate', type: 'number', required: true },
        { key: 'service_charge', label: 'Service Charge', type: 'number' },
      ]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'rate', label: 'Rate' },
        { key: 'service_charge', label: 'Service Charge' },
      ]}
      mapCreate={(form) => ({
        code: String(form.code ?? '').trim() || null,
        name: form.name,
        rate: Number(form.rate) || 0,
        service_charge: Number(form.service_charge ?? form.rate) || 0,
      })}
      mapUpdate={(form) => ({
        code: form.code,
        name: form.name,
        rate: Number(form.rate) || 0,
        service_charge: Number(form.service_charge ?? form.rate) || 0,
      })}
    />
  )
}
