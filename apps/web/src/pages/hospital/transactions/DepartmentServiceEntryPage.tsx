import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { HospitalPrintPreview, opdBillPrintJob, type HospitalPrintJob } from '../billing/HospitalPrintPreview'
import { Banner, Box, FieldWrap, FoundPatient, PatientFind } from '../shared/hmsKit'
import { errMsg, fmtMoney, todayIso, unwrapList } from '../shared/hmsShared'

type Named = { id: string; code: string; name: string }
type Doctor = { id: string; doctor_code?: string; full_name?: string; department_id?: string | null }
type PayMode = { id: string; name: string }
type CatalogItem = { id: string; code: string; name: string; rate: number | string }
type Line = { service_id: string; code: string; name: string; quantity: number; rate: string }

/**
 * Department Wise Service Entry — bill department services to a patient
 * (POST /hospital/opd-bills with department_id; services from the OPD billing catalog).
 */
export function DepartmentServiceEntryPage() {
  const [departments, setDepartments] = useState<Named[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [modes, setModes] = useState<PayMode[]>([])
  const [patient, setPatient] = useState<FoundPatient | null>(null)
  const [deptId, setDeptId] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [billDate, setBillDate] = useState(todayIso())
  const [session, setSession] = useState<'morning' | 'evening'>(new Date().getHours() < 12 ? 'morning' : 'evening')
  const [modeId, setModeId] = useState('')
  const [search, setSearch] = useState('')
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savedBillNo, setSavedBillNo] = useState('')
  const [printJob, setPrintJob] = useState<HospitalPrintJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const [d, doc, m] = await Promise.all([
          api.get<unknown>('/hospital/departments'),
          api.get<unknown>('/hospital/doctors', { page: 1, page_size: 100 }),
          api.get<unknown>('/hospital/payment-modes'),
        ])
        setDepartments(unwrapList<Named>(d))
        setDoctors(unwrapList<Doctor>(doc))
        const pm = unwrapList<PayMode>(m)
        setModes(pm)
        setModeId(pm.find((x) => /cash/i.test(x.name))?.id || pm[0]?.id || '')
      } catch (e) {
        setError(errMsg(e))
      }
    })()
  }, [])

  async function findServices(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    try {
      setCatalog(
        unwrapList<CatalogItem>(
          await api.get<unknown>('/hospital/opd-bills/catalog/services', { search: search.trim() || undefined }),
        ),
      )
    } catch (err) {
      setError(errMsg(err))
    }
  }

  function addLine(s: CatalogItem) {
    setLines((prev) => {
      const hit = prev.find((l) => l.service_id === s.id)
      if (hit) return prev.map((l) => (l.service_id === s.id ? { ...l, quantity: l.quantity + 1 } : l))
      return [...prev, { service_id: s.id, code: s.code, name: s.name, quantity: 1, rate: String(s.rate) }]
    })
  }

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.rate) || 0) * l.quantity, 0),
    [lines],
  )

  function reset() {
    setPatient(null)
    setLines([])
    setCatalog([])
    setSavedId(null)
    setSavedBillNo('')
  }

  async function save() {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      if (!patient) throw new Error('Find a patient first')
      if (!doctorId) throw new Error('Select a doctor')
      if (!lines.length) throw new Error('Add at least one service')
      const saved = await api.post<{ id: string; bill_no: string }>('/hospital/opd-bills', {
        patient_id: patient.id,
        doctor_id: doctorId,
        department_id: deptId || null,
        payment_mode_id: modeId || null,
        payments: modeId && total > 0 ? [{ payment_mode_id: modeId, amount: total }] : [],
        bill_date: billDate,
        visit_category: 'opd',
        token_session: session,
        lines: lines.map((l) => ({
          service_id: l.service_id,
          quantity: l.quantity,
          rate: Number(l.rate) || 0,
          service_name: l.name,
        })),
      })
      setSavedId(saved.id)
      setSavedBillNo(saved.bill_no || '')
      setOk(`Saved bill ${saved.bill_no}`)
      setLines([])
      setPatient(null)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>Department Wise Service Entry</h1>
      <div className="hint">Enter services performed by a department against a patient; creates an OPD bill.</div>
      <Banner error={error} ok={ok} />
      {savedId && (
        <div className="hms-toolbar">
          <button
            className="hms-btn"
            type="button"
            onClick={() => setPrintJob(opdBillPrintJob(savedId, savedBillNo))}
          >
            Print last bill
          </button>
        </div>
      )}

      <Box title="Patient & department">
        <PatientFind selected={patient} onSelect={setPatient} />
        <div className="hms-grid hms-grid-4">
          <FieldWrap label="Department">
            <select className="hms-field" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
          </FieldWrap>
          <FieldWrap label="Doctor" required>
            <select className="hms-field" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">—</option>
              {doctors
                .filter((d) => !deptId || !d.department_id || d.department_id === deptId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.doctor_code} — {d.full_name}
                  </option>
                ))}
            </select>
          </FieldWrap>
          <FieldWrap label="Bill Date">
            <input className="hms-field" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </FieldWrap>
          <FieldWrap label="Session">
            <select className="hms-field" value={session} onChange={(e) => setSession(e.target.value as 'morning' | 'evening')}>
              <option value="morning">Morning</option>
              <option value="evening">Evening</option>
            </select>
          </FieldWrap>
        </div>
      </Box>

      <Box title="Services">
        <form className="hms-toolbar" onSubmit={findServices}>
          <input
            className="hms-field"
            style={{ width: 260 }}
            placeholder="Search service code / name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="hms-btn" type="submit">
            Search
          </button>
        </form>
        {catalog.length > 0 && (
          <div className="hms-table-wrap" style={{ maxHeight: 160, marginBottom: 8 }}>
            <table className="hms-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Service</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {catalog.slice(0, 200).map((s) => (
                  <tr key={s.id} onClick={() => addLine(s)}>
                    <td>{s.code}</td>
                    <td>{s.name}</td>
                    <td>{fmtMoney(s.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="hms-table-wrap" style={{ maxHeight: 240 }}>
          <table className="hms-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Service</th>
                <th style={{ width: 90 }}>Qty</th>
                <th style={{ width: 120 }}>Rate</th>
                <th>Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.service_id}>
                  <td>{l.code}</td>
                  <td>{l.name}</td>
                  <td>
                    <input
                      className="hms-field"
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((x) =>
                            x.service_id === l.service_id ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="hms-field"
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.rate}
                      onChange={(e) =>
                        setLines((prev) => prev.map((x) => (x.service_id === l.service_id ? { ...x, rate: e.target.value } : x)))
                      }
                    />
                  </td>
                  <td>{fmtMoney((Number(l.rate) || 0) * l.quantity)}</td>
                  <td>
                    <button
                      className="hms-btn hms-btn-danger"
                      type="button"
                      onClick={() => setLines((prev) => prev.filter((x) => x.service_id !== l.service_id))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {!lines.length && (
                <tr>
                  <td colSpan={6}>Search and click a service to add it</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Box>

      <div className="hms-toolbar">
        <label>Payment Mode</label>
        <select className="hms-field" style={{ width: 200 }} value={modeId} onChange={(e) => setModeId(e.target.value)}>
          <option value="">—</option>
          {modes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <strong>Total: {fmtMoney(total)}</strong>
        <button className="hms-btn hms-btn-primary" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? '…' : 'Save'}
        </button>
        <button className="hms-btn" type="button" onClick={reset}>
          Clear
        </button>
      </div>
      {printJob ? <HospitalPrintPreview job={printJob} onClose={() => setPrintJob(null)} /> : null}
    </div>
  )
}
