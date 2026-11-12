import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import type { MasterMode } from '../masters/ActionSelectMaster'
import { apiDelete, errMsg, useOptions } from '../shared/hmsShared'

type Member = { id: string; code?: string | null; name: string; is_bundle?: boolean }
type Profile = {
  id: string
  code?: string | null
  name: string
  price: number | string
  sub_category_id?: string | null
  sub_category_name?: string | null
  members: Member[]
}
type LabTest = { id: string; code?: string | null; name: string; is_profile?: boolean }
type Mapping = {
  id: string
  service_id: string
  service_code?: string | null
  service_name?: string | null
  parameter_id: string
  parameter_code?: string | null
  parameter_name?: string | null
  sort_order: number
  is_required: boolean
}

type Form = { name: string; price: string; sub_category_id: string; member_test_ids: string[] }
const emptyForm = (): Form => ({ name: '', price: '0', sub_category_id: '', member_test_ids: [] })

/**
 * Test Profile / Panel (parameter_mapping)
 *  - /hospital/pathology/profiles            (profile = billable panel + member tests)
 *  - /hospital/pathology/service-parameters  (raw service -> parameter mapping)
 */
export function ParameterMappingPage() {
  const [mode, setMode] = useState<MasterMode>('Create')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [tests, setTests] = useState<LabTest[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState<Form>(emptyForm())
  const [memberFilter, setMemberFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // service -> parameter mapping
  const [mapService, setMapService] = useState('')
  const [mapParam, setMapParam] = useState('')
  const [mapSort, setMapSort] = useState('0')
  const [mapRequired, setMapRequired] = useState(true)
  const [mappings, setMappings] = useState<Mapping[]>([])

  const subs = useOptions<{ id: string; name: string; category_code?: string | null }>(
    '/hospital/service-sub-categories',
    (s) => ({ value: s.id, label: s.name }),
    undefined,
    (s) => !s.category_code || s.category_code === 'LAB',
  )
  const services = useOptions<{ id: string; code?: string; name: string }>(
    '/hospital/pathology/lab-services',
    (s) => ({ value: s.id, label: `${s.code || ''} — ${s.name}` }),
  )
  const params = useOptions<{ id: string; code?: string; name: string }>(
    '/hospital/pathology/parameters',
    (p) => ({ value: p.id, label: `${p.code || ''} — ${p.name}` }),
  )

  async function load() {
    const [p, t] = await Promise.all([
      api.get<Profile[]>('/hospital/pathology/profiles'),
      api.get<LabTest[]>('/hospital/pathology/lab-tests'),
    ])
    setProfiles(p || [])
    setTests((t || []).filter((x) => !x.is_profile))
  }

  async function loadMappings(serviceId: string) {
    if (!serviceId) {
      setMappings([])
      return
    }
    setMappings(await api.get<Mapping[]>('/hospital/pathology/service-parameters', { service_id: serviceId }))
  }

  useEffect(() => {
    void load().catch((e) => setError(errMsg(e)))
  }, [])

  useEffect(() => {
    void loadMappings(mapService).catch((e) => setError(errMsg(e)))
  }, [mapService])

  const selected = useMemo(() => profiles.find((p) => p.id === selectedId) || null, [profiles, selectedId])

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
      sub_category_id: selected.sub_category_id || '',
      member_test_ids: (selected.members || []).map((m) => m.id),
    })
  }, [selectedId, mode])

  function toggleMember(id: string) {
    setForm((p) => ({
      ...p,
      member_test_ids: p.member_test_ids.includes(id)
        ? p.member_test_ids.filter((x) => x !== id)
        : [...p.member_test_ids, id],
    }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    const body = {
      name: form.name.trim(),
      price: Number(form.price) || 0,
      sub_category_id: form.sub_category_id || null,
      member_test_ids: form.member_test_ids,
    }
    try {
      if (mode === 'Create') {
        await api.post('/hospital/pathology/profiles', body)
        setOk('Profile created')
        setForm(emptyForm())
      } else if (mode === 'Modify') {
        if (!selectedId) throw new Error('Select a profile')
        await api.put(`/hospital/pathology/profiles/${selectedId}`, body)
        setOk('Profile updated')
      } else {
        if (!selectedId) throw new Error('Select a profile')
        if (!window.confirm(`Delete profile "${selected?.name}"?`)) return
        await apiDelete(`/hospital/pathology/profiles/${selectedId}`)
        setOk('Profile deleted')
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

  async function addMapping() {
    setError(null)
    try {
      await api.post('/hospital/pathology/service-parameters', {
        service_id: mapService,
        parameter_id: mapParam,
        sort_order: Number(mapSort) || 0,
        is_required: mapRequired,
      })
      await loadMappings(mapService)
    } catch (err) {
      setError(errMsg(err))
    }
  }

  async function removeMapping(id: string) {
    setError(null)
    try {
      await apiDelete(`/hospital/pathology/service-parameters/${id}`)
      await loadMappings(mapService)
    } catch (err) {
      setError(errMsg(err))
    }
  }

  const ro = mode === 'Delete'
  const visibleTests = tests.filter((t) =>
    `${t.code || ''} ${t.name}`.toLowerCase().includes(memberFilter.trim().toLowerCase()),
  )

  return (
    <div className="hms-page">
      <h1>Test Profile / Panel</h1>
      <div className="hint">Group lab tests into a billable profile, and map parameters to a lab service.</div>
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
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code ? `${p.code} — ` : ''}
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <form className="hms-box" onSubmit={onSubmit}>
        <div className="hms-box-title">Profile Details</div>
        <div className="hms-grid hms-grid-3" style={{ marginTop: 4 }}>
          <div className="hms-field-wrap">
            <label>Profile Name *</label>
            <input className="hms-field" required={!ro} readOnly={ro} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="hms-field-wrap">
            <label>Price</label>
            <input className="hms-field" type="number" min={0} step="0.01" readOnly={ro} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </div>
          <div className="hms-field-wrap">
            <label>Sub Category</label>
            <select className="hms-field" disabled={ro} value={form.sub_category_id} onChange={(e) => setForm({ ...form, sub_category_id: e.target.value })}>
              <option value="">—</option>
              {subs.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="hms-box" style={{ marginTop: 14 }}>
          <div className="hms-box-title">Member Tests ({form.member_test_ids.length} selected)</div>
          <input
            className="hms-field"
            style={{ marginTop: 4, marginBottom: 6, maxWidth: 320 }}
            placeholder="Filter tests…"
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
          />
          <div className="hms-table-wrap" style={{ maxHeight: 240 }}>
            <table className="hms-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>Code</th>
                  <th>Test</th>
                </tr>
              </thead>
              <tbody>
                {visibleTests.map((t) => (
                  <tr key={t.id} onClick={() => !ro && toggleMember(t.id)}>
                    <td>
                      <input type="checkbox" disabled={ro} checked={form.member_test_ids.includes(t.id)} onChange={() => toggleMember(t.id)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    <td>{t.code}</td>
                    <td>{t.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="hms-actions">
          <button className={`hms-btn ${mode === 'Delete' ? 'hms-btn-danger' : 'hms-btn-primary'}`} type="submit" disabled={busy}>
            {busy ? '…' : mode === 'Create' ? 'Save' : mode === 'Modify' ? 'Update' : 'Delete'}
          </button>
          <button className="hms-btn" type="button" onClick={() => { setMode('Create'); setForm(emptyForm()); setSelectedId('') }}>
            Clear
          </button>
        </div>
      </form>

      <div className="hms-table-wrap" style={{ marginBottom: 12 }}>
        <table className="hms-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Profile</th>
              <th>Sub Category</th>
              <th style={{ textAlign: 'right' }}>Price</th>
              <th>Members</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr
                key={p.id}
                className={p.id === selectedId ? 'active' : ''}
                onClick={() => {
                  setSelectedId(p.id)
                  if (mode === 'Create') setMode('Modify')
                }}
              >
                <td>{p.code}</td>
                <td>{p.name}</td>
                <td>{p.sub_category_name}</td>
                <td style={{ textAlign: 'right' }}>{Number(p.price).toFixed(2)}</td>
                <td>{(p.members || []).map((m) => m.name).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="hms-box" style={{ marginTop: 16 }}>
        <div className="hms-box-title">Service → Parameter Mapping</div>
        <div className="hms-grid hms-grid-4" style={{ marginTop: 4 }}>
          <div className="hms-field-wrap">
            <label>Lab Service</label>
            <select className="hms-field" value={mapService} onChange={(e) => setMapService(e.target.value)}>
              <option value="">—</option>
              {services.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Parameter</label>
            <select className="hms-field" value={mapParam} onChange={(e) => setMapParam(e.target.value)}>
              <option value="">—</option>
              {params.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Sort Order</label>
            <input className="hms-field" type="number" value={mapSort} onChange={(e) => setMapSort(e.target.value)} />
          </div>
          <div className="hms-field-wrap">
            <label>Required</label>
            <input type="checkbox" checked={mapRequired} onChange={(e) => setMapRequired(e.target.checked)} />
          </div>
        </div>
        <div className="hms-actions">
          <button className="hms-btn hms-btn-primary" type="button" disabled={!mapService || !mapParam} onClick={() => void addMapping()}>
            Add Mapping
          </button>
        </div>
        <div className="hms-table-wrap" style={{ marginTop: 8, maxHeight: 220 }}>
          <table className="hms-table">
            <thead>
              <tr>
                <th>Parameter Code</th>
                <th>Parameter</th>
                <th>Sort</th>
                <th>Required</th>
                <th style={{ width: 70 }} />
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.id} style={{ cursor: 'default' }}>
                  <td>{m.parameter_code}</td>
                  <td>{m.parameter_name}</td>
                  <td>{m.sort_order}</td>
                  <td>{m.is_required ? 'Yes' : 'No'}</td>
                  <td>
                    <button className="hms-btn hms-btn-danger" type="button" onClick={() => void removeMapping(m.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {!mappings.length && (
                <tr style={{ cursor: 'default' }}>
                  <td colSpan={5} style={{ color: '#64748b' }}>{mapService ? 'No mappings' : 'Select a lab service'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
