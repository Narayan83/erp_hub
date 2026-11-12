import { useState } from 'react'
import '../billing/hms-master.css'
import { ApiPendingNotice, Banner, Box } from '../shared/hmsKit'
import { fmtMoney } from '../shared/hmsShared'
import { OpdBillFull, OpdBillLookup } from './opdBillTools'

/**
 * Realisation Date Entry (cheque / card clearing date). The hospital API stores no realisation
 * date on bill payments yet, so this page shows the non-cash payments that would need one.
 */
export function RealisationDatePage() {
  const [bill, setBill] = useState<OpdBillFull | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState('')

  const nonCash = (bill?.payments || []).filter((p) => !/cash/i.test(p.payment_mode_name || ''))

  return (
    <div className="hms-page">
      <h1>Realisation Date Entry</h1>
      <div className="hint">Record the date a cheque / card / online payment was realised.</div>
      <Banner error={error} />
      <ApiPendingNotice>
        The payments API has no <code>realisation_date</code> field yet. You can look up a bill and
        review its payment rows here; saving the date is enabled once the backend exposes it.
      </ApiPendingNotice>
      <OpdBillLookup bill={bill} onLoaded={setBill} onError={setError} />
      {bill && (
        <Box title="Payments awaiting realisation">
          <div className="hms-toolbar">
            <label>Realisation Date</label>
            <input className="hms-field" style={{ width: 160 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <button className="hms-btn hms-btn-primary" type="button" disabled title="Backend field not available yet">
              Save
            </button>
          </div>
          <div className="hms-table-wrap" style={{ maxHeight: 200 }}>
            <table className="hms-table">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>Document No</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {nonCash.map((p, i) => (
                  <tr key={i}>
                    <td>{p.payment_mode_name}</td>
                    <td>{p.document_no}</td>
                    <td>{fmtMoney(p.amount)}</td>
                  </tr>
                ))}
                {!nonCash.length && (
                  <tr>
                    <td colSpan={3}>No non-cash payments on this bill</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Box>
      )}
    </div>
  )
}
