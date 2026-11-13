import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { Banner, Box, FieldWrap } from '../shared/hmsKit'
import { errMsg, fmtMoney, unwrapList } from '../shared/hmsShared'
import { OpdBillFull, OpdBillLookup, opdUpdatePayload } from './opdBillTools'

type Authority = { id: string; code: string; name: string }

/**
 * Authorise Discount — set the scheme discount on a saved OPD bill and note the authorising
 * authority in the bill remarks (the API has no separate discount-authorisation record).
 */
export function AuthoriseDiscountPage() {
  const [bill, setBill] = useState<OpdBillFull | null>(null)
  const [authorities, setAuthorities] = useState<Authority[]>([])
  const [authorityId, setAuthorityId] = useState('')
  const [discount, setDiscount] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api
      .get<unknown>('/hospital/authorities')
      .then((a) => setAuthorities(unwrapList<Authority>(a)))
      .catch((e) => setError(errMsg(e)))
  }, [])

  function onLoaded(b: OpdBillFull | null) {
    setBill(b)
    setOk(null)
    setDiscount(String(b?.scheme_discount ?? 0))
  }

  async function save() {
    if (!bill) return
    const amt = Number(discount)
    if (!Number.isFinite(amt) || amt < 0) {
      setError('Enter a valid discount amount')
      return
    }
    if (amt > Number(bill.gross_amount)) {
      setError('Discount cannot exceed gross amount')
      return
    }
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const authority = authorities.find((a) => a.id === authorityId)
      const note = authority ? `Discount authorised by ${authority.name}` : ''
      const remarks = [bill.remarks?.replace(/\s*Discount authorised by .*$/, ''), note].filter(Boolean).join(' ')
      const saved = await api.put<OpdBillFull>(
        `/hospital/opd-bills/${bill.id}`,
        opdUpdatePayload(bill, { scheme_discount: amt, remarks: remarks || null }),
      )
      setBill(saved)
      setDiscount(String(saved.scheme_discount ?? amt))
      setOk(`Discount saved on ${saved.bill_no} — net ${fmtMoney(saved.net_amount)}`)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>Authorise Discount</h1>
      <div className="hint">Approve / adjust the discount given on a saved OPD bill.</div>
      <Banner error={error} ok={ok} />
      <OpdBillLookup bill={bill} onLoaded={onLoaded} onError={setError} />

      {bill && (
        <Box title="Discount">
          <div className="hms-grid hms-grid-4">
            <FieldWrap label="Gross Amount">
              <input className="hms-field" readOnly value={fmtMoney(bill.gross_amount)} />
            </FieldWrap>
            <FieldWrap label="Current Discount">
              <input className="hms-field" readOnly value={fmtMoney(bill.scheme_discount)} />
            </FieldWrap>
            <FieldWrap label="Authorised Discount" required>
              <input
                className="hms-field"
                type="number"
                min={0}
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </FieldWrap>
            <FieldWrap label="Authority">
              <select className="hms-field" value={authorityId} onChange={(e) => setAuthorityId(e.target.value)}>
                <option value="">—</option>
                {authorities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </FieldWrap>
          </div>
          <div className="hms-actions">
            <button className="hms-btn hms-btn-primary" type="button" disabled={busy} onClick={() => void save()}>
              {busy ? '…' : 'Authorise'}
            </button>
          </div>
        </Box>
      )}
    </div>
  )
}
