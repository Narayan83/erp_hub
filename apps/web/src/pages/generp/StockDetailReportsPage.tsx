import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { fmt, todayISO } from '../../lib/generp/saleBillMath'
import type { Lot, Party, Product } from '../../generpTypes'

type Mode = 'barcode' | 'item' | 'movement'

type BarcodeRow = {
  date: string
  lot_name: string
  product_name: string
  product_code: string
  barcode: string
  cost_price: number
  sale_rate: number | null
  disc_pct: number | null
  net_sale_rate: number | null
  qty: number
  status: string
}

type BarcodeReport = {
  rows: BarcodeRow[]
  purchase_value: number
  sales_value: number
  margin: number
  margin_pct: number | null
}

type ItemRow = {
  product_id: string
  product_code: string
  product_name: string
  barcode_count: number
  qty_in: number
  qty_sold: number
  qty_remaining: number
  purchase_value: number
  sales_value: number
  balance_value: number
}

type MoveRow = {
  lot_name: string
  date: string | null
  product_code: string
  product_name: string
  p_qty: number
  p_rate: number
  p_amt: number
  pr_qty: number
  pr_rate: number
  pr_amt: number
  s_qty: number
  s_rate: number
  s_amt: number
  sr_qty: number
  sr_rate: number
  sr_amt: number
  ti_qty: number
  ti_rate: number
  ti_amt: number
  to_qty: number
  to_rate: number
  to_amt: number
  bal_qty: number
  bal_rate: number
  bal_amt: number
}

const TITLES: Record<Mode, string> = {
  barcode: 'Barcode Details',
  item: 'Item Code Stock',
  movement: 'Stock Report',
}

function n(v: number | null | undefined) {
  return v == null ? '' : fmt(v)
}

