import { ReactNode, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { errMsg, unwrapList } from './hmsShared'

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api/v1'

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('erp_token')
  return t ? { Authorization: `Bearer ${t}` } : {}
}

/** Authenticated binary GET (PDF / images). */
export async function fetchBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
    headers: authHeaders(),
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const j = JSON.parse(await res.text())
      if (typeof j?.detail === 'string') detail = j.detail
    } catch {
      /* not json */
    }
    throw new Error(detail)
  }
  return res.blob()
}

/** multipart POST — browser sets the boundary header itself. */
export async function uploadForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
    method: 'POST',
    headers: { Accept: 'application/json', ...authHeaders() },
    body: form,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const detail = data?.detail ?? res.statusText
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return data as T
}

export function Banner({ error, ok }: { error?: string | null; ok?: string | null }) {
  return (
    <>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}
    </>
  )
}

export function FieldWrap({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="hms-field-wrap">
      <label>
        {label}
        {required ? ' *' : ''}
      </label>
      {children}
    </div>
  )
}

export function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="hms-box">
      <div className="hms-box-title">{title}</div>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  )
}

/** Notice for desktop menus that have no backend endpoint yet. */
export function ApiPendingNotice({ children }: { children: ReactNode }) {
  return (
    <div
      className="hms-box"
      style={{ background: '#fffbeb', borderColor: '#f59e0b', color: '#78350f' }}
    >
      <div className="hms-box-title" style={{ background: '#fffbeb' }}>
        Backend pending
      </div>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  )
}

export type FoundPatient = {
  id: string
  patient_no: string
  full_name: string
  first_name?: string
  middle_name?: string | null
  last_name?: string | null
  mobile?: string | null
}

function patientName(p: FoundPatient): string {
  return (
    p.full_name ||
    [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ')
  )
}

/** HMS-styled patient finder: exact patient_no first, then fuzzy search list. */
export function PatientFind({
  onSelect,
  selected,
  label = 'Patient Id',
}: {
  onSelect: (p: FoundPatient) => void
  selected?: FoundPatient | null
  label?: string
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<FoundPatient[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function find() {
    const term = q.trim()
    if (!term) return
    setBusy(true)
    setErr(null)
    setHits([])
    try {
      const exact = unwrapList<FoundPatient>(
        await api.get<unknown>('/hospital/patients/search', {
          patient_no: term,
          page: 1,
          page_size: 5,
        }),
      )
      const hit = exact.find((p) => (p.patient_no || '').toLowerCase() === term.toLowerCase())
      if (hit) {
        onSelect(hit)
        return
      }
      const soft = unwrapList<FoundPatient>(
        await api.get<unknown>('/hospital/patients', { search: term, page: 1, page_size: 15 }),
      )
      if (!soft.length) setErr('Patient not found')
      else if (soft.length === 1) onSelect(soft[0])
      else setHits(soft)
    } catch (ex) {
      setErr(errMsg(ex))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="hms-toolbar" style={{ marginBottom: 4 }}>
        <label>{label}</label>
        <input
          className="hms-field"
          style={{ width: 220 }}
          placeholder="Patient no / name / mobile"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            e.stopPropagation()
            void find()
          }}
        />
        <button className="hms-btn" type="button" disabled={busy} onClick={() => void find()}>
          {busy ? '…' : 'Find'}
        </button>
        {selected && (
          <strong style={{ marginLeft: 8 }}>
            {selected.patient_no} — {patientName(selected)}
          </strong>
        )}
      </div>
      {err && <div className="hms-error">{err}</div>}
      {hits.length > 0 && (
        <div className="hms-table-wrap" style={{ maxHeight: 160, marginBottom: 6 }}>
          <table className="hms-table">
            <thead>
              <tr>
                <th>Patient No</th>
                <th>Name</th>
                <th>Mobile</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => {
                    onSelect(p)
                    setHits([])
                  }}
                >
                  <td>{p.patient_no}</td>
                  <td>{patientName(p)}</td>
                  <td>{p.mobile || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
