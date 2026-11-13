import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'

type Menu = { id?: string; code: string; label: string }
type Shortcut = { module_code: string; button_label: string; sort_order: number }

export function DashboardShortcutPage() {
  const [menus, setMenus] = useState<Menu[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const [m, s] = await Promise.all([
          api.get<Menu[]>('/hospital/dashboard/shortcut-menus').catch(() =>
            api.get<Menu[]>('/hospital/menus').then((rows) =>
              rows.map((r) => ({ code: (r as { code: string }).code, label: (r as { label: string }).label })),
            ),
          ),
          api.get<Shortcut[]>('/hospital/dashboard/shortcuts'),
        ])
        setMenus(m)
        setSelected((s || []).map((x) => x.module_code))
      } catch (e) {
        setError(String(e))
      }
    })()
  }, [])

  function toggle(code: string) {
    setSelected((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]))
  }

  async function save() {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      await api.put('/hospital/dashboard/shortcuts', {
        host_code: 'dashboard',
        items: selected.map((module_code, i) => {
          const menu = menus.find((m) => m.code === module_code)
          return {
            module_code,
            button_label: menu?.label || module_code,
            sort_order: i + 1,
            is_active: true,
          }
        }),
      })
      setOk('Shortcuts saved')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>Menu Shortcuts</h1>
      <div className="hint">Choose menus shown as dashboard shortcuts.</div>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}
      <div className="hms-actions">
        <button className="hms-btn hms-btn-primary" type="button" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>
      <div className="hms-table-wrap" style={{ maxHeight: 480 }}>
        <table className="hms-table">
          <thead>
            <tr>
              <th></th>
              <th>Menu</th>
              <th>Code</th>
            </tr>
          </thead>
          <tbody>
            {menus.map((m) => (
              <tr key={m.code}>
                <td>
                  <input type="checkbox" checked={selected.includes(m.code)} onChange={() => toggle(m.code)} />
                </td>
                <td>{m.label}</td>
                <td>{m.code}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