export function StockDetailReportsPage({ mode }: { mode: Mode }) {
  const [dateFrom, setDateFrom] = useState('2020-01-01')
  const [dateTo, setDateTo] = useState(todayISO())
  const [status, setStatus] = useState('not_sold')
  const [barcode, setBarcode] = useState('')
  const [hideRates, setHideRates] = useState(false)
  const [query, setQuery] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [productId, setProductId] = useState('')
  const [lotId, setLotId] = useState('')
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [lots, setLots] = useState<Lot[]>([])
  const [barcodeReport, setBarcodeReport] = useState<BarcodeReport | null>(null)
  const [itemRows, setItemRows] = useState<ItemRow[]>([])
  const [moveRows, setMoveRows] = useState<MoveRow[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const [parties, prods, lotRows] = await Promise.all([
        api.get<Party[]>('/parties', { party_type: 'vendor' }).catch(() => [] as Party[]),
        api.get<Product[]>('/products', { limit: 500 }).catch(() => [] as Product[]),
        api.get<Lot[]>('/stock/lots').catch(() => [] as Lot[]),
      ])
      setSuppliers(parties)
      setProducts(prods)
      setLots(lotRows)
    })()
  }, [])

  const load = async () => {
    setBusy(true)
    setError('')
    try {
      if (mode === 'barcode') {
        const data = await api.get<BarcodeReport>('/stock/reports/barcode-stock', {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          status,
          barcode: barcode.trim() || undefined,
          hide_sale_rates: hideRates ? 'true' : 'false',
        })
        setBarcodeReport(data)
      } else if (mode === 'item') {
        const data = await api.get<ItemRow[]>('/stock/reports/item-stock', {
          q: query.trim() || undefined,
          product_id: productId || undefined,
        })
        setItemRows(data)
      } else {
        const data = await api.get<MoveRow[]>('/stock/reports/movement-stock', {
          supplier_id: supplierId || undefined,
          product_id: productId || undefined,
          lot_id: lotId || undefined,
          barcode: barcode.trim() || undefined,
        })
        setMoveRows(data)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load report')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const shownItems = useMemo(() => itemRows, [itemRows])
  const itemPager = useClientPager(shownItems, query, TABLE_PAGE_SIZE)
  const movePager = useClientPager(moveRows, `${supplierId}${productId}${lotId}`, TABLE_PAGE_SIZE)
  const barcodePager = useClientPager(barcodeReport?.rows || [], status, TABLE_PAGE_SIZE)

  const exportReport = (format: SpreadsheetFormat) => {
    if (mode === 'barcode') {
      downloadExcel('barcode-stock', {
        name: 'Barcode Details',
        headers: ['Date', 'Lot', 'Product', 'Barcode', 'Cost', 'Sale rate', 'Disc %', 'Net sale', 'Qty'],
        rows: (barcodeReport?.rows || []).map((r) => [
          String(r.date || '').slice(0, 10),
          r.lot_name,
          r.product_name,
          r.barcode,
          r.cost_price,
          r.sale_rate ?? '',
          r.disc_pct ?? '',
          r.net_sale_rate ?? '',
          r.qty,
        ]),
      }, format)
      return
    }
    if (mode === 'item') {
      downloadExcel('item-stock', {
        name: 'Item Code Stock',
        headers: ['Code', 'Name', 'Barcodes', 'Qty in', 'Sold', 'Balance', 'Purchase value', 'Sales value'],
        rows: itemRows.map((r) => [
          r.product_code,
          r.product_name,
          r.barcode_count,
          r.qty_in,
          r.qty_sold,
          r.qty_remaining,
          r.purchase_value,
          r.sales_value,
        ]),
      }, format)
      return
    }
    downloadExcel('stock-report', {
      name: 'Stock Report',
      headers: [
        'Lot', 'Date', 'Code', 'Product',
        'P Qty', 'P Rate', 'P Amt',
        'PR Qty', 'PR Rate', 'PR Amt',
        'Sale Qty', 'Sale Rate', 'Sale Amt',
        'SR Qty', 'SR Rate', 'SR Amt',
        'In Qty', 'In Rate', 'In Amt',
        'Out Qty', 'Out Rate', 'Out Amt',
        'Bal Qty', 'Bal Rate', 'Bal Amt',
      ],
      rows: moveRows.map((r) => [
        r.lot_name, String(r.date || '').slice(0, 10), r.product_code, r.product_name,
        r.p_qty, r.p_rate, r.p_amt,
        r.pr_qty, r.pr_rate, r.pr_amt,
        r.s_qty, r.s_rate, r.s_amt,
        r.sr_qty, r.sr_rate, r.sr_amt,
        r.ti_qty, r.ti_rate, r.ti_amt,
        r.to_qty, r.to_rate, r.to_amt,
        r.bal_qty, r.bal_rate, r.bal_amt,
      ]),
    }, format)
  }

  const moveTotals = useMemo(() => {
    const keys = ['p_qty', 'p_amt', 'pr_qty', 'pr_amt', 's_qty', 's_amt', 'sr_qty', 'sr_amt', 'ti_qty', 'ti_amt', 'to_qty', 'to_amt', 'bal_qty', 'bal_amt'] as const
    const totals = Object.fromEntries(keys.map((k) => [k, 0])) as Record<(typeof keys)[number], number>
    for (const row of moveRows) {
      for (const k of keys) totals[k] += Number(row[k] || 0)
    }
    return totals
  }, [moveRows])

  return (
    <div className="settings-page">
      <div className="settings-title-row">
        <h2>{TITLES[mode]}</h2>
        <ExportFormatButtons disabled={busy} onExport={exportReport} />
      </div>
      {error && <div className="error-banner">{error}</div>}

      {mode === 'barcode' ? (
        <>
          <div className="settings-field-row">
            <label className="settings-field">
              <span>From</span>
              <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="settings-field">
              <span>To</span>
              <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label className="settings-field">
              <span>Barcode</span>
              <input className="input" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </label>
          </div>
          <div className="settings-field-row" style={{ alignItems: 'center' }}>
            {(['not_sold', 'sold', 'transferred', 'all'] as const).map((key) => (
              <label key={key} style={{ marginRight: 12 }}>
                <input type="radio" name="bc-status" checked={status === key} onChange={() => setStatus(key)} />{' '}
                {key === 'not_sold' ? 'Not sold' : key === 'sold' ? 'Sold' : key === 'transferred' ? 'Transferred' : 'All'}
              </label>
            ))}
            <label>
              <input type="checkbox" checked={hideRates} onChange={(e) => setHideRates(e.target.checked)} /> Non sales rates
            </label>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void load()}>
              View
            </button>
          </div>
          <div className="table-wrap">
            <table className="table data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Lot Name</th>
                  <th>Product Name</th>
                  <th>Barcode</th>
                  <th>Cost price</th>
                  <th>Basic Sl rate</th>
                  <th>Sale dis %</th>
                  <th>Net Sale rate</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {barcodePager.pageRows.map((row) => (
                  <tr key={`${row.barcode}-${row.date}`}>
                    <td>{String(row.date || '').slice(0, 10)}</td>
                    <td>{row.lot_name}</td>
                    <td>{row.product_name}</td>
                    <td>{row.barcode}</td>
                    <td className="num">{fmt(row.cost_price)}</td>
                    <td className="num">{n(row.sale_rate)}</td>
                    <td className="num">{n(row.disc_pct)}</td>
                    <td className="num">{n(row.net_sale_rate)}</td>
                    <td className="num">{fmt(row.qty, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPager page={barcodePager.page} totalPages={barcodePager.totalPages} total={barcodePager.total} pageSize={barcodePager.pageSize} onPage={barcodePager.setPage} />
          {barcodeReport ? (
            <div className="settings-field-row">
              <span>Total Purchase Value {fmt(barcodeReport.purchase_value)}</span>
              <span>Total Sales Value {fmt(barcodeReport.sales_value)}</span>
              <span>Total Margin {fmt(barcodeReport.margin)}</span>
              <span>Total Margin % {barcodeReport.margin_pct == null ? '--------' : fmt(barcodeReport.margin_pct)}</span>
            </div>
          ) : null}
        </>
      ) : null}

      {mode === 'item' ? (
        <>
          <div className="settings-field-row">
            <label className="settings-field">
              <span>Item</span>
              <input className="input" placeholder="Code or name" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label className="settings-field">
              <span>Product</span>
              <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">All</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void load()}>
              View
            </button>
          </div>
          <div className="table-wrap">
            <table className="table data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Barcodes</th>
                  <th>Qty in</th>
                  <th>Sold</th>
                  <th>Balance</th>
                  <th>Purchase value</th>
                  <th>Sales value</th>
                  <th>Balance value</th>
                </tr>
              </thead>
              <tbody>
                {itemPager.pageRows.map((row) => (
                  <tr key={row.product_id}>
                    <td>{row.product_code}</td>
                    <td>{row.product_name}</td>
                    <td className="num">{row.barcode_count}</td>
                    <td className="num">{fmt(row.qty_in, 3)}</td>
                    <td className="num">{fmt(row.qty_sold, 3)}</td>
                    <td className="num">{fmt(row.qty_remaining, 3)}</td>
                    <td className="num">{fmt(row.purchase_value)}</td>
                    <td className="num">{fmt(row.sales_value)}</td>
                    <td className="num">{fmt(row.balance_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPager page={itemPager.page} totalPages={itemPager.totalPages} total={itemPager.total} pageSize={itemPager.pageSize} onPage={itemPager.setPage} />
        </>
      ) : null}

      {mode === 'movement' ? (
        <>
          <div className="settings-field-row">
            <label className="settings-field">
              <span>Supplier</span>
              <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">All</option>
                {suppliers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Product</span>
              <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">All</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Lot</span>
              <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)}>
                <option value="">All</option>
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Barcode</span>
              <input className="input" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void load()}>
              Stock report
            </button>
          </div>
          <div className="table-wrap">
            <table className="table data-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Lot</th>
                  <th rowSpan={2}>Date</th>
                  <th rowSpan={2}>Code</th>
                  <th rowSpan={2}>Product</th>
                  <th colSpan={3}>Purchase</th>
                  <th colSpan={3}>Purchase Return</th>
                  <th colSpan={3}>Sales</th>
                  <th colSpan={3}>Sales Return</th>
                  <th colSpan={3}>Transfer In</th>
                  <th colSpan={3}>Transfer Out</th>
                  <th colSpan={3}>Balance</th>
                </tr>
                <tr>
                  {Array.from({ length: 21 }, (_, i) => (
                    <th key={`sub-${i}`}>{['Qty', 'Rate', 'Amt'][i % 3]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movePager.pageRows.map((row, i) => (
                  <tr key={`${row.lot_name}-${row.product_code}-${i}`}>
                    <td>{row.lot_name}</td>
                    <td>{String(row.date || '').slice(0, 10)}</td>
                    <td>{row.product_code}</td>
                    <td>{row.product_name}</td>
                    <td className="num">{fmt(row.p_qty, 0)}</td>
                    <td className="num">{fmt(row.p_rate)}</td>
                    <td className="num">{fmt(row.p_amt)}</td>
                    <td className="num">{fmt(row.pr_qty, 0)}</td>
                    <td className="num">{fmt(row.pr_rate)}</td>
                    <td className="num">{fmt(row.pr_amt)}</td>
                    <td className="num">{fmt(row.s_qty, 0)}</td>
                    <td className="num">{fmt(row.s_rate)}</td>
                    <td className="num">{fmt(row.s_amt)}</td>
                    <td className="num">{fmt(row.sr_qty, 0)}</td>
                    <td className="num">{fmt(row.sr_rate)}</td>
                    <td className="num">{fmt(row.sr_amt)}</td>
                    <td className="num">{fmt(row.ti_qty, 0)}</td>
                    <td className="num">{fmt(row.ti_rate)}</td>
                    <td className="num">{fmt(row.ti_amt)}</td>
                    <td className="num">{fmt(row.to_qty, 0)}</td>
                    <td className="num">{fmt(row.to_rate)}</td>
                    <td className="num">{fmt(row.to_amt)}</td>
                    <td className="num">{fmt(row.bal_qty, 0)}</td>
                    <td className="num">{fmt(row.bal_rate)}</td>
                    <td className="num">{fmt(row.bal_amt)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="num">{fmt(moveTotals.p_qty, 0)}</td>
                  <td />
                  <td className="num">{fmt(moveTotals.p_amt)}</td>
                  <td className="num">{fmt(moveTotals.pr_qty, 0)}</td>
                  <td />
                  <td className="num">{fmt(moveTotals.pr_amt)}</td>
                  <td className="num">{fmt(moveTotals.s_qty, 0)}</td>
                  <td />
                  <td className="num">{fmt(moveTotals.s_amt)}</td>
                  <td className="num">{fmt(moveTotals.sr_qty, 0)}</td>
                  <td />
                  <td className="num">{fmt(moveTotals.sr_amt)}</td>
                  <td className="num">{fmt(moveTotals.ti_qty, 0)}</td>
                  <td />
                  <td className="num">{fmt(moveTotals.ti_amt)}</td>
                  <td className="num">{fmt(moveTotals.to_qty, 0)}</td>
                  <td />
                  <td className="num">{fmt(moveTotals.to_amt)}</td>
                  <td className="num">{fmt(moveTotals.bal_qty, 0)}</td>
                  <td />
                  <td className="num">{fmt(moveTotals.bal_amt)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <ListPager page={movePager.page} totalPages={movePager.totalPages} total={movePager.total} pageSize={movePager.pageSize} onPage={movePager.setPage} />
        </>
      ) : null}
    </div>
  )
}
