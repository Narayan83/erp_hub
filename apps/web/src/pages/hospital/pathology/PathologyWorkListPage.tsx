import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { errMsg, fmtMoney, todayIso } from '../shared/hmsShared'

type WorkItem = {
  bill_id: string
  bill_no: string
  bill_date: string
  patient_no?: string | null
  patient_name?: string | null
  order_id?: string | null
  order_status?: string | null
  sample_no?: string | null
  test_count: number
  result_pending: number
  net_amount: number | string
  referring_doctor?: string | null
}

type Result = {
  id: string
  parameter_code?: string | null
  parameter_name?: string | null
  service_name?: string | null
  panel_name?: string | null
  result_value?: string | null
  unit_name?: string | null
  reference_range_text?: string | null
  is_abnormal: boolean
  status: string
  method?: string | null
}

type Order = {
  id: string
  bill_id: string
  bill_no?: string | null
  patient_no?: string | null
  patient_name?: string | null
  order_date: string
  sample_no?: string | null
  status: string
  pathologist_name?: string | null
  authorized_at?: string | null
  results: Result[]
}

/** Pathology Work List — /hospital/pathology/work-list + orders/by-bill/{id}[/results|/authorize] */
export function PathologyWorkListPage() {
  const [date, setDate] = useState(todayIso())
  const [rows, setRows] = useState<WorkItem[]>([])
  const [order, setOrder] = useState<Order | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [activeBill, setActiveBill] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function loadList() {
    setError(null)
    setRows(await api.get<WorkItem[]>('/hospital/pathology/work-list', { bill_date: date || undefined }))
  }

  useEffect(() => {
    void loadList().catch((e) => setError(errMsg(e)))
  }, [date])

  function applyOrder(o: Order) {
    setOrder(o)
    const v: Record<string, string> = {}
    for (const r of o.results || []) v[r.id] = r.result_value ?? ''
    setValues(v)
  }

  async function openBill(billId: string) {
    setError(null)
    setOk(null)
    setActiveBill(billId)
    try {
      applyOrder(await api.get<Order>(`/hospital/pathology/orders/by-bill/${billId}`))
    } catch (e) {
      setOrder(null)
      setError(errMsg(e))
    }
  }

  const authorized = order?.status?.toLowerCase() === 'authorized'

  async function saveResults(): Promise<boolean> {
    if (!order) return false
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const updated = await api.put<Order>(`/hospital/pathology/orders/by-bill/${order.bill_id}/results`, {
        results: Object.entries(values).map(([id, result_value]) => ({
          id,
          result_value: result_value.trim() || null,
        })),
      })
      applyOrder(updated)
      setOk('Results saved')
      await loadList()
      return true
    } catch (e) {
      setError(errMsg(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function authorize() {
    if (!order) return
    if (!window.confirm('Authorize this report? Results will be locked.')) return
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      if (!(await saveResults())) return
      applyOrder(await api.post<Order>(`/hospital/pathology/orders/by-bill/${order.bill_id}/authorize`))
      setOk('Report authorized')
      await loadList()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>Pathology Work List</h1>
      <div className="hint">Pick a bill to enter results, then authorize the report.</div>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}

      <div className="hms-toolbar">
        <label>Bill Date</label>
        <input className="hms-field" type="date" style={{ width: 160 }} value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="hms-btn" type="button" onClick={() => setDate('')}>All dates</button>
        <button className="hms-btn" type="button" onClick={() => void loadList().catch((e) => setError(errMsg(e)))}>Refresh</button>
      </div>

      <div className="hms-table-wrap" style={{ marginBottom: 10 }}>
        <table className="hms-table">
          <thead>
            <tr>
              <th>Bill No</th>
              <th>Date</th>
              <th>Patient No</th>
              <th>Patient</th>
              <th>Doctor</th>
              <th>Sample</th>
              <th>Tests</th>
              <th>Pending</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bill_id} className={r.bill_id === activeBill ? 'active' : ''} onClick={() => void openBill(r.bill_id)}>
                <td>{r.bill_no}</td>
                <td>{r.bill_date}</td>
                <td>{r.patient_no}</td>
                <td>{r.patient_name}</td>
                <td>{r.referring_doctor}</td>
                <td>{r.sample_no}</td>
                <td>{r.test_count}</td>
                <td>{r.result_pending}</td>
                <td>{r.order_status || 'pending'}</td>
                <td style={{ textAlign: 'right' }}>{fmtMoney(r.net_amount)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr style={{ cursor: 'default' }}>
                <td colSpan={10} style={{ color: '#64748b' }}>No bills</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {order && (
        <div className="hms-box">
          <div className="hms-box-title">
            Result Entry — {order.bill_no} / {order.patient_name} ({order.status})
          </div>
          <div className="hms-table-wrap" style={{ marginTop: 4, maxHeight: 420 }}>
            <table className="hms-table">
              <thead>
                <tr>
                  <th>Panel / Test</th>
                  <th>Parameter</th>
                  <th style={{ width: 180 }}>Result</th>
                  <th>Unit</th>
                  <th>Reference Range</th>
                  <th>Method</th>
                  <th>Flag</th>
                </tr>
              </thead>
              <tbody>
                {order.results.map((r) => (
                  <tr key={r.id} style={{ cursor: 'default' }}>
                    <td>{r.panel_name || r.service_name}</td>
                    <td>{r.parameter_name}</td>
                    <td>
                      <input
                        className="hms-field"
                        disabled={authorized}
                        value={values[r.id] ?? ''}
                        style={r.is_abnormal ? { color: '#b91c1c', fontWeight: 700 } : undefined}
                        onChange={(e) => setValues((p) => ({ ...p, [r.id]: e.target.value }))}
                      />
                    </td>
                    <td>{r.unit_name}</td>
                    <td>{r.reference_range_text}</td>
                    <td>{r.method}</td>
                    <td>{r.is_abnormal ? 'Abnormal' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hms-actions">
            <button className="hms-btn hms-btn-primary" type="button" disabled={busy || authorized} onClick={() => void saveResults()}>
              Save Results
            </button>
            <button className="hms-btn" type="button" disabled={busy || authorized} onClick={() => void authorize()}>
              Authorize
            </button>
            <button className="hms-btn" type="button" onClick={() => { setOrder(null); setActiveBill('') }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
