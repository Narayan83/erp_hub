import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { openHospitalReport } from '../billing/report'
import { Banner, Box, FieldWrap, FoundPatient, PatientFind } from '../shared/hmsKit'
import { errMsg, fmtMoney, todayIso, unwrapList } from '../shared/hmsShared'

type Props = { menuCode: string; title?: string }
type OptionService = {
  service_id: string
  service_code?: string | null
  service_name: string
  rate?: number | string | null
  service_charge?: number | string | null
}
type Option = {
  id: string
  name: string
  menu_code: string
  doctor_id: string | null
  doctor_name: string | null
  use_patient_id: boolean
  default_rate: number | string
  bill_prefix: string
  services: OptionService[]
}
type PayMode = { id: string; code: string; name: string; is_cash?: boolean }
type PayCell = { amount: string; document_no: string }
type Doctor = { id: string; doctor_code?: string | null; full_name?: string | null; is_active?: boolean }
type Bill = {
  id: string
  bill_no: string
  bill_date: string
  patient_id: string | null
  patient_no: string | null
  patient_name: string
  doctor_id: string | null
  doctor_name?: string | null
  service_name: string
  services: Array<{ service_id: string; service_name: string; rate: number | string }>
  rate: number | string
  payment_mode_id: string | null
  payment_mode_name: string
}
type Report = {
  rows: Array<{ serial_no: number; bill_id: string; bill_no: string; bill_date: string; patient_name: string; amount: number | string }>
  grand_total: number | string
}

