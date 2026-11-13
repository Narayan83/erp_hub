import { useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { fmt } from '../../lib/generp/saleBillMath'
import type { CashbookEntry, CashbookLedgerStatement, CashbookPartyAccount } from '../../generpTypes'

type Props = {
  title: string
  mode: 'ledger' | 'party'
  ledgerId?: string | null
  partyId?: string | null
  onClose: () => void
}

export function TransactionHistoryModal({ title, mode, ledgerId, partyId, onClose }: Props) {
  const [rows, setRows] = useState<CashbookEntry[]>([])
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    void (async () => {
      setBusy(true)
      setError('')
      try {
        if (mode === 'ledger') {
          if (!ledgerId) {
            setError('No ledger selected.')
            return
          }
          const data = await api.get<CashbookLedgerStatement>(`/cashbook/ledger/${ledgerId}`, {
            limit: 100,
          })
          setRows(data.entries || [])
          setSummary(
            `Opening ${fmt(Number(data.opening_balance))} · Closing ${fmt(Number(data.closing_balance))} · ${data.entries?.length || 0} lines`,
          )
        } else {
          if (!partyId) {
            setError('No customer/supplier selected.')
            return
          }
          const data = await api.get<CashbookPartyAccount>('/cashbook/party-account', {
            party_id: partyId,
            limit: 100,
          })
          setRows(data.entries || [])
          setSummary(
            `${data.party_code} ${data.party_name || ''} · Deposit ${fmt(Number(data.deposit_balance || 0))} · ${data.entries?.length || 0} lines`,
          )
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load history')
      } finally {
        setBusy(false)
      }
    })()
  }, [mode, ledgerId, partyId])

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <h2>{title}</h2>
        {busy && <p className="hint">Loading…</p>}
        {error && <div className="error-banner">{error}</div>}
        {!busy && !error && <p className="hint" style={{ fontWeight: 600 }}>{summary}</p>}
        <div className="sb-table-wrap" style={{ maxHeight: 420, overflow: 'auto', marginTop: 8 }}>
          <table className="table data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Voucher</th>
                <th>Ledger</th>
                <th>Narration</th>
                <th className="text-end">Debit</th>
                <th className="text-end">Credit</th>
                {mode === 'ledger' && <th className="text-end">Balance</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !busy && (
                <tr>
                  <td colSpan={7} className="text-muted">
                    No transactions found
                  </td>
                </tr>
              )}
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{String(e.voucher_date || '').slice(0, 10)}</td>
                  <td>{e.voucher_no}</td>
                  <td>{e.ledger_code}</td>
                  <td>{e.line_narration || e.narration || ''}</td>
                  <td className="text-end">{fmt(Number(e.debit_amount || 0))}</td>
                  <td className="text-end">{fmt(Number(e.credit_amount || 0))}</td>
                  {mode === 'ledger' && (
                    <td className="text-end">{fmt(Number(e.running_balance || 0))}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
