import { ActionSelectMaster } from '../masters/ActionSelectMaster'

const nullable = (v: unknown) => (v === '' || v == null ? null : String(v).trim())

function body(f: Record<string, string | number | boolean>) {
  return {
    name: String(f.name || '').trim(),
    contact_person: nullable(f.contact_person),
    phone: nullable(f.phone),
    email: nullable(f.email),
    address: nullable(f.address),
    gst_number: nullable(f.gst_number),
    sort_order: Number(f.sort_order) || 0,
  }
}

/** Supplier Master — /hospital/pharmacy/suppliers */
export function SupplierMasterPage() {
  return (
    <ActionSelectMaster
      title="Supplier Master"
      listPath="/hospital/pharmacy/suppliers"
      defaults={{ sort_order: 0, is_active: true }}
      fields={[
        { key: 'code', label: 'Code', readOnlyAlways: true, placeholder: 'Auto' },
        { key: 'name', label: 'Supplier Name', required: true },
        { key: 'contact_person', label: 'Contact Person' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'gst_number', label: 'GST No' },
        { key: 'sort_order', label: 'Sort Order', type: 'number' },
        { key: 'address', label: 'Address', type: 'textarea' },
      ]}
      mapCreate={(f) => ({ ...body(f), is_active: true })}
      mapUpdate={body}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'contact_person', label: 'Contact' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'gst_number', label: 'GST No' },
      ]}
    />
  )
}
