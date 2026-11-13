import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { fetchBlob } from '../shared/hmsKit'
import { errMsg, fmtMoney, unwrapList } from '../shared/hmsShared'

type Opd = { id: string; bill_no: string; bill_date: string; doctor_name?: string | null; department_name?: string | null; net_amount: number | string }
type Ipd = { id: string; bill_no: string; admission_no?: string | null; discharge_date?: string; doctor_name?: string | null; ward_name?: string | null; net_amount: number | string }
type Doc = {
  id: string
  document_type?: string
  original_name?: string | null
  document_date?: string
  page_count?: number
  scanner_name?: string | null
  remarks?: string | null
  viewed_by_current_doctor?: boolean
}

export type RecordPatient = { id: string; patient_no: string; full_name: string }

/** OPD bills, IPD bills and scanned documents of one patient. */
export function PatientRecordPanel({ patient }: { patient: RecordPatient }) {
  const [opd, setOpd] = useState<Opd[]>([])
  const [ipd, setIpd] = useState<Ipd[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const [o, i, d] = await Promise.allSettled([
      api.get<unknown>('/hospital/opd-bills/by-patient', { patient_id: patient.id }),
      api.get<unknown>('/hospital/ipd-discharge/by-patient', { patient_id: patient.id }),
      api.get<unknown>('/hospital/patient-documents', { patient_id: patient.id }),
    ])
    setOpd(o.status === 'fulfilled' ? unwrapList<Opd>(o.value) : [])
    setIpd(i.status === 'fulfilled' ? unwrapList<Ipd>(i.value) : [])
    setDocs(d.status === 'fulfilled' ? unwrapList<Doc>(d.value) : [])
    const failed = [o, i, d].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    if (failed) setError(errMsg(failed.reason))
  }, [patient.id])

  useEffect(() => {
    void load()
  }, [load])

  async function openDoc(doc: Doc) {
    try {
      const blob = await fetchBlob(`/hospital/patient-documents/${doc.id}/file`)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      // Only doctor logins may mark a document viewed; ignore the 400 for other users.
      void api.post(`/hospital/patient-documents/${doc.id}/view`).then(load).catch(() => undefined)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <div>
      <div className="hms-box" style={{ marginTop: 8 }}>
        <div className="hms-box-title">Patient</div>
        <strong>
          {patient.patient_no} — {patient.full_name}
        </strong>
      </div>
      {error && <div className="hms-error">{error}</div>}

      <div className="hms-box">
        <div className="hms-box-title">OPD Bills ({opd.length})</div>
        <div className="hms-table-wrap" style={{ maxHeight: 200 }}>
          <table className="hms-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Bill No</th>
                <th>Doctor</th>
                <th>Department</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {opd.map((b) => (
                <tr key={b.id}>
                  <td>{b.bill_date}</td>
                  <td>{b.bill_no}</td>
                  <td>{b.doctor_name}</td>
                  <td>{b.department_name}</td>
                  <td>{fmtMoney(b.net_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="hms-box">
        <div className="hms-box-title">IPD / Discharge ({ipd.length})</div>
        <div className="hms-table-wrap" style={{ maxHeight: 200 }}>
          <table className="hms-table">
            <thead>
              <tr>
                <th>Admission</th>
                <th>Bill No</th>
                <th>Discharge</th>
                <th>Doctor</th>
                <th>Ward</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {ipd.map((b) => (
                <tr key={b.id}>
                  <td>{b.admission_no}</td>
                  <td>{b.bill_no}</td>
                  <td>{b.discharge_date}</td>
                  <td>{b.doctor_name}</td>
                  <td>{b.ward_name}</td>
                  <td>{fmtMoney(b.net_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="hms-box">
        <div className="hms-box-title">Scanned Documents ({docs.length})</div>
        <div className="hms-table-wrap" style={{ maxHeight: 240 }}>
          <table className="hms-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>File</th>
                <th>Pages</th>
                <th>Scanner</th>
                <th>Remarks</th>
                <th>Viewed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.document_date}</td>
                  <td>{d.document_type}</td>
                  <td>{d.original_name}</td>
                  <td>{d.page_count}</td>
                  <td>{d.scanner_name}</td>
                  <td>{d.remarks}</td>
                  <td>{d.viewed_by_current_doctor ? 'Yes' : ''}</td>
                  <td>
                    <button className="hms-btn" type="button" onClick={() => void openDoc(d)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {!docs.length && (
                <tr>
                  <td colSpan={8}>No documents</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
