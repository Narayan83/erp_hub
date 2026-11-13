import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { useMenuOverlay } from '../../components/generp/MenuOverlay'
import { notifyShortcutsChanged } from '../../components/generp/MenuShortcutBar'
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'

type AvailableMenu = { code: string; label: string; parent_id?: string | null }

type ShortcutRow = {
  key: string
  menu_code: string
  button_label: string
  sort_order: number
  is_active: boolean
}

type ShortcutApi = {
  id: string
  host_code?: string
  menu_code: string
  button_label: string
  sort_order: number
  is_active: boolean
  menu_label?: string | null
}

function newKey() {
  return `sc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function DashboardShortcutsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { activeCode } = useMenuOverlay()
  const isActive = activeCode === 'dashboard_shortcuts'
  const urlHost = (searchParams.get('host') || 'dashboard').trim().toLowerCase() || 'dashboard'
  const [hostCode, setHostCode] = useState(urlHost)
  const [menus, setMenus] = useState<AvailableMenu[]>([])
  const [hostMenus, setHostMenus] = useState<AvailableMenu[]>([])
  const [rows, setRows] = useState<ShortcutRow[]>([])
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [pickCode, setPickCode] = useState('')

  const usedCodes = useMemo(() => new Set(rows.map((r) => r.menu_code)), [rows])
  const unusedMenus = useMemo(
    () => menus.filter((m) => !usedCodes.has(m.code) && m.code !== hostCode),
    [menus, usedCodes, hostCode],
  )

  const hostLabel =
    hostCode === 'dashboard'
      ? 'Dashboard'
      : hostMenus.find((m) => m.code === hostCode)?.label ||
        menus.find((m) => m.code === hostCode)?.label ||
        hostCode.replace(/_/g, ' ')

  useEffect(() => {
    if (isActive) setHostCode(urlHost)
  }, [isActive, urlHost])

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const [available, allLeaves, shortcuts] = await Promise.all([
        api.get<AvailableMenu[]>('/dashboard-shortcuts/available-menus', { host_code: hostCode }),
        api.get<AvailableMenu[]>('/dashboard-shortcuts/available-menus'),
        api.get<ShortcutApi[]>('/dashboard-shortcuts', { host_code: hostCode }),
      ])
      setMenus(available)
      setHostMenus(allLeaves)
      setRows(
        shortcuts.map((s) => ({
          key: s.id || newKey(),
          menu_code: s.menu_code,
          button_label: s.button_label,
          sort_order: s.sort_order,
          is_active: s.is_active,
        })),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load shortcuts')
    } finally {
      setBusy(false)
    }
  }, [hostCode])

  useEffect(() => {
    void load()
  }, [load])

  const addFromPick = () => {
    if (!pickCode) return
    const menu = menus.find((m) => m.code === pickCode)
    if (!menu) return
    setRows((prev) => [
      ...prev,
      {
        key: newKey(),
        menu_code: menu.code,
        button_label: menu.label,
        sort_order: prev.length + 1,
        is_active: true,
      },
    ])
    setPickCode('')
    setStatus('')
  }

  const updateRow = (key: string, patch: Partial<ShortcutRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const removeRow = async (key: string) => {
    const row = rows.find((r) => r.key === key)
    if (!row) return
    setRows((prev) => prev.filter((r) => r.key !== key))
    if (key.startsWith('sc_')) return
    setBusy(true)
    setError('')
    try {
      await api.delete(`/dashboard-shortcuts/${key}`)
      notifyShortcutsChanged()
      setStatus('Shortcut removed. The menu is still in the sidebar.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove shortcut')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const move = (key: string, dir: -1 | 1) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.key === key)
      if (idx < 0) return prev
      const next = [...prev]
      const j = idx + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next.map((r, i) => ({ ...r, sort_order: i + 1 }))
    })
  }

  const save = async () => {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const saved = await api.put<ShortcutApi[]>('/dashboard-shortcuts/bulk', {
        host_code: hostCode,
        items: rows.map((r, i) => ({
          host_code: hostCode,
          menu_code: r.menu_code,
          button_label: r.button_label.trim() || r.menu_code,
          sort_order: i + 1,
          is_active: r.is_active,
        })),
      })
      setRows(
        saved.map((s) => ({
          key: s.id,
          menu_code: s.menu_code,
          button_label: s.button_label,
          sort_order: s.sort_order,
          is_active: s.is_active,
        })),
      )
      setStatus(`Shortcuts for ${hostLabel} were saved. They appear only on that menu.`)
      notifyShortcutsChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stock-voucher-page">
      <div className="sv-head">
        <div>
          <h2>Menu Shortcuts</h2>
          <p className="hint mb-0">
            Each menu has its own shortcut buttons. You are editing shortcuts for <strong>{hostLabel}</strong>.
            Removing a shortcut only unpins the button — the menu stays in the sidebar.
            Close an open screen with × on its tab; that does not delete the shortcut.
          </p>
        </div>
        <div className="sv-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void load()}>
            Reload
          </button>
          <ExportFormatButtons
            disabled={rows.length === 0}
            onExport={(format: SpreadsheetFormat) =>
              downloadExcel(
                `shortcuts-${hostCode}`,
                {
                  name: 'Shortcuts',
                  headers: ['Host', 'Order', 'Menu', 'Code', 'Button name', 'Active'],
                  rows: rows.map((r, i) => [
                    hostLabel,
                    i + 1,
                    menus.find((m) => m.code === r.menu_code)?.label || r.menu_code,
                    r.menu_code,
                    r.button_label,
                    r.is_active ? 'Yes' : 'No',
                  ]),
                },
                format,
              )
            }
          />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {status ? <p className="hint">{status}</p> : null}

      <div className="sv-form" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
        <div className="sv-field">
          <span className="field-label">Shortcuts for</span>
          <select
            className="input"
            value={hostCode}
            onChange={(e) => {
              setSearchParams({ host: e.target.value })
              setPickCode('')
              setStatus('')
            }}
          >
            <option value="dashboard">Dashboard</option>
            {hostMenus.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sv-field">
          <span className="field-label">Add menu to these shortcuts</span>
          <select className="input" value={pickCode} onChange={(e) => setPickCode(e.target.value)}>
            <option value="">— Select menu —</option>
            {unusedMenus.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label} ({m.code})
              </option>
            ))}
          </select>
        </div>
        <div className="sv-field" style={{ justifyContent: 'flex-end' }}>
          <span className="field-label">&nbsp;</span>
          <button type="button" className="btn btn-primary" disabled={!pickCode} onClick={addFromPick}>
            Add
          </button>
        </div>
      </div>

      <div className="sv-lines card">
        <div className="table-responsive">
          <table className="table sv-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Order</th>
                <th>Menu</th>
                <th style={{ width: '28%' }}>Button name</th>
                <th style={{ width: 80 }}>Active</th>
                <th style={{ width: 140 }} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="hint">
                    No shortcuts for {hostLabel} yet — add menus above.
                  </td>
                </tr>
              )}
              {rows.map((r, idx) => {
                const menu = menus.find((m) => m.code === r.menu_code)
                return (
                  <tr key={r.key}>
                    <td>{idx + 1}</td>
                    <td>
                      <strong>{menu?.label || r.menu_code}</strong>
                      <div className="hint mb-0">{r.menu_code}</div>
                    </td>
                    <td>
                      <input
                        className="input"
                        value={r.button_label}
                        onChange={(e) => updateRow(r.key, { button_label: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.is_active}
                        onChange={(e) => updateRow(r.key, { is_active: e.target.checked })}
                      />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn" onClick={() => move(r.key, -1)} disabled={idx === 0}>
                        ↑
                      </button>{' '}
                      <button
                        type="button"
                        className="btn"
                        onClick={() => move(r.key, 1)}
                        disabled={idx === rows.length - 1}
                      >
                        ↓
                      </button>{' '}
                      <button
                        type="button"
                        className="btn"
                        title="Remove shortcut (menu stays in the sidebar)"
                        onClick={() => void removeRow(r.key)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
