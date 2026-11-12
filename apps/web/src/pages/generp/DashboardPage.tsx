import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { fmt } from '../../lib/generp/saleBillMath'

type TrendPoint = {
  date: string
  sales: number
  retail_sales: number
  wholesale_sales: number
  purchases: number
  bills: number
}

type TopProduct = {
  product_id: string
  code?: string | null
  name: string
  qty: number
  amount: number
}

type LowStock = {
  product_id: string
  code?: string | null
  name: string
  current_stock: number
  unit?: string | null
}

type PayMix = {
  payment_mode_id: string
  name: string
  is_credit: boolean
  amount: number
}

type RecentVoucher = {
  id: string
  voucher_type: string
  voucher_no: string
  voucher_date?: string | null
  party_name?: string | null
  net_amount: number
}

type DashboardData = {
  as_of?: string
  range_days?: number
  kpis?: Record<string, number>
  sales_trend?: TrendPoint[]
  top_products?: TopProduct[]
  low_stock?: LowStock[]
  payment_mix_today?: PayMix[]
  recent_vouchers?: RecentVoucher[]
  today_sales?: number
  products?: number
  customers?: number
}

function money(n: number | undefined | null) {
  return fmt(Number(n || 0))
}

function shortDate(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function typeLabel(t: string) {
  return t.replace(/_/g, ' ')
}

export function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [days, setDays] = useState(14)

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const res = await api.get<DashboardData>('/dashboard/stats', { days })
      setData(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load dashboard')
    } finally {
      setBusy(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  const kpis = data?.kpis
  const trend = data?.sales_trend ?? []
  const maxSales = useMemo(() => Math.max(1, ...trend.map((t) => t.sales)), [trend])
  const maxTop = useMemo(
    () => Math.max(1, ...(data?.top_products ?? []).map((p) => p.amount)),
    [data?.top_products],
  )
  const payTotal = useMemo(
    () => (data?.payment_mix_today ?? []).reduce((s, p) => s + Number(p.amount || 0), 0) || 1,
    [data?.payment_mix_today],
  )

  return (
    <div className="dash-page">
      <div className="dash-hero">
        <div>
          <h2 className="dash-title">Dashboard</h2>
          <p className="dash-sub">
            Welcome{user?.full_name ? `, ${user.full_name}` : ''}. Live figures from your database
            {data?.as_of ? ` · as of ${data.as_of}` : ''}.
          </p>
        </div>
        <div className="dash-hero-actions">
          <select
            className="input"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Trend range"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button type="button" className="btn" disabled={busy} onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="dash-kpi-grid">
        <Kpi label="Today sales" value={`₹${money(kpis?.today_sales)}`} tone="brand" />
        <Kpi label="Today bills" value={String(kpis?.today_bills ?? '—')} tone="info" />
        <Kpi label="Collected today" value={`₹${money(kpis?.today_collected)}`} tone="ok" />
        <Kpi label="Credit today" value={`₹${money(kpis?.today_credit)}`} tone="warn" />
        <Kpi label="This week sales" value={`₹${money(kpis?.week_sales)}`} />
        <Kpi label="This month sales" value={`₹${money(kpis?.month_sales)}`} tone="brand" />
        <Kpi label="Month purchases" value={`₹${money(kpis?.month_purchases)}`} />
        <Kpi label="Low stock items" value={String(kpis?.low_stock_count ?? '—')} tone="danger" />
      </div>

      <div className="dash-grid-2">
        <section className="dash-card">
          <div className="dash-card-head">
            <h3>Sales trend</h3>
            <span className="dash-muted">{days} days · retail + wholesale</span>
          </div>
          {busy && !trend.length ? (
            <p className="dash-muted">Loading…</p>
          ) : (
            <div className="dash-bars" role="img" aria-label="Sales trend chart">
              {trend.map((p) => (
                <div key={p.date} className="dash-bar-col" title={`${p.date}: ₹${money(p.sales)}`}>
                  <div className="dash-bar-track">
                    <div
                      className="dash-bar-fill"
                      style={{ height: `${Math.max(4, (p.sales / maxSales) * 100)}%` }}
                    />
                  </div>
                  <span className="dash-bar-label">{shortDate(p.date)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="dash-split mt-2">
            <span>Month retail: ₹{money(kpis?.month_retail_sales)}</span>
            <span>Month wholesale: ₹{money(kpis?.month_wholesale_sales)}</span>
          </div>
        </section>

        <section className="dash-card">
          <div className="dash-card-head">
            <h3>Top products</h3>
            <span className="dash-muted">by amount</span>
          </div>
          {(data?.top_products ?? []).length === 0 ? (
            <p className="dash-muted">No sales in this period.</p>
          ) : (
            <ul className="dash-rank-list">
              {(data?.top_products ?? []).map((p) => (
                <li key={p.product_id}>
                  <div className="dash-rank-meta">
                    <strong>{p.name}</strong>
                    <span>
                      {p.code || '—'} · qty {fmt(p.qty, 0)}
                    </span>
                  </div>
                  <div className="dash-rank-bar-wrap">
                    <div
                      className="dash-rank-bar"
                      style={{ width: `${(p.amount / maxTop) * 100}%` }}
                    />
                  </div>
                  <div className="dash-rank-amt">₹{money(p.amount)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="dash-grid-2">
        <section className="dash-card">
          <div className="dash-card-head">
            <h3>Today payment mix</h3>
            <span className="dash-muted">from sale tenders</span>
          </div>
          {(data?.payment_mix_today ?? []).length === 0 ? (
            <p className="dash-muted">No payments recorded today.</p>
          ) : (
            <ul className="dash-pay-list">
              {(data?.payment_mix_today ?? []).map((p) => (
                <li key={p.payment_mode_id}>
                  <div className="dash-pay-row">
                    <span>
                      {p.name}
                      {p.is_credit ? ' (credit)' : ''}
                    </span>
                    <strong>₹{money(p.amount)}</strong>
                  </div>
                  <div className="dash-rank-bar-wrap">
                    <div
                      className={`dash-rank-bar${p.is_credit ? ' is-credit' : ''}`}
                      style={{ width: `${(p.amount / payTotal) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dash-card">
          <div className="dash-card-head">
            <h3>Low stock</h3>
            <button type="button" className="btn" onClick={() => navigate('/stock_balances')}>
              View stock
            </button>
          </div>
          {(data?.low_stock ?? []).length === 0 ? (
            <p className="dash-muted">No items at or below 5 units.</p>
          ) : (
            <div className="table-responsive">
              <table className="table dash-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Product</th>
                    <th className="text-end">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.low_stock ?? []).map((p) => (
                    <tr key={p.product_id}>
                      <td>{p.code || '—'}</td>
                      <td>{p.name}</td>
                      <td className="text-end text-danger fw-semibold">
                        {fmt(p.current_stock, 3)} {p.unit || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="dash-card">
        <div className="dash-card-head">
          <h3>Recent vouchers</h3>
          <div className="dash-masters">
            <span>Products: {kpis?.products ?? data?.products ?? '—'}</span>
            <span>Customers: {kpis?.customers ?? data?.customers ?? '—'}</span>
            <span>Suppliers/Vendors: {kpis?.vendors ?? '—'}</span>
          </div>
        </div>
        {(data?.recent_vouchers ?? []).length === 0 ? (
          <p className="dash-muted">No vouchers yet.</p>
        ) : (
          <div className="table-responsive">
            <table className="table dash-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>No</th>
                  <th>Party</th>
                  <th className="text-end">Net</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recent_vouchers ?? []).map((v) => (
                  <tr key={v.id}>
                    <td>{v.voucher_date || '—'}</td>
                    <td>{typeLabel(v.voucher_type)}</td>
                    <td>{v.voucher_no}</td>
                    <td>{v.party_name || '—'}</td>
                    <td className="text-end">₹{money(v.net_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'brand' | 'info' | 'ok' | 'warn' | 'danger'
}) {
  return (
    <div className={`dash-kpi${tone ? ` tone-${tone}` : ''}`}>
      <div className="dash-kpi-label">{label}</div>
      <div className="dash-kpi-value">{value}</div>
    </div>
  )
}
