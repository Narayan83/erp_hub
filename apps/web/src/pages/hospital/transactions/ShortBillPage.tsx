import { FormEvent, useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { openHospitalReport } from '../billing/report'
import { Banner, Box, FieldWrap, FoundPatient, PatientFind } from '../shared/hmsKit'
import { errMsg, fmtMoney, todayIso, unwrapList } from '../shared/hmsShared'

type Props = { menuCode: string; title?: string }
type BillType = {
  id: string
  name: string
  menu_code: string
  default_service_name?: string | null
  default_rate?: number | string
  default_doctor_id?: string | null
  bill_prefix?: string
}
type Doctor = { id: string; doctor_code?: string; full_name?: string }
type Bill = {
  id: string
  bill_no: string
  bill_date: string
  patient_id: string | null
  patient_no?: string | null
  patient_name: string
  service_name: string
  amount: number | string
  doctor_id: string | null
  doctor_name?: string | null
}
type Report = {
  rows: Array<{ serial_no: number; bill_id: string; bill_no: string; bill_date: string; patient_name: string; amount: number | string }>
  grand_total: number | string
}

/**
 * Generic short-bill entry. The bill type is resolved from the sidebar `menuCode`
 * (/hospital/short-bills/types/by-menu/{menu_code}) — scan_bill, observation_bill, xray_bill, sbt_* …
 */
export function ShortBillPage({ menuCode, title }: Props) {
  const [type, setType] = useState<BillType | null>(null)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [billId, setBillId] = useState<string | null>(null)
  const [billNo, setBillNo] = useState('')
  const [billDate, setBillDate] = useState(todayIso())
  const [patient, setPatient] = useState<FoundPatient | null>(null)
  const [patientName, setPatientName] = useState('')
  const [serviceName, setServiceName] = useState('')
  const [amount, setAmount] = useState('0')
  const [doctorId, setDoctorId] = useState('')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Bill[]>([])
  const [fromDate, setFromDate] = useState(todayIso())
  const [toDate, setToDate] = useState(todayIso())
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const newBill = useCallback(
    (t: BillType | null) => {
      setBillId(null)
      setBillNo('')
      setPatient(null)
      setPatientName('')
      setBillDate(todayIso())
      setServiceName(t?.default_service_name || '')
      setAmount(String(t?.default_rate ?? 0))
      setDoctorId(t?.default_doctor_id || '')
    },
    [],
  )

  useEffect(() => {
    setType(null)
    setReport(null)
    setHits([])
    setError(null)
    setOk(null)
    void (async () => {
      try {
        const [t, d] = await Promise.all([
          api.get<BillType>(`/hospital/short-bills/types/by-menu/${encodeURIComponent(menuCode)}`),
          api.get<unknown>('/hospital/doctors', { page: 1, page_size: 100 }),
        ])
        setType(t)
        setDoctors(unwrapList<Doctor>(d))
        newBill(t)
      } catch (e) {
        setError(errMsg(e))
      }
    })()
  }, [menuCode, newBill])

  const loadReport = useCallback(async () => {
    if (!type) return
    try {
      setReport(
        await api.get<Report>('/hospital/short-bills/report', {
          short_bill_type_id: type.id,
          from_date: fromDate,
          to_date: toDate,
        }),
      )
    } catch (e) {
      setError(errMsg(e))
    }
  }, [type, fromDate, toDate])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

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
    setServiceName(b.service_name)
    setAmount(String(b.amount))
    setDoctorId(b.doctor_id || '')
    setHits([])
    setOk(null)
  }

  async function search(e: FormEvent) {
    e.preventDefault()
    if (!type || !q.trim()) return
    setError(null)
    try {
      const list = await api.get<Bill[]>('/hospital/short-bills/search', {
        short_bill_type_id: type.id,
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
    if (!type) return
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const body = {
        bill_date: billDate,
        patient_id: patient?.id || null,
        patient_name: patientName.trim(),
        service_name: serviceName.trim(),
        amount: Number(amount) || 0,
        doctor_id: doctorId || null,
      }
      const saved = billId
        ? await api.patch<Bill>(`/hospital/short-bills/${billId}`, body)
        : await api.post<Bill>('/hospital/short-bills', { ...body, short_bill_type_id: type.id })
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
    if (!billId || !window.confirm(`Delete bill ${billNo}?`)) return
    setBusy(true)
    setError(null)
    try {
      await api.delete(`/hospital/short-bills/${billId}`)
      setOk(`Deleted bill ${billNo}`)
      newBill(type)
      await loadReport()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>{title || type?.name || 'Short Bill'}</h1>
      {type && <div className="hint">Bill type: {type.name} · prefix {type.bill_prefix || 'SB'}</div>}
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
        <button className="hms-btn" type="submit" disabled={!type}>
          Search
        </button>
        <button className="hms-btn" type="button" onClick={() => newBill(type)}>
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
                <th>Service</th>
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
                  <td>{fmtMoney(b.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="hms-box" onSubmit={onSave}>
        <div className="hms-box-title">{billId ? `Modify bill ${billNo}` : 'New bill'}</div>
        <PatientFind
          selected={patient}
          onSelect={(p) => {
            setPatient(p)
            setPatientName(p.full_name)
          }}
        />
        <div className="hms-grid hms-grid-3">
          <FieldWrap label="Bill Date" required>
            <input className="hms-field" type="date" required value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </FieldWrap>
          <FieldWrap label="Patient Name" required>
            <input className="hms-field" required value={patientName} onChange={(e) => setPatientName(e.target.value)} />
          </FieldWrap>
          <FieldWrap label="Service" required>
            <input className="hms-field" required value={serviceName} onChange={(e) => setServiceName(e.target.value)} />
          </FieldWrap>
          <FieldWrap label="Amount" required>
            <input className="hms-field" type="number" min={0} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FieldWrap>
          <FieldWrap label="Doctor">
            <select className="hms-field" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">—</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.doctor_code} — {d.full_name}
                </option>
              ))}
            </select>
          </FieldWrap>
        </div>
        <div className="hms-actions">
          <button className="hms-btn hms-btn-primary" type="submit" disabled={busy || !type}>
            {busy ? '…' : billId ? 'Update' : 'Save'}
          </button>
          <button
            className="hms-btn"
            type="button"
            disabled={!billId}
            onClick={() => billId && void openHospitalReport(`/hospital/reports/short-bill/${billId}/html`).catch((e) => setError(errMsg(e)))}
          >
            Print
          </button>
          <button className="hms-btn hms-btn-danger" type="button" disabled={!billId || busy} onClick={() => void onDelete()}>
            Delete
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
            disabled={!type}
            onClick={() =>
              type &&
              void openHospitalReport(
                `/hospital/reports/short-bill/html?short_bill_type_id=${type.id}&from_date=${fromDate}&to_date=${toDate}`,
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
                      .get<Bill>(`/hospital/short-bills/${r.bill_id}`)
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
