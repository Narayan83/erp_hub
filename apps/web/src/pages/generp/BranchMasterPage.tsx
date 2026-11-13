import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { LIST_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import type { Branch } from '../../generpTypes'

type FormState = {
  code: string
  name: string
  address: string
  is_main: boolean
  is_active: boolean
}

const EMPTY: FormState = {
  code: '',
  name: '',
  address: '',
  is_main: false,
  is_active: true,
}

function branchToForm(b: Branch): FormState {
  return {
    code: b.code || '',
    name: b.name || '',
    address: b.address || '',
    is_main: Boolean(b.is_main),
    is_active: b.is_active !== false,
  }
}

export function BranchMasterPage() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [query, setQuery] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const rows = await api.get<Branch[]>('/stock/branches')
    setBranches(rows)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await load()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load branches')
      }
    })()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return branches
    return branches.filter(
      (b) =>
        b.code.toLowerCase().includes(q) ||
        b.name.toLowerCase().includes(q) ||
        (b.address || '').toLowerCase().includes(q),
    )
  }, [branches, query])

  const pager = useClientPager(filtered, query, LIST_PAGE_SIZE)

  const exportRows = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel('branches', {
      name: 'Branches',
      headers: ['Code', 'Name', 'Address', 'Main', 'Active'],
      rows: filtered.map((b) => [
        b.code,
        b.name,
        b.address || '',
        b.is_main ? 'Yes' : 'No',
        b.is_active === false ? 'No' : 'Yes',
      ]),
    }, format)
  }

  const select = (b: Branch) => {
    setEditId(b.id)
    setForm(branchToForm(b))
    setError('')
    setStatus('')
  }

  const reset = () => {
    setEditId(null)
    setForm(EMPTY)
    setError('')
    setStatus('')
  }

  const save = async () => {
    if (!form.code.trim()) {
      setError('Branch code is required.')
      return
    }
    if (!form.name.trim()) {
      setError('Branch name is required.')
      return
    }
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        address: form.address.trim() || null,
        is_main: form.is_main,
        is_active: form.is_active,
      }
      if (editId) {
        await api.put(`/stock/branches/${editId}`, payload)
        setStatus('Branch updated.')
      } else {
        await api.post('/stock/branches', payload)
        setStatus('Branch created.')
      }
      await load()
      reset()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="master-page">
      <h2>Branch Master</h2>
      <p className="hint">Manage warehouse / store branches for stock transfers and vouchers.</p>
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="hint">{status}</p>}

      <div className="master-grid">
        <aside className="master-list">
          <input
            className="input"
            placeholder="Search branches…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="master-list-toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={reset}>
              + New Branch
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
            {pager.pageRows.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`master-list-item${editId === b.id ? ' active' : ''}`}
                onClick={() => select(b)}
              >
                <strong>{b.code}</strong>
                <span>{b.name}</span>
                <small>
                  {b.is_main ? 'Main' : 'Branch'}
                  {b.is_active === false ? ' · Inactive' : ''}
                </small>
              </button>
            ))}
          </div>
        </aside>

        <div className="master-form">
          <div className="settings-box">
            <div className="settings-field-row">
              <label className="settings-field">
                <span>Code *</span>
                <input
                  className="input"
                  value={form.code}
                  readOnly={Boolean(editId)}
                  disabled={Boolean(editId)}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                />
              </label>
              <label className="settings-field">
                <span>Name *</span>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
            </div>
            <label className="settings-field">
              <span>Address</span>
              <input
                className="input"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </label>
            <div className="settings-field-row" style={{ gap: 24 }}>
              <label>
                <input
                  type="checkbox"
                  checked={form.is_main}
                  onChange={(e) => setForm((f) => ({ ...f, is_main: e.target.checked }))}
                />{' '}
                Main Branch
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                />{' '}
                Active
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
                {editId ? 'Update' : 'Create'}
              </button>
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
