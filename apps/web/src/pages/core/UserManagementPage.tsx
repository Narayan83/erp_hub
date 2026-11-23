import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import '../hospital/billing/hms-master.css'

type Mode = 'Create' | 'Modify' | 'Delete'

type UserType = { id: string; code: string; name: string; is_active?: boolean }

type AppUser = {
  id: string
  username?: string | null
  email: string
  full_name: string
  phone?: string | null
  user_type_id?: string | null
  user_type_name?: string | null
  is_active: boolean
  roles?: string[]
}

const EMPTY = {
  username: '',
  email: '',
  fullName: '',
  phone: '',
  password: '',
  confirm: '',
  userTypeId: '',
  isActive: true,
}

export function UserManagementPage() {
  const [mode, setMode] = useState<Mode>('Create')
  const [users, setUsers] = useState<AppUser[]>([])
  const [types, setTypes] = useState<UserType[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [emailCustom, setEmailCustom] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const [rows, typeRows] = await Promise.all([
      api.get<AppUser[]>('/users'),
      api.get<UserType[]>('/user-types'),
    ])
    setUsers(rows)
    const active = typeRows.filter((t) => t.is_active !== false)
    setTypes(active)
    return active
  }

  useEffect(() => {
    void load()
      .then((active) => {
        setForm((f) => ({ ...f, userTypeId: f.userTypeId || active[0]?.id || '' }))
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const selected = useMemo(() => users.find((u) => u.id === selectedId) || null, [users, selectedId])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) =>
      [u.full_name, u.username, u.email, u.phone, u.user_type_name, ...(u.roles || [])]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [users, query])

  function applyUser(user: AppUser) {
    const username = user.username || (user.email.includes('@') ? user.email.split('@')[0] : user.email)
    setSelectedId(user.id)
    setForm({
      username,
      email: user.email || username,
      fullName: user.full_name || '',
      phone: user.phone || '',
      password: '',
      confirm: '',
      userTypeId: user.user_type_id || '',
      isActive: user.is_active,
    })
    setEmailCustom((user.email || '').toLowerCase() !== username.toLowerCase())
  }

  function clearForm(typeId = types[0]?.id || '') {
    setSelectedId('')
    setEmailCustom(false)
    setForm({ ...EMPTY, userTypeId: typeId })
  }

  useEffect(() => {
    if (mode === 'Create') {
      clearForm()
      return
    }
    if (selected) applyUser(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  function setUsername(value: string) {
    setForm((f) => ({
      ...f,
      username: value,
      email: emailCustom ? f.email : value,
    }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(null)

    if (mode === 'Delete') {
      if (!selectedId) {
        setError('Select a user')
        return
      }
      const name = selected?.full_name || 'this user'
      if (!window.confirm(`Deactivate ${name}? They will no longer be able to log in.`)) return
      setBusy(true)
      try {
        await api.delete(`/users/${selectedId}`)
        setOk('User deactivated')
        clearForm()
        setMode('Create')
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
      return
    }

    if (!form.fullName.trim() || !form.username.trim()) {
      setError('Full name and user ID are required.')
      return
    }
    if (types.length > 0 && !form.userTypeId) {
      setError('User type is required.')
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
      setError('Select a user')
      return
    }

    setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        username: form.username.trim(),
        email: form.email.trim() || form.username.trim(),
        full_name: form.fullName.trim(),
        phone: form.phone.trim() || null,
        user_type_id: form.userTypeId || null,
        is_active: form.isActive,
      }
      if (form.password) payload.password = form.password
      if (mode === 'Modify') {
        await api.patch(`/users/${selectedId}`, payload)
        setOk('User updated')
      } else {
        await api.post('/users', payload)
        setOk('User created. They can sign in with the User ID and password.')
        clearForm()
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
      <p className="hint">
        User ID can be a short name (for example ram). Email is optional and defaults to the same value. Login accepts either.
      </p>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}
      <div className="hms-toolbar">
        <label>Action</label>
        <select
          className="hms-field"
          style={{ width: 140 }}
          value={mode}
          onChange={(e) => {
            setError(null)
            setOk(null)
            setMode(e.target.value as Mode)
          }}
        >
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
              {u.full_name} ({u.username || u.email}){u.is_active ? '' : ' — inactive'}
            </option>
          ))}
        </select>
        <label>Search</label>
        <input
          className="hms-field"
          style={{ width: 220 }}
          placeholder="Name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <form className="hms-box" onSubmit={onSubmit}>
        <div className="hms-box-title">User</div>
        <div className="hms-grid hms-grid-3" style={{ marginTop: 4 }}>
          <div className="hms-field-wrap">
            <label>Full Name *</label>
            <input
              className="hms-field"
              required={!locked}
              disabled={locked}
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            />
          </div>
          <div className="hms-field-wrap">
            <label>User ID *</label>
            <input
              className="hms-field"
              required={!locked}
              disabled={locked}
              value={form.username}
              placeholder="ram"
              autoComplete="off"
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="hms-field-wrap">
            <label>Email</label>
            <input
              className="hms-field"
              disabled={locked}
              value={form.email}
              placeholder="Same as User ID if blank"
              autoComplete="off"
              onChange={(e) => {
                setEmailCustom(true)
                setForm((f) => ({ ...f, email: e.target.value }))
              }}
            />
          </div>
          <div className="hms-field-wrap">
            <label>Phone</label>
            <input
              className="hms-field"
              disabled={locked}
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          <div className="hms-field-wrap">
            <label>User Type{types.length ? ' *' : ''}</label>
            <select
              className="hms-field"
              required={!locked && types.length > 0}
              disabled={locked}
              value={form.userTypeId}
              onChange={(e) => setForm((f) => ({ ...f, userTypeId: e.target.value }))}
            >
              <option value="">—</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Password {mode === 'Create' ? '*' : '(blank keeps current)'}</label>
            <input
              className="hms-field"
              type="password"
              required={mode === 'Create'}
              disabled={locked}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </div>
          <div className="hms-field-wrap">
            <label>Confirm Password</label>
            <input
              className="hms-field"
              type="password"
              disabled={locked}
              autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
            />
          </div>
          <div className="hms-field-wrap">
            <label>Active</label>
            <select
              className="hms-field"
              disabled={locked}
              value={form.isActive ? 'yes' : 'no'}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.value === 'yes' }))}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>
        <div className="hms-actions">
          <button className={`hms-btn ${mode === 'Delete' ? 'hms-btn-danger' : 'hms-btn-primary'}`} type="submit" disabled={busy}>
            {busy ? '…' : mode === 'Create' ? 'Save' : mode === 'Modify' ? 'Update' : 'Delete'}
          </button>
          <button
            className="hms-btn"
            type="button"
            onClick={() => {
              setError(null)
              setOk(null)
              clearForm()
            }}
          >
            Clear
          </button>
        </div>
      </form>
      <div className="hms-table-wrap">
        <table className="hms-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>User ID</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Type</th>
              <th>Role</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => (
              <tr
                key={u.id}
                className={u.id === selectedId ? 'active' : ''}
                onClick={() => {
                  applyUser(u)
                  if (mode === 'Create') setMode('Modify')
                }}
              >
                <td>{u.full_name}</td>
                <td>{u.username || u.email}</td>
                <td>{u.email}</td>
                <td>{u.phone || ''}</td>
                <td>{u.user_type_name || ''}</td>
                <td>{(u.roles || []).join(', ')}</td>
                <td>{u.is_active ? 'Y' : 'N'}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7}>No users.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
