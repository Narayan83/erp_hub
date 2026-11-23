import { ActionSelectMaster } from '../masters/ActionSelectMaster'
import { useOptions } from '../shared/hmsShared'

type Named = { id: string; code?: string; name: string }

const nullable = (v: unknown) => (v === '' || v == null ? null : v)

/** Result Templates (custom_template_creation) — /hospital/pathology/result-templates */
export function ResultTemplatePage() {
  const params = useOptions<Named>('/hospital/pathology/parameters', (p) => ({
    value: p.id,
    label: `${p.code || ''} — ${p.name}`,
  }))
  const services = useOptions<Named>('/hospital/pathology/lab-services', (s) => ({
    value: s.id,
    label: `${s.code || ''} — ${s.name}`,
  }))

  return (
    <ActionSelectMaster
      title="Result Templates"
      hint="Reusable result text for a parameter and/or lab service."
      listPath="/hospital/pathology/result-templates"
      defaults={{ body: '', sort_order: 0, is_active: true }}
      fields={[
        { key: 'code', label: 'Code', placeholder: 'Auto', readOnlyOnModify: true },
        { key: 'name', label: 'Template Name', required: true },
        { key: 'sort_order', label: 'Sort Order', type: 'number' },
        { key: 'parameter_id', label: 'Parameter', type: 'select', options: params.options },
        { key: 'service_id', label: 'Lab Service', type: 'select', options: services.options },
        { key: 'body', label: 'Template Body', type: 'textarea' },
      ]}
      mapCreate={(f) => ({
        code: String(f.code ?? '').trim() || null,
        name: f.name,
        body: f.body || '',
        parameter_id: nullable(f.parameter_id),
        service_id: nullable(f.service_id),
        sort_order: Number(f.sort_order) || 0,
      })}
      mapUpdate={(f) => ({
        name: f.name,
        body: f.body || '',
        parameter_id: nullable(f.parameter_id),
        service_id: nullable(f.service_id),
        sort_order: Number(f.sort_order) || 0,
      })}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'parameter_name', label: 'Parameter' },
        { key: 'service_name', label: 'Service' },
        { key: 'sort_order', label: 'Sort' },
      ]}
    />
  )
}
