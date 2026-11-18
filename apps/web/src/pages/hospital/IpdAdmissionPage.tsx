import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { listAll } from './billing/paged'
import { PatientLookup } from './billing/PatientLookup'
import {
  Admission,
  Department,
  Doctor,
  Page,
  Patient,
  Ward,
  money,
  todayIso,
} from './billing/types'

export function IpdAdmissionPage() {
  const navigate = useNavigate()
  const [patient, setPatient] = useState<Patient | null>(null)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [wards, setWards] = useState<Ward[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [rows, setRows] = useState<Admission[]>([])

  const [admissionDate, setAdmissionDate] = useState(todayIso())
  const [wardId, setWardId] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [bedNo, setBedNo] = useState('')
  const [advanceAmount, setAdvanceAmount] = useState('0')
  const [diagnosis, setDiagnosis] = useState('')
  const [remarks, setRemarks] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function loadList() {
    const list = await api.get<Admission[] | Page<Admission>>('/hospital/ipd-admissions')
    setRows(Array.isArray(list) ? list : list.items || [])
  }

  useEffect(() => {
    void (async () => {
      const [docs, w, deps] = await Promise.all([
        listAll<Doctor>('/hospital/doctors'),
        api.get<Ward[]>('/hospital/wards'),
        api.get<Department[]>('/hospital/departments'),
      ])
      setDoctors(docs)
      setWards(w || [])
      setDepartments(deps || [])
      await loadList()
    })().catch((e) => setError(String(e)))
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!patient) {
      setError('Select patient')
      return
    }
    setBusy(true)
    try {
      await api.post('/hospital/ipd-admissions', {
        patient_id: patient.id,
        admission_date: admissionDate,
        ward_id: wardId || null,
        doctor_id: doctorId || null,
        department_id: departmentId || null,
        bed_no: bedNo || null,
        advance_amount: Number(advanceAmount) || 0,
        diagnosis: diagnosis || null,
        remarks: remarks || null,
      })
      setBedNo('')
      setAdvanceAmount('0')
      setDiagnosis('')
      setRemarks('')
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="erp-card">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">IPD Admission</h1>
        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => navigate('/opd_bill')}>
            OPD Bill
          </button>
          <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => navigate('/ipd_bill')}>
            IPD Bill
          </button>
        </div>
      </div>
      {error && <div className="alert alert-danger py-2">{error}</div>}

      <form className="border rounded p-3 mb-3" onSubmit={onSubmit}>
        <div className="row g-2 mb-2">
          <div className="col-md-6">
            <PatientLookup onSelect={setPatient} />
            <div className="small mt-1">
              {patient ? `${patient.full_name} / ${patient.mobile || patient.phone || ''}` : '—'}
            </div>
          </div>
          <div className="col-md-3">
            <label className="form-label mb-1">Admission Date</label>
            <input className="form-control" type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />
          </div>
          <div className="col-md-3">
            <label className="form-label mb-1">Bed No</label>
            <input className="form-control" value={bedNo} onChange={(e) => setBedNo(e.target.value)} />
          </div>
          <div className="col-md-3">
            <label className="form-label mb-1">Ward</label>
            <select className="form-select" value={wardId} onChange={(e) => setWardId(e.target.value)}>
              <option value="">—</option>
              {wards.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label mb-1">Doctor</label>
            <select className="form-select" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">—</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label mb-1">Department</label>
            <select className="form-select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label mb-1">Advance</label>
            <input className="form-control" type="number" min={0} step="0.01" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} />
          </div>
          <div className="col-md-6">
            <label className="form-label mb-1">Diagnosis</label>
            <input className="form-control" maxLength={250} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
          </div>
          <div className="col-md-6">
            <label className="form-label mb-1">Remarks</label>
            <input className="form-control" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-erp" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save Admission'}
        </button>
      </form>

      <h2 className="h6">Recent Admissions</h2>
      <table className="table table-sm table-hover">
        <thead>
          <tr>
            <th>Admission No</th>
            <th>Date</th>
            <th>Patient</th>
            <th>Ward</th>
            <th>Bed</th>
            <th className="text-end">Advance</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.admission_no}</td>
              <td>{r.admission_date}</td>
              <td>
                {r.patient_no} {r.patient_name}
              </td>
              <td>{r.ward_name}</td>
              <td>{r.bed_no}</td>
              <td className="text-end">{money(r.advance_amount).toFixed(2)}</td>
              <td>{r.status}</td>
              <td>
                {r.status === 'admitted' && (
                  <button
                    className="btn btn-sm btn-outline-primary"
                    type="button"
                    onClick={() => navigate(`/in_patient_discharge?admission_id=${r.id}`)}
                  >
                    Discharge Bill
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
