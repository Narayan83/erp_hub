import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { LedgerModal } from '../components/LedgerModal'
import type { SummaryRow } from '../types'

type Res = { society_name: string; as_on: string; language: string; items: SummaryRow[]; total: number }

const today = () => new Date().toISOString().slice(0, 10)

export function ShareSummaryPage() {
  const [asOn, setAsOn] = useState(today())
  const [balance, setBalance] = useState('positive')
  const [lang, setLang] = useState('kn')
  const [data, setData] = useState<Res | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      setData(await api.get<Res>('/reports/share-summary', { as_on: asOn, balance, language: lang }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div>
      <div className="no-print">
        <h1>Share summary</h1>
        {error && <div className="error">{error}</div>}
        <div className="toolbar">
          <label>
            As on
            <input className="input" type="date" value={asOn} onChange={(e) => setAsOn(e.target.value)} />
          </label>
          <label>
            Language
            <select className="input" value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="kn">Kannada</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            Balance
            <select className="input" value={balance} onChange={(e) => setBalance(e.target.value)}>
              <option value="positive">Positive</option>
              <option value="zero">Zero</option>
              <option value="negative">Negative</option>
              <option value="all">All</option>
            </select>
          </label>
          <button className="btn" type="button" onClick={() => void load()}>
            Load
          </button>
          <button className="btn primary" type="button" onClick={() => window.print()}>
            Print / PDF
          </button>
          <button className="btn" type="button" onClick={() => void api.download('/reports/share-summary/export', 'share-summary.xlsx', { as_on: asOn, balance, language: lang, fmt: 'xlsx' })}>
            Excel
          </button>
          <button className="btn" type="button" onClick={() => void api.download('/reports/share-summary/export', 'share-summary.csv', { as_on: asOn, balance, language: lang, fmt: 'csv' })}>
            CSV
          </button>
          <Link className="btn" to="/address_labels">
            Address report
          </Link>
        </div>
      </div>
      <h2>{data?.society_name ?? 'Kramcop'}</h2>
      <p className="hint">Share summary as on {data?.as_on ?? asOn} · {data?.total ?? 0} members</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ACNO</th>
              <th>Name</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((r) => (
              <tr key={r.acno}>
                <td>
                  <button className="linkish" type="button" onClick={() => setOpen(r.acno)}>
                    {r.acno}
                  </button>
                </td>
                <td className={lang === 'kn' ? 'kn' : undefined}>{lang === 'kn' ? r.name_kn || r.name_en : r.name_en || r.name_kn}</td>
                <td>{r.balance.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open != null && <LedgerModal acno={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
