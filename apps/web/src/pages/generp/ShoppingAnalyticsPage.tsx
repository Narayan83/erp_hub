import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'

type DayPoint = { date: string; sales: number; orders: number }
type TopProduct = {
  product_id: string
  name: string
  code?: string | null
  qty: number
  amount: number
}
type TopCustomer = {
  party_id: string
  name: string
  phone?: string | null
  code?: string | null
  orders: number
  amount: number
}
type RecentOrder = {
  id: string
  voucher_no: string
  voucher_date?: string | null
  party_name?: string | null
  party_phone?: string | null
  net_amount: number
  item_count: number
  narration?: string | null
}

type Analytics = {
  as_of?: string
  days: number
  kpis: {
    today_sales: number
    today_orders: number
    week_sales: number
    month_sales: number
    range_sales: number
    range_orders: number
    unique_customers: number
    avg_order_value: number
  }
  daywise: DayPoint[]
  top_products: TopProduct[]
  top_customers: TopCustomer[]
  recent_orders: RecentOrder[]
}

function money(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function ShoppingAnalyticsPage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const res = await api.get<Analytics>('/shop/analytics', { days })
      setData(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load analytics')
    } finally {
      setBusy(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  const maxSales = useMemo(() => {
    const pts = data?.daywise || []
    return Math.max(1, ...pts.map((p) => p.sales))
  }, [data])

  const productPager = useClientPager(
    data?.top_products || [],
    `${days}|${data?.top_products?.length || 0}`,
    TABLE_PAGE_SIZE,
  )
  const customerPager = useClientPager(
    data?.top_customers || [],
    `${days}|${data?.top_customers?.length || 0}`,
    TABLE_PAGE_SIZE,
  )
  const orderPager = useClientPager(
    data?.recent_orders || [],
    `${days}|${data?.recent_orders?.length || 0}`,
    TABLE_PAGE_SIZE,
  )

  const exportAll = (format: SpreadsheetFormat = 'xlsx') => {
    if (!data) return
    downloadExcel(`shop-analytics-${days}d`, [
      {
        name: 'Daywise',
        headers: ['Date', 'Sales', 'Orders'],
        rows: (data.daywise || []).map((d) => [d.date, Number(d.sales || 0), d.orders]),
      },
      {
        name: 'Top products',
        headers: ['Product', 'Code', 'Qty', 'Amount'],
        rows: (data.top_products || []).map((p) => [p.name, p.code || '', Number(p.qty || 0), Number(p.amount || 0)]),
      },
      {
        name: 'Top customers',
        headers: ['Customer', 'Phone', 'Orders', 'Amount'],
        rows: (data.top_customers || []).map((c) => [
          c.name,
          c.phone || '',
          c.orders,
          Number(c.amount || 0),
        ]),
      },
      {
        name: 'Recent orders',
        headers: ['Bill', 'Date', 'Customer', 'Phone', 'Items', 'Amount'],
        rows: (data.recent_orders || []).map((o) => [
          o.voucher_no,
          o.voucher_date || '',
          o.party_name || '',
          o.party_phone || '',
          o.item_count,
          Number(o.net_amount || 0),
        ]),
      },
    ], format)
  }

  const k = data?.kpis

  return (
    <div className="sa-page">
      <div className="sa-head">
        <div>
          <h2>Shop Analytics</h2>
          <p className="hint">
            Shopping Cart orders only (`SHOP-*` series)
            {data?.as_of ? ` · as of ${data.as_of}` : ''}
          </p>
        </div>
        <div className="sa-head-actions">
          <select
            className="input"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{ maxWidth: 140 }}
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void load()}>
            Refresh
          </button>
          <ExportFormatButtons disabled={!data} onExport={exportAll} />
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {busy && !data ? <p className="hint">Loading…</p> : null}

      {k && (
        <div className="sa-kpis">
          <div className="sa-kpi">
            <span>Today sales</span>
            <strong>{money(k.today_sales)}</strong>
            <em>{k.today_orders} orders</em>
          </div>
          <div className="sa-kpi">
            <span>This week</span>
            <strong>{money(k.week_sales)}</strong>
          </div>
          <div className="sa-kpi">
            <span>This month</span>
            <strong>{money(k.month_sales)}</strong>
          </div>
          <div className="sa-kpi">
            <span>Period sales</span>
            <strong>{money(k.range_sales)}</strong>
            <em>{k.range_orders} orders</em>
          </div>
          <div className="sa-kpi">
            <span>Unique customers</span>
            <strong>{k.unique_customers}</strong>
          </div>
          <div className="sa-kpi">
            <span>Avg order value</span>
            <strong>{money(k.avg_order_value)}</strong>
          </div>
        </div>
      )}

      <div className="sa-grid">
        <section className="sa-card sa-span-2">
          <h3>Day-wise sales</h3>
          <div className="sa-bars">
            {(data?.daywise || []).map((d) => (
              <div key={d.date} className="sa-bar-col" title={`${d.date}: ${money(d.sales)} (${d.orders})`}>
                <div className="sa-bar-track">
                  <div
                    className="sa-bar"
                    style={{ height: `${Math.max(4, (d.sales / maxSales) * 100)}%` }}
                  />
                </div>
                <span>{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="sa-card">
          <h3>Top products</h3>
          {(data?.top_products || []).length === 0 ? (
            <p className="hint">No shop product sales in this period.</p>
          ) : (
            <>
            <ListPager
              compact
              topRight
              page={productPager.page}
              totalPages={productPager.totalPages}
              total={productPager.total}
              pageSize={productPager.pageSize}
              onPage={productPager.setPage}
            />
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {productPager.pageRows.map((p) => (
                  <tr key={p.product_id}>
                    <td>
                      <strong>{p.name}</strong>
                      {p.code ? <div className="hint">{p.code}</div> : null}
                    </td>
                    <td>{p.qty}</td>
                    <td>{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </section>

        <section className="sa-card">
          <h3>Top customers</h3>
          {(data?.top_customers || []).length === 0 ? (
            <p className="hint">No shop customers in this period.</p>
          ) : (
            <>
            <ListPager
              compact
              topRight
              page={customerPager.page}
              totalPages={customerPager.totalPages}
              total={customerPager.total}
              pageSize={customerPager.pageSize}
              onPage={customerPager.setPage}
            />
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Orders</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {customerPager.pageRows.map((c) => (
                  <tr key={c.party_id}>
                    <td>
                      <strong>{c.name}</strong>
                      {c.phone ? <div className="hint">{c.phone}</div> : null}
                    </td>
                    <td>{c.orders}</td>
                    <td>{money(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </section>

        <section className="sa-card sa-span-2">
          <h3>Who purchased (recent shop orders)</h3>
          {(data?.recent_orders || []).length === 0 ? (
            <p className="hint">No shop orders yet.</p>
          ) : (
            <>
            <ListPager
              compact
              topRight
              page={orderPager.page}
              totalPages={orderPager.totalPages}
              total={orderPager.total}
              pageSize={orderPager.pageSize}
              onPage={orderPager.setPage}
            />
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {orderPager.pageRows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.voucher_no}</strong>
                    </td>
                    <td>{o.voucher_date || '—'}</td>
                    <td>
                      {o.party_name || '—'}
                      {o.party_phone ? <div className="hint">{o.party_phone}</div> : null}
                    </td>
                    <td>{o.item_count}</td>
                    <td>{money(o.net_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
