import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import './billing/hms-master.css'

type Mode = 'Create' | 'Modify' | 'Delete'
type Dept = { id: string; code: string; name: string }
type Doctor = {
  id: string
  doctor_code: string
  title?: string | null
  first_name: string
  second_name?: string | null
  third_name?: string | null
  full_name: string
  date_of_birth?: string | null
  sex?: string | null
  perm_village?: string | null
  perm_post?: string | null
  perm_taluk?: string | null
  perm_district?: string | null
  perm_pincode?: string | null
  temp_village?: string | null
  temp_post?: string | null
  temp_taluk?: string | null
  temp_district?: string | null
  temp_pincode?: string | null
  is_reference_doctor: boolean
  remarks?: string | null
  phone?: string | null
  mobile?: string | null
  mobile2?: string | null
  join_date?: string | null
  qualification?: string | null
  department_id?: string | null
  is_existing: boolean
  release_date?: string | null
  register_no?: string | null
  morning_token_start: number
  evening_token_start: number
  appointment_token_start: number
  appointment_token_end: number
  online_booking_token_start: number
  online_booking_token_end: number
  is_pathology_doctor: boolean
  email?: string | null
  specialization?: string | null
}

type Page = { items: Doctor[] }

const EMPTY = {
  title: 'Dr',
  first_name: '',
  second_name: '',
  third_name: '',
  date_of_birth: '',
  sex: 'M',
  perm_village: '',
  perm_post: '',
  perm_taluk: '',
  perm_district: '',
  perm_pincode: '',
  temp_village: '',
  temp_post: '',
  temp_taluk: '',
  temp_district: '',
  temp_pincode: '',
  is_reference_doctor: false,
  remarks: '',
  phone: '',
  mobile: '',
  mobile2: '',
  join_date: '',
  qualification: '',
  department_id: '',
  is_existing: true,
  release_date: '',
  register_no: '',
  morning_token_start: 0,
  evening_token_start: 0,
  appointment_token_start: 1,
  appointment_token_end: 5,
  online_booking_token_start: 1,
  online_booking_token_end: 10,
  is_pathology_doctor: false,
  email: '',
  specialization: '',
}

