import { useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { fetchReportHtml, openHtmlPreview, todayIso } from './reportFetch'

type Report = { rows?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }

export function ModificationBillReportPage() {
  const [fromDate, setFromDate] = useState(todayIso())
  const [toDate, setToDate] = useState(todayIso())
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const params = { from_date: fromDate, to_date: toDate }

  async function run() {
    setBusy(true)
    setError(null)
    try {
      setReport(await api.get<Report>('/hospital/reports/modification-bills', params))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function printHtml() {
    setBusy(true)
    setError(null)
    try {
      openHtmlPreview(
        await fetchReportHtml('/hospital/reports/modification-bills/html', params),
        'Modification Bill Report',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const rows = report?.rows || report?.items || []
  const cols = rows[0] ? Object.keys(rows[0]) : []

  return (
    <div className="hms-page">
      <h1>Modification Bill Details Report</h1>
      {error && <div className="hms-error">{error}</div>}
      <div className="hms-toolbar">
        <label>From</label>
        <input className="hms-field" style={{ width: 140 }} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <label>To</label>
        <input className="hms-field" style={{ width: 140 }} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <button className="hms-btn hms-btn-primary" type="button" disabled={busy} onClick={() => void run()}>
          Run
        </button>
        <button className="hms-btn" type="button" disabled={busy} onClick={() => void printHtml()}>
          Print
        </button>
      </div>
      {report && (
        <div className="hms-table-wrap">
          <table className="hms-table">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c}>{String(r[c] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
