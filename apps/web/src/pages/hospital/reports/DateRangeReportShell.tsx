import { Fragment, ReactNode, useState } from 'react'
import { api } from '../../../api/client'
import { listAll } from '../billing/paged'
import '../billing/hms-master.css'

const TOKEN_KEY = 'erp_token'
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api/v1'

export type ReportParamValue = string | string[] | number | boolean | null | undefined
export type ReportParams = Record<string, ReportParamValue>

export type ReportColumn = {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
}

export type ReportRow = {
  cells: Record<string, ReactNode>
  /** group = full-width heading row, subtotal/total = bold summary rows */
  kind?: 'group' | 'subtotal' | 'total'
}

export type ReportTableModel = {
  key?: string
  title?: string
  columns: ReportColumn[]
  rows: ReportRow[]
}

function localIso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function isoToday(): string {
  return localIso(new Date())
}

export function firstOfMonthIso(): string {
  const d = new Date()
  return localIso(new Date(d.getFullYear(), d.getMonth(), 1))
}

type DatePreset = { label: string; range: () => [string, string] }

const DATE_PRESETS: DatePreset[] = [
  { label: 'Today', range: () => [isoToday(), isoToday()] },
  {
    label: 'Yesterday',
    range: () => {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      return [localIso(d), localIso(d)]
    },
  },
  { label: 'This Month', range: () => [firstOfMonthIso(), isoToday()] },
  {
    label: 'Last Month',
    range: () => {
      const d = new Date()
      return [localIso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), localIso(new Date(d.getFullYear(), d.getMonth(), 0))]
    },
  },
]

