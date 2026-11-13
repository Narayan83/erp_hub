import { ActionSelectMaster } from './ActionSelectMaster'

/** Package Creation Master — /hospital/billing-packages */
export function PackageMasterPage() {
  return (
    <ActionSelectMaster
      title="Package Creation Master"
      hint="Create billing packages. Use “Assign Services To Package” to add the services."
      listPath="/hospital/billing-packages"
      defaults={{ code: '', name: '', package_total: '', description: '', sort_order: 0 }}
      fields={[
        { key: 'code', label: 'Code', placeholder: 'Auto', readOnlyOnModify: true },
        { key: 'name', label: 'Package Name', required: true },
        { key: 'package_total', label: 'Package Total', type: 'number' },
        { key: 'sort_order', label: 'Sort Order', type: 'number' },
        { key: 'description', label: 'Description', type: 'textarea' },
      ]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Package' },
        { key: 'package_total', label: 'Total' },
        { key: 'item_count', label: 'Services' },
        { key: 'sort_order', label: 'Sort' },
      ]}
      mapCreate={(f) => ({
        code: String(f.code || '').trim() || null,
        name: f.name,
        package_total: f.package_total === '' || f.package_total == null ? null : Number(f.package_total),
        description: String(f.description || '') || null,
        sort_order: Number(f.sort_order) || 0,
      })}
      mapUpdate={(f) => ({
        name: f.name,
        package_total: f.package_total === '' || f.package_total == null ? null : Number(f.package_total),
        description: String(f.description || '') || null,
        sort_order: Number(f.sort_order) || 0,
      })}
    />
  )
}
