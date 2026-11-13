import { FormEvent, useEffect, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'

type User = { id: string; full_name: string; email: string }
type Role = { id: string; role_name: string }
type Mapping = { id: string; user_id: string; role_id: string; role_name: string; priority: number }

export function UserRoleMappingPage() {
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [rows, setRows] = useState<Mapping[]>([])
  const [userId, setUserId] = useState('')
  const [roleId, setRoleId] = useState('')
  const [priority, setPriority] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  async function loadUsers() {
    const [u, r] = await Promise.all([
      api.get<User[]>('/hospital/users', { active_only: true }),
      api.get<Role[]>('/hospital/roles'),
    ])
    setUsers(u)
    setRoles(r)
    if (!userId && u[0]) setUserId(u[0].id)
    if (!roleId && r[0]) setRoleId(r[0].id)
  }

  async function loadMappings(uid: string) {
    if (!uid) {
      setRows([])
      return
    }
    const m = await api.get<Mapping[]>('/hospital/user-roles', { user_id: uid })
    setRows(m)
  }

  useEffect(() => {
    void loadUsers().catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    void loadMappings(userId).catch((e) => setError(String(e)))
  }, [userId])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(null)
    try {
      await api.post('/hospital/user-roles', { user_id: userId, role_id: roleId, priority })
      setOk('Mapped')
      await loadMappings(userId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove(id: string) {
    setError(null)
    try {
      await api.delete(`/hospital/user-roles/${id}`)
      await loadMappings(userId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="hms-page">
      <h1>Role Mapping</h1>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}
      <form className="hms-box" onSubmit={onSubmit}>
        <div className="hms-box-title">Assign Role</div>
        <div className="hms-grid hms-grid-3" style={{ marginTop: 4 }}>
          <div className="hms-field-wrap">
            <label>User</label>
            <select className="hms-field" value={userId} onChange={(e) => setUserId(e.target.value)}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Role</label>
            <select className="hms-field" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.role_name}
                </option>
              ))}
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Priority</label>
            <input className="hms-field" type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
          </div>
        </div>
        <div className="hms-actions">
          <button className="hms-btn hms-btn-primary" type="submit">
            Assign
          </button>
        </div>
      </form>
      <div className="hms-table-wrap">
        <table className="hms-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Priority</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{users.find((u) => u.id === row.user_id)?.full_name || row.user_id}</td>
                <td>{row.role_name}</td>
                <td>{row.priority}</td>
                <td>
                  <button className="hms-btn hms-btn-danger" type="button" onClick={() => void remove(row.id)}>
                    Remove
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
