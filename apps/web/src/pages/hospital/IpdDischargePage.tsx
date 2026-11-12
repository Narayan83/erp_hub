import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { openHospitalReport } from './billing/report'
import {
  Admission,
  BillLine,
  CatalogService,
  Doctor,
  IpdBillDetail,
  Page,
  Patient,
  PayMode,
  Ward,
  money,
  todayIso,
  uid,
} from './billing/types'
import './billing/hospital-bill.css'

type Props = { mode?: 'create' | 'modify'; initialBillId?: string }
type CatalogRow = CatalogService & { qty: number; checked: boolean }
type PayAmount = Record<string, { amount: string; document_no: string }>

export function IpdDischargePage({ mode = 'create', initialBillId }: Props) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const modify = mode === 'modify'
  const admissionFromQuery = params.get('admission_id')

  const [patient, setPatient] = useState<Patient | null>(null)
  const [patientNo, setPatientNo] = useState('')
  const [admission, setAdmission] = useState<Admission | null>(null)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [wards, setWards] = useState<Ward[]>([])
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([])
  const [payModes, setPayModes] = useState<PayMode[]>([])
  const [catalogAll, setCatalogAll] = useState<CatalogService[]>([])
  const [catalogRows, setCatalogRows] = useState<CatalogRow[]>([])
  const [catalogSearch, setCatalogSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')

  const [billId, setBillId] = useState<string | null>(initialBillId || null)
  const [billNo, setBillNo] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [wardId, setWardId] = useState('')
  const [bedNo, setBedNo] = useState('')
  const [admissionDate, setAdmissionDate] = useState(todayIso())
  const [dischargeDate, setDischargeDate] = useState(todayIso())
  const [billDate, setBillDate] = useState(todayIso())
  const [scheme, setScheme] = useState('')
  const [discount, setDiscount] = useState(0)
  const [adjustAdvance, setAdjustAdvance] = useState(0)
  const [hideAdvance, setHideAdvance] = useState(false)
  const [deposit, setDeposit] = useState(0)
  const [lines, setLines] = useState<BillLine[]>([])
  const [payAmounts, setPayAmounts] = useState<PayAmount>({})
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const gross = useMemo(() => lines.reduce((s, l) => s + l.quantity * l.rate, 0), [lines])
  const afterDiscount = Math.max(gross - discount, 0)
  const net = Math.max(afterDiscount - adjustAdvance, 0)
  const paid = useMemo(
    () => Object.values(payAmounts).reduce((s, p) => s + (Number(p.amount) || 0), 0),
    [payAmounts],
  )
  const balance = Number((net - paid).toFixed(2))
  const stayDays = useMemo(() => {
    try {
      const a = new Date(admissionDate)
      const d = new Date(dischargeDate)
      return Math.max(Math.floor((d.getTime() - a.getTime()) / 86400000) + 1, 1)
    } catch {
      return 1
    }
  }, [admissionDate, dischargeDate])

  useEffect(() => {
    void (async () => {
      const [docs, w, services, pms, cats] = await Promise.all([
        api.get<Page<Doctor>>('/hospital/doctors', { page: 1, page_size: 200 }),
        api.get<Ward[]>('/hospital/wards'),
        api.get<CatalogService[]>('/hospital/ipd-discharge/catalog/services'),
        api.get<PayMode[]>('/hospital/payment-modes').catch(() => api.get<PayMode[]>('/accounts/payment-modes')),
        api.get<Array<{ id: string; name: string }>>('/hospital/service-categories'),
      ])
      setDoctors(docs.items || [])
      setWards(w || [])
      setCatalogAll(services || [])
      setPayModes(pms || [])
      setCategories(cats || [])
      const initPay: PayAmount = {}
      for (const m of pms || []) initPay[m.id] = { amount: '', document_no: '' }
      setPayAmounts(initPay)
    })().catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    const q = catalogSearch.trim().toLowerCase()
    setCatalogRows(
      catalogAll
        .filter((s) => !categoryId || s.category_id === categoryId)
        .filter((s) => !q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
        .map((s) => ({ ...s, qty: 1, checked: false, rate: money(s.rate) })),
    )
  }, [catalogAll, catalogSearch, categoryId])

  useEffect(() => {
    if (admissionFromQuery) void loadAdmission(admissionFromQuery)
  }, [admissionFromQuery])

  useEffect(() => {
    if (initialBillId) void loadBill(initialBillId)
  }, [initialBillId])

  async function refreshDeposit(patientId: string) {
    try {
      const dep = await api.get<{ balance: number | string }>('/hospital/cashbook/patient-deposit', {
        patient_id: patientId,
      })
      setDeposit(money(dep.balance))
    } catch {
      setDeposit(0)
    }
  }

  async function findPatient() {
    const q = patientNo.trim()
    if (!q) return
    const exact = await api.get<Page<Patient>>('/hospital/patients/search', {
      patient_no: q,
      page: 1,
      page_size: 5,
      active_only: true,
    })
    const hit = exact.items?.[0]
    if (!hit) {
      setError('Patient not found')
      return
    }
    setPatient(hit)
    setPatientNo(hit.patient_no)
    await refreshDeposit(hit.id)
    try {
      const admitted = await api.get<Admission[]>('/hospital/ipd-admissions', {
        status: 'admitted',
        patient_id: hit.id,
      })
      if (admitted?.[0]) await loadAdmission(admitted[0].id)
    } catch {
      /* optional */
    }
  }

  async function loadAdmission(id: string) {
    const adm = await api.get<Admission>(`/hospital/ipd-admissions/${id}`)
    setAdmission(adm)
    setPatient({ id: adm.patient_id, patient_no: adm.patient_no || '', full_name: adm.patient_name || '' })
    setPatientNo(adm.patient_no || '')
    setDoctorId(adm.doctor_id || '')
    setWardId(adm.ward_id || '')
    setBedNo(adm.bed_no || '')
    setAdmissionDate(String(adm.admission_date).slice(0, 10))
    await refreshDeposit(adm.patient_id)
    setStatus(`Admission ${adm.admission_no}`)
  }

  async function loadBill(id: string) {
    applyBill(await api.get<IpdBillDetail>(`/hospital/ipd-discharge/${id}`))
  }

  function applyBill(bill: IpdBillDetail) {
    setBillId(bill.id)
    setBillNo(bill.bill_no)
    setPatient({ id: bill.patient_id, patient_no: bill.patient_no || '', full_name: bill.patient_name || '' })
    setPatientNo(bill.patient_no || '')
    setDoctorId(bill.doctor_id || '')
    setWardId(bill.ward_id || '')
    setBedNo(bill.bed_no || '')
    setAdmissionDate(bill.admission_date ? String(bill.admission_date).slice(0, 10) : todayIso())
    setDischargeDate(bill.discharge_date ? String(bill.discharge_date).slice(0, 10) : todayIso())
    setBillDate(String(bill.bill_date).slice(0, 10))
    setScheme(bill.scheme || '')
    setDiscount(money(bill.scheme_discount))
    setAdjustAdvance(money(bill.adjust_advance))
    setHideAdvance(!!bill.hide_advance_on_bill)
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
        next[p.payment_mode_id] = { amount: String(money(p.amount)), document_no: p.document_no || '' }
      }
      return next
    })
    void refreshDeposit(bill.patient_id)
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

  function fillBalance() {
    const cash = payModes.find((m) => m.is_cash || m.code === 'CASH') || payModes[0]
    if (!cash) return
    setPayAmounts((prev) => {
      const next: PayAmount = {}
      for (const m of payModes) next[m.id] = { amount: '', document_no: prev[m.id]?.document_no || '' }
      next[cash.id] = { amount: net > 0 ? net.toFixed(2) : '', document_no: '' }
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

  function enterAdvance() {
    if (deposit > 0.01 && gross > 0) setAdjustAdvance(Math.min(deposit, afterDiscount))
    else {
      const v = window.prompt(`Adjust advance (available ${deposit.toFixed(2)})`, String(adjustAdvance || ''))
      if (v == null) return
      setAdjustAdvance(Math.min(Math.max(Number(v) || 0, 0), deposit))
    }
  }

  async function onSubmit() {
    setError(null)
    if (!patient) return setError('Select patient')
    if (!doctorId && !modify) return setError('Doctor is required')
    if (!lines.length) return setError('Add at least one service')
    if (dischargeDate < admissionDate) return setError('Discharge date must be ≥ admission date')
    if (deposit > 0.01 && gross > 0 && adjustAdvance <= 0) {
      return setError('Advance adjustment is required when patient has deposit balance')
    }
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
      admission_id: admission?.id || null,
      ward_id: wardId || null,
      bed_no: bedNo || null,
      doctor_id: doctorId || null,
      admission_date: admissionDate,
      discharge_date: dischargeDate,
      bill_date: billDate,
      payment_mode_id: payments[0]?.payment_mode_id || null,
      payments,
      is_cash: true,
      scheme: scheme || null,
      admin_charges: 0,
      scheme_discount: discount,
      sanctioned_scheme_amount: 0,
      adjust_advance: adjustAdvance,
      hide_advance_on_bill: hideAdvance,
      lines: lines.map((l) => ({
        service_id: l.service_id,
        quantity: l.quantity,
        rate: l.rate,
        service_name: l.service_name,
      })),
    }

    setBusy(true)
    try {
      let saved: IpdBillDetail
      if (modify && billId) {
        const { doctor_id: _d, admission_id: _a, ...updateBody } = payload
        saved = await api.put<IpdBillDetail>(`/hospital/ipd-discharge/${billId}`, updateBody)
      } else {
        saved = await api.post<IpdBillDetail>('/hospital/ipd-discharge', {
          ...payload,
          patient_id: patient.id,
        })
      }
      setBillId(saved.id)
      setBillNo(saved.bill_no)
      setStatus(`Saved ${saved.bill_no}`)
      try {
        await openHospitalReport(`/hospital/reports/ipd-bill/${saved.id}/html`)
      } catch {
        /* optional */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const actions = [
    { label: 'Admitted List', go: () => navigate('/ipd_bill') },
    { label: 'Reprint Bill', go: () => navigate('/ipd_bill_reprint') },
    { label: 'Discharge Summary', go: () => navigate('/diagnose_management') },
    { label: 'Collect Advance', go: () => navigate('/advance_collection') },
    { label: 'Adjust Advance', go: enterAdvance },
    { label: 'IPD Admission', go: () => navigate('/in_patient_admission') },
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
              <label>Admission No</label>
              <input className="hms-field" readOnly value={admission?.admission_no || ''} placeholder="Optional / linked" />
            </div>
          </div>

          <div className="hms-box">
            <div className="hms-box-title">Bill Details</div>
            <div className="hms-form-row">
              <label>Bill No</label>
              <input className="hms-field" readOnly value={billNo} placeholder="IPDB financial-year series" />
            </div>
            <div className="hms-form-row">
              <label>Admit / Discharge</label>
              <div className="hms-pair">
                <input className="hms-field" type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />
                <input className="hms-field" type="date" value={dischargeDate} onChange={(e) => setDischargeDate(e.target.value)} />
              </div>
            </div>
            <div className="hms-form-row">
              <label>Entry Date / Stay</label>
              <div className="hms-pair">
                <input className="hms-field" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
                <input className="hms-field" readOnly value={`${stayDays} day(s)`} />
              </div>
            </div>
            <div className="hms-form-row">
              <label>Ward / Bed</label>
              <div className="hms-pair">
                <select className="hms-field" value={wardId} onChange={(e) => setWardId(e.target.value)}>
                  <option value="">—</option>
                  {wards.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </select>
                <input className="hms-field" value={bedNo} onChange={(e) => setBedNo(e.target.value)} />
              </div>
            </div>
            <div className="hms-form-row">
              <label>Scheme / Disc</label>
              <div className="hms-pair">
                <input className="hms-field" value={scheme} onChange={(e) => setScheme(e.target.value)} placeholder="No Scheme" />
                <input
                  className="hms-field"
                  type="number"
                  min={0}
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="hms-form-row">
              <label>Hide advance</label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={hideAdvance} onChange={(e) => setHideAdvance(e.target.checked)} />
                Don't show advance on bill print
              </label>
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
              <select className="hms-field" value={doctorId} disabled={modify} onChange={(e) => setDoctorId(e.target.value)}>
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
            <div className="hms-inline-bar" style={{ marginTop: 4 }}>
              <label className="hms-section-label">Category</label>
              <select className="hms-field" style={{ maxWidth: 200 }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="hms-btn" type="button" onClick={() => { setCategoryId(''); setCatalogSearch('') }}>
                Show All
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
            <button className="hms-btn" type="button" onClick={() => setLines((p) => p.slice(0, -1))}>
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
                            rows.map((x) => (x.key === l.key ? { ...x, rate: Number(e.target.value) || 0 } : x)),
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
              {busy ? 'Saving…' : modify ? 'Update Bill' : 'Discharge & Save Bill'}
            </button>
            <button
              className="hms-btn"
              type="button"
              disabled={!billId}
              onClick={() => billId && void openHospitalReport(`/hospital/reports/ipd-bill/${billId}/html`)}
            >
              Print Bill
            </button>
            <span className="hint">
              IPD Bill posts to discharge API (same as hospital desktop). Preview opens after save.
            </span>
          </div>
        </section>
      </div>
      <input className="hms-status" readOnly value={status} />
    </div>
  )
}
