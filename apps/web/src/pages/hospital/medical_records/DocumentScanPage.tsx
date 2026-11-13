import { FormEvent, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'

type Props = { title: string; scannerName: string }
type Patient = { id: string; patient_no: string; full_name: string }
type Doc = {
  id: string
  document_type?: string
  original_name?: string | null
  remarks?: string | null
  document_date?: string
  scanner_name?: string | null
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api/v1'

export function DocumentScanPage({ title, scannerName }: Props) {
  const [search, setSearch] = useState('')
  const [patient, setPatient] = useState<Patient | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [remarks, setRemarks] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function findPatient() {
    setError(null)
    const data = await api.get<{ items: Patient[] }>('/hospital/patients', { page: 1, page_size: 5, search })
    const p = data.items?.[0]
    if (!p) throw new Error('Patient not found')
    setPatient(p)
    setDocs(await api.get<Doc[]>('/hospital/patient-documents', { patient_id: p.id }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!patient || !file) {
      setError('Select patient and file')
      return
    }
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const fd = new FormData()
      fd.append('patient_id', patient.id)
      fd.append('file', file)
      fd.append('scanner_name', scannerName)
      if (remarks) fd.append('remarks', remarks)
      fd.append('original_name', file.name)
      const token = localStorage.getItem('erp_token')
      const res = await fetch(`${API_BASE}/hospital/patient-documents`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
      const text = await res.text()
      if (!res.ok) {
        try {
          const j = JSON.parse(text)
          throw new Error(typeof j.detail === 'string' ? j.detail : text)
        } catch (err) {
          if (err instanceof Error && err.message !== text) throw err
          throw new Error(text || res.statusText)
        }
      }
      setOk('Document uploaded')
      setFile(null)
      setRemarks('')
      setDocs(await api.get<Doc[]>('/hospital/patient-documents', { patient_id: patient.id }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>{title}</h1>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}
      <div className="hms-toolbar">
        <input className="hms-field" style={{ width: 240 }} placeholder="Patient search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="hms-btn" type="button" onClick={() => void findPatient().catch((e) => setError(String(e)))}>
          Find
        </button>
        <span>{patient ? `${patient.patient_no} — ${patient.full_name}` : ''}</span>
      </div>
      <form className="hms-box" onSubmit={onSubmit}>
        <div className="hms-box-title">Upload ({scannerName})</div>
        <div className="hms-grid hms-grid-2" style={{ marginTop: 4 }}>
          <div className="hms-field-wrap">
            <label>File</label>
            <input className="hms-field" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="hms-field-wrap">
            <label>Remarks</label>
            <input className="hms-field" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
        <div className="hms-actions">
          <button className="hms-btn hms-btn-primary" type="submit" disabled={!patient || !file || busy}>
            {busy ? '…' : 'Upload'}
          </button>
        </div>
      </form>
      <div className="hms-table-wrap">
        <table className="hms-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>File</th>
              <th>Scanner</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.document_date}</td>
                <td>{d.original_name}</td>
                <td>{d.scanner_name}</td>
                <td>{d.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
