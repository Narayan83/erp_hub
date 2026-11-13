import { ActionSelectMaster } from '../masters/ActionSelectMaster'

type Props = {
  title: string
  /** pharmacy code-master type: MF manufacturer, MK marketing agency, DM distributor, DC drug category, MG medicine group */
  typeCode: string
  /** defaults to the shared code-masters endpoint */
  listPath?: string
  hint?: string
}

/**
 * Reusable Code/Name master for pharmacy lookups.
 * GET/POST /hospital/pharmacy/code-masters?master_type=XX, PATCH/DELETE /code-masters/{id}
 */
export function PharmacyPartyMasterPage({
  title,
  typeCode,
  listPath = '/hospital/pharmacy/code-masters',
  hint,
}: Props) {
  return (
    <ActionSelectMaster
      title={title}
      hint={hint}
      listPath={listPath}
      listParams={{ master_type: typeCode }}
      defaults={{ sort_order: 0, is_active: true }}
      fields={[
        { key: 'code', label: 'Code', readOnlyAlways: true, placeholder: 'Auto' },
        { key: 'name', label: 'Name', required: true },
        { key: 'sort_order', label: 'Sort Order', type: 'number' },
      ]}
      mapCreate={(f) => ({
        master_type: typeCode,
        name: String(f.name || '').trim(),
        sort_order: Number(f.sort_order) || 0,
        is_active: true,
      })}
      mapUpdate={(f) => ({
        name: String(f.name || '').trim(),
        sort_order: Number(f.sort_order) || 0,
      })}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'sort_order', label: 'Sort' },
      ]}
    />
  )
}
