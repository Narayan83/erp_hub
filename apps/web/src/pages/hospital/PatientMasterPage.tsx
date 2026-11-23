import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import './billing/hms-master.css'

type Mode = 'Create' | 'Modify' | 'Delete'

type Section = { id: string; code: string; name: string }
type Patient = {
  id: string
  patient_no: string
  hospital_section_id?: string | null
  title?: string | null
  first_name: string
  middle_name?: string | null
  last_name?: string | null
  full_name: string
  date_of_birth?: string | null
  age?: string | null
  gender: string
  blood_group?: string | null
  village_code?: string | null
  contact_address1?: string | null
  contact_address2?: string | null
  contact_address3?: string | null
  contact_address4?: string | null
  contact_address5?: string | null
  perm_address1?: string | null
  perm_address2?: string | null
  perm_address3?: string | null
  perm_address4?: string | null
  perm_address5?: string | null
  old_software_id?: string | null
  remarks?: string | null
  phone?: string | null
  mobile?: string | null
  mobile2?: string | null
  scheme?: string | null
  aadhar_no?: string | null
  is_existing_patient: boolean
  patient_type?: string | null
  email?: string | null
  is_active: boolean
}

type Page = { items: Patient[]; total: number }

const TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr', 'Master', 'Baby']
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const PATIENT_TYPES = ['General', 'Insurance', 'Corporate', 'Staff', 'VIP']
const PAGE_SIZE = 20

const EMPTY = {
  title: 'Mr',
  first_name: '',
  middle_name: '',
  last_name: '',
  date_of_birth: '',
  age: '0 Days',
  gender: 'M',
  blood_group: '',
  village_code: '',
  contact_address1: '',
  contact_address2: '',
  contact_address3: '',
  contact_address4: '',
  contact_address5: '',
  perm_address1: '',
  perm_address2: '',
  perm_address3: '',
  perm_address4: '',
  perm_address5: '',
  old_software_id: '',
  remarks: '',
  phone: '',
  mobile: '',
  mobile2: '',
  scheme: '',
  aadhar_no: '',
  is_existing_patient: false,
  patient_type: 'General',
  email: '',
  hospital_section_id: '',
}

function ageFromDob(dob: string): string {
  if (!dob) return '0 Days'
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return '0 Days'
  const today = new Date()
  let years = today.getFullYear() - d.getFullYear()
  const m = today.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) years -= 1
  if (years >= 1) return `${years} Years`
  let months = (today.getFullYear() - d.getFullYear()) * 12 + today.getMonth() - d.getMonth()
  if (today.getDate() < d.getDate()) months -= 1
  if (months >= 1) return `${months} Months`
  const days = Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86400000))
  return `${days} Days`
}

