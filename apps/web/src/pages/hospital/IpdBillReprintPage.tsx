import { FormEvent, useState } from 'react'
import { api } from '../../api/client'
import { PatientLookup } from './billing/PatientLookup'
import { openHospitalReport } from './billing/report'
import { IpdBillDetail, IpdBillSummary, Patient, money } from './billing/types'

export function IpdBillReprintPage() {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [billNo, setBillNo] = useState('')
  const [rows, setRows] = useState<IpdBillSummary[]>([])
  const [detail, setDetail] = useState<IpdBillDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function byPatient(p: Patient) {
    setPatient(p)
    setError(null)
    const list = await api.get<IpdBillSummary[]>('/hospital/ipd-discharge/by-patient', {
      patient_id: p.id,
    })
    setRows(list || [])
    setDetail(null)
  }

  async function byBillNo(e: FormEvent) {
    e.preventDefault()
    if (!billNo.trim()) return
    try {
      const bill = await api.get<IpdBillDetail>(
        `/hospital/ipd-discharge/by-no/${encodeURIComponent(billNo.trim())}`,
      )
      setDetail(bill)
      setRows([bill])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="erp-card">
      <h1 className="h4 mb-3">IPD Bill Reprint</h1>
      {error && <div className="alert alert-danger py-2">{error}</div>}
      <div className="row g-3 mb-3">
        <div className="col-md-6">
          <PatientLookup onSelect={(p) => void byPatient(p)} />
          <div className="small text-muted mt-1">
            {patient ? `${patient.patient_no} — ${patient.full_name}` : ''}
          </div>
        </div>
        <div className="col-md-6">
          <form className="row g-2 align-items-end" onSubmit={byBillNo}>
            <div className="col-8">
              <label className="form-label mb-1">Bill No</label>
              <input className="form-control" value={billNo} onChange={(e) => setBillNo(e.target.value)} />
            </div>
            <div className="col-4">
              <button className="btn btn-outline-secondary w-100" type="submit">
                Find
              </button>
            </div>
          </form>
        </div>
      </div>
      <table className="table table-sm table-hover">
        <thead>
          <tr>
            <th>Bill No</th>
            <th>Date</th>
            <th>Admission</th>
            <th>Doctor</th>
            <th>Ward</th>
            <th>Stay</th>
            <th className="text-end">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              style={{ cursor: 'pointer' }}
              onClick={() => void api.get<IpdBillDetail>(`/hospital/ipd-discharge/${r.id}`).then(setDetail)}
            >
              <td>{r.bill_no}</td>
              <td>{r.bill_date}</td>
              <td>{r.admission_no}</td>
              <td>{r.doctor_name}</td>
              <td>{r.ward_name}</td>
              <td>{r.stay_days}</td>
              <td className="text-end">{money(r.net_amount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail && (
        <div className="border rounded p-3">
          <div className="d-flex justify-content-between mb-2">
            <strong>
              {detail.bill_no} — {detail.patient_name}
            </strong>
            <button
              className="btn btn-sm btn-erp"
              type="button"
              onClick={() => void openHospitalReport(`/hospital/reports/ipd-bill/${detail.id}/html`)}
            >
              Print / Preview
            </button>
          </div>
          <div className="row small">
            <div className="col-md-3">Discharge: {detail.discharge_date}</div>
            <div className="col-md-3">Stay: {detail.stay_days} days</div>
            <div className="col-md-3">Gross: {money(detail.gross_amount).toFixed(2)}</div>
            <div className="col-md-3">Net: {money(detail.net_amount).toFixed(2)}</div>
          </div>
        </div>
      )}
    </div>
  )
}
