import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { errMsg, fmtMoney, todayIso } from '../shared/hmsShared'

export type RegisterKind =
  | 'sales'
  | 'purchase'
  | 'sales-return'
  | 'purchase-return'
  | 'sales-summary'
  | 'schedule-h'
  | 'stock'

type Col = { key: string; label: string; money?: boolean; right?: boolean }

type KindConfig = {
  title: string
  path: string
  /** paginated bill browser (supports search + bill detail) */
  bills?: { params: Record<string, string>; detailPath: string }
  dated: boolean
  columns: Col[]
}

const BILL_COLS: Col[] = [
  { key: 'bill_no', label: 'Bill No' },
  { key: 'bill_date', label: 'Date' },
  { key: 'party_name', label: 'Party' },
  { key: 'invoice_no', label: 'Invoice' },
  { key: 'item_count', label: 'Items', right: true },
  { key: 'gross_amount', label: 'Gross', money: true, right: true },
  { key: 'discount_amount', label: 'Discount', money: true, right: true },
  { key: 'net_amount', label: 'Net', money: true, right: true },
  { key: 'status', label: 'Status' },
]

const CONFIG: Record<RegisterKind, KindConfig> = {
  sales: {
    title: 'Sales Register',
    path: '/hospital/pharmacy/sale-bills',
    bills: { params: { bill_kind: 'sale' }, detailPath: '/hospital/pharmacy/sale-bills' },
    dated: true,
    columns: BILL_COLS,
  },
  'sales-return': {
    title: 'Sales Return Register',
    path: '/hospital/pharmacy/sale-bills',
    bills: { params: { bill_kind: 'return' }, detailPath: '/hospital/pharmacy/sale-bills' },
    dated: true,
    columns: BILL_COLS,
  },
  purchase: {
    title: 'Purchase Register',
    path: '/hospital/pharmacy/purchase-bills',
    bills: { params: { bill_kind: 'purchase' }, detailPath: '/hospital/pharmacy/purchase-bills' },
    dated: true,
    columns: BILL_COLS,
  },
  'purchase-return': {
    title: 'Purchase Return Register',
    path: '/hospital/pharmacy/purchase-bills',
    bills: { params: { bill_kind: 'return' }, detailPath: '/hospital/pharmacy/purchase-bills' },
    dated: true,
    columns: BILL_COLS,
  },
  'sales-summary': {
    title: 'Sales Summary',
    path: '/hospital/pharmacy/reports/sales-summary',
    dated: true,
    columns: [
      { key: 'item_code', label: 'Item Code' },
      { key: 'item_name', label: 'Item' },
      { key: 'total_qty', label: 'Total Qty', right: true },
      { key: 'total_amount', label: 'Total Amount', money: true, right: true },
    ],
  },
  'schedule-h': {
    title: 'Schedule H Drug Report',
    path: '/hospital/pharmacy/reports/schedule-h',
    dated: true,
    columns: [
      { key: 'bill_no', label: 'Bill No' },
      { key: 'bill_date', label: 'Date' },
      { key: 'patient_name', label: 'Patient' },
      { key: 'item_code', label: 'Item Code' },
      { key: 'item_name', label: 'Item' },
      { key: 'schedule', label: 'Schedule' },
      { key: 'quantity', label: 'Qty', right: true },
      { key: 'amount', label: 'Amount', money: true, right: true },
    ],
  },
  stock: {
    title: 'Consolidated Stock Report',
    path: '/hospital/pharmacy/reports/stock',
    dated: false,
    columns: [
      { key: 'item_type', label: 'Type' },
      { key: 'item_code', label: 'Item Code' },
      { key: 'item_name', label: 'Item' },
      { key: 'unit', label: 'Unit' },
      { key: 'purchased_qty', label: 'Purchased', right: true },
      { key: 'sold_qty', label: 'Sold', right: true },
      { key: 'balance_qty', label: 'Balance', right: true },
      { key: 'reorder_level', label: 'Reorder Level', right: true },
    ],
  },
}

type Row = Record<string, unknown>
type Detail = {
  bill_no: string
  bill_date: string
  patient_name?: string | null
  net_amount: number | string
  lines: Array<{
    id: string
    item_code: string
    item_name: string
    batch_no?: string | null
    expiry_date?: string | null
    rate: number | string
    quantity: number
    tax_amount: number | string
    line_net: number | string
  }>
}

const PAGE_SIZE = 50

type Props = { reportKind: RegisterKind }

/**
 * Pharmacy registers and reports.
 *  bills:   GET /hospital/pharmacy/sale-bills | purchase-bills  (bill_kind, page, page_size, search, from_date, to_date)
 *  reports: GET /hospital/pharmacy/reports/{sales-summary|schedule-h}?from_date&to_date, /reports/stock
 */
