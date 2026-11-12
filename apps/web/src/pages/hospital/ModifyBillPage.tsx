import { FormEvent, useState } from 'react'
import { api } from '../../api/client'
import { PatientLookup } from './billing/PatientLookup'
import { OpdBillPage } from './OpdBillPage'
import { IpdDischargePage } from './IpdDischargePage'
import { IpdBillSummary, OpdBillSummary, Patient, money } from './billing/types'

type BillType = 'OPD' | 'IPD'

export function ModifyBillPage() {
  const [billType, setBillType] = useState<BillType>('OPD')
  const [billNo, setBillNo] = useState('')
  const [patient, setPatient] = useState<Patient | null>(null)
  const [rows, setRows] = useState<Array<OpdBillSummary | IpdBillSummary>>([])
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function searchPatient(p: Patient) {
    setPatient(p)
    setEditId(null)
    setError(null)
    if (billType === 'OPD') {
      const list = await api.get<OpdBillSummary[]>('/hospital/opd-bills/by-patient', {
        patient_id: p.id,
      })
      setRows((list || []).filter((b) => b.status !== 'cancelled'))
    } else {
      const list = await api.get<IpdBillSummary[]>('/hospital/ipd-discharge/by-patient', {
        patient_id: p.id,
      })
      setRows(list || [])
    }
  }

  async function searchBillNo(e: FormEvent) {
    e.preventDefault()
    if (!billNo.trim()) return
    setError(null)
    try {
      if (billType === 'OPD') {
        const bill = await api.get<OpdBillSummary>(
          `/hospital/opd-bills/by-no/${encodeURIComponent(billNo.trim())}`,
        )
        setEditId(bill.id)
        setRows([bill])
      } else {
        const bill = await api.get<IpdBillSummary>(
          `/hospital/ipd-discharge/by-no/${encodeURIComponent(billNo.trim())}`,
        )
        setEditId(bill.id)
        setRows([bill])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (editId) {
    return (
      <div>
        <button className="btn btn-sm btn-outline-secondary mb-2" type="button" onClick={() => setEditId(null)}>
          ← Back to search
        </button>
        {billType === 'OPD' ? (
          <OpdBillPage mode="modify" initialBillId={editId} />
        ) : (
          <IpdDischargePage mode="modify" initialBillId={editId} />
        )}
      </div>
    )
  }

  return (
    <div className="erp-card">
      <h1 className="h4 mb-3">Modify Bill</h1>
      {error && <div className="alert alert-danger py-2">{error}</div>}
      <div className="mb-3">
        <div className="btn-group">
          <button
            className={`btn btn-sm ${billType === 'OPD' ? 'btn-erp' : 'btn-outline-secondary'}`}
            type="button"
            onClick={() => {
              setBillType('OPD')
              setRows([])
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
            }}
          >
            IPD
          </button>
        </div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-md-6">
          <PatientLookup onSelect={(p) => void searchPatient(p)} />
          <div className="small text-muted mt-1">
            {patient ? `${patient.patient_no} — ${patient.full_name}` : ''}
          </div>
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
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.bill_no}</td>
              <td>{r.bill_date}</td>
              <td>{r.doctor_name}</td>
              <td className="text-end">{money(r.net_amount).toFixed(2)}</td>
              <td>
                <button className="btn btn-sm btn-erp" type="button" onClick={() => setEditId(r.id)}>
                  Modify
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
