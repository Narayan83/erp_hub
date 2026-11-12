import { FormEvent, useState } from 'react'
import { api } from '../../api/client'
import { PatientLookup } from './billing/PatientLookup'
import { IpdBillSummary, OpdBillSummary, Patient, money } from './billing/types'

type BillType = 'OPD' | 'IPD'

export function CancelBillPage() {
  const [billType, setBillType] = useState<BillType>('OPD')
  const [billNo, setBillNo] = useState('')
  const [patient, setPatient] = useState<Patient | null>(null)
  const [rows, setRows] = useState<Array<OpdBillSummary | IpdBillSummary>>([])
  const [selected, setSelected] = useState<OpdBillSummary | IpdBillSummary | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function searchPatient(p: Patient) {
    setPatient(p)
    setSelected(null)
    if (billType === 'OPD') {
      setRows(await api.get<OpdBillSummary[]>('/hospital/opd-bills/by-patient', { patient_id: p.id }))
    } else {
      setRows(await api.get<IpdBillSummary[]>('/hospital/ipd-discharge/by-patient', { patient_id: p.id }))
    }
  }

  async function searchBillNo(e: FormEvent) {
    e.preventDefault()
    if (!billNo.trim()) return
    try {
      if (billType === 'OPD') {
        const bill = await api.get<OpdBillSummary>(
          `/hospital/opd-bills/by-no/${encodeURIComponent(billNo.trim())}`,
        )
        setSelected(bill)
        setRows([bill])
      } else {
        const bill = await api.get<IpdBillSummary>(
          `/hospital/ipd-discharge/by-no/${encodeURIComponent(billNo.trim())}`,
        )
        setSelected(bill)
        setRows([bill])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function cancelBill() {
    if (!selected) return
    if (reason.trim().length < 1) {
      setError('Cancellation reason is required')
      return
    }
    if (!window.confirm(`Cancel bill ${selected.bill_no}?`)) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const path =
        billType === 'OPD'
          ? `/hospital/opd-bills/${selected.id}/cancel`
          : `/hospital/ipd-discharge/${selected.id}/cancel`
      await api.post(path, { reason: reason.trim() })
      setMessage(`Cancelled ${selected.bill_no}`)
      setSelected(null)
      if (patient) await searchPatient(patient)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="erp-card">
      <h1 className="h4 mb-3">Cancel Bill</h1>
      {error && <div className="alert alert-danger py-2">{error}</div>}
      {message && <div className="alert alert-success py-2">{message}</div>}
      <div className="btn-group mb-3">
        <button
          className={`btn btn-sm ${billType === 'OPD' ? 'btn-erp' : 'btn-outline-secondary'}`}
          type="button"
          onClick={() => {
            setBillType('OPD')
            setRows([])
            setSelected(null)
          }}
        >
          OPD
        </button>
        <button
          className={`btn btn-sm ${billType === 'IPD' ? 'btn-erp' : 'btn-outline-secondary'}`}
          type="button"
          onClick={() => {
            setBillType('IPD')
            setRows([])
            setSelected(null)
          }}
        >
          IPD
        </button>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-md-6">
          <PatientLookup onSelect={(p) => void searchPatient(p)} />
        </div>
        <div className="col-md-6">
          <form className="row g-2 align-items-end" onSubmit={searchBillNo}>
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
            <th className="text-end">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              style={{ cursor: 'pointer', background: selected?.id === r.id ? '#e8f0fe' : undefined }}
              onClick={() => setSelected(r)}
            >
              <td>{r.bill_no}</td>
              <td>{r.bill_date}</td>
              <td>{r.doctor_name}</td>
              <td className="text-end">{money(r.net_amount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected && (
        <div className="border rounded p-3">
          <div className="mb-2">
            <strong>
              Cancel {selected.bill_no} — Net {money(selected.net_amount).toFixed(2)}
            </strong>
          </div>
          <label className="form-label">Reason *</label>
          <textarea
            className="form-control mb-2"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button className="btn btn-danger" type="button" disabled={busy} onClick={() => void cancelBill()}>
            {busy ? 'Cancelling…' : 'Cancel This Bill'}
          </button>
        </div>
      )}
    </div>
  )
}
