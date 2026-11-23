import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../../api/client'
import {
  HospitalMenu,
  HospitalShortcut,
  SHORTCUT_MENUS_API,
  SHORTCUTS_API,
  notifyHospitalShortcutsChanged,
  shortcutButtonName,
} from '../shortcuts'
import '../billing/hms-master.css'

type Row = {
  key: string
  module_code: string
  button_label: string
  description: string
  is_active: boolean
}

function newKey() {
  return `sc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function toRow(item: HospitalShortcut): Row {
  return {
    key: item.id || newKey(),
    module_code: item.module_code,
    button_label: item.button_label,
    description: item.description || '',
    is_active: item.is_active,
  }
}

export function DashboardShortcutPage({ initialHost }: { initialHost?: string } = {}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlHost =
    (initialHost || searchParams.get('host') || 'dashboard').trim().toLowerCase() || 'dashboard'
  const [hostCode, setHostCode] = useState(urlHost)
  const [menus, setMenus] = useState<HospitalMenu[]>([])
  const [hosts, setHosts] = useState<HospitalMenu[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [pick, setPick] = useState('')
  const [customName, setCustomName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const popupMode = Boolean(initialHost)

  useEffect(() => {
    setHostCode(urlHost)
  }, [urlHost])

  const used = useMemo(() => new Set(rows.map((row) => row.module_code)), [rows])
  const unused = useMemo(
    () => menus.filter((menu) => menu.code !== hostCode && !used.has(menu.code)),
    [menus, used, hostCode],
  )
  const hostMenu = hosts.find((menu) => menu.code === hostCode)
  const hostLabel =
    hostCode === 'dashboard'
      ? 'Dashboard'
      : hostMenu?.picker_label || hostMenu?.label || hostCode.replace(/_/g, ' ')

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const [available, hostMenus, shortcuts] = await Promise.all([
        api.get<HospitalMenu[]>(SHORTCUT_MENUS_API, { host_code: hostCode }),
        api.get<HospitalMenu[]>(SHORTCUT_MENUS_API, { host_code: 'dashboard' }),
        api.get<HospitalShortcut[]>(SHORTCUTS_API, {
          active_only: false,
          host_code: hostCode,
        }),
      ])
      setMenus(available || [])
      setHosts(hostMenus || [])
      setRows((shortcuts || []).filter((row) => !row.module_code.startsWith('_')).map(toRow))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shortcuts')
    } finally {
      setBusy(false)
    }
  }, [hostCode])

  useEffect(() => {
    void load()
  }, [load])

  function menuLabel(code: string) {
    return menus.find((menu) => menu.code === code)?.label || hosts.find((menu) => menu.code === code)?.label || code
  }

  async function persist(next: Row[], message: string) {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const saved = await api.put<HospitalShortcut[]>(SHORTCUTS_API, {
        host_code: hostCode,
        items: next.map((row, index) => ({
          module_code: row.module_code,
          button_label: row.button_label.trim() || menuLabel(row.module_code),
          description: row.description.trim() || null,
          sort_order: index + 1,
          is_active: row.is_active,
        })),
      })
      setRows((saved || []).filter((row) => !row.module_code.startsWith('_')).map(toRow))
      notifyHospitalShortcutsChanged()
      setOk(message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      await load()
    } finally {
      setBusy(false)
    }
  }

  function addShortcut() {
    const menu = unused.find((item) => item.code === pick)
    if (!menu) {
      setError('Select a menu to add')
      return
    }
    const label = customName.trim() || shortcutButtonName(menu)
    const next = [
      ...rows,
      {
        key: newKey(),
        module_code: menu.code,
        button_label: label,
        description: description.trim(),
        is_active: true,
      },
    ]
    setPick('')
    setCustomName('')
    setDescription('')
    void persist(next, `Added “${label}” on ${hostLabel}`)
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    ;[next[index], next[target]] = [next[target], next[index]]
    setRows(next)
  }

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  return (
    <div className="hms-page">
      <h1>Menu Shortcuts</h1>
      <p className="hint">
        Each screen keeps its own shortcut buttons for your login. You are editing <strong>{hostLabel}</strong>.
        Add a menu with a custom button name, then save. Removing a shortcut only unpins the button — the menu
        stays in the sidebar.
      </p>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}

      <div className="hms-toolbar">
        <label htmlFor="shortcut-host">Shortcuts for</label>
        <select
          id="shortcut-host"
          className="hms-field"
          style={{ maxWidth: 280 }}
          value={hostCode}
          onChange={(e) => {
            const next = e.target.value
            if (popupMode) setHostCode(next)
            else setSearchParams({ host: next })
            setPick('')
            setCustomName('')
            setOk(null)
          }}
        >
          <option value="dashboard">Dashboard</option>
          {hosts.map((menu) => (
            <option key={menu.code} value={menu.code}>
              {menu.picker_label || menu.label}
            </option>
          ))}
        </select>
        <button className="hms-btn" type="button" disabled={busy} onClick={() => void load()}>
          Reload
        </button>
        <button className="hms-btn hms-btn-primary" type="button" disabled={busy} onClick={() => void persist(rows, `Shortcuts for ${hostLabel} saved`)}>
          Save Shortcuts
        </button>
      </div>

      <div className="hms-box" style={{ marginTop: 12 }}>
        <div className="hms-box-title">Add custom shortcut</div>
        <div className="hms-toolbar" style={{ marginTop: 8 }}>
          <label htmlFor="shortcut-menu">Menu</label>
          <select
            id="shortcut-menu"
            className="hms-field"
            style={{ maxWidth: 260 }}
            value={pick}
            onChange={(e) => {
              const code = e.target.value
              setPick(code)
              const menu = unused.find((item) => item.code === code)
              setCustomName(menu ? shortcutButtonName(menu) : '')
            }}
          >
            <option value="">Select menu</option>
            {unused.map((menu) => (
              <option key={menu.code} value={menu.code}>
                {menu.picker_label || menu.label}
              </option>
            ))}
          </select>
          <label htmlFor="shortcut-name">Button name</label>
          <input
            id="shortcut-name"
            className="hms-field"
            style={{ maxWidth: 180 }}
            placeholder="Custom name"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
          />
          <label htmlFor="shortcut-desc">Description</label>
          <input
            id="shortcut-desc"
            className="hms-field"
            style={{ maxWidth: 220 }}
            placeholder="Optional"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button className="hms-btn hms-btn-primary" type="button" disabled={!pick || busy} onClick={addShortcut}>
            Add
          </button>
        </div>
      </div>

      <div className="hms-table-wrap" style={{ maxHeight: 480 }}>
        <table className="hms-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Menu</th>
              <th>Button name</th>
              <th>Description</th>
              <th style={{ width: 70 }}>Active</th>
              <th style={{ width: 180 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6}>No shortcuts on this screen yet.</td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={row.key}>
                  <td>{index + 1}</td>
                  <td>{menuLabel(row.module_code)}</td>
                  <td>
                    <input
                      className="hms-field"
                      value={row.button_label}
                      onChange={(e) => update(row.key, { button_label: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="hms-field"
                      value={row.description}
                      onChange={(e) => update(row.key, { description: e.target.value })}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={row.is_active}
                      onChange={(e) => update(row.key, { is_active: e.target.checked })}
                    />
                  </td>
                  <td>
                    <button className="hms-btn" type="button" disabled={index === 0} onClick={() => move(index, -1)}>
                      Up
                    </button>{' '}
                    <button
                      className="hms-btn"
                      type="button"
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      Down
                    </button>{' '}
                    <button
                      className="hms-btn hms-btn-danger"
                      type="button"
                      disabled={busy}
                      onClick={() => void persist(rows.filter((item) => item.key !== row.key), 'Shortcut removed. The menu stays in the sidebar.')}
                    >
                      Delete
                    </button>
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
