import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { Banner, Box, FieldWrap } from '../shared/hmsKit'
import { errMsg, fmtMoney, unwrapList } from '../shared/hmsShared'
import { OpdBillFull, OpdBillLookup, opdUpdatePayload } from './opdBillTools'

type PayMode = { id: string; code: string; name: string; is_cash?: boolean }

/**
 * Payment Mode Entry — correct the payment mode of a saved OPD bill.
 * Replaces the bill's payment rows with a single row on the chosen mode (same total).
 */
export function PaymentModeEntryPage() {
  const [bill, setBill] = useState<OpdBillFull | null>(null)
  const [modes, setModes] = useState<PayMode[]>([])
  const [modeId, setModeId] = useState('')
  const [docNo, setDocNo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api
      .get<unknown>('/hospital/payment-modes')
      .then((m) => setModes(unwrapList<PayMode>(m)))
      .catch((e) => setError(errMsg(e)))
  }, [])

  function onLoaded(b: OpdBillFull | null) {
    setBill(b)
    setOk(null)
    setModeId(b?.payments?.[0]?.payment_mode_id || b?.payment_mode_id || '')
    setDocNo(b?.payments?.[0]?.document_no || '')
  }

  async function save() {
    if (!bill || !modeId) return
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const paid = (bill.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)
      const amount = paid > 0 ? paid : Number(bill.net_amount || 0)
      const payload = opdUpdatePayload(bill, {
        payment_mode_id: modeId,
        payments: amount > 0 ? [{ payment_mode_id: modeId, amount, document_no: docNo.trim() || null }] : [],
      })
      const saved = await api.put<OpdBillFull>(`/hospital/opd-bills/${bill.id}`, payload)
      setBill(saved)
      setOk(`Payment mode updated on ${saved.bill_no}`)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const selected = modes.find((m) => m.id === modeId)

  return (
    <div className="hms-page">
      <h1>Payment Mode Entry</h1>
      <div className="hint">Change the payment mode (cash / card / cheque / UPI …) recorded on a saved OPD bill.</div>
      <Banner error={error} ok={ok} />
      <OpdBillLookup bill={bill} onLoaded={onLoaded} onError={setError} />

      {bill && (
        <>
          <Box title="Current payments">
            <div className="hms-table-wrap" style={{ maxHeight: 160 }}>
              <table className="hms-table">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th>Document No</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(bill.payments || []).map((p, i) => (
                    <tr key={i}>
                      <td>{p.payment_mode_name || modes.find((m) => m.id === p.payment_mode_id)?.name}</td>
                      <td>{p.document_no}</td>
                      <td>{fmtMoney(p.amount)}</td>
                    </tr>
                  ))}
                  {!bill.payments?.length && (
                    <tr>
                      <td colSpan={3}>{bill.payment_mode_name || 'No payment rows'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Box>
          <Box title="New payment mode">
            <div className="hms-grid hms-grid-3">
              <FieldWrap label="Payment Mode" required>
                <select className="hms-field" value={modeId} onChange={(e) => setModeId(e.target.value)}>
                  <option value="">—</option>
                  {modes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </FieldWrap>
              <FieldWrap label={selected?.is_cash ? 'Document No (optional)' : 'Cheque / Card / Ref No'}>
                <input className="hms-field" value={docNo} onChange={(e) => setDocNo(e.target.value)} />
              </FieldWrap>
            </div>
            <div className="hms-actions">
              <button className="hms-btn hms-btn-primary" type="button" disabled={busy || !modeId} onClick={() => void save()}>
                {busy ? '…' : 'Update'}
              </button>
            </div>
          </Box>
        </>
      )}
    </div>
  )
}
