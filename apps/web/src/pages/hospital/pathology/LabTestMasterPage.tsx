import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import type { MasterMode } from '../masters/ActionSelectMaster'
import { apiDelete, errMsg, GENDER_OPTIONS, useOptions } from '../shared/hmsShared'

type RangeRow = {
  gender: string
  age_from: number | string
  age_to: number | string
  age_unit: string
  low: number | string | null
  high: number | string | null
  text_range: string | null
}

type LabTest = {
  id: string
  code?: string | null
  name: string
  price: number | string
  unit_id?: string | null
  unit_name?: string | null
  result_type: string
  method?: string | null
  sub_category_id?: string | null
  sub_category_name?: string | null
  is_profile?: boolean
  ranges: RangeRow[]
}

type Form = {
  name: string
  price: string
  unit_id: string
  result_type: string
  method: string
  sub_category_id: string
  ranges: RangeRow[]
}

const emptyRange = (): RangeRow => ({
  gender: 'A',
  age_from: 0,
  age_to: 120,
  age_unit: 'years',
  low: '',
  high: '',
  text_range: '',
})

const emptyForm = (): Form => ({
  name: '',
  price: '0',
  unit_id: '',
  result_type: 'numeric',
  method: '',
  sub_category_id: '',
  ranges: [],
})

const numOrNull = (v: unknown) => (v === '' || v == null ? null : Number(v))