export function PatientMasterPage() {
  const [mode, setMode] = useState<Mode>('Create')
  const [sections, setSections] = useState<Section[]>([])
  const [rows, setRows] = useState<Patient[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [listLoaded, setListLoaded] = useState(false)
  const [listBusy, setListBusy] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ ...EMPTY })
  const [patientNo, setPatientNo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [upperOpen, setUpperOpen] = useState(false)
  const [otherOpen, setOtherOpen] = useState(false)

  async function loadList(opts?: { page?: number; search?: string }) {
    const nextPage = opts?.page ?? page
    const nextSearch = opts?.search ?? search
    setListBusy(true)
    setError(null)
    try {
      const data = await api.get<Page>('/hospital/patients', {
        page: nextPage,
        page_size: PAGE_SIZE,
        search: nextSearch.trim() || undefined,
      })
      setRows(data.items || [])
      setTotal(data.total ?? 0)
      setPage(nextPage)
      setListLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setListBusy(false)
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const secs = await api.get<Section[]>('/hospital/hospital-sections')
        setSections(secs)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) || null,
    [rows, selectedId],
  )
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  useEffect(() => {
    if (mode === 'Create') {
      setSelectedId('')
      setPatientNo('')
      setForm({ ...EMPTY })
      return
    }
    if (!selected) return
    setPatientNo(selected.patient_no)
    setForm({
      title: selected.title || 'Mr',
      first_name: selected.first_name || '',
      middle_name: selected.middle_name || '',
      last_name: selected.last_name || '',
      date_of_birth: selected.date_of_birth || '',
      age: selected.age || '',
      gender: selected.gender || 'M',
      blood_group: selected.blood_group || '',
      village_code: selected.village_code || '',
      contact_address1: selected.contact_address1 || '',
      contact_address2: selected.contact_address2 || '',
      contact_address3: selected.contact_address3 || '',
      contact_address4: selected.contact_address4 || '',
      contact_address5: selected.contact_address5 || '',
      perm_address1: selected.perm_address1 || '',
      perm_address2: selected.perm_address2 || '',
      perm_address3: selected.perm_address3 || '',
      perm_address4: selected.perm_address4 || '',
      perm_address5: selected.perm_address5 || '',
      old_software_id: selected.old_software_id || '',
      remarks: selected.remarks || '',
      phone: selected.phone || '',
      mobile: selected.mobile || '',
      mobile2: selected.mobile2 || '',
      scheme: selected.scheme || '',
      aadhar_no: selected.aadhar_no || '',
      is_existing_patient: Boolean(selected.is_existing_patient),
      patient_type: selected.patient_type || 'General',
      email: selected.email || '',
      hospital_section_id: selected.hospital_section_id || '',
    })
  }, [selectedId, mode, selected])

  function setField<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    const payload = {
      ...form,
      hospital_section_id: form.hospital_section_id || null,
      middle_name: form.middle_name || null,
      last_name: form.last_name || null,
      date_of_birth: form.date_of_birth || null,
      blood_group: form.blood_group || null,
      village_code: form.village_code || null,
      contact_address1: form.contact_address1 || null,
      contact_address2: form.contact_address2 || null,
      contact_address3: form.contact_address3 || null,
      contact_address4: form.contact_address4 || null,
      contact_address5: form.contact_address5 || null,
      perm_address1: form.perm_address1 || null,
      perm_address2: form.perm_address2 || null,
      perm_address3: form.perm_address3 || null,
      perm_address4: form.perm_address4 || null,
      perm_address5: form.perm_address5 || null,
      old_software_id: form.old_software_id || null,
      remarks: form.remarks || null,
      phone: form.phone || null,
      mobile: form.mobile || null,
      mobile2: form.mobile2 || null,
      scheme: form.scheme || null,
      aadhar_no: form.aadhar_no || null,
      email: form.email || null,
      patient_type: form.patient_type || null,
    }
    try {
      if (mode === 'Create') {
        const created = await api.post<Patient>('/hospital/patients', payload)
        setOk(`Saved — Patient No ${created.patient_no}`)
        setForm({ ...EMPTY })
        setPatientNo('')
      } else if (mode === 'Modify') {
        if (!selectedId) throw new Error('Select a patient')
        await api.patch(`/hospital/patients/${selectedId}`, payload)
        setOk('Updated')
      } else {
        if (!selectedId) throw new Error('Select a patient')
        await api.patch(`/hospital/patients/${selectedId}`, { is_active: false })
        setOk('Deactivated')
        setMode('Create')
        setSelectedId('')
      }
      if (listLoaded) await loadList({ page: 1 })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const locked = mode === 'Delete'

  return (
    <div className="hms-page patient-master">
      <div className="hms-toolbar" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, textDecoration: 'underline' }}>
          {mode === 'Create' ? 'New Patient Creation' : 'Patient Master'}
        </h1>
        <div className="hms-toolbar" style={{ margin: 0 }}>
          <label>Hospital Section</label>
          <select
            className="hms-field"
            style={{ width: 200 }}
            disabled={locked}
            value={form.hospital_section_id}
            onChange={(e) => setField('hospital_section_id', e.target.value)}
          >
            <option value="">—</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}

      <div className="hms-collapse">
        <button
          type="button"
          className="hms-collapse-toggle"
          aria-expanded={upperOpen}
          onClick={() => setUpperOpen((v) => !v)}
        >
          <span className={`hms-collapse-chevron${upperOpen ? '' : ' is-closed'}`} aria-hidden />
          Action / Select Patient / Search
          {!upperOpen && mode !== 'Create' && selected && (
            <span style={{ fontWeight: 400, color: 'var(--hms-muted)' }}>
              — {selected.patient_no} {selected.full_name}
            </span>
          )}
        </button>
        {upperOpen && (
          <div className="hms-collapse-body">
            <div className="hms-toolbar" style={{ marginBottom: 0 }}>
              <label>Action</label>
              <select className="hms-field" style={{ width: 140 }} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                <option>Create</option>
                <option>Modify</option>
                <option>Delete</option>
              </select>
              <input
                className="hms-field"
                style={{ width: 220 }}
                placeholder="Search no / name / mobile"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void loadList({ page: 1 })
                  }
                }}
              />
              <label>Select Patient</label>
              <select
                className="hms-field"
                style={{ width: 320 }}
                disabled={mode === 'Create'}
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                <option value="">—</option>
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.patient_no} — {r.full_name}
                  </option>
                ))}
              </select>
              {listLoaded && (
                <>
                  <button
                    className="hms-btn"
                    type="button"
                    disabled={listBusy || page <= 1}
                    onClick={() => void loadList({ page: page - 1 })}
                  >
                    Prev
                  </button>
                  <span style={{ color: 'var(--hms-muted)' }}>
                    Page {page} / {totalPages} · {total} total
                  </span>
                  <button
                    className="hms-btn"
                    type="button"
                    disabled={listBusy || page >= totalPages}
                    onClick={() => void loadList({ page: page + 1 })}
                  >
                    Next
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit}>
        <div className="hms-identity">
          <div className="hms-field-wrap">
            <label>Patient Id</label>
            <input className="hms-field" readOnly value={patientNo} placeholder="Auto on save" />
          </div>
          <div className="hms-field-wrap">
            <label>First Name</label>
            <div className="hms-identity-name">
              <select className="hms-field" disabled={locked} value={form.title} onChange={(e) => setField('title', e.target.value)}>
                {TITLES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <input className="hms-field" required={!locked} disabled={locked} value={form.first_name} onChange={(e) => setField('first_name', e.target.value)} />
            </div>
          </div>
          <div className="hms-field-wrap">
            <label>Second Name</label>
            <input className="hms-field" disabled={locked} value={form.middle_name} onChange={(e) => setField('middle_name', e.target.value)} />
          </div>
          <div className="hms-field-wrap">
            <label>Third Name</label>
            <input className="hms-field" disabled={locked} value={form.last_name} onChange={(e) => setField('last_name', e.target.value)} />
          </div>
          <div className="hms-field-wrap">
            <label>Date of Birth</label>
            <input
              className="hms-field"
              type="date"
              disabled={locked}
              value={form.date_of_birth}
              onChange={(e) => {
                setField('date_of_birth', e.target.value)
                setField('age', ageFromDob(e.target.value))
              }}
            />
          </div>
          <div className="hms-field-wrap">
            <label>Age</label>
            <input className="hms-field" disabled={locked} value={form.age} onChange={(e) => setField('age', e.target.value)} />
          </div>
          <div className="hms-field-wrap">
            <label>Sex</label>
            <select className="hms-field" disabled={locked} value={form.gender} onChange={(e) => setField('gender', e.target.value)}>
              <option>M</option>
              <option>F</option>
              <option>O</option>
              <option>U</option>
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Blood Grp</label>
            <select className="hms-field" disabled={locked} value={form.blood_group} onChange={(e) => setField('blood_group', e.target.value)}>
              <option value="">—</option>
              {BLOOD_GROUPS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="hms-grid hms-grid-2 patient-master-addresses">
          <div className="hms-box">
            <div className="hms-box-title">Contact Address</div>
            <div className="hms-grid hms-grid-2" style={{ marginTop: 4 }}>
              {(
                [
                  ['village_code', 'Village Code'],
                  ['contact_address1', 'Village/Address1'],
                  ['contact_address2', 'Post/Address2'],
                  ['contact_address3', 'Taluk/Address3'],
                  ['contact_address4', 'District/Address4'],
                  ['contact_address5', 'Pin Code'],
                  ['aadhar_no', 'Aadhar No'],
                ] as const
              ).map(([key, label]) => (
                <div className="hms-field-wrap" key={key}>
                  <label>{label}</label>
                  <input className="hms-field" disabled={locked} value={form[key]} onChange={(e) => setField(key, e.target.value)} />
                </div>
              ))}
            </div>
          </div>
          <div className="hms-box">
            <div className="hms-box-title">Additional Address</div>
            <div className="hms-grid hms-grid-2" style={{ marginTop: 4 }}>
              {(
                [
                  ['perm_address1', 'Village/Address1'],
                  ['perm_address2', 'Post/Address2'],
                  ['perm_address3', 'Taluk/Address3'],
                  ['perm_address4', 'District/Address4'],
                  ['perm_address5', 'Pin Code'],
                ] as const
              ).map(([key, label]) => (
                <div className="hms-field-wrap" key={key}>
                  <label>{label}</label>
                  <input className="hms-field" disabled={locked} value={form[key]} onChange={(e) => setField(key, e.target.value)} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="hms-collapse">
          <button
            type="button"
            className="hms-collapse-toggle"
            aria-expanded={otherOpen}
            onClick={() => setOtherOpen((v) => !v)}
          >
            <span className={`hms-collapse-chevron${otherOpen ? '' : ' is-closed'}`} aria-hidden />
            Contact / Other
          </button>
          {otherOpen && (
            <div className="hms-collapse-body">
              <div className="hms-grid hms-grid-4">
                <div className="hms-field-wrap">
                  <label>OLD software Id</label>
                  <input className="hms-field" disabled={locked} value={form.old_software_id} onChange={(e) => setField('old_software_id', e.target.value)} />
                </div>
                <div className="hms-field-wrap">
                  <label>Remarks</label>
                  <input className="hms-field" disabled={locked} value={form.remarks} onChange={(e) => setField('remarks', e.target.value)} />
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
                  <label>Scheme</label>
                  <input className="hms-field" disabled={locked} value={form.scheme} onChange={(e) => setField('scheme', e.target.value)} />
                </div>
                <div className="hms-field-wrap">
                  <label>Existing</label>
                  <select
                    className="hms-field"
                    disabled={locked}
                    value={form.is_existing_patient ? 'Y' : 'N'}
                    onChange={(e) => setField('is_existing_patient', e.target.value === 'Y')}
                  >
                    <option value="Y">Y</option>
                    <option value="N">N</option>
                  </select>
                </div>
                <div className="hms-field-wrap">
                  <label>Patient Type</label>
                  <select className="hms-field" disabled={locked} value={form.patient_type} onChange={(e) => setField('patient_type', e.target.value)}>
                    {PATIENT_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="hms-field-wrap">
                  <label>Email</label>
                  <input className="hms-field" disabled={locked} value={form.email} onChange={(e) => setField('email', e.target.value)} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="hms-actions hms-actions-spread">
          <button
            className={`hms-btn ${mode === 'Delete' ? 'hms-btn-danger' : 'hms-btn-primary'}`}
            type="submit"
            data-save-shortcut
            disabled={busy}
          >
            {busy ? '…' : mode === 'Create' ? 'Save' : mode === 'Modify' ? 'Update' : 'Delete'}
          </button>
          <div className="hms-actions-left">
            <button className="hms-btn" type="button" disabled={listBusy} onClick={() => void loadList({ page: 1 })}>
              {listBusy ? '…' : 'Load'}
            </button>
            <button
              className="hms-btn"
              type="button"
              onClick={() => {
                setMode('Create')
                setForm({ ...EMPTY })
                setPatientNo('')
                setSelectedId('')
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </form>

      <div className="hms-table-wrap" style={{ marginTop: 4 }}>
        <table className="hms-table">
          <thead>
            <tr>
              <th>Patient No</th>
              <th>Name</th>
              <th>Sex</th>
              <th>Age</th>
              <th>Mobile</th>
            </tr>
          </thead>
          <tbody>
            {!listLoaded ? (
              <tr>
                <td colSpan={5} style={{ color: 'var(--hms-muted)' }}>
                  Click Load (below the form) to fetch patients — 20 per page.
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ color: 'var(--hms-muted)' }}>
                  No patients found.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className={r.id === selectedId ? 'active' : ''}
                  onClick={() => {
                    setSelectedId(r.id)
                    if (mode === 'Create') setMode('Modify')
                  }}
                >
                  <td>{r.patient_no}</td>
                  <td>{r.full_name}</td>
                  <td>{r.gender}</td>
                  <td>{r.age}</td>
                  <td>{r.mobile}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
