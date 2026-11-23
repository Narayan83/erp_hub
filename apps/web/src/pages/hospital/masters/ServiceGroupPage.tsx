import { ActionSelectMaster } from './ActionSelectMaster'

/**
 * Service Groups. Services are attached via “Assign Services To Group”.
 */
export function ServiceGroupPage() {
  return (
    <ActionSelectMaster
      title="Service Groups"
      hint="A service shows under a group on OPD and IPD bills after it is assigned to that group."
      listPath="/hospital/service-groups"
      defaults={{ code: '', name: '', sort_order: 0 }}
      fields={[
        { key: 'code', label: 'Code', placeholder: 'Auto', readOnlyOnModify: true },
        { key: 'name', label: 'Group Name', required: true },
        { key: 'sort_order', label: 'Sort Order', type: 'number' },
      ]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Group' },
        { key: 'sort_order', label: 'Sort' },
      ]}
      mapCreate={(f) => ({
        code: String(f.code || '').trim() || null,
        name: f.name,
        sort_order: Number(f.sort_order) || 0,
      })}
      mapUpdate={(f) => ({ name: f.name, sort_order: Number(f.sort_order) || 0 })}
    />
  )
}
