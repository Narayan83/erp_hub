import { FormEvent, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'

type Ledger = { id: string; name: string; system_key?: string | null }
type Voucher = {
  id: string
  voucher_no: string
  voucher_date: string
  kind?: string | null
  narration?: string | null
  amount: number
}

export function CashbookPage({ kind }: { kind: 'advance' | 'payment' | 'contra' | 'list' }) {
  const { labels } = useAuth()
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [rows, setRows] = useState<Voucher[]>([])
  const [amount, setAmount] = useState('100')
  const [narration, setNarration] = useState('')

  async function load() {
    setLedgers(await api.get<Ledger[]>('/accounts/ledgers'))
    setRows(await api.get<Voucher[]>('/accounts/cashbook'))
  }

  useEffect(() => {
    void load()
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (kind === 'list') return
    const cash = ledgers.find((l) => l.system_key === 'CASH')
    const deposit = ledgers.find((l) => l.system_key === 'PARTY_DEPOSIT')
    const debit = kind === 'payment' ? (deposit?.id || cash?.id) : cash?.id
    const credit = kind === 'payment' ? cash?.id : deposit?.id
    if (!debit || !credit) return
    await api.post('/accounts/cashbook', {
      voucher_date: new Date().toISOString().slice(0, 10),
      kind,
      narration,
      debit_ledger_id: debit,
      credit_ledger_id: credit,
      amount: Number(amount),
    })
    setNarration('')
    await load()
  }

  const title =
    kind === 'advance'
      ? `${labels.deposit} / Advance`
      : kind === 'payment'
        ? 'Payment / Adjustment'
        : kind === 'contra'
          ? 'Contra Entry'
          : 'Daybook / Cashbook'

  return (
    <div className="erp-card">
      <h1 className="h4 mb-3">{title}</h1>
      {kind !== 'list' ? (
        <form className="row g-2 mb-4" onSubmit={onSubmit}>
          <div className="col-md-2">
            <input className="form-control" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="col-md-5">
            <input className="form-control" placeholder="Narration" value={narration} onChange={(e) => setNarration(e.target.value)} />
          </div>
          <div className="col-md-2">
            <button className="btn btn-erp w-100" type="submit">Post</button>
          </div>
        </form>
      ) : null}
      <table className="table table-sm">
        <thead>
          <tr>
            <th>No</th>
            <th>Date</th>
            <th>Kind</th>
            <th>Narration</th>
            <th className="text-end">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.voucher_no}</td>
              <td>{r.voucher_date}</td>
              <td>{r.kind}</td>
              <td>{r.narration}</td>
              <td className="text-end">{r.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
