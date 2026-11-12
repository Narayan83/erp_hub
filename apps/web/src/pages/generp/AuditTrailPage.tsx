import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { todayISO } from '../../lib/generp/saleBillMath'

type AuditRow = {
  id: string
  occurred_at: string
  user_id?: string | null
  user_name?: string | null
  user_email?: string | null
  menu_code?: string | null
  menu_label?: string | null
  action: string
  entity_type?: string | null
  entity_id?: string | null
  ref_no?: string | null
  summary?: string | null
  details?: Record<string, unknown> | null
}

type AuditFilters = {
  users: { id: string; name: string; email?: string | null }[]
  menus: { code: string; label: string }[]
  actions: string[]
}

function monthStartISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export function AuditTrailPage() {
  const [dateFrom, setDateFrom] = useState(monthStartISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [menuCode, setMenuCode] = useState('')
  const [userId, setUserId] = useState('')
  const [action, setAction] = useState('')
  const [filters, setFilters] = useState<AuditFilters>({ users: [], menus: [], actions: [] })
  const [rows, setRows] = useState<AuditRow[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<AuditFilters>('/audit-logs/filters')
        setFilters(data)
      } catch {
        /* page still usable without dropdowns */
      }
    })()
  }, [])

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const data = await api.get<AuditRow[]>('/audit-logs', {
        date_from: dateFrom,
        date_to: dateTo,
        menu_code: menuCode || undefined,
        user_id: userId || undefined,
        action: action || undefined,
        limit: 500,
      })
      setRows(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load audit trail')
      setRows([])
    } finally {
      setBusy(false)
    }
  }, [dateFrom, dateTo, menuCode, userId, action])

  useEffect(() => {
    void load()
  }, [load])

  const pager = useClientPager(rows, `${dateFrom}|${dateTo}|${menuCode}|${userId}|${action}`, TABLE_PAGE_SIZE)

  const canRestore = (r: AuditRow) => {
    if (r.action !== 'DELETE') return false
    const details = r.details || {}
    const path = String(details.path || '')
    const snapshot = details.snapshot as Record<string, unknown> | undefined
    return Boolean(r.entity_id || snapshot?.id) && (path.includes('/vouchers/') || r.entity_type === 'vouchers')
  }

  const restore = async (r: AuditRow) => {
    if (!confirm(`Restore ${r.ref_no || 'this record'} from audit log?`)) return
    setRestoring(r.id)
    try {
      await api.post(`/audit-logs/${r.id}/restore`, {})
      await load()
      alert('Restored. The bill is active again.')
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Restore failed')
    } finally {
      setRestoring(null)
    }
  }

  const exportRows = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel('audit-trail', {
      name: 'Audit Trail',
      headers: ['When', 'User', 'Menu', 'Action', 'Ref', 'Summary', 'Details'],
      rows: rows.map((r) => [
        fmtWhen(r.occurred_at),
        r.user_name || r.user_email || '',
        r.menu_label || r.menu_code || '',
        r.action,
        r.ref_no || '',
        r.summary || '',
        r.details ? JSON.stringify(r.details) : '',
      ]),
    }, format)
  }

  return (
    <div className="settings-page">
      <h2>Audit Trail</h2>
      <p className="hint">
        Every create, modify, delete and login is stored with a JSON details column. Deleted
        bills and receipt / payment / contra entries can be restored from the matching DELETE
        row.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="settings-box settings-box--form">
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
            <span>Menu</span>
            <select className="input" value={menuCode} onChange={(e) => setMenuCode(e.target.value)}>
              <option value="">All menus</option>
              {filters.menus.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>User</span>
            <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">All users</option>
              {filters.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>Action</span>
            <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All actions</option>
              {filters.actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void load()}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <ListPager
        topRight
        page={pager.page}
        totalPages={pager.totalPages}
        total={rows.length}
        pageSize={TABLE_PAGE_SIZE}
        onPage={pager.setPage}
        onExport={exportRows}
      />

      <div className="table-wrap">
        <table className="table data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Menu</th>
              <th>Action</th>
              <th>Ref</th>
              <th>Summary</th>
              <th>Details</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pager.pageRows.length === 0 ? (
              <tr>
                <td colSpan={8}>{busy ? 'Loading…' : 'No activity in this filter.'}</td>
              </tr>
            ) : (
              pager.pageRows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtWhen(r.occurred_at)}</td>
                  <td>{r.user_name || r.user_email || '—'}</td>
                  <td>{r.menu_label || r.menu_code || '—'}</td>
                  <td>{r.action}</td>
                  <td>{r.ref_no || '—'}</td>
                  <td>{r.summary || '—'}</td>
                  <td>
                    {r.details ? (
                      <details>
                        <summary>JSON</summary>
                        <pre
                          style={{
                            margin: '6px 0 0',
                            maxWidth: 420,
                            maxHeight: 220,
                            overflow: 'auto',
                            whiteSpace: 'pre-wrap',
                            fontSize: 12,
                          }}
                        >
                          {JSON.stringify(r.details, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {canRestore(r) ? (
                      <button
                        type="button"
                        className="btn"
                        disabled={restoring === r.id}
                        onClick={() => void restore(r)}
                      >
                        {restoring === r.id ? 'Restoring…' : 'Restore'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
