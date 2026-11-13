import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { Admission, money } from './billing/types'

/** Menu "IPD Bill" = active admissions picker → opens IPD Discharge bill. */
export function IpdBillPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Admission[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api
      .get<Admission[]>('/hospital/ipd-admissions', { status: 'admitted' })
      .then(setRows)
      .catch((e) => setError(String(e)))
  }, [])

  function openDischarge(id: string) {
    navigate(`/in_patient_discharge?admission_id=${encodeURIComponent(id)}`)
  }

  return (
    <div className="erp-card">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">IPD Bill — Admitted Patients</h1>
        <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => navigate('/in_patient_admission')}>
          IPD Admission
        </button>
      </div>
      {error && <div className="alert alert-danger py-2">{error}</div>}
      <p className="text-muted small">Select an admission to open IPD Discharge Bill (same as hospital desktop).</p>
      <table className="table table-sm table-hover">
        <thead>
          <tr>
            <th>Admission No</th>
            <th>Patient Id</th>
            <th>Patient</th>
            <th>Ward</th>
            <th>Bed</th>
            <th className="text-end">Advance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ cursor: 'pointer' }} onDoubleClick={() => openDischarge(r.id)}>
              <td>{r.admission_no}</td>
              <td>{r.patient_no}</td>
              <td>{r.patient_name}</td>
              <td>{r.ward_name}</td>
              <td>{r.bed_no}</td>
              <td className="text-end">{money(r.advance_amount).toFixed(2)}</td>
              <td>
                <button className="btn btn-sm btn-erp" type="button" onClick={() => openDischarge(r.id)}>
                  Open Discharge Bill
                </button>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={7} className="text-muted">
                No admitted patients
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