export function fmtMoney(v: number | string | null | undefined): string {
  const n = Number(v ?? 0)
  return (Number.isFinite(n) ? n : 0).toFixed(2)
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return `${fmtDate(v)} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

/** Build "?a=1&b=2&b=3" skipping empty values; arrays repeat the key. */
export function buildQuery(params: ReportParams): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      v.filter((x) => x !== '').forEach((x) => q.append(k, x))
    } else {
      q.append(k, String(v))
    }
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

export type DoctorOption = { id: string; full_name: string; doctor_code?: string }

/** /hospital/doctors caps page_size at 100, so page through the results. */
export async function loadAllDoctors(): Promise<DoctorOption[]> {
  return listAll<DoctorOption>('/hospital/doctors')
}

/** Fetch the HTML report with the bearer token and show it via blob URL in a new window. */
export async function printHtmlReport(path: string): Promise<void> {
  // Open synchronously so the popup is not blocked after the async fetch.
  const win = window.open('', '_blank')
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const res = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
      headers: {
        Accept: 'text/html,application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    const text = await res.text()
    if (!res.ok) {
      let detail: unknown = text
      try {
        detail = JSON.parse(text)?.detail ?? text
      } catch {
        /* keep raw text */
      }
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
    }
    const blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/html' }))
    if (win) win.location.href = blobUrl
    else window.open(blobUrl, '_blank')
    setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000)
  } catch (err) {
    win?.close()
    throw err
  }
}

/** Download a server-generated file (e.g. `.../excel?...`) with the bearer token. */
export async function downloadReportFile(path: string, fileName: string): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const text = await res.text()
    let detail: unknown = text
    try {
      detail = JSON.parse(text)?.detail ?? text
    } catch {
      /* keep raw text */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

type ShellProps<T> = {
  title: string
  hint?: string
  /** JSON endpoint, e.g. /hospital/reports/form-3c. HTML is `${endpoint}/html`. */
  endpoint: string
  /** Extra (non-date) query params; arrays are sent as repeated keys. */
  params?: ReportParams
  /** Extra filter controls rendered next to the date inputs. */
  filters?: ReactNode
  /** Return an error message to block Run/Print, or null when OK. */
  validate?: () => string | null
  datesRequired?: boolean
  buildTables: (data: T) => ReportTableModel[]
  /** Optional summary block shown under the tables. */
  renderSummary?: (data: T) => ReactNode
  /** Full-width controls rendered under the date/filter grid. */
  belowFilters?: ReactNode
  /** When set, shows an Excel button that downloads `${endpoint}/excel` as this file name. */
  excelFileName?: string
  /** Content of the Help panel; the Help button is hidden when omitted. */
  help?: ReactNode
  defaultRange?: 'today' | 'month'
  runLabel?: string
}

function ReportTable({ model }: { model: ReportTableModel }) {
  return (
    <div style={{ marginBottom: 10 }}>
      {model.title ? <div style={{ fontWeight: 700, margin: '4px 0' }}>{model.title}</div> : null}
      <div className="hms-table-wrap" style={{ maxHeight: 'none' }}>
        <table className="hms-table">
          <thead>
            <tr>
              {model.columns.map((c) => (
                <th key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.length === 0 ? (
              <tr style={{ cursor: 'default' }}>
                <td colSpan={model.columns.length} style={{ textAlign: 'center', color: '#64748b' }}>
                  No records
                </td>
              </tr>
            ) : (
              model.rows.map((row, i) =>
                row.kind === 'group' ? (
                  <tr key={i} style={{ cursor: 'default', background: '#e8eef6', fontWeight: 700 }}>
                    <td colSpan={model.columns.length}>{row.cells[model.columns[0].key]}</td>
                  </tr>
                ) : (
                  <tr
                    key={i}
                    style={{
                      cursor: 'default',
                      fontWeight: row.kind ? 700 : undefined,
                      background: row.kind === 'total' ? '#dbeafe' : row.kind === 'subtotal' ? '#f1f5f9' : undefined,
                    }}
                  >
                    {model.columns.map((c) => (
                      <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                        {row.cells[c.key] ?? ''}
                      </td>
                    ))}
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function DateRangeReportShell<T>({
  title,
  hint,
  endpoint,
  params,
  filters,
  validate,
  datesRequired = true,
  buildTables,
  renderSummary,
  belowFilters,
  excelFileName,
  help,
  defaultRange = 'month',
  runLabel = 'Run',
}: ShellProps<T>) {
  const [fromDate, setFromDate] = useState(defaultRange === 'today' ? isoToday() : firstOfMonthIso())
  const [toDate, setToDate] = useState(isoToday())
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  function query(): string | null {
    if (datesRequired && (!fromDate || !toDate)) {
      setError('From date and To date are required')
      return null
    }
    if (fromDate && toDate && fromDate > toDate) {
      setError('From date cannot be after To date')
      return null
    }
    const msg = validate?.()
    if (msg) {
      setError(msg)
      return null
    }
    return buildQuery({ from_date: fromDate, to_date: toDate, ...params })
  }

  async function run() {
    setError(null)
    const q = query()
    if (q === null) return
    setBusy(true)
    try {
      setData(await api.get<T>(`${endpoint}${q}`))
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function print() {
    setError(null)
    const q = query()
    if (q === null) return
    try {
      await printHtmlReport(`${endpoint}/html${q}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function excel() {
    if (!excelFileName) return
    setError(null)
    const q = query()
    if (q === null) return
    try {
      await downloadReportFile(`${endpoint}/excel${q}`, excelFileName)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const tables = data ? buildTables(data) : []

  return (
    <div className="hms-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h1 style={{ flex: 1 }}>{title}</h1>
        {help ? (
          <button type="button" className="hms-btn" onClick={() => setShowHelp((v) => !v)}>
            {showHelp ? 'Hide Help' : 'Help'}
          </button>
        ) : null}
      </div>
      {hint ? <div className="hint">{hint}</div> : null}
      {help && showHelp ? <div className="hms-box hms-report-help">{help}</div> : null}
      {error ? <div className="hms-error">{error}</div> : null}

      <div className="hms-box">
        <span className="hms-box-title">Filters</span>
        <div className="hms-grid hms-grid-4" style={{ alignItems: 'end' }}>
          <div className="hms-field-wrap">
            <label>From Date</label>
            <input
              className="hms-field"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="hms-field-wrap">
            <label>To Date</label>
            <input className="hms-field" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          {filters}
        </div>
        <div className="hms-actions" style={{ marginTop: 4 }}>
          {DATE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="hms-btn"
              style={{ height: 22, padding: '0 8px', fontSize: 11 }}
              onClick={() => {
                const [f, t] = p.range()
                setFromDate(f)
                setToDate(t)
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        {belowFilters}
        <div className="hms-actions">
          <button type="button" className="hms-btn hms-btn-primary" disabled={busy} onClick={() => void run()}>
            {busy ? 'Loading…' : runLabel}
          </button>
          <button type="button" className="hms-btn" onClick={() => void print()}>
            Print
          </button>
          {excelFileName ? (
            <button type="button" className="hms-btn" onClick={() => void excel()}>
              Excel
            </button>
          ) : null}
        </div>
      </div>

      {data ? (
        <div className="hms-box">
          <span className="hms-box-title">Report</span>
          {tables.map((t, i) => (
            <Fragment key={t.key ?? i}>
              <ReportTable model={t} />
            </Fragment>
          ))}
          {renderSummary ? renderSummary(data) : null}
        </div>
      ) : null}
    </div>
  )
}
