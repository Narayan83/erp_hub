import { FormEvent, useEffect, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { Banner, Box, FieldWrap } from '../shared/hmsKit'
import { errMsg, fmtMoney, unwrapList } from '../shared/hmsShared'

type BillType = 'OPD' | 'IPD'
type Doctor = { id: string; doctor_code?: string; full_name?: string }
type Line = {
  service_id: string | null
  service_name: string
  rate: number | string
  quantity: number
  original_rate?: number | string | null
  hospital_amount?: number | string
  doctor_amount?: number | string
  sharing_doctor_id?: string | null
  line_source?: string
  package_id?: string | null
}
type Payment = { payment_mode_id: string; amount: number | string; document_no?: string | null }
type Bill = {
  id: string
  bill_no: string
  bill_date: string
  patient_id: string
  patient_no?: string | null
  patient_name?: string | null
  doctor_id: string | null
  doctor_name?: string | null
  department_id?: string | null
  payment_mode_id?: string | null
  payments?: Payment[]
  scheme?: string | null
  admin_charges?: number | string
  scheme_discount?: number | string
  sanctioned_scheme_amount?: number | string
  adjust_advance?: number | string
  remarks?: string | null
  visit_category?: string
  token_session?: string | null
  appointment_date?: string | null
  net_amount: number | string
  status?: string
  lines: Line[]
}
type PatientRec = { id: string; title?: string | null; first_name: string; middle_name?: string | null; last_name?: string | null }

/**
 * Change Patient Name / Doctor on a saved bill.
 * Name → PATCH /hospital/patients/{id} (updates Patient Master).
 * Doctor → PUT /hospital/opd-bills/{id} (OPD only; the IPD update schema has no doctor field).
 */
export function ChangePatientDoctorPage() {
  const [billType, setBillType] = useState<BillType>('OPD')
  const [billNo, setBillNo] = useState('')
  const [bill, setBill] = useState<Bill | null>(null)
  const [patient, setPatient] = useState<PatientRec | null>(null)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [changeName, setChangeName] = useState(false)
  const [changeDoctor, setChangeDoctor] = useState(false)
  const [first, setFirst] = useState('')
  const [middle, setMiddle] = useState('')
  const [last, setLast] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api
      .get<unknown>('/hospital/doctors', { page: 1, page_size: 100 })
      .then((d) => setDoctors(unwrapList<Doctor>(d)))
      .catch((e) => setError(errMsg(e)))
  }, [])

  async function load(e: FormEvent) {
    e.preventDefault()
    if (!billNo.trim()) return
    setError(null)
    setOk(null)
    setBill(null)
    setPatient(null)
    try {
      const path = billType === 'OPD' ? '/hospital/opd-bills/by-no/' : '/hospital/ipd-discharge/by-no/'
      const b = await api.get<Bill>(`${path}${encodeURIComponent(billNo.trim())}`)
      const p = await api.get<PatientRec>(`/hospital/patients/${b.patient_id}`)
      setBill(b)
      setPatient(p)
      setFirst(p.first_name || '')
      setMiddle(p.middle_name || '')
      setLast(p.last_name || '')
      setDoctorId(b.doctor_id || '')
      setChangeName(false)
      setChangeDoctor(false)
    } catch (err) {
      setError(errMsg(err))
    }
  }

  async function apply() {
    if (!bill || !patient) return
    if (!changeName && !changeDoctor) {
      setError('Tick “Change patient name” and/or “Change doctor”')
      return
    }
    setBusy(true)
    setError(null)
    setOk(null)
    const done: string[] = []
    try {
      if (changeName) {
        if (!first.trim()) throw new Error('First name is required')
        const upd = await api.patch<PatientRec>(`/hospital/patients/${patient.id}`, {
          first_name: first.trim(),
          middle_name: middle.trim() || null,
          last_name: last.trim() || null,
        })
        setPatient(upd)
        done.push('patient name')
      }
      if (changeDoctor) {
        if (billType !== 'OPD') throw new Error('Doctor change is available for OPD bills only')
        if (!doctorId) throw new Error('Select a doctor')
        const saved = await api.put<Bill>(`/hospital/opd-bills/${bill.id}`, {
          doctor_id: doctorId,
          payment_mode_id: bill.payment_mode_id || null,
          payments: (bill.payments || []).map((p) => ({
            payment_mode_id: p.payment_mode_id,
            amount: Number(p.amount),
            document_no: p.document_no || null,
          })),
          department_id: bill.department_id || null,
          scheme: bill.scheme || null,
          admin_charges: Number(bill.admin_charges || 0),
          scheme_discount: Number(bill.scheme_discount || 0),
          sanctioned_scheme_amount: Number(bill.sanctioned_scheme_amount || 0),
          adjust_advance: Number(bill.adjust_advance || 0),
          remarks: bill.remarks || null,
          bill_date: bill.bill_date,
          visit_category: bill.visit_category || 'opd',
          token_session: bill.token_session || 'morning',
          appointment_date: bill.appointment_date || null,
          lines: bill.lines.map((l) => ({
            service_id: l.service_id,
            quantity: l.quantity,
            rate: Number(l.rate),
            service_name: l.service_name,
            line_source: l.line_source || 'manual',
            package_id: l.package_id || null,
            original_rate: l.original_rate == null ? null : Number(l.original_rate),
            hospital_amount: l.hospital_amount == null ? null : Number(l.hospital_amount),
            doctor_amount: l.doctor_amount == null ? null : Number(l.doctor_amount),
            sharing_doctor_id: l.sharing_doctor_id || null,
          })),
        })
        setBill(saved)
        done.push('doctor')
      }
      setOk(`Updated ${done.join(' and ')}`)
    } catch (err) {
      setError(errMsg(err) + (done.length ? ` (already saved: ${done.join(', ')})` : ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>Change Patient Name / Doctor</h1>
      <div className="hint">
        After a bill is saved: correct the patient name (updates Patient Master) and/or change the
        consulting doctor (OPD).
      </div>
      <Banner error={error} ok={ok} />

      <form className="hms-box" onSubmit={load}>
        <div className="hms-box-title">Find Bill</div>
        <div className="hms-toolbar">
          <label>Bill Type</label>
          <select
            className="hms-field"
            style={{ width: 100 }}
            value={billType}
            onChange={(e) => {
              setBillType(e.target.value as BillType)
              setBill(null)
            }}
          >
            <option>OPD</option>
            <option>IPD</option>
          </select>
          <label>Bill No</label>
          <input className="hms-field" style={{ width: 200 }} value={billNo} onChange={(e) => setBillNo(e.target.value)} />
          <button className="hms-btn hms-btn-primary" type="submit">
            Load
          </button>
        </div>
      </form>

      {bill && patient && (
        <>
          <Box title="Bill">
            <div>
              <strong>{bill.bill_no}</strong> · {bill.bill_date} · Patient {bill.patient_no} —{' '}
              {bill.patient_name} · Doctor {bill.doctor_name || '—'} · Net {fmtMoney(bill.net_amount)}
              {bill.status ? ` · ${bill.status}` : ''}
            </div>
          </Box>

          <Box title="Patient name (updates Patient Master)">
            <label>
              <input type="checkbox" checked={changeName} onChange={(e) => setChangeName(e.target.checked)} /> Change
              patient name
            </label>
            <div className="hms-grid hms-grid-3" style={{ marginTop: 6 }}>
              <FieldWrap label="First name">
                <input className="hms-field" disabled={!changeName} value={first} onChange={(e) => setFirst(e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Middle name">
                <input className="hms-field" disabled={!changeName} value={middle} onChange={(e) => setMiddle(e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Last name">
                <input className="hms-field" disabled={!changeName} value={last} onChange={(e) => setLast(e.target.value)} />
              </FieldWrap>
            </div>
          </Box>

          <Box title="Consulting doctor">
            <label>
              <input
                type="checkbox"
                disabled={billType !== 'OPD'}
                checked={changeDoctor}
                onChange={(e) => setChangeDoctor(e.target.checked)}
              />{' '}
              Change doctor {billType !== 'OPD' && '(OPD bills only)'}
            </label>
            <div className="hms-grid hms-grid-3" style={{ marginTop: 6 }}>
              <FieldWrap label="Doctor">
                <select className="hms-field" disabled={!changeDoctor} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                  <option value="">—</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.doctor_code} — {d.full_name}
                    </option>
                  ))}
                </select>
              </FieldWrap>
            </div>
          </Box>

          <div className="hms-actions">
            <button className="hms-btn hms-btn-primary" type="button" disabled={busy} onClick={() => void apply()}>
              {busy ? '…' : 'Apply changes'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
