import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'

type Role = { id: string; role_name: string }
type Menu = { id: string; code: string; label: string }
type Perm = { menu_id: string; can_view: boolean; can_create: boolean; can_update: boolean; can_delete: boolean }

export function RoleMenuPermissionsPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [menus, setMenus] = useState<Menu[]>([])
  const [roleId, setRoleId] = useState('')
  const [perms, setPerms] = useState<Record<string, Perm>>({})
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void Promise.all([
      api.get<Role[]>('/hospital/roles'),
      api.get<Menu[]>('/hospital/menus'),
    ])
      .then(([r, m]) => {
        setRoles(r)
        setMenus(m)
        if (r[0]) setRoleId(r[0].id)
      })
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    if (!roleId) return
    void api
      .get<Perm[]>(`/hospital/roles/${roleId}/permissions`)
      .then((list) => {
        const map: Record<string, Perm> = {}
        for (const m of menus) {
          const existing = list.find((p) => p.menu_id === m.id)
          map[m.id] = existing || {
            menu_id: m.id,
            can_view: false,
            can_create: false,
            can_update: false,
            can_delete: false,
          }
        }
        setPerms(map)
      })
      .catch((e) => setError(String(e)))
  }, [roleId, menus])

  function toggle(menuId: string, key: keyof Perm) {
    if (key === 'menu_id') return
    setPerms((prev) => ({
      ...prev,
      [menuId]: { ...prev[menuId], [key]: !prev[menuId][key] },
    }))
  }

  async function save() {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      await api.put(`/hospital/roles/${roleId}/permissions`, {
        permissions: Object.values(perms).filter((p) => p.can_view || p.can_create || p.can_update || p.can_delete),
      })
      setOk('Permissions saved')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>Role Menu Permissions</h1>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}
      <div className="hms-toolbar">
        <label>Role</label>
        <select className="hms-field" style={{ minWidth: 220 }} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.role_name}
            </option>
          ))}
        </select>
        <button className="hms-btn hms-btn-primary" type="button" disabled={busy || !roleId} onClick={() => void save()}>
          Save
        </button>
      </div>
      <div className="hms-table-wrap" style={{ maxHeight: 480 }}>
        <table className="hms-table">
          <thead>
            <tr>
              <th>Menu</th>
              <th>View</th>
              <th>Create</th>
              <th>Update</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody>
            {menus.map((m) => {
              const p = perms[m.id]
              if (!p) return null
              return (
                <tr key={m.id}>
                  <td>
                    {m.label} <span style={{ color: '#64748b' }}>({m.code})</span>
                  </td>
                  {(['can_view', 'can_create', 'can_update', 'can_delete'] as const).map((k) => (
                    <td key={k}>
                      <input type="checkbox" checked={Boolean(p[k])} onChange={() => toggle(m.id, k)} />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
