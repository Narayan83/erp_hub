import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { openHospitalReport } from './billing/report'
import {
  BillLine,
  CatalogService,
  Department,
  Doctor,
  OpdBillDetail,
  Page,
  Patient,
  PayMode,
  defaultSession,
  money,
  todayIso,
  uid,
} from './billing/types'
import './billing/hospital-bill.css'

type Props = { mode?: 'create' | 'modify'; initialBillId?: string }

type CatalogRow = CatalogService & { qty: number; checked: boolean }
type PayAmount = Record<string, { amount: string; document_no: string }>

const HOLD_KEY = 'hms_opd_bill_hold'

export function OpdBillPage({ mode = 'create', initialBillId }: Props) {
  const navigate = useNavigate()
  const modify = mode === 'modify'

  const [patient, setPatient] = useState<Patient | null>(null)
  const [patientNo, setPatientNo] = useState('')
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([])
  const [packages, setPackages] = useState<Array<{ id: string; name: string }>>([])
  const [payModes, setPayModes] = useState<PayMode[]>([])
  const [catalogAll, setCatalogAll] = useState<CatalogService[]>([])
  const [catalogRows, setCatalogRows] = useState<CatalogRow[]>([])
  const [catalogSearch, setCatalogSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [packageId, setPackageId] = useState('')

  const [billId, setBillId] = useState<string | null>(initialBillId || null)
  const [billNo, setBillNo] = useState('')
  const [tokenNo, setTokenNo] = useState('')
  const [billDate, setBillDate] = useState(todayIso())
  const [visitCategory, setVisitCategory] = useState('opd')
  const [tokenSession, setTokenSession] = useState<'morning' | 'evening'>(defaultSession())
  const [appointmentDate, setAppointmentDate] = useState(todayIso())
  const [doctorId, setDoctorId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [scheme, setScheme] = useState('')
  const [adjustAdvance, setAdjustAdvance] = useState(0)
  const [deposit, setDeposit] = useState(0)
  const [lines, setLines] = useState<BillLine[]>([])
  const [payAmounts, setPayAmounts] = useState<PayAmount>({})
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const scheduled = visitCategory === 'appointment' || visitCategory === 'online_booking'
  const gross = useMemo(() => lines.reduce((s, l) => s + l.quantity * l.rate, 0), [lines])
  const net = Math.max(gross - adjustAdvance, 0)
  const paid = useMemo(
    () => Object.values(payAmounts).reduce((s, p) => s + (Number(p.amount) || 0), 0),
    [payAmounts],
  )
  const balance = Number((net - paid).toFixed(2))

  useEffect(() => {
    void (async () => {
      const [docs, deps, services, pms, cats, pkgs] = await Promise.all([
        api.get<Page<Doctor>>('/hospital/doctors', { page: 1, page_size: 200 }),
        api.get<Department[]>('/hospital/departments'),
        api.get<CatalogService[]>('/hospital/opd-bills/catalog/services'),
        api.get<PayMode[]>('/hospital/payment-modes').catch(() => api.get<PayMode[]>('/accounts/payment-modes')),
        api.get<Array<{ id: string; name: string }>>('/hospital/service-categories'),
        api.get<Array<{ id: string; name: string }>>('/hospital/billing-packages').catch(() => []),
      ])
      setDoctors(docs.items || [])
      setDepartments(deps || [])
      setCatalogAll(services || [])
      setPayModes(pms || [])
      setCategories(cats || [])
      setPackages(pkgs || [])
      if (!doctorId && docs.items?.[0]) setDoctorId(docs.items[0].id)
      const initPay: PayAmount = {}
      for (const m of pms || []) initPay[m.id] = { amount: '', document_no: '' }
      setPayAmounts(initPay)
      setCatalogRows(
        (services || []).map((s) => ({ ...s, qty: 1, checked: false, rate: money(s.rate) })),
      )
    })().catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    if (initialBillId) void loadBill(initialBillId)
  }, [initialBillId])

  useEffect(() => {
    const q = catalogSearch.trim().toLowerCase()
    setCatalogRows(
      catalogAll
        .filter((s) => !categoryId || s.category_id === categoryId)
        .filter(
          (s) =>
            !q ||
            s.name.toLowerCase().includes(q) ||
            s.code.toLowerCase().includes(q) ||
            (s.category_name || '').toLowerCase().includes(q),
        )
        .map((s) => ({ ...s, qty: 1, checked: false, rate: money(s.rate) })),
    )
  }, [catalogAll, catalogSearch, categoryId])

  async function findPatient() {
    const q = patientNo.trim()
    if (!q) return
    setError(null)
    try {
      const exact = await api.get<Page<Patient>>('/hospital/patients/search', {
        patient_no: q,
        page: 1,
        page_size: 5,
        active_only: true,
      })
      const hit =
        exact.items?.find((p) => p.patient_no.toLowerCase() === q.toLowerCase()) || exact.items?.[0]
      if (!hit) {
        const soft = await api.get<Page<Patient>>('/hospital/patients', { search: q, page: 1, page_size: 10 })
        if (!soft.items?.[0]) {
          setError('Patient not found')
          return
        }
        await selectPatient(soft.items[0])
        return
      }
      await selectPatient(hit)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function selectPatient(p: Patient) {
    setPatient(p)
    setPatientNo(p.patient_no)
    try {
      const dep = await api.get<{ balance: number | string }>('/hospital/cashbook/patient-deposit', {
        patient_id: p.id,
      })
      setDeposit(money(dep.balance))
    } catch {
      setDeposit(0)
    }
    setStatus(`Patient ${p.patient_no} — ${p.full_name}`)
  }

  async function loadBill(id: string) {
    const bill = await api.get<OpdBillDetail>(`/hospital/opd-bills/${id}`)
    applyBill(bill)
  }

  function applyBill(bill: OpdBillDetail) {
    setBillId(bill.id)
    setBillNo(bill.bill_no)
    setTokenNo(bill.token_number != null ? String(bill.token_number) : '')
    setBillDate(String(bill.bill_date).slice(0, 10))
    setDoctorId(bill.doctor_id || '')
    setDepartmentId(bill.department_id || '')
    setVisitCategory(bill.visit_category || 'opd')
    setTokenSession((bill.token_session as 'morning' | 'evening') || defaultSession())
    setAppointmentDate(bill.appointment_date ? String(bill.appointment_date).slice(0, 10) : todayIso())
    setScheme(bill.scheme || '')
    setAdjustAdvance(money(bill.adjust_advance))
    setPatient({ id: bill.patient_id, patient_no: bill.patient_no || '', full_name: bill.patient_name || '' })
    setPatientNo(bill.patient_no || '')
    setLines(
      (bill.lines || []).map((l) => ({
        key: uid('line'),
        service_id: l.service_id || '',
        service_code: l.service_code,
        service_name: l.service_name,
        category_name: l.category_name,
        quantity: l.quantity,
        rate: money(l.rate),
      })),
    )
    setPayAmounts((prev) => {
      const next: PayAmount = { ...prev }
      for (const k of Object.keys(next)) next[k] = { amount: '', document_no: '' }
      for (const p of bill.payments || []) {
        next[p.payment_mode_id] = {
          amount: String(money(p.amount)),
          document_no: p.document_no || '',
        }
      }
      return next
    })
    void api
      .get<{ balance: number | string }>('/hospital/cashbook/patient-deposit', { patient_id: bill.patient_id })
      .then((d) => setDeposit(money(d.balance)))
      .catch(() => setDeposit(0))
    setStatus(`Loaded bill ${bill.bill_no}`)
  }

  function addSelected() {
    const next = [...lines]
    for (const row of catalogRows) {
      if (!row.checked) continue
      const existing = next.find((l) => l.service_id === row.id)
      if (existing) existing.quantity += row.qty || 1
      else {
        next.push({
          key: uid('line'),
          service_id: row.id,
          service_code: row.code,
          service_name: row.name,
          category_name: row.category_name,
          quantity: row.qty || 1,
          rate: money(row.rate),
        })
      }
    }
    setLines(next)
    setCatalogRows((rows) => rows.map((r) => ({ ...r, checked: false })))
  }

  function removeSelectedLine() {
    // remove last line if none selected conceptually — remove checked via filter of last
    setLines((prev) => prev.slice(0, -1))
  }

  function fillBalance() {
    const cash = payModes.find((m) => m.is_cash || m.code === 'CASH') || payModes[0]
    if (!cash) return
    setPayAmounts((prev) => {
      const next: PayAmount = {}
      for (const m of payModes) next[m.id] = { amount: '', document_no: prev[m.id]?.document_no || '' }
      next[cash.id] = { amount: net > 0 ? net.toFixed(2) : '', document_no: next[cash.id]?.document_no || '' }
      return next
    })
  }

  function clearPayments() {
    setPayAmounts((prev) => {
      const next: PayAmount = {}
      for (const id of Object.keys(prev)) next[id] = { amount: '', document_no: '' }
      return next
    })
  }

  function clearForm() {
    if (modify) return
    setBillId(null)
    setBillNo('')
    setTokenNo('')
    setBillDate(todayIso())
    setVisitCategory('opd')
    setTokenSession(defaultSession())
    setAppointmentDate(todayIso())
    setScheme('')
    setAdjustAdvance(0)
    setLines([])
    clearPayments()
    setPatient(null)
    setPatientNo('')
    setDeposit(0)
    setError(null)
    setStatus('Cleared')
  }

  function holdBill() {
    const payload = {
      patient,
      patientNo,
      billDate,
      visitCategory,
      tokenSession,
      appointmentDate,
      doctorId,
      departmentId,
      scheme,
      adjustAdvance,
      lines,
      payAmounts,
      deposit,
    }
    localStorage.setItem(HOLD_KEY, JSON.stringify(payload))
    setStatus('Bill held locally — use Resume Held to restore')
  }

  function resumeHeld() {
    const raw = localStorage.getItem(HOLD_KEY)
    if (!raw) {
      setStatus('No held bill')
      return
    }
    try {
      const h = JSON.parse(raw)
      setPatient(h.patient)
      setPatientNo(h.patientNo || '')
      setBillDate(h.billDate || todayIso())
      setVisitCategory(h.visitCategory || 'opd')
      setTokenSession(h.tokenSession || defaultSession())
      setAppointmentDate(h.appointmentDate || todayIso())
      setDoctorId(h.doctorId || '')
      setDepartmentId(h.departmentId || '')
      setScheme(h.scheme || '')
      setAdjustAdvance(h.adjustAdvance || 0)
      setLines(h.lines || [])
      setPayAmounts(h.payAmounts || {})
      setDeposit(h.deposit || 0)
      setStatus('Resumed held bill')
    } catch {
      setStatus('Held bill corrupt')
    }
  }

  function enterAdvance() {
    const v = window.prompt(`Adjust advance (available ${deposit.toFixed(2)})`, String(adjustAdvance || ''))
    if (v == null) return
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) return
    setAdjustAdvance(Math.min(n, deposit))
  }

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!patient) return setError('Select patient')
    if (!doctorId) return setError('Doctor is required')
    if (!lines.length) return setError('Add at least one service line')
    if (scheduled && !appointmentDate) return setError('Booking date required')
    if (net > 0.01 && Math.abs(paid - net) > 0.01) {
      return setError(`Payments (${paid.toFixed(2)}) must equal net (${net.toFixed(2)})`)
    }

    const payments = Object.entries(payAmounts)
      .filter(([, v]) => Number(v.amount) > 0)
      .map(([payment_mode_id, v]) => ({
        payment_mode_id,
        amount: Number(v.amount),
        document_no: v.document_no || null,
      }))

    const payload = {
      doctor_id: doctorId,
      department_id: departmentId || null,
      payment_mode_id: payments[0]?.payment_mode_id || null,
      payments,
      is_cash: true,
      scheme: scheme || null,
      admin_charges: 0,
      scheme_discount: 0,
      sanctioned_scheme_amount: 0,
      adjust_advance: adjustAdvance,
      bill_date: billDate,
      visit_category: visitCategory,
      token_session: tokenSession,
      appointment_date: scheduled ? appointmentDate : null,
      lines: lines.map((l) => ({
        service_id: l.service_id,
        quantity: l.quantity,
        rate: l.rate,
        service_name: l.service_name,
      })),
    }

    setBusy(true)
    try {
      let saved: OpdBillDetail
      if (modify && billId) {
        saved = await api.put<OpdBillDetail>(`/hospital/opd-bills/${billId}`, payload)
      } else {
        saved = await api.post<OpdBillDetail>('/hospital/opd-bills', { ...payload, patient_id: patient.id })
      }
      setBillId(saved.id)
      setBillNo(saved.bill_no)
      setTokenNo(saved.token_number != null ? String(saved.token_number) : '')
      setStatus(`Saved ${saved.bill_no}`)
      try {
        await openHospitalReport(`/hospital/reports/opd-bill/${saved.id}/html`)
      } catch {
        /* optional */
      }
      if (!modify) {
        localStorage.removeItem(HOLD_KEY)
        clearForm()
        setBillNo(saved.bill_no)
        setStatus(`Saved ${saved.bill_no} — form cleared`)
      } else applyBill(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const actions = [
    { label: 'New Patient', go: () => navigate('/patient_master') },
    { label: 'Service Creation', go: () => navigate('/patient_service_creation') },
    { label: 'Tokens', go: () => setStatus('Select doctor then save bill to assign token') },
    { label: 'Reprint Bill', go: () => navigate('/opd_bill_reprint') },
    {
      label: 'Casesheet',
      go: () => {
        if (!patient) return setStatus('Select patient for casesheet')
        void openHospitalReport(`/hospital/reports/opd-casesheet/${patient.id}/html`).catch((e) =>
          setError(String(e)),
        )
      },
    },
    { label: 'Pathology Bill', go: () => navigate('/pathology_bill') },
    { label: 'Collect Advance', go: () => navigate('/advance_collection') },
    { label: 'Adjust Advance', go: enterAdvance },
    { label: 'IPD Admission', go: () => navigate('/in_patient_admission') },
    { label: 'IPD Bill', go: () => navigate('/ipd_bill') },
  ]

  return (
    <div className="hms-bill-page">
      {!modify && (
        <div className="hms-bill-actions">
          {actions.map((a) => (
            <button key={a.label} className="hms-btn" type="button" onClick={a.go}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      {error && <div className="hms-error">{error}</div>}

      <div className="hms-bill-split">
        <aside className="hms-bill-left">
          <div className="hms-box">
            <div className="hms-box-title">Patient</div>
            <div className="hms-form-row">
              <label>Patient Id</label>
              <div className="hms-pair">
                <input
                  className="hms-field"
                  value={patientNo}
                  readOnly={modify}
                  onChange={(e) => setPatientNo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void findPatient()}
                  placeholder="Patient No"
                />
                {!modify && (
                  <button className="hms-btn" type="button" onClick={() => void findPatient()}>
                    Find
                  </button>
                )}
              </div>
            </div>
            <div className="hms-form-row">
              <label>Patient Name</label>
              <input className="hms-field" readOnly value={patient?.full_name || ''} />
            </div>
            <div className="hms-form-row">
              <label>Mobile</label>
              <input className="hms-field" readOnly value={patient?.mobile || patient?.phone || ''} />
            </div>
          </div>

          <div className="hms-box">
            <div className="hms-box-title">Bill Details</div>
            <div className="hms-form-row">
              <label>Bill No</label>
              <input
                className="hms-field"
                readOnly
                value={billNo}
                placeholder="Financial-year series on Save (e.g. OPD202600001)"
              />
            </div>
            <div className="hms-form-row">
              <label>Date / Visit</label>
              <div className="hms-pair">
                <input className="hms-field" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
                <select className="hms-field" value={visitCategory} onChange={(e) => setVisitCategory(e.target.value)}>
                  <option value="opd">OPD</option>
                  <option value="reference">Reference</option>
                  <option value="appointment">Appointment</option>
                  <option value="online_booking">Online Booking</option>
                </select>
              </div>
            </div>
            <div className="hms-form-row">
              <label>Session / Token</label>
              <div className="hms-pair">
                <select
                  className="hms-field"
                  value={tokenSession}
                  onChange={(e) => setTokenSession(e.target.value as 'morning' | 'evening')}
                >
                  <option value="morning">Morning</option>
                  <option value="evening">Evening</option>
                </select>
                <input className="hms-field" readOnly value={tokenNo} placeholder="Assigned on Save" />
              </div>
            </div>
            {scheduled && (
              <div className="hms-form-row">
                <label>Booking Date</label>
                <input
                  className="hms-field"
                  type="date"
                  value={appointmentDate}
                  onChange={(e) => setAppointmentDate(e.target.value)}
                />
              </div>
            )}
            <div className="hms-form-row">
              <label>Dept / Scheme</label>
              <div className="hms-pair">
                <select className="hms-field" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} — {d.name}
                    </option>
                  ))}
                </select>
                <input
                  className="hms-field"
                  value={scheme}
                  onChange={(e) => setScheme(e.target.value)}
                  placeholder="No Scheme"
                />
              </div>
            </div>
          </div>

          <div className="hms-net-row">
            <label>Net Amount</label>
            <input className="hms-net-input" readOnly value={net.toFixed(2)} />
          </div>
          <div className="hms-adv-row">
            <label>Advance Bal</label>
            <input className="hms-field" readOnly value={deposit.toFixed(2)} style={{ flex: 1 }} />
            <button className="hms-btn" type="button" onClick={enterAdvance}>
              Adjust Advance
            </button>
          </div>

          <div className="hms-box" style={{ flex: 1 }}>
            <div className="hms-box-title">Payments</div>
            <div className="hms-pay-toolbar">
              <button className="hms-btn" type="button" onClick={fillBalance}>
                Fill Balance
              </button>
              <button className="hms-btn" type="button" onClick={clearPayments}>
                Clear
              </button>
            </div>
            <table className="hms-table">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>Document No</th>
                  <th style={{ width: 90 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {payModes.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>
                      <input
                        placeholder="Cheque / UTR"
                        value={payAmounts[m.id]?.document_no || ''}
                        onChange={(e) =>
                          setPayAmounts((prev) => ({
                            ...prev,
                            [m.id]: { amount: prev[m.id]?.amount || '', document_no: e.target.value },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        style={{ textAlign: 'right' }}
                        placeholder="0"
                        value={payAmounts[m.id]?.amount || ''}
                        onChange={(e) =>
                          setPayAmounts((prev) => ({
                            ...prev,
                            [m.id]: { document_no: prev[m.id]?.document_no || '', amount: e.target.value },
                          }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hms-pay-foot">
              <span className="paid">Paid: {paid.toFixed(2)}</span>
              <span className="bal">Balance: {balance.toFixed(2)}</span>
            </div>
          </div>
        </aside>

        <section className="hms-bill-right">
          <div className="hms-box">
            <div className="hms-box-title">Doctor</div>
            <div className="hms-inline-bar" style={{ marginTop: 4 }}>
              <label className="hms-section-label">Doctor</label>
              <select className="hms-field" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">Select doctor</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.doctor_code} — {d.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="hms-box">
            <div className="hms-box-title">Service Filters</div>
            <div className="hms-inline-bar" style={{ marginTop: 4, flexWrap: 'wrap' }}>
              <label className="hms-section-label">Category</label>
              <select className="hms-field" style={{ maxWidth: 180 }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label className="hms-section-label">Package</label>
              <select className="hms-field" style={{ maxWidth: 200 }} value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                <option value="">Select Package</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div style={{ flex: 1 }} />
              <button className="hms-btn" type="button" onClick={() => { setCategoryId(''); setCatalogSearch('') }}>
                Show All
              </button>
              <button
                className="hms-btn"
                type="button"
                onClick={() => setStatus(packageId ? 'Package apply uses package items when configured' : 'Select a package')}
              >
                Apply Package
              </button>
            </div>
          </div>

          <div className="hms-inline-bar">
            <span className="hms-section-label">Available Services</span>
            <input
              className="hms-field"
              style={{ maxWidth: 280 }}
              placeholder="Search service name or code..."
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
            />
          </div>
          <div className="hms-scroll-table">
            <table className="hms-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>Add</th>
                  <th>Service</th>
                  <th style={{ width: 50 }}>Qty</th>
                  <th style={{ width: 80 }}>Rate</th>
                  <th style={{ width: 70 }}>Code</th>
                  <th style={{ width: 90 }}>Category</th>
                </tr>
              </thead>
              <tbody>
                {catalogRows.map((r, idx) => (
                  <tr key={r.id}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={r.checked}
                        onChange={(e) =>
                          setCatalogRows((rows) =>
                            rows.map((x, i) => (i === idx ? { ...x, checked: e.target.checked } : x)),
                          )
                        }
                      />
                    </td>
                    <td>{r.name}</td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        value={r.qty}
                        onChange={(e) =>
                          setCatalogRows((rows) =>
                            rows.map((x, i) =>
                              i === idx ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>{money(r.rate).toFixed(2)}</td>
                    <td>{r.code}</td>
                    <td>{r.category_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="hms-inline-bar">
            <span className="hms-section-label">Bill Lines</span>
            <div style={{ flex: 1 }} />
            <button className="hms-btn" type="button" onClick={addSelected}>
              Add Selected
            </button>
            <button className="hms-btn" type="button" onClick={removeSelectedLine}>
              Remove Line
            </button>
          </div>
          <div className="hms-scroll-table">
            <table className="hms-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th style={{ width: 50 }}>Qty</th>
                  <th style={{ width: 80 }}>Rate</th>
                  <th style={{ width: 90 }}>Amount</th>
                  <th style={{ width: 70 }}>Code</th>
                  <th style={{ width: 90 }}>Category</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>{l.service_name}</td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        value={l.quantity}
                        onChange={(e) =>
                          setLines((rows) =>
                            rows.map((x) =>
                              x.key === l.key
                                ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) }
                                : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={l.rate}
                        onChange={(e) =>
                          setLines((rows) =>
                            rows.map((x) =>
                              x.key === l.key ? { ...x, rate: Number(e.target.value) || 0 } : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>{(l.quantity * l.rate).toFixed(2)}</td>
                    <td>{l.service_code}</td>
                    <td>{l.category_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="hms-bill-footer">
            <button className="hms-btn hms-btn-primary" type="button" disabled={busy} onClick={() => void onSubmit()}>
              {busy ? 'Saving…' : modify ? 'Update Bill' : 'Save Bill'}
            </button>
            <button
              className="hms-btn"
              type="button"
              disabled={!billId}
              onClick={() => billId && void openHospitalReport(`/hospital/reports/opd-bill/${billId}/html`)}
            >
              Print Bill
            </button>
            {!modify && (
              <>
                <button className="hms-btn" type="button" onClick={holdBill}>
                  Hold Bill
                </button>
                <button className="hms-btn" type="button" onClick={resumeHeld}>
                  Resume Held
                </button>
                <button className="hms-btn" type="button" onClick={clearForm}>
                  Clear
                </button>
              </>
            )}
            <span className="hint">
              {modify
                ? 'Modify services and payments, then click Update Bill.'
                : 'Bill No uses OPD financial-year series (resets 1 April each year). Preview opens after save.'}
            </span>
          </div>
        </section>
      </div>
      <input className="hms-status" readOnly value={status} />
    </div>
  )
}
