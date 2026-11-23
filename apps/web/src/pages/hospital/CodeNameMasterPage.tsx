import { ActionSelectMaster } from './masters/ActionSelectMaster'

type Props = {
  title: string
  listPath: string
  createPath?: string
  paginated?: boolean
  extraCreateFields?: Record<string, unknown>
  columns?: Array<{ key: string; label: string }>
  codeKey?: string
  nameKey?: string
}

export function CodeNameMasterPage({
  title,
  listPath,
  createPath,
  paginated = false,
  extraCreateFields,
  columns,
  codeKey = 'code',
  nameKey = 'name',
}: Props) {
  return (
    <ActionSelectMaster
      title={title}
      listPath={listPath}
      createPath={createPath}
      paginated={paginated}
      codeKey={codeKey}
      labelKey={nameKey}
      defaults={{
        [codeKey]: '',
        [nameKey]: '',
        ...((extraCreateFields || {}) as Record<string, string | number | boolean>),
      }}
      fields={[
        { key: codeKey, label: 'Code', placeholder: 'Auto', readOnlyOnModify: true },
        { key: nameKey, label: 'Name', required: true },
      ]}
      columns={
        columns || [
          { key: codeKey, label: 'Code' },
          { key: nameKey, label: 'Name' },
        ]
      }
      mapCreate={(form) => ({
        [codeKey]: String(form[codeKey] ?? '').trim() || null,
        [nameKey]: form[nameKey],
        ...(extraCreateFields || {}),
      })}
      mapUpdate={(form) => ({
        [codeKey]: form[codeKey],
        [nameKey]: form[nameKey],
      })}
    />
  )
}
