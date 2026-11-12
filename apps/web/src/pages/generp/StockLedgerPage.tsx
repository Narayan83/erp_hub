import { useCallback, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { ListPager } from '../../components/generp/ListPager'
import { Typeahead } from '../../components/generp/Typeahead'
import { downloadExcel } from '../../lib/generp/exportExcel'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { fmt, todayISO } from '../../lib/generp/saleBillMath'
import type { Product, StockLedgerRow } from '../../generpTypes'

function monthStartISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function StockLedgerPage() {
  const [product, setProduct] = useState<Product | null>(null)
  const [productText, setProductText] = useState('')
  const [dateFrom, setDateFrom] = useState(monthStartISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [rows, setRows] = useState<StockLedgerRow[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const searchProducts = useCallback(async (query: string) => {
    const q = query.trim()
    if (!q) return []
    return api.get<Product[]>('/products', { q, limit: 20 })
  }, [])

  const productLabel = useCallback(
    (p: Product) => `${p.code || ''} — ${p.name || ''}`,
    [],
  )

  const pickExactProduct = useCallback((query: string, list: Product[]) => {
    const low = query.trim().toLowerCase()
    if (!low) return null
    return (
      list.find((p) => {
        const code = String(p.code || '').trim().toLowerCase()
        return code && code === low
      }) ?? null
    )
  }, [])

  const load = async () => {
    if (!product) {
      setError('Select a product.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const data = await api.get<StockLedgerRow[]>('/stock/stock-ledger', {
        product_id: product.id,
        date_from: dateFrom,
        date_to: dateTo,
      })
      setRows(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load ledger')
      setRows([])
    } finally {
      setBusy(false)
    }
  }

  const pager = useClientPager(rows, product?.id || rows.length, TABLE_PAGE_SIZE)

  return (
    <div className="settings-page">
      <h2>Stock Ledger</h2>
      <p className="hint">Product-wise stock movements with running balance.</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="settings-box settings-box--form">
        <label className="settings-field">
          <span>Product *</span>
          <Typeahead
            value={productText}
            onChange={(v) => {
              setProductText(v)
              setProduct(null)
            }}
            onSelect={(p) => {
              setProduct(p)
              setProductText(productLabel(p))
            }}
            searchItems={searchProducts}
            getLabel={productLabel}
            getKey={(p) => p.id}
            placeholder="Search product code or name"
            pickExact={pickExactProduct}
          />
        </label>
        <div className="settings-field-row">
          <label className="settings-field">
            <span>From</span>
            <input
              className="input"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>To</span>
            <input
              className="input"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void load()}>
          Show Ledger
        </button>
        {rows.length > 0 && (
          <ExportFormatButtons
            onExport={(format) =>
              downloadExcel(
                `stock-ledger-${productText || 'product'}`,
                {
                  name: 'Stock Ledger',
                  headers: ['Date', 'Type', 'Ref', 'Narration', 'Qty Δ', 'Balance'],
                  rows: rows.map((r) => [
                    r.movement_date,
                    r.movement_type,
                    r.ref_no || '',
                    r.narration || '',
                    Number(r.qty_delta || 0),
                    r.running_balance != null ? Number(r.running_balance) : '',
                  ]),
                },
                format,
              )
            }
          />
        )}
      </div>

      {rows.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>
            {productText}
            {rows.length ? ` · Closing: ${fmt(Number(rows[rows.length - 1].running_balance || 0), 3)}` : ''}
          </h3>
          <ListPager
            topRight
            page={pager.page}
            totalPages={pager.totalPages}
            total={pager.total}
            pageSize={pager.pageSize}
            onPage={pager.setPage}
          />
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Ref</th>
                <th>Narration</th>
                <th style={{ textAlign: 'right' }}>Qty Δ</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.movement_date}</td>
                  <td>{r.movement_type}</td>
                  <td>{r.ref_no || '—'}</td>
                  <td>{r.narration || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(Number(r.qty_delta), 3)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {r.running_balance != null ? fmt(Number(r.running_balance), 3) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