/** Lab Test Master (service_creation_pathology) — /hospital/pathology/lab-tests */
export function LabTestMasterPage() {
  const [mode, setMode] = useState<MasterMode>('Create')
  const [rows, setRows] = useState<LabTest[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState<Form>(emptyForm())
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const units = useOptions<{ id: string; name: string }>('/hospital/pathology/units', (u) => ({
    value: u.id,
    label: u.name,
  }))
  const subs = useOptions<{ id: string; name: string; category_code?: string | null }>(
    '/hospital/service-sub-categories',
    (s) => ({ value: s.id, label: s.name }),
    undefined,
    (s) => !s.category_code || s.category_code === 'LAB',
  )

  async function load() {
    const data = await api.get<LabTest[]>('/hospital/pathology/lab-tests')
    setRows((data || []).filter((t) => !t.is_profile))
  }

  useEffect(() => {
    void load().catch((e) => setError(errMsg(e)))
  }, [])

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) || null, [rows, selectedId])

  useEffect(() => {
    if (mode === 'Create') {
      setSelectedId('')
      setForm(emptyForm())
    }
  }, [mode])

  useEffect(() => {
    if (!selected || mode === 'Create') return
    setForm({
      name: selected.name,
      price: String(selected.price ?? 0),
      unit_id: selected.unit_id || '',
      result_type: selected.result_type || 'numeric',
      method: selected.method || '',
      sub_category_id: selected.sub_category_id || '',
      ranges: (selected.ranges || []).map((r) => ({
        ...r,
        low: r.low ?? '',
        high: r.high ?? '',
        text_range: r.text_range ?? '',
      })),
    })
  }, [selectedId, mode])

  function setF<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((p) => ({ ...p, [key]: value }))
  }

  function setRange(i: number, patch: Partial<RangeRow>) {
    setForm((p) => ({
      ...p,
      ranges: p.ranges.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    }))
  }

  function payload() {
    return {
      name: form.name.trim(),
      price: Number(form.price) || 0,
      unit_id: form.unit_id || null,
      result_type: form.result_type,
      method: form.method.trim() || null,
      sub_category_id: form.sub_category_id || null,
      ranges:
        form.result_type === 'numeric' || form.ranges.length
          ? form.ranges.map((r) => ({
              gender: r.gender || 'A',
              age_from: Number(r.age_from) || 0,
              age_to: Number(r.age_to) || 0,
              age_unit: r.age_unit || 'years',
              low: numOrNull(r.low),
              high: numOrNull(r.high),
              text_range: (r.text_range || '').toString().trim() || null,
            }))
          : [],
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      if (mode === 'Create') {
        await api.post('/hospital/pathology/lab-tests', payload())
        setOk('Lab test created')
        setForm(emptyForm())
      } else if (mode === 'Modify') {
        if (!selectedId) throw new Error('Select a lab test')
        await api.put(`/hospital/pathology/lab-tests/${selectedId}`, payload())
        setOk('Lab test updated')
      } else {
        if (!selectedId) throw new Error('Select a lab test')
        if (!window.confirm(`Delete lab test "${selected?.name}"?`)) return
        await apiDelete(`/hospital/pathology/lab-tests/${selectedId}`)
        setOk('Lab test deleted')
        setSelectedId('')
        setMode('Create')
      }
      await load()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const ro = mode === 'Delete'

  return (
    <div className="hms-page">
      <h1>Lab Test Master</h1>
      <div className="hint">Billable lab tests with unit, result type and reference ranges.</div>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}

      <div className="hms-toolbar">
        <label>Action</label>
        <select className="hms-field" style={{ width: 160 }} value={mode} onChange={(e) => setMode(e.target.value as MasterMode)}>
          <option>Create</option>
          <option>Modify</option>
          <option>Delete</option>
        </select>
        <label>Select</label>
        <select
          className="hms-field"
          style={{ minWidth: 320 }}
          disabled={mode === 'Create'}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">—</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code ? `${r.code} — ` : ''}
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <form className="hms-box" onSubmit={onSubmit}>
        <div className="hms-box-title">Test Details</div>
        <div className="hms-grid hms-grid-3" style={{ marginTop: 4 }}>
          <div className="hms-field-wrap">
            <label>Test Name *</label>
            <input className="hms-field" required={!ro} readOnly={ro} value={form.name} onChange={(e) => setF('name', e.target.value)} />
          </div>
          <div className="hms-field-wrap">
            <label>Price</label>
            <input className="hms-field" type="number" min={0} step="0.01" readOnly={ro} value={form.price} onChange={(e) => setF('price', e.target.value)} />
          </div>
          <div className="hms-field-wrap">
            <label>Unit</label>
            <select className="hms-field" disabled={ro} value={form.unit_id} onChange={(e) => setF('unit_id', e.target.value)}>
              <option value="">—</option>
              {units.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Result Type</label>
            <select className="hms-field" disabled={ro} value={form.result_type} onChange={(e) => setF('result_type', e.target.value)}>
              <option value="numeric">Numeric</option>
              <option value="text">Text</option>
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Method</label>
            <input className="hms-field" readOnly={ro} value={form.method} onChange={(e) => setF('method', e.target.value)} />
          </div>
          <div className="hms-field-wrap">
            <label>Sub Category</label>
            <select className="hms-field" disabled={ro} value={form.sub_category_id} onChange={(e) => setF('sub_category_id', e.target.value)}>
              <option value="">—</option>
              {subs.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="hms-box" style={{ marginTop: 14 }}>
          <div className="hms-box-title">Reference Ranges</div>
          <table className="hms-table" style={{ marginTop: 4 }}>
            <thead>
              <tr>
                <th>Gender</th>
                <th>Age From</th>
                <th>Age To</th>
                <th>Age Unit</th>
                <th>Low</th>
                <th>High</th>
                <th>Text Range</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {form.ranges.map((r, i) => (
                <tr key={i} style={{ cursor: 'default' }}>
                  <td>
                    <select className="hms-field" disabled={ro} value={r.gender} onChange={(e) => setRange(i, { gender: e.target.value })}>
                      {GENDER_OPTIONS.map((g) => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                      ))}
                    </select>
                  </td>
                  <td><input className="hms-field" type="number" min={0} readOnly={ro} value={r.age_from} onChange={(e) => setRange(i, { age_from: e.target.value })} /></td>
                  <td><input className="hms-field" type="number" min={0} readOnly={ro} value={r.age_to} onChange={(e) => setRange(i, { age_to: e.target.value })} /></td>
                  <td>
                    <select className="hms-field" disabled={ro} value={r.age_unit} onChange={(e) => setRange(i, { age_unit: e.target.value })}>
                      <option value="days">Days</option>
                      <option value="weeks">Weeks</option>
                      <option value="months">Months</option>
                      <option value="years">Years</option>
                    </select>
                  </td>
                  <td><input className="hms-field" type="number" step="any" readOnly={ro} value={r.low ?? ''} onChange={(e) => setRange(i, { low: e.target.value })} /></td>
                  <td><input className="hms-field" type="number" step="any" readOnly={ro} value={r.high ?? ''} onChange={(e) => setRange(i, { high: e.target.value })} /></td>
                  <td><input className="hms-field" readOnly={ro} value={r.text_range ?? ''} onChange={(e) => setRange(i, { text_range: e.target.value })} /></td>
                  <td>
                    <button
                      type="button"
                      className="hms-btn"
                      disabled={ro}
                      onClick={() => setForm((p) => ({ ...p, ranges: p.ranges.filter((_, idx) => idx !== i) }))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {!form.ranges.length && (
                <tr style={{ cursor: 'default' }}>
                  <td colSpan={8} style={{ color: '#64748b' }}>No ranges</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="hms-actions">
            <button type="button" className="hms-btn" disabled={ro} onClick={() => setForm((p) => ({ ...p, ranges: [...p.ranges, emptyRange()] }))}>
              + Add Range
            </button>
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
              setMode('Create')
              setForm(emptyForm())
              setSelectedId('')
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
              <th>Code</th>
              <th>Name</th>
              <th>Unit</th>
              <th>Type</th>
              <th>Method</th>
              <th>Sub Category</th>
              <th style={{ textAlign: 'right' }}>Price</th>
              <th>Ranges</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={r.id === selectedId ? 'active' : ''}
                onClick={() => {
                  setSelectedId(r.id)
                  if (mode === 'Create') setMode('Modify')
                }}
              >
                <td>{r.code}</td>
                <td>{r.name}</td>
                <td>{r.unit_name}</td>
                <td>{r.result_type}</td>
                <td>{r.method}</td>
                <td>{r.sub_category_name}</td>
                <td style={{ textAlign: 'right' }}>{Number(r.price).toFixed(2)}</td>
                <td>{r.ranges?.length || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
