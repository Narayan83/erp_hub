import { FormEvent, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { Banner, FieldWrap } from '../shared/hmsKit'
import { errMsg, unwrapList } from '../shared/hmsShared'
import { PatientRecordPanel, RecordPatient } from './PatientRecordPanel'

type Hit = RecordPatient & { mobile?: string | null; phone?: string | null; gender?: string; age?: string | null }

const FIELDS: Array<{ key: string; label: string }> = [
  { key: 'patient_no', label: 'Patient No' },
  { key: 'first_name', label: 'First Name' },
  { key: 'middle_name', label: 'Middle Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'village', label: 'Village' },
  { key: 'taluk', label: 'Taluk' },
  { key: 'district', label: 'District' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'aadhar_no', label: 'Aadhar No' },
  { key: 'old_id', label: 'Old Id' },
]

/** Patient History Search — multi-field patient search, then bills + scanned documents. */
export function PatientHistorySearchPage() {
  const [form, setForm] = useState<Record<string, string>>({})
  const [hits, setHits] = useState<Hit[]>([])
  const [selected, setSelected] = useState<RecordPatient | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)

  async function search(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSelected(null)
    try {
      const params: Record<string, string | number> = { page: 1, page_size: 50 }
      for (const f of FIELDS) if (form[f.key]?.trim()) params[f.key] = form[f.key].trim()
      setHits(unwrapList<Hit>(await api.get<unknown>('/hospital/patients/search', params)))
      setSearched(true)
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>Patient History Search</h1>
      <Banner error={error} />
      <form className="hms-box" onSubmit={search}>
        <div className="hms-box-title">Search</div>
        <div className="hms-grid hms-grid-4" style={{ marginTop: 4 }}>
          {FIELDS.map((f) => (
            <FieldWrap key={f.key} label={f.label}>
              <input
                className="hms-field"
                value={form[f.key] || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </FieldWrap>
          ))}
        </div>
        <div className="hms-actions">
          <button className="hms-btn hms-btn-primary" type="submit" disabled={busy}>
            {busy ? '…' : 'Search'}
          </button>
          <button
            className="hms-btn"
            type="button"
            onClick={() => {
              setForm({})
              setHits([])
              setSelected(null)
              setSearched(false)
            }}
          >
            Clear
          </button>
        </div>
      </form>

      <div className="hms-table-wrap" style={{ maxHeight: 260 }}>
        <table className="hms-table">
          <thead>
            <tr>
              <th>Patient No</th>
              <th>Name</th>
              <th>Gender</th>
              <th>Age</th>
              <th>Mobile</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((p) => (
              <tr key={p.id} className={selected?.id === p.id ? 'active' : ''} onClick={() => setSelected(p)}>
                <td>{p.patient_no}</td>
                <td>{p.full_name}</td>
                <td>{p.gender}</td>
                <td>{p.age}</td>
                <td>{p.mobile || p.phone}</td>
              </tr>
            ))}
            {searched && !hits.length && (
              <tr>
                <td colSpan={5}>No patients found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && <PatientRecordPanel key={selected.id} patient={selected} />}
    </div>
  )
}
