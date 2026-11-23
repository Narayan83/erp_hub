import { FormEvent, useState } from 'react'
import { api } from '../../api/client'
import { PatientLookup } from './billing/PatientLookup'
import { HospitalPrintPreview, opdBillPrintJob, type HospitalPrintJob } from './billing/HospitalPrintPreview'
import { OpdBillDetail, OpdBillSummary, Patient, money } from './billing/types'

export function OpdBillReprintPage() {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [billNo, setBillNo] = useState('')
  const [rows, setRows] = useState<OpdBillSummary[]>([])
  const [detail, setDetail] = useState<OpdBillDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [printJob, setPrintJob] = useState<HospitalPrintJob | null>(null)

  async function searchByPatient(p: Patient) {
    setPatient(p)
    setError(null)
    setDetail(null)
    const list = await api.get<OpdBillSummary[]>('/hospital/opd-bills/by-patient', {
      patient_id: p.id,
    })
    setRows(list || [])
  }

  async function searchByBillNo(e: FormEvent) {
    e.preventDefault()
    if (!billNo.trim()) return
    setError(null)
    try {
      const bill = await api.get<OpdBillDetail>(`/hospital/opd-bills/by-no/${encodeURIComponent(billNo.trim())}`)
      setDetail(bill)
      setRows([bill])
      setPatient({
        id: bill.patient_id,
        patient_no: bill.patient_no || '',
        full_name: bill.patient_name || '',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function openBill(id: string) {
    setError(null)
    try {
      setDetail(await api.get<OpdBillDetail>(`/hospital/opd-bills/${id}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="erp-card">
      <h1 className="h4 mb-3">OPD Bill Reprint</h1>
      {error && <div className="alert alert-danger py-2">{error}</div>}
      <div className="row g-3 mb-3">
        <div className="col-md-6">
          <PatientLookup onSelect={(p) => void searchByPatient(p)} />
          <div className="small mt-1 text-muted">{patient ? `${patient.patient_no} — ${patient.full_name}` : ''}</div>
        </div>
        <div className="col-md-6">
          <form className="row g-2 align-items-end" onSubmit={searchByBillNo}>
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
            <th>Doctor</th>
            <th>Token</th>
            <th>Visit</th>
            <th className="text-end">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => void openBill(r.id)}>
              <td>{r.bill_no}</td>
              <td>{r.bill_date}</td>
              <td>{r.doctor_name}</td>
              <td>{r.token_number}</td>
              <td>{r.visit_category}</td>
              <td className="text-end">{money(r.net_amount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <div className="border rounded p-3 mt-3">
          <div className="d-flex justify-content-between mb-2">
            <strong>
              {detail.bill_no} — {detail.patient_name} / {detail.doctor_name}
            </strong>
            <button
              className="btn btn-sm btn-erp"
              type="button"
              onClick={() => setPrintJob(opdBillPrintJob(detail.id, detail.bill_no))}
            >
              Print / Preview
            </button>
          </div>
          <div className="row small mb-2">
            <div className="col-md-3">Date: {detail.bill_date}</div>
            <div className="col-md-3">Visit: {detail.visit_category}</div>
            <div className="col-md-3">Token: {detail.token_number}</div>
            <div className="col-md-3">Pay: {detail.payment_mode_name}</div>
            <div className="col-md-3">Gross: {money(detail.gross_amount).toFixed(2)}</div>
            <div className="col-md-3">Net: {money(detail.net_amount).toFixed(2)}</div>
          </div>
          <table className="table table-sm mb-0">
            <thead>
              <tr>
                <th>Service</th>
                <th>Qty</th>
                <th className="text-end">Rate</th>
                <th className="text-end">Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines?.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.service_name}
                    <div className="text-muted small">{l.service_code}</div>
                  </td>
                  <td>{l.quantity}</td>
                  <td className="text-end">{money(l.rate).toFixed(2)}</td>
                  <td className="text-end">{money(l.amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {printJob ? <HospitalPrintPreview job={printJob} onClose={() => setPrintJob(null)} /> : null}
    </div>
  )
}
