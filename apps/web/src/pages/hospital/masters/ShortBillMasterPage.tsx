import { ActionSelectMaster } from './ActionSelectMaster'
import { useOptions } from '../shared/hmsShared'

type Doctor = { id: string; doctor_code?: string; full_name?: string }

/** Short Bill Master — bill types that drive the generic Short Bill transaction pages. */
export function ShortBillMasterPage() {
  const { options: doctors } = useOptions<Doctor>(
    '/hospital/doctors',
    (d) => ({ value: d.id, label: `${d.doctor_code || ''} — ${d.full_name || ''}` }),
    { page: 1, page_size: 100 },
  )

  const blankToNull = (v: unknown) => (v === '' || v == null ? null : v)

  return (
    <ActionSelectMaster
      title="Short Bill Master"
      hint="Each short bill type gets its own transaction menu (menu code). Leave code / menu code blank to auto-generate."
      listPath="/hospital/short-bills/types"
      defaults={{
        code: '',
        name: '',
        menu_code: '',
        default_service_name: '',
        default_rate: 0,
        default_doctor_id: '',
        bill_prefix: 'SB',
        sort_order: 0,
        is_active: true,
      }}
      fields={[
        { key: 'code', label: 'Code', placeholder: 'Auto', readOnlyOnModify: true },
        { key: 'name', label: 'Bill Type Name', required: true },
        { key: 'menu_code', label: 'Menu Code', placeholder: 'Auto', readOnlyOnModify: true },
        { key: 'default_service_name', label: 'Default Service Name' },
        { key: 'default_rate', label: 'Default Rate', type: 'number' },
        { key: 'default_doctor_id', label: 'Default Doctor', type: 'select', options: doctors },
        { key: 'bill_prefix', label: 'Bill Prefix' },
        { key: 'sort_order', label: 'Sort Order', type: 'number' },
        { key: 'is_active', label: 'Active', type: 'checkbox' },
      ]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'menu_code', label: 'Menu Code' },
        { key: 'default_service_name', label: 'Default Service' },
        { key: 'default_rate', label: 'Rate' },
        { key: 'default_doctor_name', label: 'Doctor' },
        { key: 'bill_prefix', label: 'Prefix' },
        { key: 'is_active', label: 'Active' },
      ]}
      mapCreate={(f) => ({
        code: blankToNull(String(f.code || '').trim()),
        name: f.name,
        menu_code: blankToNull(String(f.menu_code || '').trim()),
        default_service_name: blankToNull(f.default_service_name),
        default_rate: Number(f.default_rate) || 0,
        default_doctor_id: blankToNull(f.default_doctor_id),
        bill_prefix: String(f.bill_prefix || '').trim() || 'SB',
        sort_order: Number(f.sort_order) || 0,
        is_active: Boolean(f.is_active),
      })}
      mapUpdate={(f) => ({
        name: f.name,
        default_service_name: blankToNull(f.default_service_name),
        default_rate: Number(f.default_rate) || 0,
        default_doctor_id: blankToNull(f.default_doctor_id),
        bill_prefix: String(f.bill_prefix || '').trim() || 'SB',
        sort_order: Number(f.sort_order) || 0,
        is_active: Boolean(f.is_active),
      })}
    />
  )
}
