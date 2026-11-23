import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { listAll } from './billing/paged'
import { openHospitalReport } from './billing/report'
import { ResizableScrollTable } from './billing/ResizableScrollTable'
import { ServiceSearchField } from './billing/ServiceSearchField'
import {
  BillLine,
  CatalogService,
  Department,
  Doctor,
  Page,
  Patient,
  PayMode,
  money,
  todayIso,
  uid,
} from './billing/types'
import './billing/hospital-bill.css'

type Props = { mode?: 'create' | 'modify' | 'reprint' | 'cancel'; initialBillId?: string }

type CatalogRow = CatalogService & { qty: number; checked: boolean }

type PathologyBillDetail = {
  id: string
  bill_no: string
  bill_date: string
  patient_id: string
  patient_no?: string | null
  patient_name?: string | null
  doctor_id?: string | null
  referring_doctor?: string | null
  department_id?: string | null
  payment_mode_id?: string | null
  is_cash?: boolean
  scheme?: string | null
  admin_charges?: number | string
  scheme_discount?: number | string
  adjust_advance?: number | string
  sample_no?: string | null
  sample_date?: string | null
  order_status?: string | null
  net_amount?: number | string
  remarks?: string | null
  status?: string
  lines?: Array<{
    service_id?: string | null
    service_code: string
    service_name: string
    category_name?: string | null
    quantity: number
    rate: number | string
  }>
}

const HOLD_KEY = 'hms_pathology_bill_hold'

