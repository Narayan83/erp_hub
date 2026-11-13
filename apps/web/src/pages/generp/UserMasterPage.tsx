import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { LIST_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'

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

type FormState = {
  username: string
  email: string
  full_name: string
  phone: string
  password: string
  user_type_id: string
  is_active: boolean
}

const EMPTY: FormState = {
  username: '',
  email: '',
  full_name: '',
  phone: '',
  password: '',
  user_type_id: '',
  is_active: true,
}

export function UserMasterPage() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [types, setTypes] = useState<UserTypeRow[]>([])
  const [query, setQuery] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [emailCustom, setEmailCustom] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [rows, typeRows] = await Promise.all([
      api.get<AppUser[]>('/users'),
      api.get<UserTypeRow[]>('/user-types'),
    ])
    setUsers(rows)
    setTypes(typeRows.filter((t) => t.is_active !== false))
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await load()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load users')
      }
    })()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) =>
      [u.username, u.email, u.full_name, u.phone, u.user_type_name]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [users, query])

  const pager = useClientPager(filtered, query, LIST_PAGE_SIZE)

  const exportRows = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel('users', {
      name: 'Users',
      headers: ['User ID', 'Name', 'Email', 'Phone', 'Type', 'Active'],
      rows: filtered.map((u) => [
        u.username || '',
        u.full_name,
        u.email,
        u.phone || '',
        u.user_type_name || '',
        u.is_active ? 'Yes' : 'No',
      ]),
    }, format)
  }

  const select = (u: AppUser) => {
    const username = u.username || u.email.split('@')[0] || ''
    setEditId(u.id)
    setForm({
      username,
      email: u.email || username,
      full_name: u.full_name || '',
      phone: u.phone || '',
      password: '',
      user_type_id: u.user_type_id || '',
      is_active: u.is_active,
    })
    setEmailCustom((u.email || '').toLowerCase() !== username.toLowerCase())
    setError('')
  }

  const reset = () => {
    setEditId(null)
    setForm({ ...EMPTY, user_type_id: types[0]?.id || '' })
    setEmailCustom(false)
    setError('')
  }

  const setUsername = (value: string) => {
    setForm((f) => ({
      ...f,
      username: value,
      email: emailCustom ? f.email : value,
    }))
  }

  const save = async () => {
    if (!form.username.trim() && !form.email.trim()) {
      setError('User ID is required.')
      return
    }
    if (!form.full_name.trim()) {
      setError('Name is required.')
      return
    }
    if (!editId && !form.password) {
      setError('Password is required for a new user.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        username: form.username.trim() || undefined,
        email: form.email.trim() || undefined,
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        user_type_id: form.user_type_id || null,
        is_active: form.is_active,
      }
      if (form.password) payload.password = form.password
      if (editId) {
        await api.patch(`/users/${editId}`, payload)
      } else {
        await api.post('/users', payload)
      }
      await load()
      reset()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!editId) return
    if (!confirm('Deactivate this user?')) return
    setBusy(true)
    try {
      await api.delete(`/users/${editId}`)
      await load()
      reset()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="master-page">
      <h2>User Addition / Modification</h2>
      <p className="hint">
        User ID can be a short name (e.g. ram). Email is optional and defaults to the same value.
        Login accepts either.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="master-grid">
        <aside className="master-list">
          <input
            className="input"
            placeholder="Search users…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="master-list-toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={reset}>
              + New User
            </button>
            <ListPager
              compact
              page={pager.page}
              totalPages={pager.totalPages}
              total={pager.total}
              pageSize={pager.pageSize}
              onPage={pager.setPage}
              onExport={exportRows}
            />
          </div>
          <div className="master-list-scroll">
            {pager.pageRows.map((u) => (
              <button
                key={u.id}
                type="button"
                className={`master-list-item${editId === u.id ? ' active' : ''}`}
                onClick={() => select(u)}
              >
                <strong>{u.username || u.email}</strong>
                <span>{u.full_name}</span>
                <small>
                  {u.email}
                  {u.user_type_name ? ` · ${u.user_type_name}` : ''}
                  {u.is_active ? '' : ' · Inactive'}
                </small>
              </button>
            ))}
          </div>
        </aside>

        <div className="master-form">
          <div className="settings-box">
            <div className="settings-field-row">
              <label className="settings-field">
                <span>User ID *</span>
                <input
                  className="input"
                  value={form.username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ram"
                  autoComplete="off"
                />
                <small className="hint">Short id used at login</small>
              </label>
              <label className="settings-field">
                <span>Email</span>
                <input
                  className="input"
                  value={form.email}
                  onChange={(e) => {
                    setEmailCustom(true)
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }}
                  placeholder="Same as User ID if blank"
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="settings-field-row">
              <label className="settings-field">
                <span>Full Name *</span>
                <input
                  className="input"
                  value={form.full_name}
                  onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                />
              </label>
              <label className="settings-field">
                <span>Phone</span>
                <input
                  className="input"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </label>
            </div>
            <div className="settings-field-row">
              <label className="settings-field">
                <span>User Type</span>
                <select
                  className="input"
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
              <label className="settings-field">
                <span>{editId ? 'New Password' : 'Password *'}</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={editId ? 'Leave blank to keep' : ''}
                />
              </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />{' '}
              Active
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
                {editId ? 'Update' : 'Create'}
              </button>
              {editId && (
                <button type="button" className="btn" disabled={busy} onClick={() => void remove()}>
                  Deactivate
                </button>
              )}
              <button type="button" className="btn" onClick={reset}>
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
