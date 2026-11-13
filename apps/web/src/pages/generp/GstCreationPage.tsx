import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { LIST_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import type { GstRate } from '../../generpTypes'

type FormState = {
  code: string
  name: string
  rate: number
  cgst: number
  sgst: number
  igst: number
  sort_order: number
  is_active: boolean
}

const EMPTY: FormState = {
  code: '',
  name: '',
  rate: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  sort_order: 0,
  is_active: true,
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function splitFromRate(rate: number) {
  const r = num(rate)
  return { rate: r, cgst: r / 2, sgst: r / 2, igst: r }
}

function gstToForm(g: GstRate): FormState {
  const rate = num(g.rate)
  return {
    code: g.code || '',
    name: g.name || '',
    rate,
    cgst: g.cgst != null ? num(g.cgst) : rate / 2,
    sgst: g.sgst != null ? num(g.sgst) : rate / 2,
    igst: g.igst != null ? num(g.igst) : rate,
    sort_order: num(g.sort_order),
    is_active: g.is_active !== false,
  }
}

export function GstCreationPage() {
  const [rows, setRows] = useState<GstRate[]>([])
  const [query, setQuery] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const list = await api.get<GstRate[]>('/gst', { include_inactive: 'true' })
    setRows(list)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await load()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load GST rates')
      }
    })()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (g) =>
        (g.code || '').toLowerCase().includes(q) ||
        (g.name || '').toLowerCase().includes(q) ||
        String(g.rate ?? '').includes(q),
    )
  }, [rows, query])

  const pager = useClientPager(filtered, query, LIST_PAGE_SIZE)

  const exportRows = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel('gst-rates', {
      name: 'GST Rates',
      headers: ['Code', 'Name', 'Rate %', 'CGST', 'SGST', 'IGST', 'Sort', 'Active'],
      rows: filtered.map((g) => [
        g.code || '',
        g.name || '',
        num(g.rate),
        num(g.cgst),
        num(g.sgst),
        num(g.igst),
        num(g.sort_order),
        g.is_active === false ? 'No' : 'Yes',
      ]),
    }, format)
  }

  const select = (g: GstRate) => {
    setEditId(g.id)
    setForm(gstToForm(g))
    setError('')
    setStatus('')
  }

  const reset = () => {
    setEditId(null)
    setForm(EMPTY)
    setError('')
    setStatus('')
  }

  const setRate = (raw: string) => {
    const next = splitFromRate(Number(raw) || 0)
    setForm((f) => {
      const autoName = !f.name.trim() || /^GST\s+\d+(\.\d+)?%$/.test(f.name.trim())
      const autoCode = !editId && (!f.code.trim() || /^GST\d+(\.\d+)?$/.test(f.code.trim()))
      const rateLabel = Number.isInteger(next.rate) ? String(next.rate) : String(next.rate)
      return {
        ...f,
        ...next,
        name: autoName ? `GST ${rateLabel}%` : f.name,
        code: autoCode ? `GST${rateLabel}`.replace('.', '_') : f.code,
      }
    })
  }

  const save = async () => {
    if (!form.code.trim()) {
      setError('GST code is required.')
      return
    }
    if (!form.name.trim()) {
      setError('GST name is required.')
      return
    }
    if (form.rate < 0 || form.rate > 100) {
      setError('GST rate must be between 0 and 100.')
      return
    }
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const payload = {
        name: form.name.trim(),
        rate: form.rate,
        cgst: form.cgst,
        sgst: form.sgst,
        igst: form.igst,
        sort_order: form.sort_order,
        is_active: form.is_active,
      }
      if (editId) {
        await api.patch(`/gst/${editId}`, payload)
        setStatus('GST updated.')
      } else {
        await api.post('/gst', { ...payload, code: form.code.trim().toUpperCase() })
        setStatus('GST created.')
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
    if (!confirm('Deactivate this GST rate? Products can no longer pick it until you reactivate.')) return
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await api.delete(`/gst/${editId}`)
      setStatus('GST deactivated.')
      await load()
      reset()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Deactivate failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="master-page">
      <h2>GST Creation</h2>
      <p className="hint">
        Tax slabs used on products and bills. CGST and SGST default to half of the rate; IGST
        defaults to the full rate. Deactivated rates stay in this list so you can reactivate them.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="hint">{status}</p>}

      <div className="master-grid">
        <aside className="master-list">
          <input
            className="input"
            placeholder="Search GST…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="master-list-toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={reset}>
              + New GST
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
            {pager.pageRows.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`master-list-item${editId === g.id ? ' active' : ''}`}
                onClick={() => select(g)}
              >
                <strong>{g.code || '—'}</strong>
                <span>{g.name || `${num(g.rate)}%`}</span>
                <small>
                  {num(g.rate)}%
                  {g.is_active === false ? ' · Inactive' : ''}
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
            <div className="settings-field-row">
              <label className="settings-field">
                <span>Rate % *</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </label>
              <label className="settings-field">
                <span>Sort Order</span>
                <input
                  className="input"
                  type="number"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sort_order: Number(e.target.value) || 0 }))
                  }
                />
              </label>
            </div>
            <div className="settings-field-row">
              <label className="settings-field">
                <span>CGST %</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.cgst}
                  onChange={(e) => setForm((f) => ({ ...f, cgst: Number(e.target.value) || 0 }))}
                />
              </label>
              <label className="settings-field">
                <span>SGST %</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.sgst}
                  onChange={(e) => setForm((f) => ({ ...f, sgst: Number(e.target.value) || 0 }))}
                />
              </label>
              <label className="settings-field">
                <span>IGST %</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.igst}
                  onChange={(e) => setForm((f) => ({ ...f, igst: Number(e.target.value) || 0 }))}
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
