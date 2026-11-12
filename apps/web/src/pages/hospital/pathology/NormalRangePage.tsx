import { ActionSelectMaster } from '../masters/ActionSelectMaster'
import { GENDER_OPTIONS, useOptions } from '../shared/hmsShared'

type Named = { id: string; code?: string; name: string }

const nullable = (v: unknown) => (v === '' || v == null ? null : v)

/** Reference Ranges (normal_range_creation) — /hospital/pathology/normal-ranges */
export function NormalRangePage() {
  const params = useOptions<Named>('/hospital/pathology/parameters', (p) => ({
    value: p.id,
    label: `${p.code || ''} — ${p.name}`,
  }))
  const units = useOptions<Named>('/hospital/pathology/units', (u) => ({
    value: u.id,
    label: u.name,
  }))

  return (
    <ActionSelectMaster
      title="Reference Ranges"
      hint="Normal range per parameter, gender and age band (age in days)."
      listPath="/hospital/pathology/normal-ranges"
      codeKey="parameter_code"
      labelKey="parameter_name"
      defaults={{ gender: 'A', age_from_days: 0, age_to_days: 36500, sort_order: 0 }}
      fields={[
        { key: 'parameter_id', label: 'Parameter', type: 'select', required: true, options: params.options, readOnlyOnModify: true },
        { key: 'gender', label: 'Gender', type: 'select', required: true, options: GENDER_OPTIONS.map((g) => ({ value: g.value, label: g.label })) },
        { key: 'unit_id', label: 'Unit', type: 'select', options: units.options },
        { key: 'age_from_days', label: 'Age From (days)', type: 'number' },
        { key: 'age_to_days', label: 'Age To (days)', type: 'number' },
        { key: 'sort_order', label: 'Sort Order', type: 'number' },
        { key: 'min_value', label: 'Min Value', type: 'number' },
        { key: 'max_value', label: 'Max Value', type: 'number' },
        { key: 'text_range', label: 'Text Range', placeholder: 'e.g. Negative / 4.0 - 11.0' },
      ]}
      mapCreate={(f) => ({
        parameter_id: f.parameter_id,
        gender: f.gender || 'A',
        age_from_days: Number(f.age_from_days) || 0,
        age_to_days: f.age_to_days === '' ? 36500 : Number(f.age_to_days),
        min_value: nullable(f.min_value),
        max_value: nullable(f.max_value),
        text_range: nullable(f.text_range),
        unit_id: nullable(f.unit_id),
        sort_order: Number(f.sort_order) || 0,
      })}
      mapUpdate={(f) => ({
        gender: f.gender || 'A',
        age_from_days: Number(f.age_from_days) || 0,
        age_to_days: f.age_to_days === '' ? 36500 : Number(f.age_to_days),
        min_value: nullable(f.min_value),
        max_value: nullable(f.max_value),
        text_range: nullable(f.text_range),
        unit_id: nullable(f.unit_id),
        sort_order: Number(f.sort_order) || 0,
      })}
      columns={[
        { key: 'parameter_code', label: 'Code' },
        { key: 'parameter_name', label: 'Parameter' },
        { key: 'gender', label: 'Gender' },
        { key: 'age_from_days', label: 'Age From (d)' },
        { key: 'age_to_days', label: 'Age To (d)' },
        { key: 'min_value', label: 'Min' },
        { key: 'max_value', label: 'Max' },
        { key: 'text_range', label: 'Text Range' },
        { key: 'unit_name', label: 'Unit' },
      ]}
    />
  )
}
