import { FIELD_SOURCE_GROUPS, type BarcodeFieldSource } from '../../lib/generp/barcodeLabels'

export function BarcodeFieldSourceSelect({
  value,
  onChange,
}: {
  value: BarcodeFieldSource
  onChange: (value: BarcodeFieldSource) => void
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as BarcodeFieldSource)}>
      {FIELD_SOURCE_GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.text}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
