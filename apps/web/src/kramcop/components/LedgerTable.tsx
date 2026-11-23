import { useMemo, useState } from 'react'
import { formatDate } from '../lib/dates'
import type { Ledger, Txn } from '../types'

export function LedgerTable({
  ledger,
  onDelete,
}: {
  ledger: Ledger
  onDelete?: (id: string) => void
}) {
  const [oldestFirst, setOldestFirst] = useState(false)
  const rows = useMemo(
    () => (oldestFirst ? [...ledger.items].reverse() : ledger.items),
    [ledger.items, oldestFirst],
  )

  return (
    <div className="ledger-sheet">
      <div className="totals no-print">
        <span>Addition: {ledger.addition_amount.toFixed(2)}</span>
        <span>Deletion: {ledger.deletion_amount.toFixed(2)}</span>
        <strong>Balance: {ledger.balance.toFixed(2)}</strong>
        {ledger.share_nos && <span>Current shares: {ledger.share_nos}</span>}
        <button className="btn" type="button" onClick={() => setOldestFirst((v) => !v)}>
          {oldestFirst ? 'Newest first' : 'Oldest first'}
        </button>
        <button className="btn primary" type="button" onClick={() => window.print()}>
          Print ledger
        </button>
      </div>
      <div className="print-only ledger-print-head">
        <strong>ACNO {ledger.member.acno} · {ledger.member.name_en || ledger.member.name_kn}</strong>
        <div>
          Addition {ledger.addition_amount.toFixed(2)} · Deletion {ledger.deletion_amount.toFixed(2)} · Balance{' '}
          {ledger.balance.toFixed(2)}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Share no.</th>
              <th>Addition</th>
              <th>Deletion</th>
              <th>Balance</th>
              <th>Board</th>
              <th>Narration</th>
              {onDelete && <th className="no-print"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r: Txn) => (
              <tr key={r.id}>
                <td>{formatDate(r.txn_date)}</td>
                <td>{r.kind_label}</td>
                <td>{r.rno}</td>
                <td>{r.kind === 'share_addition' ? r.amount : ''}</td>
                <td>{r.kind === 'share_deletion' ? r.amount : ''}</td>
                <td>{(r.running_balance ?? 0).toFixed(2)}</td>
                <td>{r.board_meeting}</td>
                <td>{r.narration}</td>
                {onDelete && (
                  <td className="row-actions no-print">
                    <button type="button" onClick={() => onDelete(r.id)}>
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