/** Single Service OPD bill — option resolved by sidebar menu code (sso_*). */
export function SingleServiceOpdBillPage({ menuCode, title }: Props) {
  const [option, setOption] = useState<Option | null>(null)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [doctorId, setDoctorId] = useState('')
  const [modes, setModes] = useState<PayMode[]>([])
  const [pay, setPay] = useState<Record<string, PayCell>>({})
  const [billId, setBillId] = useState<string | null>(null)
  const [billNo, setBillNo] = useState('')
  const [billDate, setBillDate] = useState(todayIso())
  const [patient, setPatient] = useState<FoundPatient | null>(null)
  const [patientName, setPatientName] = useState('')
  const [rates, setRates] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Bill[]>([])
  const [fromDate, setFromDate] = useState(todayIso())
  const [toDate, setToDate] = useState(todayIso())
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const cashMode = useCallback(
    (pm: PayMode[]) => pm.find((m) => m.is_cash || m.code === 'CASH') || pm[0],
    [],
  )

  const fillCash = useCallback(
    (pm: PayMode[], amount: number, prev: Record<string, PayCell> = {}) => {
      const cash = cashMode(pm)
      const next: Record<string, PayCell> = {}
      for (const m of pm) next[m.id] = { amount: '', document_no: prev[m.id]?.document_no || '' }
      if (cash && amount > 0) next[cash.id] = { amount: amount.toFixed(2), document_no: next[cash.id].document_no }
      return next
    },
    [cashMode],
  )

  const resetForm = useCallback((o: Option | null, pm: PayMode[]) => {
    setBillId(null)
    setBillNo('')
    setBillDate(todayIso())
    setPatient(null)
    setPatientName('')
    setDoctorId(o?.doctor_id || '')
    const r: Record<string, string> = {}
    let amount = 0
    for (const s of o?.services || []) {
      const rate = Number(s.rate ?? o?.default_rate ?? 0) || 0
      r[s.service_id] = String(s.rate ?? o?.default_rate ?? 0)
      amount += rate
    }
    setRates(r)
    setPicked(new Set((o?.services || []).map((s) => s.service_id)))
    setPay(fillCash(pm, amount))
  }, [fillCash])

  useEffect(() => {
    setOption(null)
    setReport(null)
    setHits([])
    setError(null)
    setOk(null)
    void (async () => {
      try {
        const [o, m, docs] = await Promise.all([
          api.get<Option>(`/hospital/single-service-opd/options/by-menu/${encodeURIComponent(menuCode)}`),
          api.get<unknown>('/hospital/payment-modes'),
          api.get<unknown>('/hospital/doctors', { page: 1, page_size: 100 }).catch(() => []),
        ])
        const pm = unwrapList<PayMode>(m).filter((mode) => mode.id)
        const doctorRows = unwrapList<Doctor>(docs).filter((d) => d.is_active !== false)
        if (o.doctor_id && !doctorRows.some((d) => d.id === o.doctor_id)) {
          doctorRows.unshift({ id: o.doctor_id, full_name: o.doctor_name })
        }
        setOption(o)
        setDoctors(doctorRows)
        setModes(pm)
        resetForm(o, pm)
      } catch (e) {
        setError(errMsg(e))
      }
    })()
  }, [menuCode, resetForm])

  const loadReport = useCallback(async () => {
    if (!option) return
    try {
      setReport(
        await api.get<Report>('/hospital/single-service-opd/bills/report', {
          option_id: option.id,
          from_date: fromDate,
          to_date: toDate,
        }),
      )
    } catch (e) {
      setError(errMsg(e))
    }
  }, [option, fromDate, toDate])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

  const total = useMemo(
    () =>
      (option?.services || [])
        .filter((s) => picked.has(s.service_id))
        .reduce((sum, s) => sum + (Number(rates[s.service_id]) || 0), 0),
    [option, picked, rates],
  )

  const paid = useMemo(
    () => Object.values(pay).reduce((sum, cell) => sum + (Number(cell.amount) || 0), 0),
    [pay],
  )
  const balance = Number((total - paid).toFixed(2))

  function setPayCell(id: string, patch: Partial<PayCell>) {
    setPay((prev) => ({
      ...prev,
      [id]: { amount: prev[id]?.amount || '', document_no: prev[id]?.document_no || '', ...patch },
    }))
  }

  function fillBalance() {
    const cash = cashMode(modes)
    if (!cash) return
    setPay((prev) => {
      const paidNow = Object.values(prev).reduce((sum, cell) => sum + (Number(cell.amount) || 0), 0)
      const due = Number((total - paidNow).toFixed(2))
      if (due <= 0) return prev
      if ((Number(prev[cash.id]?.amount) || 0) === 0) {
        return { ...prev, [cash.id]: { amount: due.toFixed(2), document_no: prev[cash.id]?.document_no || '' } }
      }
      const empty = modes.find((m) => (Number(prev[m.id]?.amount) || 0) === 0)
      if (!empty) return prev
      return { ...prev, [empty.id]: { amount: due.toFixed(2), document_no: prev[empty.id]?.document_no || '' } }
    })
  }

  function clearPayments() {
    setPay((prev) => {
      const next: Record<string, PayCell> = {}
      for (const m of modes) next[m.id] = { amount: '', document_no: prev[m.id]?.document_no || '' }
      return next
    })
  }

  function applyServiceChange(nextPicked: Set<string>, nextRates: Record<string, string>) {
    const amount = (option?.services || [])
      .filter((s) => nextPicked.has(s.service_id))
      .reduce((sum, s) => sum + (Number(nextRates[s.service_id]) || 0), 0)
    setPay((prev) => fillCash(modes, amount, prev))
  }

  function load(b: Bill) {
    setBillId(b.id)
    setBillNo(b.bill_no)
    setBillDate(b.bill_date)
    setPatient(
      b.patient_id
        ? { id: b.patient_id, patient_no: b.patient_no || '', full_name: b.patient_name }
        : null,
    )
    setPatientName(b.patient_name)
    setPicked(new Set(b.services.map((s) => s.service_id)))
    setRates((prev) => {
      const next = { ...prev }
      for (const s of b.services) next[s.service_id] = String(s.rate)
      return next
    })
    setDoctorId(b.doctor_id || option?.doctor_id || '')
    const amount = Number(b.rate) || 0
    const next: Record<string, PayCell> = {}
    for (const m of modes) next[m.id] = { amount: '', document_no: '' }
    if (b.payment_mode_id && amount > 0) {
      next[b.payment_mode_id] = { amount: amount.toFixed(2), document_no: '' }
    }
    setPay(next)
    setHits([])
    setOk(null)
  }

  async function search(e: FormEvent) {
    e.preventDefault()
    if (!option || !q.trim()) return
    setError(null)
    try {
      const list = await api.get<Bill[]>('/hospital/single-service-opd/bills/search', {
        option_id: option.id,
        q: q.trim(),
      })
      setHits(list)
      if (!list.length) setError('No bills found')
    } catch (err) {
      setError(errMsg(err))
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!option) return
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      if (option.use_patient_id && !patient) throw new Error('Find the patient before saving')
      if (!option.use_patient_id && !patientName.trim()) throw new Error('Enter the patient name')
      const lines = option.services
        .filter((s) => picked.has(s.service_id))
        .map((s) => ({ service_id: s.service_id, rate: Number(rates[s.service_id]) || 0 }))
      if (!lines.length) throw new Error('Tick at least one service')
      if (total > 0.01 && Math.abs(balance) > 0.01) {
        throw new Error(`Payment total (${paid.toFixed(2)}) must equal net amount (${total.toFixed(2)})`)
      }
      let paymentModeId: string | null = null
      let best = 0
      for (const [id, cell] of Object.entries(pay)) {
        const amount = Number(cell.amount) || 0
        if (amount > best) {
          best = amount
          paymentModeId = id
        }
      }
      const body = {
        bill_date: billDate,
        doctor_id: doctorId || null,
        patient_id: option.use_patient_id ? patient?.id || null : null,
        patient_no: option.use_patient_id ? patient?.patient_no || null : null,
        patient_name: option.use_patient_id ? patient?.full_name || '' : patientName.trim(),
        lines,
        payment_mode_id: paymentModeId,
      }
      const saved = billId
        ? await api.patch<Bill>(`/hospital/single-service-opd/bills/${billId}`, body)
        : await api.post<Bill>('/hospital/single-service-opd/bills', { ...body, option_id: option.id })
      setBillId(saved.id)
      setBillNo(saved.bill_no)
      setOk(`${billId ? 'Updated' : 'Saved'} bill ${saved.bill_no}`)
      await loadReport()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    if (!billId || !window.confirm(`Cancel bill ${billNo}?`)) return
    setBusy(true)
    setError(null)
    try {
      await api.delete(`/hospital/single-service-opd/bills/${billId}`)
      setOk(`Cancelled bill ${billNo}`)
      resetForm(option, modes)
      await loadReport()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>{title || option?.name || 'Single Service OPD Bill'}</h1>
      {option && (
        <div className="hint">
          {option.doctor_name || 'No default doctor'} · prefix {option.bill_prefix}
          {option.use_patient_id ? ' · registered patient required' : ' · type the patient name'}
        </div>
      )}
      <Banner error={error} ok={ok} />

      <form className="hms-toolbar" onSubmit={search}>
        <label>Find bill</label>
        <input
          className="hms-field"
          style={{ width: 240 }}
          placeholder="Bill no / patient name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="hms-btn" type="submit" disabled={!option}>
          Search
        </button>
        <button className="hms-btn" type="button" onClick={() => resetForm(option, modes)}>
          New
        </button>
      </form>
      {hits.length > 0 && (
        <div className="hms-table-wrap" style={{ maxHeight: 180, marginBottom: 8 }}>
          <table className="hms-table">
            <thead>
              <tr>
                <th>Bill No</th>
                <th>Date</th>
                <th>Patient</th>
                <th>Services</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((b) => (
                <tr key={b.id} onClick={() => load(b)}>
                  <td>{b.bill_no}</td>
                  <td>{b.bill_date}</td>
                  <td>{b.patient_name}</td>
                  <td>{b.service_name}</td>
                  <td>{fmtMoney(b.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="hms-box" onSubmit={onSave}>
        <div className="hms-box-title">{billId ? `Modify bill ${billNo}` : 'New bill'}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <div className="hms-grid hms-grid-2">
              <FieldWrap label="Doctor">
                <select className="hms-field" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                  <option value="">— Select doctor —</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name || d.doctor_code}
                    </option>
                  ))}
                </select>
              </FieldWrap>
              <FieldWrap label="Bill Date" required>
                <input className="hms-field" type="date" required value={billDate} onChange={(e) => setBillDate(e.target.value)} />
              </FieldWrap>
            </div>
            {option?.use_patient_id ? (
              <PatientFind
                selected={patient}
                onSelect={(p) => {
                  setPatient(p)
                  setPatientName(p.full_name)
                }}
              />
            ) : (
              <FieldWrap label="Patient Name" required>
                <input
                  className="hms-field"
                  required
                  placeholder="Patient name"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                />
              </FieldWrap>
            )}
            <div className="hms-table-wrap" style={{ marginTop: 6, maxHeight: 160 }}>
              <table className="hms-table">
                <thead>
                  <tr>
                    <th />
                    <th>Code</th>
                    <th>Service</th>
                    <th style={{ width: 100 }}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {(option?.services || []).map((s) => (
                    <tr key={s.service_id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={picked.has(s.service_id)}
                          onChange={() => {
                            const next = new Set(picked)
                            if (next.has(s.service_id)) next.delete(s.service_id)
                            else next.add(s.service_id)
                            setPicked(next)
                            applyServiceChange(next, rates)
                          }}
                        />
                      </td>
                      <td>{s.service_code}</td>
                      <td>{s.service_name}</td>
                      <td>
                        <input
                          className="hms-field"
                          type="number"
                          min={0}
                          step="0.01"
                          value={rates[s.service_id] ?? ''}
                          onChange={(e) => {
                            const next = { ...rates, [s.service_id]: e.target.value }
                            setRates(next)
                            applyServiceChange(picked, next)
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3}>
                      <strong>Total</strong>
                    </td>
                    <td>
                      <strong>{fmtMoney(total)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ width: 300, flex: '0 0 300px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <strong style={{ fontSize: 12 }}>Payment Mode</strong>
              <div className="hms-pay-toolbar" style={{ marginBottom: 0 }}>
                <button className="hms-btn" type="button" onClick={fillBalance}>
                  Fill Balance
                </button>
                <button className="hms-btn" type="button" onClick={clearPayments}>
                  Clear
                </button>
              </div>
            </div>
            <div className="hms-table-wrap" style={{ maxHeight: 168 }}>
              <table className="hms-table">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th>Document</th>
                    <th style={{ width: 72 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {modes.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>
                        <input
                          className="hms-field"
                          placeholder="Ref"
                          value={pay[m.id]?.document_no || ''}
                          onChange={(e) => setPayCell(m.id, { document_no: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="hms-field"
                          style={{ textAlign: 'right' }}
                          placeholder="0"
                          value={pay[m.id]?.amount || ''}
                          onChange={(e) => setPayCell(m.id, { amount: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hms-pay-foot">
              <span className="paid">Paid: {paid.toFixed(2)}</span>
              <span className={balance === 0 ? 'bal settled' : 'bal'}>Balance: {balance.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="hms-actions">
          <button className="hms-btn hms-btn-primary" type="submit" disabled={busy || !option}>
            {busy ? '…' : billId ? 'Update' : 'Save'}
          </button>
          <button
            className="hms-btn"
            type="button"
            disabled={!billId}
            onClick={() =>
              billId &&
              void openHospitalReport(`/hospital/reports/single-service-opd/${billId}/html`).catch((e) => setError(errMsg(e)))
            }
          >
            Print
          </button>
          <button className="hms-btn hms-btn-danger" type="button" disabled={!billId || busy} onClick={() => void onDelete()}>
            Cancel Bill
          </button>
        </div>
      </form>

      <Box title="Collection report">
        <div className="hms-toolbar">
          <label>From</label>
          <input className="hms-field" style={{ width: 150 }} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <label>To</label>
          <input className="hms-field" style={{ width: 150 }} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <button
            className="hms-btn"
            type="button"
            disabled={!option}
            onClick={() =>
              option &&
              void openHospitalReport(
                `/hospital/reports/single-service-opd/html?option_id=${option.id}&from_date=${fromDate}&to_date=${toDate}`,
              ).catch((e) => setError(errMsg(e)))
            }
          >
            Print report
          </button>
        </div>
        <div className="hms-table-wrap" style={{ maxHeight: 240 }}>
          <table className="hms-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Bill No</th>
                <th>Date</th>
                <th>Patient</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {(report?.rows || []).map((r) => (
                <tr
                  key={r.bill_id}
                  onClick={() =>
                    void api
                      .get<Bill>(`/hospital/single-service-opd/bills/${r.bill_id}`)
                      .then(load)
                      .catch((e) => setError(errMsg(e)))
                  }
                >
                  <td>{r.serial_no}</td>
                  <td>{r.bill_no}</td>
                  <td>{r.bill_date}</td>
                  <td>{r.patient_name}</td>
                  <td>{fmtMoney(r.amount)}</td>
                </tr>
              ))}
              {report && (
                <tr>
                  <td colSpan={4}>
                    <strong>Total</strong>
                  </td>
                  <td>
                    <strong>{fmtMoney(report.grand_total)}</strong>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Box>
    </div>
  )
}
