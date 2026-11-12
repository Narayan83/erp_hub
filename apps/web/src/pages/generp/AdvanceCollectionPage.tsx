import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { Typeahead } from '../../components/generp/Typeahead'
import { focusNextEnterTarget, handleEnterAsTab } from '../../lib/generp/enterAsTab'
import { fmt, todayISO } from '../../lib/generp/saleBillMath'
import type { AccountingVoucher, Party, PartyDepositBalance, PaymentMode } from '../../generpTypes'

export function AdvanceCollectionPage() {
  const [parties, setParties] = useState<Party[]>([])
  const [modes, setModes] = useState<PaymentMode[]>([])
  const [party, setParty] = useState<Party | null>(null)
  const [partyText, setPartyText] = useState('')
  const [balance, setBalance] = useState(0)
  const [voucherDate, setVoucherDate] = useState(todayISO())
  const [paymentModeId, setPaymentModeId] = useState('')
  const [amount, setAmount] = useState('')
  const [narration, setNarration] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([
      api.get<Party[]>('/parties', { party_type: 'customer' }),
      api.get<PaymentMode[]>('/payment-modes'),
    ])
    setParties(p)
    const payModes = m.filter((x) => !x.is_credit)
    setModes(payModes)
    const cash = payModes.find((x) => x.is_cash) ?? payModes[0]
    if (cash) setPaymentModeId(cash.id)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await load()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load')
      }
    })()
  }, [load])

  const refreshBalance = async (partyId: string) => {
    try {
      const data = await api.get<PartyDepositBalance>('/cashbook/party-deposit', {
        party_id: partyId,
      })
      setBalance(Number(data.balance || 0))
    } catch {
      setBalance(0)
    }
  }

  const selectParty = async (p: Party | null) => {
    setParty(p)
    setPartyText(p ? `${p.code || ''} — ${p.name}` : '')
    if (p) await refreshBalance(p.id)
    else setBalance(0)
  }

  const clear = () => {
    setParty(null)
    setPartyText('')
    setBalance(0)
    setAmount('')
    setNarration('')
    setStatus('')
    setError('')
    setVoucherDate(todayISO())
  }

  const save = async () => {
    if (!party) {
      setError('Select a customer.')
      return
    }
    if (!paymentModeId) {
      setError('Select a payment mode.')
      return
    }
    const amt = Number(String(amount).replace(/,/g, ''))
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid amount.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await api.post<AccountingVoucher>('/cashbook/advance', {
        party_id: party.id,
        voucher_date: voucherDate,
        payment_mode_id: paymentModeId,
        amount: String(amt),
        narration: narration.trim() || null,
      })
      setStatus(`Saved ${result.voucher_no}`)
      setAmount('')
      setNarration('')
      await refreshBalance(party.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="settings-page"
      ref={formRef}
      onKeyDown={(e) => handleEnterAsTab(e, formRef.current)}
    >
      <h2>Advance Collection</h2>
      <p className="hint">
        Collect customer advance / deposit. Debits the payment-mode ledger and credits CUST-DEPOSIT.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="hint">{status}</p>}

      <div className="settings-box settings-box--form">
        <label className="settings-field">
          <span>Customer *</span>
          <Typeahead
            value={partyText}
            onChange={setPartyText}
            onSelect={(item) => void selectParty(item)}
            items={parties}
            getLabel={(p) => `${p.code || ''} — ${p.name}`}
            getKey={(p) => p.id}
            placeholder="Search customer code or name"
            onEnter={() => {
              const active = document.activeElement
              if (formRef.current && active instanceof HTMLElement) {
                focusNextEnterTarget(formRef.current, active)
              }
            }}
          />
        </label>
        <label className="settings-field">
          <span>Current Advance Balance</span>
          <input className="input" readOnly value={fmt(balance)} data-skip-enter="true" tabIndex={-1} />
        </label>
        <label className="settings-field">
          <span>Date *</span>
          <input
            className="input"
            type="date"
            value={voucherDate}
            onChange={(e) => setVoucherDate(e.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>Payment Mode *</span>
          <select
            className="input"
            value={paymentModeId}
            onChange={(e) => setPaymentModeId(e.target.value)}
          >
            {modes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} — {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          <span>Amount *</span>
          <input
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label className="settings-field">
          <span>Narration</span>
          <input
            className="input"
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            data-enter-activate="save"
            onClick={() => void save()}
          >
            Save Advance
          </button>
          <button type="button" className="btn" data-skip-enter="true" onClick={clear}>
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}
