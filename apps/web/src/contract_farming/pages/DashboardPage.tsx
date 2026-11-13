import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { BarChart } from '../components/BarChart'
import type { Charts, Project, ReportSummary } from '../types'

function money(v: number | string) {
  return Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

export function DashboardPage() {
  const [summary, setSummary] = useState<ReportSummary[]>([])
  const [charts, setCharts] = useState<Charts | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const [s, c, p] = await Promise.all([
          api.get<ReportSummary[]>('/reports/summary', { by_phase: 1 }),
          api.get<Charts>('/reports/charts'),
          api.get<Project[]>('/projects'),
        ])
        setSummary(s)
        setCharts(c)
        setProjects(p)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      }
    })()
  }, [])

  const receipts = summary.reduce((a, r) => a + Number(r.receipts || 0), 0)
  const payments = summary.reduce((a, r) => a + Number(r.payments || 0), 0)
  const balance = receipts - payments
  const txns = summary.reduce((a, r) => a + Number(r.txn_count || 0), 0)

  return (
    <div>
      <h1>Contract Farming</h1>
      <p className="hint">
        Multi-project farm accounting — partners, phases, labour, vendors, ledgers, and payments. Seeded from
        Susthira Balaga Balleruhundi Phase 6 & 7 sheets.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="stats">
        <div className="stat">
          <div className="label">Projects</div>
          <div className="value">{projects.length}</div>
        </div>
        <div className="stat">
          <div className="label">Receipts</div>
          <div className="value">₹ {money(receipts)}</div>
        </div>
        <div className="stat">
          <div className="label">Payments</div>
          <div className="value">₹ {money(payments)}</div>
        </div>
        <div className="stat">
          <div className="label">Balance</div>
          <div className="value">₹ {money(balance)}</div>
        </div>
        <div className="stat">
          <div className="label">Transactions</div>
          <div className="value">{txns}</div>
        </div>
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Phase summary</h3>
        <div className="table-wrap" style={{ border: 0 }}>
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
              {summary.map((r, i) => (
                <tr key={`${r.project_id}-${r.phase_id}-${i}`}>
                  <td>{r.project_name}</td>
                  <td>{r.phase_name || '—'}</td>
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
