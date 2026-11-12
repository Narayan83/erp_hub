import { ActionSelectMaster } from './masters/ActionSelectMaster'

type Props = { itemType: string; title: string }

export function PharmacyItemPage({ itemType, title }: Props) {
  return (
    <ActionSelectMaster
      title={title}
      listPath="/hospital/pharmacy/items"
      listParams={{ item_type: itemType }}
      codeKey="code"
      labelKey="name"
      defaults={{ code: '', name: '', mrp: 0, item_type: itemType }}
      fields={[
        { key: 'code', label: 'Code', required: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'mrp', label: 'MRP', type: 'number' },
      ]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'mrp', label: 'MRP' },
        { key: 'item_type', label: 'Type' },
      ]}
      mapCreate={(form) => ({
        code: form.code || null,
        name: form.name,
        item_type: itemType,
        mrp: Number(form.mrp) || 0,
      })}
      mapUpdate={(form) => ({
        name: form.name,
        mrp: Number(form.mrp) || 0,
      })}
    />
  )
}
