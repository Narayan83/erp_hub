import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { downloadExcel } from '../../lib/generp/exportExcel'

export type YearMode = 'none' | 'financial_year' | 'year'

export type DocumentNumberRule = {
  id: string
  kind: string
  label: string
  prefix: string
  year_mode: YearMode
  prefix2: string
  prefix3: string
  seq_digits: number
  sample_no: string
  sample_display: string
}

const YEAR_OPTIONS: { value: YearMode; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'financial_year', label: 'Financial year (2627)' },
  { value: 'year', label: 'Year (2026)' },
]

function fyCode(d = new Date()): string {
  const month = d.getMonth() + 1
  const y = d.getFullYear()
  const start = month >= 4 ? y : y - 1
  return `${String(start % 100).padStart(2, '0')}${String((start + 1) % 100).padStart(2, '0')}`
}

function cleanToken(raw: string, max: number): string {
  return raw.replace(/[^A-Za-z0-9./_-]/g, '').slice(0, max)
}

function withSamples(r: DocumentNumberRule): DocumentNumberRule {
  const digits = Math.min(10, Math.max(4, Number(r.seq_digits) || 6))
  const seq = String(1).padStart(digits, '0')
  const year =
    r.year_mode === 'none' ? '' : r.year_mode === 'year' ? String(new Date().getFullYear()) : fyCode()
  const prefix = r.prefix || ''
  return {
    ...r,
    seq_digits: digits,
    sample_display: '—',
    sample_no: `${prefix}${year}${r.prefix2}${r.prefix3}${seq}`,
  }
}

export function BillPrefixPage() {
  const [rows, setRows] = useState<DocumentNumberRule[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<DocumentNumberRule[]>('/document-number-rules')
        setRows(data.map((r) => withSamples({ ...r, year_mode: r.year_mode || 'financial_year' })))
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load')
      }
    })()
  }, [])

  const patch = (kind: string, part: Partial<DocumentNumberRule>) => {
    setRows((cur) => cur.map((r) => (r.kind === kind ? withSamples({ ...r, ...part }) : r)))
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const updated = await api.put<DocumentNumberRule[]>('/document-number-rules', {
        rules: rows.map((r) => ({
          kind: r.kind,
          prefix: r.prefix,
          year_mode: r.year_mode,
          prefix2: r.prefix2,
          prefix3: r.prefix3,
          seq_digits: r.seq_digits,
        })),
      })
      setRows(updated.map((r) => withSamples(r)))
      alert('Prefixes saved. Sale Bill will use this format only after you save a bill — not while the screen is open.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const hint = useMemo(
    () =>
      'The sale bill screen does not show a number while you type. The full number (text prefix + year + other prefixes + sequence) is created only when you click Save. That way a bill you abandon never consumes a number, and two people saving at the same time get different numbers. Click Save Prefixes after you change this table.',
    [],
  )

  return (
    <div className="settings-page">
      <h2>Bill Prefix</h2>
      <p className="hint">{hint}</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="settings-box" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Document</th>
              <th>Text prefix</th>
              <th>Year</th>
              <th>2nd prefix</th>
              <th>3rd prefix</th>
              <th>Digits</th>
              <th>Before save</th>
              <th>Number after save</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind}>
                <td>{r.label}</td>
                <td>
                  <input
                    className="input"
                    value={r.prefix}
                    maxLength={16}
                    placeholder="e.g. INV"
                    style={{ width: 90 }}
                    onChange={(e) => patch(r.kind, { prefix: cleanToken(e.target.value, 16) })}
                  />
                </td>
                <td>
                  <select
                    className="input"
                    value={r.year_mode}
                    style={{ width: 170 }}
                    onChange={(e) => patch(r.kind, { year_mode: e.target.value as YearMode })}
                  >
                    {YEAR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="input"
                    value={r.prefix2}
                    maxLength={12}
                    placeholder="blank = none"
                    style={{ width: 80 }}
                    onChange={(e) => patch(r.kind, { prefix2: cleanToken(e.target.value, 12) })}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    value={r.prefix3}
                    maxLength={12}
                    placeholder="blank = none"
                    style={{ width: 80 }}
                    onChange={(e) => patch(r.kind, { prefix3: cleanToken(e.target.value, 12) })}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={4}
                    max={10}
                    value={r.seq_digits}
                    style={{ width: 64 }}
                    onChange={(e) => patch(r.kind, { seq_digits: Number(e.target.value) || 6 })}
                  />
                </td>
                <td>
                  <code>{r.sample_display}</code>
                </td>
                <td>
                  <code>{r.sample_no}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bill-prefix-save">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save Prefixes'}
        </button>
        <ExportFormatButtons
          disabled={rows.length === 0}
          onExport={(format) =>
            downloadExcel(
              'bill-prefixes',
              {
                name: 'Prefixes',
                headers: [
                  'Document',
                  'Text prefix',
                  'Year',
                  '2nd prefix',
                  '3rd prefix',
                  'Digits',
                  'Before save',
                  'Number after save',
                ],
                rows: rows.map((r) => [
                  r.label,
                  r.prefix,
                  r.year_mode,
                  r.prefix2,
                  r.prefix3,
                  r.seq_digits,
                  r.sample_display,
                  r.sample_no,
                ]),
              },
              format,
            )
          }
        />
        <span className="hint mb-0">Changes apply to the next bill you save.</span>
      </div>
    </div>
  )
}
