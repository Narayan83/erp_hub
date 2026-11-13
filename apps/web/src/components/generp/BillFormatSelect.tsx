import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { BILL_FORMATS } from '../../lib/generp/billFormat'

type ExtraFormat = { code: string; name: string; custom?: boolean }

type Props = {
  value: string
  onChange: (format: string) => void
  disabled?: boolean
  id?: string
  documentCode?: string
}

export function BillFormatSelect({ value, onChange, disabled, id, documentCode }: Props) {
  const [extras, setExtras] = useState<ExtraFormat[]>([])

  useEffect(() => {
    if (!documentCode) {
      setExtras([])
      return
    }
    let cancelled = false
    void api
      .get<{ formats?: ExtraFormat[] }>(`/print-configs/formats?code=${encodeURIComponent(documentCode)}`)
      .then((data) => {
        if (cancelled) return
        setExtras((data.formats || []).filter((f) => f.custom || String(f.code || '').startsWith('CUSTOM_')))
      })
      .catch(() => {
        if (!cancelled) setExtras([])
      })
    return () => {
      cancelled = true
    }
  }, [documentCode])

  const options = [...BILL_FORMATS, ...extras]
  const known = options.some((f) => f.code === value)

  return (
    <label className="bill-format-field">
      <span>Bill format</span>
      <select
        id={id}
        className="input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {!known && value ? <option value={value}>{value}</option> : null}
        {options.map((f) => (
          <option key={f.code} value={f.code}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  )
}
