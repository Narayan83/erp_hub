import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'

type Mode = 'Create' | 'Modify' | 'Delete'

type AppUser = {
  id: string
  username?: string | null
  email: string
  full_name: string
  phone?: string | null
  user_type_id?: string | null
  user_type_name?: string | null
  is_active: boolean
}

type UserTypeRow = {
  id: string
  name: string
  is_active?: boolean
}

const EMPTY = {
  username: '',
  email: '',
  full_name: '',
  phone: '',
  password: '',
  confirm: '',
  user_type_id: '',
}

export function UsersPage() {
  const [mode, setMode] = useState<Mode>('Create')
  const [users, setUsers] = useState<AppUser[]>([])
  const [types, setTypes] = useState<UserTypeRow[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [emailCustom, setEmailCustom] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [rows, typeRows] = await Promise.all([
      api.get<AppUser[]>('/users'),
      api.get<UserTypeRow[]>('/user-types'),
    ])
    setUsers(rows)
    const active = typeRows.filter((t) => t.is_active !== false)
    setTypes(active)
    return active
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const active = await load()
        setForm((f) => ({ ...f, user_type_id: f.user_type_id || active[0]?.id || '' }))
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load users')
      }
    })()
  }, [load])

  const applyUser = (u: AppUser) => {
    const username = u.username || (u.email.includes('@') ? u.email.split('@')[0] : u.email)
    setSelectedId(u.id)
    setForm({
      username,
      email: u.email || username,
      full_name: u.full_name || '',
      phone: u.phone || '',
      password: '',
      confirm: '',
      user_type_id: u.user_type_id || '',
    })
    setEmailCustom((u.email || '').toLowerCase() !== username.toLowerCase())
  }

  const clearForm = (typeId = types[0]?.id || '') => {
    setSelectedId('')
    setEmailCustom(false)
    setForm({ ...EMPTY, user_type_id: typeId })
  }

  const setUsername = (value: string) => {
    setForm((f) => ({
      ...f,
      username: value,
      email: emailCustom ? f.email : value,
    }))
  }

  const onMode = (next: Mode) => {
    setMode(next)
    setError('')
    setOk('')
    if (next === 'Create') clearForm()
  }

  const save = async () => {
    setError('')
    setOk('')
    if (mode === 'Delete') {
      if (!selectedId) {
        setError('Select a user to delete.')
        return
      }
      const name = users.find((u) => u.id === selectedId)?.full_name || 'this user'
      if (!window.confirm(`Deactivate ${name}? They will no longer be able to log in.`)) return
      setBusy(true)
      try {
        await api.delete(`/users/${selectedId}`)
        setOk('User deactivated.')
        clearForm()
        setMode('Create')
        await load()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Delete failed')
      } finally {
        setBusy(false)
      }
      return
    }

    if (!form.full_name.trim() || !form.username.trim() || !form.user_type_id) {
      setError('Full name, user ID and user type are required.')
      return
    }
    if (mode === 'Create' && !form.password) {
      setError('Password is required for a new user.')
      return
    }
    if (form.password && form.password !== form.confirm) {
      setError('Password and confirm password do not match.')
      return
    }
    if (mode === 'Modify' && !selectedId) {
      setError('Select a user to modify.')
      return
    }

    setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        username: form.username.trim(),
        email: form.email.trim() || form.username.trim(),
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        user_type_id: form.user_type_id,
      }
      if (form.password) payload.password = form.password
      if (mode === 'Modify') {
        await api.patch(`/users/${selectedId}`, payload)
        setOk('User updated.')
      } else {
        await api.post('/users', payload)
        setOk('User created. They can sign in with the User ID and password.')
        clearForm()
      }
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const locked = mode === 'Delete'

  return (
    <div>
      <h1>User Addition / Modification</h1>
      <p className="hint">
        User ID can be a short name (for example ram). Email is optional and defaults to the same value.
        Login accepts either.
      </p>
      {error && <div className="error">{error}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="cf-bar">
        <label>
          Action
          <select className="input" value={mode} onChange={(e) => onMode(e.target.value as Mode)}>
            <option>Create</option>
            <option>Modify</option>
            <option>Delete</option>
          </select>
        </label>
        <label style={{ flex: 2 }}>
          Select User
          <select
            className="input"
            disabled={mode === 'Create'}
            value={selectedId}
            onChange={(e) => {
              const id = e.target.value
              setSelectedId(id)
              const user = users.find((u) => u.id === id)
              if (user) applyUser(user)
              else clearForm()
            }}
          >
            <option value="">—</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.username || u.email})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel">
        <div className="grid3">
          <label>
            Full Name *
            <input
              className="input"
              disabled={locked}
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            />
          </label>
          <label>
            User ID *
            <input
              className="input"
              disabled={locked}
              value={form.username}
              placeholder="ram"
              autoComplete="off"
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            Email
            <input
              className="input"
              disabled={locked}
              value={form.email}
              placeholder="Same as User ID if blank"
              autoComplete="off"
              onChange={(e) => {
                setEmailCustom(true)
                setForm((f) => ({ ...f, email: e.target.value }))
              }}
            />
          </label>
          <label>
            Phone
            <input
              className="input"
              disabled={locked}
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </label>
          <label>
            User Type *
            <select
              className="input"
              disabled={locked}
              value={form.user_type_id}
              onChange={(e) => setForm((f) => ({ ...f, user_type_id: e.target.value }))}
            >
              <option value="">—</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Password {mode === 'Create' ? '*' : ''}
            <input
              className="input"
              type="password"
              disabled={locked}
              autoComplete="new-password"
              placeholder={mode === 'Modify' ? 'Leave blank to keep' : ''}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </label>
          <label>
            Confirm Password
            <input
              className="input"
              type="password"
              disabled={locked}
              autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
            />
          </label>
        </div>
        <div className="cf-bar">
          <button className={`btn ${mode === 'Delete' ? 'danger' : 'primary'}`} type="button" disabled={busy} onClick={() => void save()}>
            {busy ? '…' : mode === 'Create' ? 'Save' : mode === 'Modify' ? 'Update' : 'Delete'}
          </button>
          <button className="btn ghost" type="button" onClick={() => { setError(''); setOk(''); clearForm() }}>
            Clear
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>User ID</th>
              <th>Email</th>
              <th>Type</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className={u.id === selectedId ? 'selected' : ''}
                onClick={() => {
                  applyUser(u)
                  if (mode === 'Create') setMode('Modify')
                }}
              >
                <td>{u.full_name}</td>
                <td>{u.username || u.email}</td>
                <td>{u.email}</td>
                <td>{u.user_type_name || ''}</td>
                <td>{u.is_active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5}>No users yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
