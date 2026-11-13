import { useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'

type Patient = { id: string; patient_no: string; full_name: string; mobile?: string | null; age?: string | null; gender?: string }
type Opd = { id: string; bill_no: string; bill_date: string; net_amount?: number | string; doctor_name?: string }
type Ipd = { id: string; admission_no?: string; bill_no?: string; admission_date?: string; discharge_date?: string | null }

type Props = { title?: string }

export function PatientHistoryPage({ title = 'Patient History OPD' }: Props) {
  const [search, setSearch] = useState('')
  const [patient, setPatient] = useState<Patient | null>(null)
  const [opd, setOpd] = useState<Opd[]>([])
  const [ipd, setIpd] = useState<Ipd[]>([])
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null)
    try {
      const data = await api.get<{ items: Patient[] }>('/hospital/patients', { page: 1, page_size: 10, search })
      const p = data.items?.[0]
      if (!p) throw new Error('Patient not found')
      setPatient(p)
      const [o, i] = await Promise.all([
        api.get<Opd[]>('/hospital/opd-bills/by-patient', { patient_id: p.id }).catch(() => [] as Opd[]),
        api.get<Ipd[]>('/hospital/ipd-discharge/by-patient', { patient_id: p.id }).catch(() => [] as Ipd[]),
      ])
      setOpd(o)
      setIpd(i)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="hms-page">
      <h1>{title}</h1>
      {error && <div className="hms-error">{error}</div>}
      <div className="hms-toolbar">
        <input className="hms-field" style={{ width: 260 }} placeholder="Patient no / name / mobile" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="hms-btn hms-btn-primary" type="button" onClick={() => void run()}>
          Search
        </button>
      </div>
      {patient && (
        <div className="hms-box">
          <div className="hms-box-title">Patient</div>
          <div>
            {patient.patient_no} — {patient.full_name} | {patient.gender} {patient.age} | {patient.mobile}
          </div>
        </div>
      )}
      <div className="hms-box">
        <div className="hms-box-title">OPD Bills</div>
        <div className="hms-table-wrap">
          <table className="hms-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Bill No</th>
                <th>Doctor</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {opd.map((r) => (
                <tr key={r.id}>
                  <td>{r.bill_date}</td>
                  <td>{r.bill_no}</td>
                  <td>{r.doctor_name}</td>
                  <td>{String(r.net_amount ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="hms-box">
        <div className="hms-box-title">IPD / Discharge</div>
        <div className="hms-table-wrap">
          <table className="hms-table">
            <thead>
              <tr>
                <th>Admission</th>
                <th>Bill</th>
                <th>Adm Date</th>
                <th>Discharge</th>
              </tr>
            </thead>
            <tbody>
              {ipd.map((r) => (
                <tr key={r.id}>
                  <td>{r.admission_no}</td>
                  <td>{r.bill_no}</td>
                  <td>{r.admission_date}</td>
                  <td>{r.discharge_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