export function PathologyBillPage({ mode = 'create', initialBillId }: Props) {
  const modify = mode === 'modify'
  const reprint = mode === 'reprint'
  const cancel = mode === 'cancel'

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
  const [billDate, setBillDate] = useState(todayIso())
  const [sampleNo, setSampleNo] = useState('')
  const [sampleDate, setSampleDate] = useState(todayIso())
  const [orderStatus, setOrderStatus] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [referringDoctor, setReferringDoctor] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [paymentModeId, setPaymentModeId] = useState('')
  const [isCash, setIsCash] = useState(true)
  const [scheme, setScheme] = useState('')
  const [adminCharges, setAdminCharges] = useState(0)
  const [schemeDiscount, setSchemeDiscount] = useState(0)
  const [adjustAdvance, setAdjustAdvance] = useState(0)
  const [deposit, setDeposit] = useState(0)
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<BillLine[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lookupBillNo, setLookupBillNo] = useState('')

  const gross = useMemo(() => lines.reduce((s, l) => s + l.quantity * l.rate, 0), [lines])
  const net = Math.max(gross + adminCharges - schemeDiscount - adjustAdvance, 0)

  useEffect(() => {
    void (async () => {
      const [docs, deps, services, pms, cats, pkgs] = await Promise.all([
        listAll<Doctor>('/hospital/doctors'),
        api.get<Department[]>('/hospital/departments'),
        api.get<CatalogService[]>('/hospital/pathology-bills/catalog/services'),
        api.get<PayMode[]>('/hospital/payment-modes').catch(() => api.get<PayMode[]>('/accounts/payment-modes')),
        api.get<Array<{ id: string; name: string }>>('/hospital/service-groups'),
        api.get<Array<{ id: string; name: string }>>('/hospital/billing-packages').catch(() => []),
      ])
      setDoctors(docs)
      setDepartments(deps || [])
      setCatalogAll(services || [])
      setPayModes(pms || [])
      setCategories(cats || [])
      setPackages(pkgs || [])
      if (!doctorId && docs[0]) setDoctorId(docs[0].id)
      const pathDept = (deps || []).find((d) => d.code?.toUpperCase() === 'PATH')
      if (!departmentId && pathDept) setDepartmentId(pathDept.id)
      const cash = (pms || []).find((m) => m.is_cash || m.code === 'CASH') || (pms || [])[0]
      if (!paymentModeId && cash) setPaymentModeId(cash.id)
      setCatalogRows((services || []).map((s) => ({ ...s, qty: 1, checked: false, rate: money(s.rate) })))
    })().catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    if (initialBillId) void loadBill(initialBillId)
  }, [initialBillId])

  useEffect(() => {
    const q = catalogSearch.trim().toLowerCase()
    setCatalogRows(
      catalogAll
        .filter((s) => !categoryId || s.group_id === categoryId)
        .filter(
          (s) =>
            !q ||
            s.name.toLowerCase().includes(q) ||
            s.code.toLowerCase().includes(q) ||
            (s.group_name || '').toLowerCase().includes(q),
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
    const bill = await api.get<PathologyBillDetail>(`/hospital/pathology-bills/${id}`)
    applyBill(bill)
  }

  async function loadBillByNo() {
    const no = lookupBillNo.trim() || billNo.trim()
    if (!no) return setError('Enter bill number')
    setError(null)
    try {
      const bill = await api.get<PathologyBillDetail>(`/hospital/pathology-bills/by-no/${encodeURIComponent(no)}`)
      applyBill(bill)
      if (reprint) {
        await openHospitalReport(`/hospital/reports/pathology-bill/${bill.id}/html`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function applyBill(bill: PathologyBillDetail) {
    setBillId(bill.id)
    setBillNo(bill.bill_no)
    setBillDate(String(bill.bill_date).slice(0, 10))
    setSampleNo(bill.sample_no || '')
    setSampleDate(bill.sample_date ? String(bill.sample_date).slice(0, 10) : todayIso())
    setOrderStatus(bill.order_status || bill.status || '')
    setDoctorId(bill.doctor_id || '')
    setReferringDoctor(bill.referring_doctor || '')
    setDepartmentId(bill.department_id || '')
    setPaymentModeId(bill.payment_mode_id || '')
    setIsCash(bill.is_cash !== false)
    setScheme(bill.scheme || '')
    setAdminCharges(money(bill.admin_charges))
    setSchemeDiscount(money(bill.scheme_discount))
    setAdjustAdvance(money(bill.adjust_advance))
    setRemarks(bill.remarks || '')
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
          category_name: row.group_name,
          quantity: row.qty || 1,
          rate: money(row.rate),
        })
      }
    }
    setLines(next)
    setCatalogRows((rows) => rows.map((r) => ({ ...r, checked: false })))
  }

  function clearForm() {
    if (modify) return
    setBillId(null)
    setBillNo('')
    setBillDate(todayIso())
    setSampleNo('')
    setSampleDate(todayIso())
    setOrderStatus('')
    setScheme('')
    setAdminCharges(0)
    setSchemeDiscount(0)
    setAdjustAdvance(0)
    setRemarks('')
    setReferringDoctor('')
    setLines([])
    setPatient(null)
    setPatientNo('')
    setDeposit(0)
    setError(null)
    setStatus('Cleared')
  }

  function holdBill() {
    localStorage.setItem(
      HOLD_KEY,
      JSON.stringify({
        patient,
        patientNo,
        billDate,
        sampleNo,
        sampleDate,
        doctorId,
        referringDoctor,
        departmentId,
        paymentModeId,
        isCash,
        scheme,
        adminCharges,
        schemeDiscount,
        adjustAdvance,
        remarks,
        lines,
        deposit,
      }),
    )
    setStatus('Bill held locally — use Resume Held to restore')
  }

  function resumeHeld() {
    const raw = localStorage.getItem(HOLD_KEY)
    if (!raw) return setStatus('No held bill')
    try {
      const h = JSON.parse(raw)
      setPatient(h.patient)
      setPatientNo(h.patientNo || '')
      setBillDate(h.billDate || todayIso())
      setSampleNo(h.sampleNo || '')
      setSampleDate(h.sampleDate || todayIso())
      setDoctorId(h.doctorId || '')
      setReferringDoctor(h.referringDoctor || '')
      setDepartmentId(h.departmentId || '')
      setPaymentModeId(h.paymentModeId || '')
      setIsCash(h.isCash !== false)
      setScheme(h.scheme || '')
      setAdminCharges(h.adminCharges || 0)
      setSchemeDiscount(h.schemeDiscount || 0)
      setAdjustAdvance(h.adjustAdvance || 0)
      setRemarks(h.remarks || '')
      setLines(h.lines || [])
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
    if (!lines.length) return setError('Add at least one test/service line')

    const payload = {
      doctor_id: doctorId || null,
      referring_doctor: referringDoctor || null,
      department_id: departmentId || null,
      payment_mode_id: paymentModeId || null,
      is_cash: isCash,
      scheme: scheme || null,
      admin_charges: adminCharges,
      scheme_discount: schemeDiscount,
      adjust_advance: adjustAdvance,
      remarks: remarks || null,
      bill_date: billDate,
      sample_date: sampleDate || null,
      sample_no: sampleNo || null,
      lines: lines.map((l) => ({
        service_id: l.service_id,
        quantity: l.quantity,
        rate: l.rate,
        service_name: l.service_name,
      })),
    }

    setBusy(true)
    try {
      let saved: PathologyBillDetail
      if (modify && billId) {
        saved = await api.put<PathologyBillDetail>(`/hospital/pathology-bills/${billId}`, payload)
      } else {
        saved = await api.post<PathologyBillDetail>('/hospital/pathology-bills', {
          ...payload,
          patient_id: patient.id,
        })
      }
      setBillId(saved.id)
      setBillNo(saved.bill_no)
      setOrderStatus(saved.order_status || saved.status || '')
      setStatus(`Saved ${saved.bill_no}`)
      try {
        await openHospitalReport(`/hospital/reports/pathology-bill/${saved.id}/html`)
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

  async function onCancelBill() {
    if (!billId) return setError('Load a bill first')
    const reason = window.prompt('Cancel reason', 'Cancelled')
    if (reason == null) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/hospital/pathology-bills/${billId}/cancel`, { reason })
      setStatus(`Cancelled ${billNo}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const readOnlyLookup = reprint || cancel

  return (
    <div className="hms-bill-page">
      {error && <div className="hms-error">{error}</div>}

      <div className="hms-bill-split">
        <aside className="hms-bill-left">
          {(reprint || cancel || modify) && (
            <div className="hms-box">
              <div className="hms-box-title">Find Bill</div>
              <div className="hms-form-row">
                <label>Bill No</label>
                <div className="hms-pair">
                  <input
                    className="hms-field"
                    value={lookupBillNo}
                    onChange={(e) => setLookupBillNo(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void loadBillByNo()}
                    placeholder="Pathology bill no"
                  />
                  <button className="hms-btn" type="button" onClick={() => void loadBillByNo()}>
                    Load
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="hms-box">
            <div className="hms-box-title">Patient</div>
            <div className="hms-form-row">
              <label>Patient Id</label>
              <div className="hms-pair">
                <input
                  className="hms-field"
                  value={patientNo}
                  readOnly={modify || readOnlyLookup}
                  onChange={(e) => setPatientNo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void findPatient()}
                  placeholder="Patient No"
                />
                {!modify && !readOnlyLookup && (
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
            <div className="hms-box-title">Sample & Bill</div>
            <div className="hms-form-row">
              <label>Bill No</label>
              <input className="hms-field" readOnly value={billNo} placeholder="Assigned on Save" />
            </div>
            <div className="hms-form-row">
              <label>Bill Date</label>
              <input
                className="hms-field"
                type="date"
                value={billDate}
                disabled={readOnlyLookup}
                onChange={(e) => setBillDate(e.target.value)}
              />
            </div>
            <div className="hms-form-row">
              <label>Sample No</label>
              <input
                className="hms-field"
                value={sampleNo}
                disabled={readOnlyLookup}
                onChange={(e) => setSampleNo(e.target.value)}
                placeholder="Sample / Lab ID"
              />
            </div>
            <div className="hms-form-row">
              <label>Sample Date</label>
              <input
                className="hms-field"
                type="date"
                value={sampleDate}
                disabled={readOnlyLookup}
                onChange={(e) => setSampleDate(e.target.value)}
              />
            </div>
            <div className="hms-form-row">
              <label>Order Status</label>
              <input className="hms-field" readOnly value={orderStatus} placeholder="Created on Save" />
            </div>
            <div className="hms-form-row">
              <label>Cash/Credit</label>
              <select
                className="hms-field"
                value={isCash ? 'cash' : 'credit'}
                disabled={readOnlyLookup}
                onChange={(e) => setIsCash(e.target.value === 'cash')}
              >
                <option value="cash">1.CASH</option>
                <option value="credit">2.CREDIT</option>
              </select>
            </div>
            <div className="hms-form-row">
              <label>Payment Mode</label>
              <select
                className="hms-field"
                value={paymentModeId}
                disabled={readOnlyLookup}
                onChange={(e) => setPaymentModeId(e.target.value)}
              >
                <option value="">Select</option>
                {payModes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="hms-form-row">
              <label>Department</label>
              <select
                className="hms-field"
                value={departmentId}
                disabled={readOnlyLookup}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">Select</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="hms-form-row">
              <label>Scheme</label>
              <input
                className="hms-field"
                value={scheme}
                disabled={readOnlyLookup}
                onChange={(e) => setScheme(e.target.value)}
                placeholder="No Scheme"
              />
            </div>
          </div>

          <div className="hms-box">
            <div className="hms-box-title">Charges</div>
            <div className="hms-form-row">
              <label>Admin Charges</label>
              <input
                className="hms-field"
                type="number"
                min={0}
                step="0.01"
                value={adminCharges}
                disabled={readOnlyLookup}
                onChange={(e) => setAdminCharges(Number(e.target.value) || 0)}
              />
            </div>
            <div className="hms-form-row">
              <label>Scheme Discount</label>
              <input
                className="hms-field"
                type="number"
                min={0}
                step="0.01"
                value={schemeDiscount}
                disabled={readOnlyLookup}
                onChange={(e) => setSchemeDiscount(Number(e.target.value) || 0)}
              />
            </div>
            <div className="hms-form-row">
              <label>Adjust Advance</label>
              <div className="hms-pair">
                <input className="hms-field" readOnly value={adjustAdvance.toFixed(2)} />
                {!readOnlyLookup && (
                  <button className="hms-btn hms-btn-sm" type="button" onClick={enterAdvance}>
                    Set
                  </button>
                )}
              </div>
            </div>
            <div className="hms-adv-row">
              <span className="hms-section-label">Advance Bal</span>
              <strong>{deposit.toFixed(2)}</strong>
            </div>
          </div>

          <div className="hms-net-row">
            <label>NET AMOUNT</label>
            <input className="hms-net-input" readOnly value={net.toFixed(2)} />
          </div>
        </aside>

        <section className="hms-bill-right">
          <div className="hms-filter-bar">
            <label className="hms-section-label">Pathologist</label>
            <select
              className="hms-field hms-doctor-field"
              value={doctorId}
              disabled={readOnlyLookup}
              onChange={(e) => setDoctorId(e.target.value)}
            >
              <option value="">Select doctor</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.doctor_code} — {d.full_name}
                </option>
              ))}
            </select>
            <label className="hms-section-label">Package</label>
            <select
              className="hms-field"
              style={{ maxWidth: 150 }}
              value={packageId}
              disabled={readOnlyLookup}
              onChange={(e) => setPackageId(e.target.value)}
            >
              <option value="">Select Package</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="hms-btn hms-btn-sm"
              type="button"
              disabled={readOnlyLookup}
              onClick={() =>
                setStatus(packageId ? 'Package apply uses package items when configured' : 'Select a package')
              }
            >
              Apply Package
            </button>
          </div>

          <div className="hms-filter-bar">
            <ServiceSearchField
              value={catalogSearch}
              onChange={setCatalogSearch}
              placeholder="Search test name or code..."
              disabled={readOnlyLookup}
            />
            <select
              className="hms-field"
              style={{ maxWidth: 140 }}
              aria-label="Category"
              value={categoryId}
              disabled={readOnlyLookup}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              className="hms-field"
              style={{ maxWidth: 160 }}
              aria-label="Ref. Doctor"
              value={referringDoctor}
              disabled={readOnlyLookup}
              onChange={(e) => setReferringDoctor(e.target.value)}
              placeholder="Ref. doctor"
            />
            <button
              className="hms-btn hms-btn-sm"
              type="button"
              disabled={readOnlyLookup}
              onClick={() => {
                setCategoryId('')
                setCatalogSearch('')
              }}
            >
              Show All
            </button>
          </div>

          <ResizableScrollTable>
            <table className="hms-table hms-table-compact">
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
                        disabled={readOnlyLookup}
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
                        disabled={readOnlyLookup}
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
                    <td>{r.group_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResizableScrollTable>

          <div className="hms-inline-bar">
            <span className="hms-section-label">Bill Lines</span>
            <div style={{ flex: 1 }} />
            {!readOnlyLookup && (
              <>
                <button className="hms-btn hms-btn-sm" type="button" onClick={addSelected}>
                  Add Selected
                </button>
                <button className="hms-btn hms-btn-sm" type="button" onClick={() => setLines((p) => p.slice(0, -1))}>
                  Remove Line
                </button>
              </>
            )}
          </div>
          <ResizableScrollTable>
            <table className="hms-table hms-table-compact">
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
                        disabled={readOnlyLookup}
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
                        disabled={readOnlyLookup}
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
          </ResizableScrollTable>

          <div className="hms-inline-bar">
            <span className="hms-section-label">Notes</span>
            <input
              className="hms-field"
              value={remarks}
              disabled={readOnlyLookup}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="General note / remarks"
            />
          </div>

          <div className="hms-bill-footer">
            {reprint ? (
              <button
                className="hms-btn hms-btn-primary"
                type="button"
                disabled={!billId || busy}
                onClick={() => billId && void openHospitalReport(`/hospital/reports/pathology-bill/${billId}/html`)}
              >
                Print Bill
              </button>
            ) : cancel ? (
              <button className="hms-btn hms-btn-primary" type="button" disabled={!billId || busy} onClick={() => void onCancelBill()}>
                {busy ? 'Cancelling…' : 'Cancel Bill'}
              </button>
            ) : (
              <>
                <button className="hms-btn hms-btn-primary" type="button" disabled={busy} onClick={() => void onSubmit()}>
                  {busy ? 'Saving…' : modify ? 'Update Bill' : 'Save Bill'}
                </button>
                <button
                  className="hms-btn"
                  type="button"
                  disabled={!billId}
                  onClick={() => billId && void openHospitalReport(`/hospital/reports/pathology-bill/${billId}/html`)}
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
              </>
            )}
            <span className="hint">
              {reprint
                ? 'Load a pathology bill number to reprint.'
                : cancel
                  ? 'Load a pathology bill number, then cancel.'
                  : 'Pathology bill — catalog shows 10 rows; scroll for more. Content fits one page.'}
            </span>
          </div>
        </section>
      </div>
      <input className="hms-status" readOnly value={status} />
    </div>
  )
}
