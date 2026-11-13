import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { Role, User } from '../types'

export function UsersPage() {
  const [rows, setRows] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    const [users, roleList] = await Promise.all([api.get<User[]>('/users'), api.get<Role[]>('/roles')])
    setRows(users)
    setRoles(roleList)
  }

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message))
  }, [])

  const toggleRole = (id: string) => {
    setRoleIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  const save = async () => {
    setError('')
    try {
      const body = { username, email, full_name: fullName, password, is_active: true, role_ids: roleIds }
      if (editId) await api.put(`/users/${editId}`, body)
      else await api.post('/users', body)
      setEditId(null)
      setUsername('')
      setEmail('')
      setFullName('')
      setPassword('')
      setRoleIds([])
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    }
  }

  return (
    <div>
      <h1>User management</h1>
      <p className="hint">Assign one or more roles. Menu access comes from those roles.</p>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <div className="row">
          <label>
            Username
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>
            Email
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Full name
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>
          <label>
            Password {editId ? '(blank = keep)' : ''}
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        </div>
        <div className="role-map">
          {roles.map((r) => (
            <label key={r.id} className="check">
              <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} />
              {r.name}
            </label>
          ))}
        </div>
        <button className="btn primary" type="button" onClick={() => void save()}>
          {editId ? 'Update user' : 'Create user'}
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Name</th>
              <th>Roles</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.email}</td>
                <td>{u.full_name}</td>
                <td>{(u.roles ?? []).map((r) => r.name).join(', ') || '—'}</td>
                <td>{u.is_active === false ? 'No' : 'Yes'}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditId(u.id)
                      setUsername(u.username)
                      setEmail(u.email)
                      setFullName(u.full_name)
                      setRoleIds((u.roles ?? []).map((r) => r.id))
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.put(`/users/${u.id}`, {
                        username: u.username,
                        email: u.email,
                        full_name: u.full_name,
                        password: '',
                        is_active: u.is_active === false,
                        role_ids: (u.roles ?? []).map((r) => r.id),
                      })
                      await load()
                    }}
                  >
                    {u.is_active === false ? 'Activate' : 'Deactivate'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Delete ${u.username}?`)) return
                      try {
                        await api.del(`/users/${u.id}`)
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
