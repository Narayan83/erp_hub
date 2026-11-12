import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { Banner } from '../shared/hmsKit'
import { errMsg, todayIso, unwrapList } from '../shared/hmsShared'
import { PatientRecordPanel, RecordPatient } from './PatientRecordPanel'

type Doctor = { id: string; doctor_code?: string; full_name?: string }
type Token = {
  id: string
  doctor_id: string
  doctor_name?: string | null
  patient_id: string
  patient_no?: string | null
  patient_name?: string | null
  bill_no?: string | null
  token_number: number
  token_date: string
  token_session: string
  visit_category: string
}

/**
 * Patient History OPD — doctor's OPD token list (/hospital/opd-bills/tokens); pick a patient to
 * see OPD/IPD bills and scanned documents. Doctor logins are scoped to their own tokens by the API.
 */
export function PatientHistoryOpdPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [doctorId, setDoctorId] = useState('')
  const [date, setDate] = useState(todayIso())
  const [session, setSession] = useState('')
  const [category, setCategory] = useState('')
  const [tokens, setTokens] = useState<Token[]>([])
  const [selected, setSelected] = useState<RecordPatient | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api
      .get<unknown>('/hospital/doctors', { page: 1, page_size: 100 })
      .then((d) => setDoctors(unwrapList<Doctor>(d)))
      .catch(() => setDoctors([]))
  }, [])

  async function load() {
    setBusy(true)
    setError(null)
    setSelected(null)
    try {
      setTokens(
        unwrapList<Token>(
          await api.get<unknown>('/hospital/opd-bills/tokens', {
            doctor_id: doctorId || undefined,
            token_date: date || undefined,
            token_session: session || undefined,
            visit_category: category || undefined,
          }),
        ),
      )
    } catch (e) {
      setError(errMsg(e))
      setTokens([])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="hms-page">
      <h1>Patient History OPD</h1>
      <Banner error={error} />
      <div className="hms-toolbar">
        <label>Doctor</label>
        <select className="hms-field" style={{ width: 240 }} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
          <option value="">All</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.doctor_code} — {d.full_name}
            </option>
          ))}
        </select>
        <label>Date</label>
        <input className="hms-field" style={{ width: 150 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <label>Session</label>
        <select className="hms-field" style={{ width: 120 }} value={session} onChange={(e) => setSession(e.target.value)}>
          <option value="">All</option>
          <option value="morning">Morning</option>
          <option value="evening">Evening</option>
        </select>
        <label>Visit</label>
        <select className="hms-field" style={{ width: 150 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All</option>
          <option value="opd">OPD</option>
          <option value="reference">Reference</option>
          <option value="appointment">Appointment</option>
          <option value="online_booking">Online booking</option>
        </select>
        <button className="hms-btn hms-btn-primary" type="button" disabled={busy} onClick={() => void load()}>
          {busy ? '…' : 'Show'}
        </button>
      </div>

      <div className="hms-table-wrap" style={{ maxHeight: 260 }}>
        <table className="hms-table">
          <thead>
            <tr>
              <th>Token</th>
              <th>Session</th>
              <th>Visit</th>
              <th>Patient No</th>
              <th>Patient</th>
              <th>Doctor</th>
              <th>Bill No</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr
                key={t.id}
                className={selected?.id === t.patient_id ? 'active' : ''}
                onClick={() =>
                  setSelected({ id: t.patient_id, patient_no: t.patient_no || '', full_name: t.patient_name || '' })
                }
              >
                <td>{t.token_number}</td>
                <td>{t.token_session}</td>
                <td>{t.visit_category}</td>
                <td>{t.patient_no}</td>
                <td>{t.patient_name}</td>
                <td>{t.doctor_name}</td>
                <td>{t.bill_no}</td>
              </tr>
            ))}
            {!tokens.length && (
              <tr>
                <td colSpan={7}>No tokens for the selected filters</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && <PatientRecordPanel key={selected.id} patient={selected} />}
    </div>
  )
}
