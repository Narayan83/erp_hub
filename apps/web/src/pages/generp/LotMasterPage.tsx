import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { LIST_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import type { CompanyProfile, Lot } from '../../generpTypes'

type FormState = {
  code: string
  name: string
  remarks: string
  is_active: boolean
}

const EMPTY: FormState = { code: '', name: '', remarks: '', is_active: true }

export function LotMasterPage() {
  const [lots, setLots] = useState<Lot[]>([])
  const [lotEnabled, setLotEnabled] = useState(false)
  const [query, setQuery] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [rows, profile] = await Promise.all([
      api.get<Lot[]>('/stock/lots'),
      api.get<CompanyProfile>('/company-profile').catch(() => null),
    ])
    setLots(rows)
    setLotEnabled(profile?.lot_enabled === true)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await load()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load lots')
      }
    })()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return lots
    return lots.filter(
      (l) =>
        l.code.toLowerCase().includes(q) ||
        l.name.toLowerCase().includes(q) ||
        (l.remarks || '').toLowerCase().includes(q),
    )
  }, [lots, query])
  const pager = useClientPager(filtered, query, LIST_PAGE_SIZE)

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      setError('Lot code and name are required.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        remarks: form.remarks.trim() || null,
        is_active: form.is_active,
      }
      if (editId) await api.put(`/stock/lots/${editId}`, payload)
      else await api.post('/stock/lots', payload)
      setForm(EMPTY)
      setEditId(null)
      setStatus('Lot saved.')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (lot: Lot) => {
    if (!window.confirm(`Delete lot ${lot.code}?`)) return
    setBusy(true)
    setError('')
    try {
      await api.delete(`/stock/lots/${lot.id}`)
      if (editId === lot.id) {
        setEditId(null)
        setForm(EMPTY)
      }
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-page">
      <h2>Lot Master</h2>
      {lotEnabled ? (
        <p className="hint">Lots can be selected on the purchase bill and on the stock report.</p>
      ) : (
        <p className="hint">Turn on Lot enabled in Software Setup to use lots on purchase bills.</p>
      )}
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="hint">{status}</p>}
      <div className="settings-box">
        <div className="settings-field-row">
          <label className="settings-field">
            <span>Code</span>
            <input className="input" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
          </label>
          <label className="settings-field">
            <span>Name</span>
            <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
        </div>
        <label className="settings-field">
          <span>Remarks</span>
          <input className="input" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
          />{' '}
          Active
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {editId ? 'Update' : 'Save'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setEditId(null)
              setForm(EMPTY)
              setError('')
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              downloadExcel(
                'lots',
                {
                  name: 'Lots',
                  headers: ['Code', 'Name', 'Remarks', 'Active'],
                  rows: filtered.map((l) => [l.code, l.name, l.remarks || '', l.is_active === false ? 'No' : 'Yes']),
                },
                'xlsx' as SpreadsheetFormat,
              )
            }
          >
            Excel
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Remarks</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pager.pageRows.map((lot) => (
              <tr key={lot.id}>
                <td>{lot.code}</td>
                <td>{lot.name}</td>
                <td>{lot.remarks || ''}</td>
                <td>{lot.is_active === false ? 'No' : 'Yes'}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setEditId(lot.id)
                      setForm({
                        code: lot.code,
                        name: lot.name,
                        remarks: lot.remarks || '',
                        is_active: lot.is_active !== false,
                      })
                    }}
                  >
                    Edit
                  </button>{' '}
                  <button type="button" className="btn" onClick={() => void remove(lot)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager
        page={pager.page}
        totalPages={pager.totalPages}
        total={pager.total}
        pageSize={pager.pageSize}
        onPage={pager.setPage}
      />
    </div>
  )
}
