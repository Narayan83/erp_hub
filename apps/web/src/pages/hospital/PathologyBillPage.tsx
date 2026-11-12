import { FormEvent, useEffect, useState } from 'react'
import { api } from '../../api/client'

type Patient = { id: string; patient_no: string; full_name: string }
type Service = { id: string; code: string; name: string; rate?: number }
type Bill = { id: string; bill_no: string; bill_date: string; patient_no: string; net_amount: number; status: string }
type Page<T> = { items: T[] }

export function PathologyBillPage() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [patientId, setPatientId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const [p, s] = await Promise.all([
      api.get<Page<Patient>>('/hospital/patients', { page: 1, page_size: 100 }),
      api.get<Service[]>('/hospital/pathology-bills/catalog/services').catch(() => [] as Service[]),
    ])
    setPatients(p.items || [])
    setServices(s || [])
    if (!patientId && p.items?.[0]) setPatientId(p.items[0].id)
    if (!serviceId && s?.[0]) setServiceId(s[0].id)
  }

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [])

  async function onPatientChange(id: string) {
    setPatientId(id)
    if (!id) return
    try {
      const list = await api.get<Bill[]>('/hospital/pathology-bills/by-patient', { patient_id: id })
      setBills(list || [])
    } catch {
      setBills([])
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api.post('/hospital/pathology-bills', {
        patient_id: patientId,
        bill_date: new Date().toISOString().slice(0, 10),
        lines: [{ service_id: serviceId, quantity: 1 }],
      })
      await onPatientChange(patientId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="erp-card">
      <h1 className="h4 mb-3">Pathology Bill</h1>
      {error && <div className="alert alert-danger py-2">{error}</div>}
      <form className="row g-2 mb-4" onSubmit={onSubmit}>
        <div className="col-md-4">
          <select className="form-select" value={patientId} onChange={(e) => void onPatientChange(e.target.value)} required>
            <option value="">Patient</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>{p.patient_no} — {p.full_name}</option>
            ))}
          </select>
        </div>
        <div className="col-md-5">
          <select className="form-select" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
            <option value="">Lab service</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
            ))}
          </select>
        </div>
        <div className="col-md-2">
          <button className="btn btn-erp w-100" type="submit">Save</button>
        </div>
      </form>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Bill No</th>
            <th>Date</th>
            <th>Patient</th>
            <th className="text-end">Net</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.id}>
              <td>{b.bill_no}</td>
              <td>{b.bill_date}</td>
              <td>{b.patient_no}</td>
              <td className="text-end">{b.net_amount}</td>
              <td>{b.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
