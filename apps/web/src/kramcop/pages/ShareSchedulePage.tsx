import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { LedgerModal } from '../components/LedgerModal'
import type { ScheduleRow } from '../types'

type List = { items: ScheduleRow[]; total: number; page: number; page_size: number }

export function ShareSchedulePage() {
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (p = 1, q = query) => {
    const res = await api.get<List>('/reports/share-schedule', { q, page: p, page_size: 40 })
    setRows(res.items)
    setTotal(res.total)
    setPage(res.page)
  }, [query])

  useEffect(() => {
    void load(1, query).catch((err: Error) => setError(err.message))
  }, [query, load])

  const pages = Math.max(1, Math.ceil(total / 40))

  return (
    <div>
      <h1>Share schedule</h1>
      <p className="hint">Click an account number to open that member ledger.</p>
      {error && <div className="error">{error}</div>}
      <div className="toolbar">
        <input className="input search" placeholder="Search ACNO, name, mobile…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span>
          {total} members · page {page}/{pages}
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ACNO</th>
              <th>Name</th>
              <th>Mobile</th>
              <th>Shares</th>
              <th>Addition</th>
              <th>Deletion</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.acno}>
                <td>
                  <button className="linkish" type="button" onClick={() => setOpen(r.acno)}>
                    {r.acno}
                  </button>
                </td>
                <td>
                  {r.name_en}
                  <div className="kn muted">{r.name_kn}</div>
                </td>
                <td>{r.mobile}</td>
                <td>{r.share_nos}</td>
                <td>{r.addition_amount.toFixed(2)}</td>
                <td>{r.deletion_amount.toFixed(2)}</td>
                <td>{r.balance.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button className="btn" type="button" disabled={page <= 1} onClick={() => void load(page - 1)}>
          Prev
        </button>
        <button className="btn" type="button" disabled={page >= pages} onClick={() => void load(page + 1)}>
          Next
        </button>
      </div>
      {open != null && <LedgerModal acno={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
