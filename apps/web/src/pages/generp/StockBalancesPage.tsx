import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel } from '../../lib/generp/exportExcel'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { fmt } from '../../lib/generp/saleBillMath'
import type { StockBalance } from '../../generpTypes'

export function StockBalancesPage() {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<StockBalance[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (q?: string) => {
    setBusy(true)
    setError('')
    try {
      const data = await api.get<StockBalance[]>('/stock/stock-balances', {
        q: q?.trim() || undefined,
      })
      setRows(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load balances')
      setRows([])
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const pager = useClientPager(rows, query, TABLE_PAGE_SIZE)

  return (
    <div className="settings-page">
      <h2>Consolidated Stock</h2>
      <p className="hint">Current stock on hand for all active products.</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="settings-box" style={{ marginBottom: 16 }}>
        <div className="settings-field-row">
          <label className="settings-field" style={{ flex: 1 }}>
            <span>Search</span>
            <input
              className="input"
              placeholder="Product code or name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void load(query)
              }}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void load(query)}>
              Search
            </button>
            {rows.length > 0 && (
              <ExportFormatButtons
                onExport={(format) =>
                  downloadExcel(
                    'consolidated-stock',
                    {
                      name: 'Consolidated Stock',
                      headers: ['Code', 'Product', 'Unit', 'Current Stock'],
                      rows: rows.map((r) => [
                        r.product_code || '',
                        r.product_name || '',
                        r.unit || '',
                        Number(r.current_stock || 0),
                      ]),
                    },
                    format,
                  )
                }
              />
            )}
          </div>
        </div>
      </div>

      <div className="card">
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
              <th>Code</th>
              <th>Product</th>
              <th>Unit</th>
              <th style={{ textAlign: 'right' }}>Current Stock</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="hint">
                  No products found.
                </td>
              </tr>
            )}
            {pager.pageRows.map((r) => (
              <tr key={r.product_id}>
                <td>{r.product_code || '—'}</td>
                <td>{r.product_name || '—'}</td>
                <td>{r.unit || '—'}</td>
                <td style={{ textAlign: 'right' }}>{fmt(Number(r.current_stock), 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