export function DoctorMasterPage() {
  const [mode, setMode] = useState<Mode>('Create')
  const [depts, setDepts] = useState<Dept[]>([])
  const [rows, setRows] = useState<Doctor[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [doctorCode, setDoctorCode] = useState('')
  const [form, setForm] = useState({ ...EMPTY })
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const [d, docs] = await Promise.all([
      api.get<Dept[]>('/hospital/departments'),
      api.get<Page>('/hospital/doctors', { page: 1, page_size: 200 }),
    ])
    setDepts(d)
    setRows(docs.items || [])
  }

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [])

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) || null, [rows, selectedId])

  useEffect(() => {
    if (mode === 'Create') {
      setSelectedId('')
      setDoctorCode('')
      setForm({ ...EMPTY })
      return
    }
    if (!selected) return
    setDoctorCode(selected.doctor_code)
    setForm({
      title: selected.title || 'Dr',
      first_name: selected.first_name || '',
      second_name: selected.second_name || '',
      third_name: selected.third_name || '',
      date_of_birth: selected.date_of_birth || '',
      sex: selected.sex || 'M',
      perm_village: selected.perm_village || '',
      perm_post: selected.perm_post || '',
      perm_taluk: selected.perm_taluk || '',
      perm_district: selected.perm_district || '',
      perm_pincode: selected.perm_pincode || '',
      temp_village: selected.temp_village || '',
      temp_post: selected.temp_post || '',
      temp_taluk: selected.temp_taluk || '',
      temp_district: selected.temp_district || '',
      temp_pincode: selected.temp_pincode || '',
      is_reference_doctor: Boolean(selected.is_reference_doctor),
      remarks: selected.remarks || '',
      phone: selected.phone || '',
      mobile: selected.mobile || '',
      mobile2: selected.mobile2 || '',
      join_date: selected.join_date || '',
      qualification: selected.qualification || '',
      department_id: selected.department_id || '',
      is_existing: selected.is_existing !== false,
      release_date: selected.release_date || '',
      register_no: selected.register_no || '',
      morning_token_start: selected.morning_token_start ?? 0,
      evening_token_start: selected.evening_token_start ?? 0,
      appointment_token_start: selected.appointment_token_start ?? 1,
      appointment_token_end: selected.appointment_token_end ?? 5,
      online_booking_token_start: selected.online_booking_token_start ?? 1,
      online_booking_token_end: selected.online_booking_token_end ?? 10,
      is_pathology_doctor: Boolean(selected.is_pathology_doctor),
      email: selected.email || '',
      specialization: selected.specialization || '',
    })
  }, [mode, selectedId, selected])

  function setField(key: string, value: string | number | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    const payload = {
      ...form,
      second_name: form.second_name || null,
      third_name: form.third_name || null,
      date_of_birth: form.date_of_birth || null,
      department_id: form.department_id || null,
      join_date: form.join_date || null,
      release_date: form.release_date || null,
      phone: form.phone || null,
      mobile: form.mobile || null,
      mobile2: form.mobile2 || null,
      email: form.email || null,
      qualification: form.qualification || null,
      specialization: form.specialization || null,
      register_no: form.register_no || null,
      remarks: form.remarks || null,
      perm_village: form.perm_village || null,
      perm_post: form.perm_post || null,
      perm_taluk: form.perm_taluk || null,
      perm_district: form.perm_district || null,
      perm_pincode: form.perm_pincode || null,
      temp_village: form.temp_village || null,
      temp_post: form.temp_post || null,
      temp_taluk: form.temp_taluk || null,
      temp_district: form.temp_district || null,
      temp_pincode: form.temp_pincode || null,
    }
    try {
      if (mode === 'Create') {
        const created = await api.post<Doctor>('/hospital/doctors', payload)
        setOk(`Saved — ${created.doctor_code}`)
        setForm({ ...EMPTY })
        setDoctorCode('')
      } else if (mode === 'Modify') {
        if (!selectedId) throw new Error('Select a doctor')
        await api.patch(`/hospital/doctors/${selectedId}`, payload)
        setOk('Updated')
      } else {
        if (!selectedId) throw new Error('Select a doctor')
        await api.patch(`/hospital/doctors/${selectedId}`, { is_active: false })
        setOk('Deactivated')
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
      <h1>Doctor Master</h1>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}

      <div className="hms-toolbar">
        <label>Action</label>
        <select className="hms-field" style={{ width: 160 }} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="Create">Create Doctor</option>
          <option value="Modify">Modify Doctor</option>
          <option value="Delete">Delete Doctor</option>
        </select>
        <label>Select Doctor</label>
        <select
          className="hms-field"
          style={{ minWidth: 280 }}
          disabled={mode === 'Create'}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">—</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.doctor_code} — {r.full_name}
            </option>
          ))}
        </select>
      </div>

      <form onSubmit={onSubmit}>
        <div className="hms-box">
          <div className="hms-box-title">Doctor ID</div>
          <div className="hms-grid hms-grid-4" style={{ marginTop: 4 }}>
            <div className="hms-field-wrap">
              <label>Code</label>
              <input className="hms-field" readOnly value={doctorCode} placeholder="Generated on Save" />
            </div>
            <div className="hms-field-wrap">
              <label>Title</label>
              <select className="hms-field" disabled={locked} value={form.title} onChange={(e) => setField('title', e.target.value)}>
                {['Dr', 'Mr', 'Mrs', 'Ms', 'Prof'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="hms-field-wrap">
              <label>First Name *</label>
              <input className="hms-field" required={!locked} disabled={locked} value={form.first_name} onChange={(e) => setField('first_name', e.target.value)} />
            </div>
            <div className="hms-field-wrap">
              <label>Second Name</label>
              <input className="hms-field" disabled={locked} value={form.second_name} onChange={(e) => setField('second_name', e.target.value)} />
            </div>
            <div className="hms-field-wrap">
              <label>Third Name</label>
              <input className="hms-field" disabled={locked} value={form.third_name} onChange={(e) => setField('third_name', e.target.value)} />
            </div>
            <div className="hms-field-wrap">
              <label>Date of Birth</label>
              <input className="hms-field" type="date" disabled={locked} value={form.date_of_birth} onChange={(e) => setField('date_of_birth', e.target.value)} />
            </div>
            <div className="hms-field-wrap">
              <label>Sex</label>
              <select className="hms-field" disabled={locked} value={form.sex} onChange={(e) => setField('sex', e.target.value)}>
                <option>M</option>
                <option>F</option>
                <option>O</option>
              </select>
            </div>
            <div className="hms-field-wrap">
              <label>Department</label>
              <select className="hms-field" disabled={locked} value={form.department_id} onChange={(e) => setField('department_id', e.target.value)}>
                <option value="">—</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="hms-grid hms-grid-2">
          <div className="hms-box">
            <div className="hms-box-title">Permanent Address</div>
            <div className="hms-grid hms-grid-2" style={{ marginTop: 4 }}>
              {(
                [
                  ['perm_village', 'Village'],
                  ['perm_post', 'Post'],
                  ['perm_taluk', 'Taluk'],
                  ['perm_district', 'District'],
                  ['perm_pincode', 'Pincode'],
                ] as const
              ).map(([k, label]) => (
                <div className="hms-field-wrap" key={k}>
                  <label>{label}</label>
                  <input className="hms-field" disabled={locked} value={String(form[k])} onChange={(e) => setField(k, e.target.value)} />
                </div>
              ))}
            </div>
          </div>
          <div className="hms-box">
            <div className="hms-box-title">Temporary Address</div>
            <div className="hms-grid hms-grid-2" style={{ marginTop: 4 }}>
              {(
                [
                  ['temp_village', 'Village'],
                  ['temp_post', 'Post'],
                  ['temp_taluk', 'Taluk'],
                  ['temp_district', 'District'],
                  ['temp_pincode', 'Pincode'],
                ] as const
              ).map(([k, label]) => (
                <div className="hms-field-wrap" key={k}>
                  <label>{label}</label>
                  <input className="hms-field" disabled={locked} value={String(form[k])} onChange={(e) => setField(k, e.target.value)} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="hms-box">
          <div className="hms-box-title">Professional / Contact</div>
          <div className="hms-grid hms-grid-4" style={{ marginTop: 4 }}>
            <div className="hms-field-wrap">
              <label>Qualification</label>
              <input className="hms-field" disabled={locked} value={form.qualification} onChange={(e) => setField('qualification', e.target.value)} />
            </div>
            <div className="hms-field-wrap">
              <label>Specialization</label>
              <input className="hms-field" disabled={locked} value={form.specialization} onChange={(e) => setField('specialization', e.target.value)} />
            </div>
            <div className="hms-field-wrap">
              <label>Register No</label>
              <input className="hms-field" disabled={locked} value={form.register_no} onChange={(e) => setField('register_no', e.target.value)} />
            </div>
            <div className="hms-field-wrap">
              <label>Join Date</label>
              <input className="hms-field" type="date" disabled={locked} value={form.join_date} onChange={(e) => setField('join_date', e.target.value)} />
            </div>
            <div className="hms-field-wrap">
              <label>Phone</label>
              <input className="hms-field" disabled={locked} value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
            </div>
            <div className="hms-field-wrap">
              <label>Mobile</label>
              <input className="hms-field" disabled={locked} value={form.mobile} onChange={(e) => setField('mobile', e.target.value)} />
            </div>
            <div className="hms-field-wrap">
              <label>Mobile2</label>
              <input className="hms-field" disabled={locked} value={form.mobile2} onChange={(e) => setField('mobile2', e.target.value)} />
            </div>
            <div className="hms-field-wrap">
              <label>Email</label>
              <input className="hms-field" disabled={locked} value={form.email} onChange={(e) => setField('email', e.target.value)} />
            </div>
            <div className="hms-field-wrap">
              <label>Morning Token Start</label>
              <input className="hms-field" type="number" disabled={locked} value={form.morning_token_start} onChange={(e) => setField('morning_token_start', Number(e.target.value))} />
            </div>
            <div className="hms-field-wrap">
              <label>Evening Token Start</label>
              <input className="hms-field" type="number" disabled={locked} value={form.evening_token_start} onChange={(e) => setField('evening_token_start', Number(e.target.value))} />
            </div>
            <div className="hms-field-wrap">
              <label>Appt Token Start</label>
              <input className="hms-field" type="number" disabled={locked} value={form.appointment_token_start} onChange={(e) => setField('appointment_token_start', Number(e.target.value))} />
            </div>
            <div className="hms-field-wrap">
              <label>Appt Token End</label>
              <input className="hms-field" type="number" disabled={locked} value={form.appointment_token_end} onChange={(e) => setField('appointment_token_end', Number(e.target.value))} />
            </div>
            <div className="hms-field-wrap">
              <label>Reference Doctor</label>
              <input type="checkbox" disabled={locked} checked={form.is_reference_doctor} onChange={(e) => setField('is_reference_doctor', e.target.checked)} />
            </div>
            <div className="hms-field-wrap">
              <label>Pathology Doctor</label>
              <input type="checkbox" disabled={locked} checked={form.is_pathology_doctor} onChange={(e) => setField('is_pathology_doctor', e.target.checked)} />
            </div>
            <div className="hms-field-wrap">
              <label>Existing</label>
              <input type="checkbox" disabled={locked} checked={form.is_existing} onChange={(e) => setField('is_existing', e.target.checked)} />
            </div>
            <div className="hms-field-wrap" style={{ gridColumn: 'span 2' }}>
              <label>Remarks</label>
              <input className="hms-field" disabled={locked} value={form.remarks} onChange={(e) => setField('remarks', e.target.value)} />
            </div>
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
              setForm({ ...EMPTY })
              setDoctorCode('')
              setSelectedId('')
            }}
          >
            Clear
          </button>
        </div>
      </form>

      <div className="hms-table-wrap" style={{ marginTop: 10 }}>
        <table className="hms-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Qualification</th>
              <th>Mobile</th>
              <th>Pathology</th>
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
                <td>{r.doctor_code}</td>
                <td>{r.full_name}</td>
                <td>{r.qualification}</td>
                <td>{r.mobile || r.phone}</td>
                <td>{r.is_pathology_doctor ? 'Y' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
