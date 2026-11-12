import { ActionSelectMaster } from './ActionSelectMaster'

export function PatientIdFormatPage() {
  return (
    <ActionSelectMaster
      title="Patient ID Format"
      hint="Pattern tokens like {YY}{SEQ} — sample_output is shown on registration."
      listPath="/hospital/patient-no-formats"
      codeKey="code"
      labelKey="name"
      defaults={{
        code: '',
        name: '',
        pattern: '{YY}{SEQ}',
        sample_output: '25001',
        seq_pad_width: 3,
        is_selected: false,
        sort_order: 0,
      }}
      fields={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name', required: true },
        { key: 'pattern', label: 'Pattern', required: true },
        { key: 'sample_output', label: 'Sample Output', required: true },
        { key: 'seq_pad_width', label: 'Seq Pad Width', type: 'number' },
        { key: 'sort_order', label: 'Sort Order', type: 'number' },
        { key: 'is_selected', label: 'Selected', type: 'checkbox' },
      ]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'pattern', label: 'Pattern' },
        { key: 'sample_output', label: 'Sample' },
        { key: 'is_selected', label: 'Selected' },
      ]}
      mapCreate={(form) => ({
        code: form.code || null,
        name: form.name,
        pattern: form.pattern,
        sample_output: form.sample_output,
        seq_pad_width: Number(form.seq_pad_width) || 3,
        is_selected: Boolean(form.is_selected),
        sort_order: Number(form.sort_order) || 0,
      })}
      mapUpdate={(form) => ({
        name: form.name,
        pattern: form.pattern,
        sample_output: form.sample_output,
        seq_pad_width: Number(form.seq_pad_width) || 3,
        is_selected: Boolean(form.is_selected),
        sort_order: Number(form.sort_order) || 0,
      })}
    />
  )
}
