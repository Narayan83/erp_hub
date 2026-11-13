import { ActionSelectMaster } from './masters/ActionSelectMaster'

export function PatientServiceMasterPage() {
  return (
    <ActionSelectMaster
      title="Patient Service Creation"
      hint="OPD/IPD billable services — rate feeds billing catalogues."
      listPath="/hospital/patient-services"
      codeKey="code"
      labelKey="name"
      defaults={{ code: '', name: '', rate: 0, service_charge: 0 }}
      fields={[
        { key: 'code', label: 'Code', required: true },
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
        code: form.code,
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
