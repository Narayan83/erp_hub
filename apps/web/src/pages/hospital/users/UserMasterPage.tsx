import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'

type Mode = 'Create' | 'Modify' | 'Delete'
type UserType = { id: string; code: string; name: string }
type User = {
  id: string
  email: string
  full_name: string
  phone?: string | null
  user_type_id: string | null
  user_type_name?: string | null
  is_active: boolean
}

export function UserMasterPage() {
  const [mode, setMode] = useState<Mode>('Create')
  const [users, setUsers] = useState<User[]>([])
  const [types, setTypes] = useState<UserType[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [userTypeId, setUserTypeId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const [u, t] = await Promise.all([
      api.get<User[]>('/hospital/users', { active_only: false }),
      api.get<UserType[]>('/hospital/user-types'),
    ])
    setUsers(u)
    setTypes(t)
    if (!userTypeId && t[0]) setUserTypeId(t[0].id)
  }

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [])

  const selected = useMemo(() => users.find((u) => u.id === selectedId) || null, [users, selectedId])

  useEffect(() => {
    if (mode === 'Create') {
      setSelectedId('')
      setEmail('')
      setPassword('')
      setFullName('')
      setPhone('')
      return
    }
    if (!selected) return
    setEmail(selected.email)
    setPassword('')
    setFullName(selected.full_name)
    setPhone(selected.phone || '')
    setUserTypeId(selected.user_type_id || '')
  }, [mode, selectedId, selected])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      if (mode === 'Create') {
        await api.post('/hospital/users', {
          email,
          password,
          full_name: fullName,
          phone: phone || null,
          user_type_id: userTypeId,
        })
        setOk('User created')
        setEmail('')
        setPassword('')
        setFullName('')
        setPhone('')
      } else if (mode === 'Modify') {
        if (!selectedId) throw new Error('Select a user')
        await api.patch(`/hospital/users/${selectedId}`, {
          email,
          full_name: fullName,
          phone: phone || null,
          user_type_id: userTypeId || null,
          ...(password ? { password } : {}),
        })
        setOk('Updated')
      } else {
        if (!selectedId) throw new Error('Select a user')
        await api.delete(`/hospital/users/${selectedId}`)
        setOk('Deleted')
        setMode('Create')
        setSelectedId('')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const locked = mode === 'Delete'

  return (
    <div className="hms-page">
      <h1>User Addition / Modification</h1>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}
      <div className="hms-toolbar">
        <label>Action</label>
        <select className="hms-field" style={{ width: 140 }} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option>Create</option>
          <option>Modify</option>
          <option>Delete</option>
        </select>
        <label>Select User</label>
        <select
          className="hms-field"
          style={{ minWidth: 260 }}
          disabled={mode === 'Create'}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">—</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name} ({u.email})
            </option>
          ))}
        </select>
      </div>
      <form className="hms-box" onSubmit={onSubmit}>
        <div className="hms-box-title">User</div>
        <div className="hms-grid hms-grid-3" style={{ marginTop: 4 }}>
          <div className="hms-field-wrap">
            <label>Full Name *</label>
            <input className="hms-field" required={!locked} disabled={locked} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="hms-field-wrap">
            <label>Email *</label>
            <input className="hms-field" type="email" required={!locked} disabled={locked} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="hms-field-wrap">
            <label>Password {mode === 'Create' ? '*' : '(optional)'}</label>
            <input
              className="hms-field"
              type="password"
              required={mode === 'Create'}
              disabled={locked}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="hms-field-wrap">
            <label>Phone</label>
            <input className="hms-field" disabled={locked} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="hms-field-wrap">
            <label>User Type *</label>
            <select className="hms-field" required={!locked} disabled={locked} value={userTypeId} onChange={(e) => setUserTypeId(e.target.value)}>
              <option value="">—</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="hms-actions">
          <button className={`hms-btn ${mode === 'Delete' ? 'hms-btn-danger' : 'hms-btn-primary'}`} type="submit" disabled={busy}>
            {busy ? '…' : mode === 'Create' ? 'Save' : mode === 'Modify' ? 'Update' : 'Delete'}
          </button>
        </div>
      </form>
      <div className="hms-table-wrap">
        <table className="hms-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Type</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className={u.id === selectedId ? 'active' : ''}
                onClick={() => {
                  setSelectedId(u.id)
                  if (mode === 'Create') setMode('Modify')
                }}
              >
                <td>{u.full_name}</td>
                <td>{u.email}</td>
                <td>{u.user_type_name}</td>
                <td>{u.is_active ? 'Y' : 'N'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
