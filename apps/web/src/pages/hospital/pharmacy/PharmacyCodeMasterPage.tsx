import { ActionSelectMaster } from '../masters/ActionSelectMaster'

type Props = { title: string; masterType: string }

export function PharmacyCodeMasterPage({ title, masterType }: Props) {
  return (
    <ActionSelectMaster
      title={title}
      listPath="/hospital/pharmacy/code-masters"
      listParams={{ master_type: masterType }}
      codeKey="code"
      labelKey="name"
      defaults={{ code: '', name: '', master_type: masterType, sort_order: 0 }}
      fields={[
        { key: 'code', label: 'Code', required: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'sort_order', label: 'Sort Order', type: 'number' },
      ]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'sort_order', label: 'Sort' },
      ]}
      mapCreate={(form) => ({
        code: form.code || null,
        name: form.name,
        master_type: masterType,
        sort_order: Number(form.sort_order) || 0,
      })}
      mapUpdate={(form) => ({
        name: form.name,
        sort_order: Number(form.sort_order) || 0,
      })}
    />
  )
}
