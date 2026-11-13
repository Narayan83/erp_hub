import { ActionSelectMaster } from './ActionSelectMaster'

/** Letter Master — /hospital/letter-templates */
export function LetterMasterPage() {
  return (
    <ActionSelectMaster
      title="Letter Master"
      hint="Reusable letter templates (certificates, referral letters …)."
      listPath="/hospital/letter-templates"
      defaults={{ code: '', name: '', subject: '', body: '', sort_order: 0 }}
      fields={[
        { key: 'code', label: 'Code', placeholder: 'Auto', readOnlyOnModify: true },
        { key: 'name', label: 'Letter Name', required: true },
        { key: 'subject', label: 'Subject' },
        { key: 'sort_order', label: 'Sort Order', type: 'number' },
        { key: 'body', label: 'Body', type: 'textarea' },
      ]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'subject', label: 'Subject' },
        { key: 'sort_order', label: 'Sort' },
      ]}
      mapCreate={(f) => ({
        code: String(f.code || '').trim() || null,
        name: f.name,
        subject: String(f.subject || '') || null,
        body: String(f.body || ''),
        sort_order: Number(f.sort_order) || 0,
      })}
      mapUpdate={(f) => ({
        name: f.name,
        subject: String(f.subject || '') || null,
        body: String(f.body || ''),
        sort_order: Number(f.sort_order) || 0,
      })}
    />
  )
}
