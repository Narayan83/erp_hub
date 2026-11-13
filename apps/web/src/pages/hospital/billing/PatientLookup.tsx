import { FormEvent, useState } from 'react'
import { api } from '../../../api/client'
import type { Page, Patient } from './types'

type Props = {
  disabled?: boolean
  onSelect: (patient: Patient) => void
}

export function PatientLookup({ disabled, onSelect }: Props) {
  const [patientNo, setPatientNo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function find(e?: FormEvent) {
    e?.preventDefault()
    const q = patientNo.trim()
    if (!q) return
    setBusy(true)
    setError(null)
    try {
      const exact = await api.get<Page<Patient>>('/hospital/patients/search', {
        patient_no: q,
        page: 1,
        page_size: 5,
        active_only: true,
      })
      const hit =
        exact.items?.find((p) => p.patient_no.toLowerCase() === q.toLowerCase()) ||
        exact.items?.[0]
      if (hit) {
        onSelect(hit)
        setPatientNo(hit.patient_no)
        return
      }
      const soft = await api.get<Page<Patient>>('/hospital/patients', {
        search: q,
        page: 1,
        page_size: 10,
      })
      if (soft.items?.[0]) {
        onSelect(soft.items[0])
        setPatientNo(soft.items[0].patient_no)
      } else {
        setError('Patient not found')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="row g-2 align-items-end" onSubmit={find}>
      <div className="col-md-5">
        <label className="form-label mb-1">Patient Id</label>
        <input
          className="form-control"
          value={patientNo}
          disabled={disabled}
          onChange={(e) => setPatientNo(e.target.value)}
          placeholder="Enter patient no / search"
        />
      </div>
      <div className="col-md-3">
        <button className="btn btn-outline-secondary w-100" type="submit" disabled={disabled || busy}>
          {busy ? '…' : 'Find'}
        </button>
      </div>
      {error && (
        <div className="col-12">
          <div className="text-danger small">{error}</div>
        </div>
      )}
    </form>
  )
}
