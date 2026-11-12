import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import './billing/hms-master.css'

type TableInfo = {
  name: string
  label: string
  group: string
  group_order: number
  row_count: number
  default_selected: boolean
  protected: boolean
}

type Props = {
  open: boolean
  onClose: () => void
}

export function ClearDatabaseDialog({ open, onClose }: Props) {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setPassword('')
    setError(null)
    setOk(null)
    void (async () => {
      try {
        const rows = await api.get<TableInfo[]>('/hospital/admin/db-tables')
        setTables(rows)
        const next: Record<string, boolean> = {}
        for (const t of rows) {
          if (!t.protected) next[t.name] = Boolean(t.default_selected)
        }
        setSelected(next)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [open])

  const groups = useMemo(() => {
    const map = new Map<string, TableInfo[]>()
    for (const t of tables) {
      const list = map.get(t.group) || []
      list.push(t)
      map.set(t.group, list)
    }
    return [...map.entries()]
  }, [tables])

  const selectedNames = useMemo(
    () => Object.entries(selected).filter(([, on]) => on).map(([name]) => name),
    [selected],
  )

  function selectDefaults() {
    const next: Record<string, boolean> = {}
    for (const t of tables) {
      if (!t.protected) next[t.name] = Boolean(t.default_selected)
    }
    setSelected(next)
  }

  function selectAll() {
    const next: Record<string, boolean> = {}
    for (const t of tables) {
      if (!t.protected) next[t.name] = true
    }
    setSelected(next)
  }

  function selectNone() {
    const next: Record<string, boolean> = {}
    for (const t of tables) {
      if (!t.protected) next[t.name] = false
    }
    setSelected(next)
  }

  async function onReset() {
    setError(null)
    setOk(null)
    if (!selectedNames.length) {
      setError('Select at least one table to reset.')
      return
    }
    if (!password.trim()) {
      setError('Enter the maintenance password to confirm.')
      return
    }
    if (
      !window.confirm(
        `You are about to permanently delete all data in ${selectedNames.length} table(s).\n\nThis cannot be undone. Continue?`,
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/hospital/admin/clear-tables', {
        password,
        tables: selectedNames,
      })
      setOk(
        `${result.message || 'Selected tables reset.'}\nPlease log out and log in again to refresh all screens.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="hms-modal-backdrop" role="dialog" aria-modal="true">
      <div className="hms-modal" style={{ maxWidth: 720, width: '94vw', maxHeight: '90vh' }}>
        <h2 style={{ margin: '0 0 8px', color: '#991b1b', fontSize: 18 }}>Reset Database</h2>
        <div className="hint" style={{ marginBottom: 8 }}>
          This permanently deletes all rows in the selected tables and resets their numbering. Use it
          to get a fresh database for a NEW hospital. Tick what to reset; UNTICK any master data you
          want to keep. Hospital information, users and menus are always kept.
        </div>
        {error && <div className="hms-error">{error}</div>}
        {ok && <div className="hms-ok" style={{ whiteSpace: 'pre-wrap' }}>{ok}</div>}

        <div className="hms-actions" style={{ marginTop: 0 }}>
          <button className="hms-btn" type="button" onClick={selectDefaults}>
            Transactions only
          </button>
          <button className="hms-btn" type="button" onClick={selectAll}>
            Select all
          </button>
          <button className="hms-btn" type="button" onClick={selectNone}>
            Clear selection
          </button>
        </div>
        <div className="hint" style={{ margin: '4px 0 8px' }}>
          {selectedNames.length} table(s) selected for reset.
        </div>

        <div
          className="hms-table-wrap"
          style={{ maxHeight: '42vh', marginBottom: 10, padding: '6px 8px' }}
        >
          {groups.map(([group, rows]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontWeight: 700,
                  borderBottom: '1px solid #94a3b8',
                  paddingBottom: 2,
                  marginBottom: 4,
                }}
              >
                {group}
              </div>
              {rows.map((t) => {
                const rowsText =
                  t.row_count == null || t.row_count < 0 ? 'n/a' : `${t.row_count.toLocaleString()} rows`
                const label = `${t.label}  —  ${rowsText}`
                if (t.protected) {
                  return (
                    <label
                      key={t.name}
                      style={{ display: 'block', color: '#64748b', marginBottom: 2 }}
                    >
                      <input type="checkbox" disabled checked={false} /> {label}{' '}
                      (protected — always kept)
                    </label>
                  )
                }
                return (
                  <label key={t.name} style={{ display: 'block', marginBottom: 2 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(selected[t.name])}
                      onChange={(e) =>
                        setSelected((prev) => ({ ...prev, [t.name]: e.target.checked }))
                      }
                    />{' '}
                    {label}
                  </label>
                )
              })}
            </div>
          ))}
        </div>

        <div className="hms-field-wrap" style={{ marginBottom: 8 }}>
          <label>Maintenance password</label>
          <input
            className="hms-field"
            type="password"
            placeholder="Required to confirm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="hms-actions">
          <button className="hms-btn" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="hms-btn hms-btn-danger"
            type="button"
            onClick={() => void onReset()}
            disabled={busy || !selectedNames.length}
          >
            {busy ? 'Resetting…' : 'Reset Selected Tables'}
          </button>
        </div>
      </div>
    </div>
  )
}
