import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { Role, RoleMenu } from '../types'

type Menu = { key: string; label: string }

const blankMenu = (key: string): RoleMenu => ({
  menu_key: key,
  can_view: false,
  can_add: false,
  can_edit: false,
  can_delete: false,
})

export function RolesPage() {
  const [rows, setRows] = useState<Role[]>([])
  const [catalog, setCatalog] = useState<Menu[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [menus, setMenus] = useState<RoleMenu[]>([])
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    const [roles, list] = await Promise.all([api.get<Role[]>('/roles'), api.get<Menu[]>('/menus')])
    setRows(roles)
    setCatalog(list)
    if (!editId) setMenus(list.map((m) => blankMenu(m.key)))
  }

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message))
  }, [])

  const setFlag = (key: string, field: keyof RoleMenu, value: boolean) => {
    setMenus((cur) =>
      cur.map((m) => (m.menu_key === key ? { ...m, [field]: value, ...(field === 'can_view' && !value ? { can_add: false, can_edit: false, can_delete: false } : {}) } : m)),
    )
  }

  const save = async () => {
    setError('')
    try {
      const body = { name, description, menus: menus.filter((m) => m.can_view) }
      if (editId) await api.put(`/roles/${editId}`, body)
      else await api.post('/roles', body)
      setEditId(null)
      setName('')
      setDescription('')
      setMenus(catalog.map((m) => blankMenu(m.key)))
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    }
  }

  const edit = (r: Role) => {
    setEditId(r.id)
    setName(r.name)
    setDescription(r.description)
    setMenus(catalog.map((m) => r.menus.find((x) => x.menu_key === m.key) ?? blankMenu(m.key)))
  }

  return (
    <div>
      <h1>Roles</h1>
      <p className="hint">Create roles, map menus, then assign the role on Users.</p>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <div className="row">
          <label>
            Role name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Description
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Menu</th>
                <th>View</th>
                <th>Add</th>
                <th>Edit</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((m) => {
                const row = menus.find((x) => x.menu_key === m.key) ?? blankMenu(m.key)
                return (
                  <tr key={m.key}>
                    <td>{m.label}</td>
                    {(['can_view', 'can_add', 'can_edit', 'can_delete'] as const).map((field) => (
                      <td key={field}>
                        <input type="checkbox" checked={row[field]} onChange={(e) => setFlag(m.key, field, e.target.checked)} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" onClick={() => void save()}>
            {editId ? 'Update role' : 'Create role'}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setEditId(null)
              setName('')
              setDescription('')
              setMenus(catalog.map((m) => blankMenu(m.key)))
            }}
          >
            New
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Description</th>
              <th>Menus</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.description}</td>
                <td>{r.menus.filter((m) => m.can_view).length}</td>
                <td className="row-actions">
                  <button type="button" onClick={() => edit(r)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Delete role ${r.name}?`)) return
                      try {
                        await api.del(`/roles/${r.id}`)
                        await load()
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Delete failed')
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
