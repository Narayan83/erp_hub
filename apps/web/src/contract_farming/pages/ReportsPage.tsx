import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { BarChart } from '../components/BarChart'
import type { Charts, Ledger, Project, ReportSummary } from '../types'

function money(v: number | string) {
  return Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

export function SummaryReportPage() {
  const [rows, setRows] = useState<ReportSummary[]>([])
  const [projectId, setProjectId] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState('')

  const load = async (pid?: string) => {
    setRows(
      await api.get<ReportSummary[]>('/reports/summary', {
        by_phase: 1,
        project_id: pid || undefined,
      }),
    )
  }

  useEffect(() => {
    void (async () => {
      try {
        setProjects(await api.get<Project[]>('/projects'))
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed')
      }
    })()
  }, [])

  return (
    <div>
      <h1>Project summary</h1>
      <p className="hint">Receipts, payments, and balance by project phase.</p>
      {error && <div className="error">{error}</div>}
      <div className="panel row">
        <label>
          Project
          <select
            className="input"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value)
              void load(e.target.value)
            }}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Phase</th>
              <th>Receipts</th>
              <th>Payments</th>
              <th>Balance</th>
              <th>Txns</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.project_id}-${r.phase_id}-${i}`}>
                <td>{r.project_name}</td>
                <td>{r.phase_name}</td>
                <td className="money">₹ {money(r.receipts)}</td>
                <td className="money">₹ {money(r.payments)}</td>
                <td className="money">₹ {money(r.balance)}</td>
                <td>{r.txn_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function LedgerReportPage() {
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [ledgerId, setLedgerId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [rows, setRows] = useState<
    {
      txn_date: string
      entry_type: string
      amount: number
      running_balance: number
      narration: string
    }[]
  >([])
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        setLedgers(await api.get<Ledger[]>('/ledgers'))
        setProjects(await api.get<Project[]>('/projects'))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed')
      }
    })()
  }, [])

  const load = async () => {
    setError('')
    try {
      setRows(
        await api.get('/reports/ledger', {
          ledger_id: ledgerId || undefined,
          project_id: projectId || undefined,
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
  }

  return (
    <div>
      <h1>Ledger report</h1>
      <p className="hint">Running balance for a ledger (optionally filtered by project).</p>
      {error && <div className="error">{error}</div>}
      <div className="panel row">
        <label>
          Ledger
          <select className="input" value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}>
            <option value="">All</option>
            {ledgers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" type="button" onClick={() => void load()}>
          Run
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Running</th>
              <th>Narration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.txn_date}</td>
                <td>
                  <span className={`badge ${r.entry_type}`}>{r.entry_type}</span>
                </td>
                <td className="money">₹ {money(r.amount)}</td>
                <td className="money">₹ {money(r.running_balance)}</td>
                <td>{r.narration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ChartsPage() {
  const [charts, setCharts] = useState<Charts | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [error, setError] = useState('')

  const load = async (pid?: string) => {
    setCharts(await api.get<Charts>('/reports/charts', { project_id: pid || undefined }))
  }

  useEffect(() => {
    void (async () => {
      try {
        setProjects(await api.get<Project[]>('/projects'))
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed')
      }
    })()
  }, [])

  return (
    <div>
      <h1>Charts</h1>
      <p className="hint">Visual breakdown of receipts, payments, partners, and work types.</p>
      {error && <div className="error">{error}</div>}
      <div className="panel row">
        <label>
          Project
          <select
            className="input"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value)
              void load(e.target.value)
            }}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {charts && (
        <div className="chart-grid">
          <BarChart title="Receipts vs payments" points={charts.receipts_vs_payments} />
          <BarChart title="Partner contributions" points={charts.by_partner} />
          <BarChart title="By phase" points={charts.by_phase} altSeries="Payments" />
          <BarChart title="Expense by work type" points={charts.by_work_type} />
        </div>
      )}
    </div>
  )
}
