import { FormEvent, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { listAll } from './billing/paged'
import { PatientLookup } from './billing/PatientLookup'
import { openHospitalReport } from './billing/report'
import { Admission, Doctor, Patient, todayIso } from './billing/types'

type Summary = {
  id: string
  summary_no: string
  summary_date: string
  patient_id: string
  admission_id?: string | null
  doctor_id: string
  admission_date: string
  discharge_date: string
  condition_on_discharge?: string | null
  chief_complaint?: string | null
  history_of_illness?: string | null
  diagnosis_on_admission?: string | null
  final_diagnosis?: string | null
  investigation?: string | null
  treatment_given?: string | null
  procedures?: string | null
  medications_on_discharge?: string | null
  advice_follow_up?: string | null
  remarks?: string | null
}

const CLINICAL: Array<{ key: keyof Summary; label: string }> = [
  { key: 'chief_complaint', label: 'Chief Complaint' },
  { key: 'history_of_illness', label: 'History of Illness' },
  { key: 'diagnosis_on_admission', label: 'Diagnosis on Admission' },
  { key: 'final_diagnosis', label: 'Final Diagnosis' },
  { key: 'investigation', label: 'Investigation' },
  { key: 'treatment_given', label: 'Treatment Given' },
  { key: 'procedures', label: 'Procedures' },
  { key: 'medications_on_discharge', label: 'Medications on Discharge' },
  { key: 'advice_follow_up', label: 'Advice / Follow-up' },
  { key: 'remarks', label: 'Remarks' },
]

export function DischargeSummaryPage() {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [admissions, setAdmissions] = useState<Admission[]>([])
  const [includeAdmission, setIncludeAdmission] = useState(true)
  const [admissionId, setAdmissionId] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [summaryDate, setSummaryDate] = useState(todayIso())
  const [admissionDate, setAdmissionDate] = useState(todayIso())
  const [dischargeDate, setDischargeDate] = useState(todayIso())
  const [condition, setCondition] = useState('Stable')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [savedId, setSavedId] = useState<string | null>(null)
  const [summaryNo, setSummaryNo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void listAll<Doctor>('/hospital/doctors').then((docs) => {
      setDoctors(docs)
      if (docs[0]) setDoctorId(docs[0].id)
    })
  }, [])

  async function onPatient(p: Patient) {
    setPatient(p)
    const list = await api.get<Admission[]>('/hospital/ipd-admissions', {
      status: 'discharged',
      patient_id: p.id,
    })
    setAdmissions(list || [])
    if (list?.[0]) {
      setAdmissionId(list[0].id)
      setAdmissionDate(String(list[0].admission_date).slice(0, 10))
      if (list[0].doctor_id) setDoctorId(list[0].doctor_id)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!patient) return setError('Select patient')
    if (!doctorId) return setError('Doctor is required')
    if (includeAdmission && !admissionId) return setError('Select admission details')
    const hasClinical = CLINICAL.some((c) => (fields[c.key] || '').trim())
    if (!hasClinical) return setError('Enter at least one clinical detail')

    const payload = {
      patient_id: patient.id,
      include_admission_details: includeAdmission,
      admission_id: includeAdmission ? admissionId : null,
      doctor_id: doctorId,
      summary_date: summaryDate,
      admission_date: admissionDate,
      discharge_date: dischargeDate,
      condition_on_discharge: condition || null,
      ...Object.fromEntries(CLINICAL.map((c) => [c.key, fields[c.key] || null])),
    }

    setBusy(true)
    try {
      const saved = await api.post<Summary>('/hospital/ipd-discharge-summaries', payload)
      setSavedId(saved.id)
      setSummaryNo(saved.summary_no)
      try {
        await openHospitalReport(`/hospital/reports/discharge-summary/${saved.id}/html`)
      } catch {
        /* optional */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="erp-card">
      <h1 className="h4 mb-3">Discharge Summary</h1>
      {error && <div className="alert alert-danger py-2">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="row g-3 mb-3">
          <div className="col-md-5">
            <PatientLookup onSelect={(p) => void onPatient(p)} />
            <div className="small mt-1">{patient?.full_name || '—'}</div>
          </div>
          <div className="col-md-3">
            <label className="form-label mb-1">Summary No</label>
            <input className="form-control" readOnly value={summaryNo} placeholder="(auto)" />
          </div>
          <div className="col-md-2">
            <label className="form-label mb-1">Summary Date</label>
            <input className="form-control" type="date" value={summaryDate} onChange={(e) => setSummaryDate(e.target.value)} />
          </div>
          <div className="col-md-2 d-flex align-items-end">
            <div className="form-check">
              <input
                className="form-check-input"
                type="checkbox"
                checked={includeAdmission}
                onChange={(e) => setIncludeAdmission(e.target.checked)}
                id="incAdm"
              />
              <label className="form-check-label" htmlFor="incAdm">
                Include admission
              </label>
            </div>
          </div>
          {includeAdmission && (
            <div className="col-md-4">
              <label className="form-label mb-1">Admission</label>
              <select className="form-select" value={admissionId} onChange={(e) => setAdmissionId(e.target.value)}>
                <option value="">Select discharged admission</option>
                {admissions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.admission_no} — {a.ward_name || ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="col-md-3">
            <label className="form-label mb-1">Admission Date</label>
            <input className="form-control" type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />
          </div>
          <div className="col-md-3">
            <label className="form-label mb-1">Discharge Date</label>
            <input className="form-control" type="date" value={dischargeDate} onChange={(e) => setDischargeDate(e.target.value)} />
          </div>
          <div className="col-md-3">
            <label className="form-label mb-1">Doctor *</label>
            <select className="form-select" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">Select</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label mb-1">Condition on Discharge</label>
            <select className="form-select" value={condition} onChange={(e) => setCondition(e.target.value)}>
              {['Stable', 'Improved', 'AMA', 'Referred', 'Expired'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <table className="table table-sm">
          <thead>
            <tr>
              <th style={{ width: '28%' }}>Particulars</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {CLINICAL.map((c) => (
              <tr key={c.key}>
                <td>{c.label}</td>
                <td>
                  <textarea
                    className="form-control form-control-sm"
                    rows={2}
                    value={fields[c.key] || ''}
                    onChange={(e) => setFields((prev) => ({ ...prev, [c.key]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="d-flex gap-2">
          <button className="btn btn-erp" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save Summary'}
          </button>
          {savedId && (
            <button
              className="btn btn-outline-secondary"
              type="button"
              onClick={() => void openHospitalReport(`/hospital/reports/discharge-summary/${savedId}/html`)}
            >
              Print
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
