import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { DateField } from '../components/DateField'
import { LedgerTable } from '../components/LedgerTable'
import { MemberSnapshot } from '../components/MemberSnapshot'
import type { Ledger, Member, MemberList, ShareType } from '../types'

const today = () => new Date().toISOString().slice(0, 10)

export function TransactionsPage() {
  const [params, setSearchParams] = useSearchParams()
  const [acno, setAcno] = useState(params.get('acno') ?? '')
  const [lookup, setLookup] = useState('')
  const [matches, setMatches] = useState<Member[]>([])
  const [kind, setKind] = useState<'share_addition' | 'share_deletion'>('share_addition')
  const [txnDate, setTxnDate] = useState(today())
  const [rno, setRno] = useState('')
  const [amount, setAmount] = useState('1000')
  const [narration, setNarration] = useState('')
  const [board, setBoard] = useState('')
  const [shareCount, setShareCount] = useState('1')
  const [shareType, setShareType] = useState(4)
  const [payment, setPayment] = useState<'cash' | 'adjustment'>('cash')
  const [shac, setShac] = useState('')
  const [types, setTypes] = useState<ShareType[]>([])
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get<ShareType[]>('/share-types').then(setTypes).catch(() => undefined)
  }, [])

  const loadLedger = async (value: string) => {
    setError('')
    if (!value) {
      setLedger(null)
      return
    }
    try {
      const data = await api.get<Ledger>(`/ledger/${Number(value)}`)
      setLedger(data)
      setShac(data.member.shac)
      setShareType(data.member.share_type_code || 4)
      if (!rno && data.next_rno) setRno(data.next_rno)
    } catch (err) {
      setLedger(null)
      setError(err instanceof Error ? err.message : 'Account not found')
    }
  }

  useEffect(() => {
    const fromUrl = params.get('acno') ?? ''
    if (fromUrl) {
      setAcno(fromUrl)
      void loadLedger(fromUrl)
    }
  }, [])

  const searchMembers = async (q: string) => {
    setLookup(q)
    if (q.trim().length < 2) {
      setMatches([])
      return
    }
    const res = await api.get<MemberList>('/members', { q, page: 1, page_size: 12 })
    setMatches(res.items)
  }

  const pickMember = (m: Member) => {
    setAcno(String(m.acno))
    setLookup('')
    setMatches([])
    setSearchParams({ acno: String(m.acno) })
    void loadLedger(String(m.acno))
  }

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      if (!acno) throw new ApiError('ACNO is required')
      await api.post('/transactions', {
        acno: Number(acno),
        kind,
        txn_date: txnDate,
        rno,
        amount: Number(amount || 0),
        narration,
        board_meeting: board,
        share_count: Number(shareCount || 1),
        share_type_code: shareType,
        payment_mode: payment,
        shac,
      })
      if (kind === 'share_addition') setRno('')
      setNarration('')
      setSearchParams({ acno })
      await loadLedger(acno)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this share entry?')) return
    await api.del(`/transactions/${id}`)
    await loadLedger(acno)
  }

  return (
    <div className="entry-page">
      <h1 className="no-print">Share addition / deletion</h1>
      <p className="hint">
        Enter ACNO, name or mobile. Only that member ledger is shown. Deletion is blocked when balance is zero or would
        go negative. Share number increments automatically on addition.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="panel">
        <div className="row">
          <label className="grow">
            Find customer (name / mobile / ACNO)
            <input
              className="input"
              value={lookup}
              onChange={(e) => void searchMembers(e.target.value)}
              placeholder="Type to search"
            />
          </label>
          <label className="short">
            ACNO
            <input
              className="input"
              value={acno}
              onChange={(e) => setAcno(e.target.value)}
              onBlur={() => {
                setSearchParams(acno ? { acno } : {})
                void loadLedger(acno)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setSearchParams(acno ? { acno } : {})
                  void loadLedger(acno)
                }
              }}
            />
          </label>
        </div>
        {matches.length > 0 && (
          <div className="lookup-list">
            {matches.map((m) => (
              <button key={m.id} type="button" onClick={() => pickMember(m)}>
                {m.acno} · {m.name_en || m.name_kn} · {m.mobile}
              </button>
            ))}
          </div>
        )}
        {ledger && <MemberSnapshot member={ledger.member} allowPhotoUpload />}
        <div className="row">
          <label className="short">
            Type
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as 'share_addition' | 'share_deletion')}>
              <option value="share_addition">Addition</option>
              <option value="share_deletion">Deletion</option>
            </select>
          </label>
          <label>
            Share type
            <select className="input" value={shareType} onChange={(e) => setShareType(Number(e.target.value))}>
              {types.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.code} · {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <DateField value={txnDate} onChange={setTxnDate} />
          </label>
          <label>
            Share number (RNO)
            <input className="input" value={rno} onChange={(e) => setRno(e.target.value)} placeholder="auto on addition" />
          </label>
          <label>
            No. of shares
            <input className="input" value={shareCount} onChange={(e) => setShareCount(e.target.value)} />
          </label>
          <label>
            Amount
            <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>
            Payment
            <select className="input" value={payment} onChange={(e) => setPayment(e.target.value as 'cash' | 'adjustment')}>
              <option value="cash">Cash</option>
              <option value="adjustment">Adjustment</option>
            </select>
          </label>
          <label>
            SHAC
            <input className="input" value={shac} onChange={(e) => setShac(e.target.value)} />
          </label>
          <label>
            Board meeting
            <input className="input" value={board} onChange={(e) => setBoard(e.target.value)} />
          </label>
          <label>
            Narration
            <input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} />
          </label>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>
            Save entry
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setSearchParams(acno ? { acno } : {})
              void loadLedger(acno)
            }}
          >
            Load ledger
          </button>
        </div>
      </div>

      {!acno && <p className="hint">Enter an account number to see that member ledger only.</p>}
      {ledger && <LedgerTable ledger={ledger} onDelete={(id) => void remove(id)} />}
    </div>
  )
}