export function PharmacyRegisterPage({ reportKind }: Props) {
  const cfg = CONFIG[reportKind]
  const first = todayIso().slice(0, 8) + '01'
  const [from, setFrom] = useState(first)
  const [to, setTo] = useState(todayIso())
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [rows, setRows] = useState<Row[]>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load(p = page) {
    setBusy(true)
    setError(null)
    setDetail(null)
    try {
      if (cfg.bills) {
        const data = await api.get<{ items: Row[]; total?: number }>(cfg.path, {
          ...cfg.bills.params,
          page: p,
          page_size: PAGE_SIZE,
          search: search.trim() || undefined,
          from_date: from || undefined,
          to_date: to || undefined,
        })
        setRows(data.items || [])
        setTotal(data.total ?? (data.items || []).length)
      } else {
        const data = await api.get<Row[]>(cfg.path, cfg.dated ? { from_date: from, to_date: to } : undefined)
        setRows(data || [])
        setTotal((data || []).length)
      }
    } catch (e) {
      setRows([])
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setPage(1)
    setRows([])
    setDetail(null)
    void load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKind])

  async function openDetail(row: Row) {
    if (!cfg.bills) return
    try {
      setDetail(await api.get<Detail>(`${cfg.bills.detailPath}/${String(row.id)}`))
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const sums = useMemo(() => {
    const money = cfg.columns.filter((c) => c.money)
    return money.map((c) => ({
      key: c.key,
      value: rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0),
    }))
  }, [rows, cfg])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="hms-page">
      <h1>{cfg.title}</h1>
      {error && <div className="hms-error">{error}</div>}

      <form
        className="hms-toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          void load(1)
        }}
      >
        {cfg.dated && (
          <>
            <label>From</label>
            <input className="hms-field" type="date" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} />
            <label>To</label>
            <input className="hms-field" type="date" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        {cfg.bills && (
          <input className="hms-field" style={{ width: 220 }} placeholder="Search bill / party…" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        <button className="hms-btn hms-btn-primary" type="submit" disabled={busy}>
          {busy ? '…' : 'Show'}
        </button>
        <button className="hms-btn" type="button" onClick={() => window.print()}>Print</button>
        <span style={{ color: '#64748b' }}>{total} row(s)</span>
      </form>

      <div className="hms-table-wrap" style={{ maxHeight: 460 }}>
        <table className="hms-table">
          <thead>
            <tr>
              {cfg.columns.map((c) => (
                <th key={c.key} style={c.right ? { textAlign: 'right' } : undefined}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={String(r.id ?? `${r.bill_no ?? r.item_code}-${i}`)} onClick={() => void openDetail(r)}>
                {cfg.columns.map((c) => (
                  <td key={c.key} style={c.right ? { textAlign: 'right' } : undefined}>
                    {c.money ? fmtMoney(r[c.key]) : String(r[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr style={{ cursor: 'default' }}>
                <td colSpan={cfg.columns.length} style={{ color: '#64748b' }}>No records</td>
              </tr>
            )}
          </tbody>
          {sums.length > 0 && rows.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 700, background: '#e8eef6' }}>
                {cfg.columns.map((c, idx) => (
                  <td key={c.key} style={c.right ? { textAlign: 'right' } : undefined}>
                    {idx === 0 ? 'Page total' : c.money ? fmtMoney(sums.find((s) => s.key === c.key)?.value) : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {cfg.bills && (
        <div className="hms-actions">
          <button className="hms-btn" type="button" disabled={page <= 1 || busy} onClick={() => { setPage(page - 1); void load(page - 1) }}>
            ‹ Prev
          </button>
          <span style={{ alignSelf: 'center' }}>Page {page} / {pages}</span>
          <button className="hms-btn" type="button" disabled={page >= pages || busy} onClick={() => { setPage(page + 1); void load(page + 1) }}>
            Next ›
          </button>
        </div>
      )}

      {detail && (
        <div className="hms-box" style={{ marginTop: 14 }}>
          <div className="hms-box-title">
            {detail.bill_no} — {detail.bill_date}
            {detail.patient_name ? ` — ${detail.patient_name}` : ''}
          </div>
          <table className="hms-table" style={{ marginTop: 4 }}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Item</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Tax</th>
                <th style={{ textAlign: 'right' }}>Net</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id} style={{ cursor: 'default' }}>
                  <td>{l.item_code}</td>
                  <td>{l.item_name}</td>
                  <td>{l.batch_no}</td>
                  <td>{l.expiry_date}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMoney(l.rate)}</td>
                  <td style={{ textAlign: 'right' }}>{l.quantity}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMoney(l.tax_amount)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMoney(l.line_net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hms-actions">
            <strong>Net: {fmtMoney(detail.net_amount)}</strong>
            <button className="hms-btn" type="button" onClick={() => setDetail(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
