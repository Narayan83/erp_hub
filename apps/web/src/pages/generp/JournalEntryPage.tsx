import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { Typeahead } from '../../components/generp/Typeahead'
import { TransactionHistoryModal } from '../../components/generp/TransactionHistoryModal'
import { ListPager } from '../../components/generp/ListPager'
import { handleEnterAsTab, focusNextEnterTarget } from '../../lib/generp/enterAsTab'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { fmt, parseNum, round2, todayISO } from '../../lib/generp/saleBillMath'
import type {
  AccountingVoucher,
  JournalVoucher,
  JournalVoucherListItem,
  Ledger,
  LedgerBalance,
  Party,
  PartyDepositBalance,
} from '../../generpTypes'

export type JournalVariant = 'receipt_payment' | 'contra'
type EntryKind = 'receipt' | 'payment' | 'contra'

type LineRow = {
  key: string
  ledgerId: string
  ledgerText: string
  debit: string
  credit: string
  narration: string
}

type Props = {
  variant: JournalVariant
}

function monthStartISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function newLineKey() {
  return `ln_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function emptyLine(): LineRow {
  return { key: newLineKey(), ledgerId: '', ledgerText: '', debit: '', credit: '', narration: '' }
}

function amt(raw: string) {
  const n = parseNum(raw)
  return n > 0 ? round2(n) : 0
}

function fmtCur(balance: number, side: string) {
  return `Cur Bal: ${fmt(Math.abs(balance))} ${side || 'Dr'}`
}

export function JournalEntryPage({ variant }: Props) {
  const isContra = variant === 'contra'
  const [kind, setKind] = useState<EntryKind>(isContra ? 'contra' : 'receipt')
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [balances, setBalances] = useState<Record<string, { balance: number; side: string }>>({})
  const [parties, setParties] = useState<Party[]>([])
  const [voucherDate, setVoucherDate] = useState(todayISO())
  const [voucherNo, setVoucherNo] = useState('')
  const [headerNarration, setHeaderNarration] = useState('')
  const [lines, setLines] = useState<LineRow[]>([emptyLine(), emptyLine()])
  const [partyKind, setPartyKind] = useState<'none' | 'customer' | 'vendor'>(isContra ? 'none' : 'none')
  const [party, setParty] = useState<Party | null>(null)
  const [partyText, setPartyText] = useState('')
  const [partyDeposit, setPartyDeposit] = useState(0)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [loadedActive, setLoadedActive] = useState(true)

  const [listFrom, setListFrom] = useState(monthStartISO())
  const [listTo, setListTo] = useState(todayISO())
  const [recent, setRecent] = useState<JournalVoucherListItem[]>([])

  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<
    | { title: string; mode: 'ledger' | 'party'; ledgerId?: string; partyId?: string }
    | null
  >(null)
  const formRef = useRef<HTMLDivElement>(null)
  const saveRef = useRef<(andNew: boolean) => Promise<void>>(async () => {})

  const title = isContra
    ? 'Contra Entry'
    : kind === 'receipt'
      ? 'Receipt Entry'
      : 'Payment Entry'

  const ledgerOptions = useMemo(() => {
    if (isContra) {
      const cashBank = ledgers.filter((l) => l.is_cash || l.is_bank)
      return cashBank.length ? cashBank : ledgers
    }
    return ledgers
  }, [ledgers, isContra])

  const filteredParties = useMemo(() => {
    if (partyKind === 'none') return []
    return parties.filter((p) => p.party_type === partyKind || p.party_type === 'both')
  }, [parties, partyKind])

  const balMap = balances
  const ledgerLabel = useCallback(
    (l: Ledger) => {
      const b = balMap[l.id]
      const cur = b ? `  ·  ${fmtCur(b.balance, b.side)}` : ''
      return `${l.code} — ${l.name}${cur}`
    },
    [balMap],
  )

  const pickExactLedger = useCallback((query: string, rows: Ledger[]) => {
    const low = query.trim().toLowerCase()
    if (!low) return null
    return rows.find((l) => String(l.code || '').trim().toLowerCase() === low) ?? null
  }, [])

  const loadMasters = useCallback(async (excludeId?: string | null) => {
    const [l, customers, vendors, bals] = await Promise.all([
      api.get<Ledger[]>('/ledgers'),
      api.get<Party[]>('/parties', { party_type: 'customer' }),
      isContra
        ? api.get<Party[]>('/parties', { party_type: 'vendor' })
        : Promise.resolve([] as Party[]),
      api.get<LedgerBalance[]>('/cashbook/ledger-balances', {
        exclude_voucher_id: excludeId || undefined,
      }),
    ])
    setLedgers(l)
    setParties(isContra ? [...customers, ...vendors] : customers)
    const map: Record<string, { balance: number; side: string }> = {}
    for (const b of bals) {
      map[b.ledger_id] = { balance: Number(b.balance || 0), side: b.side || 'Dr' }
    }
    setBalances(map)
  }, [isContra])

  const loadRecent = useCallback(async () => {
    const rows = await api.get<JournalVoucherListItem[]>('/cashbook/vouchers', {
      source_type: isContra ? 'contra_entry' : 'payment_voucher',
      date_from: listFrom,
      date_to: listTo,
      include_inactive: 'true',
      limit: 300,
    })
    setRecent(rows)
  }, [isContra, listFrom, listTo])

  useEffect(() => {
    void (async () => {
      try {
        await loadMasters(null)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load')
      }
    })()
  }, [loadMasters])

  useEffect(() => {
    void loadRecent().catch(() => {
      /* list errors shown on refresh */
    })
  }, [loadRecent])

  const selectParty = async (p: Party | null) => {
    setParty(p)
    setPartyText(p ? `${p.code || ''} — ${p.name}` : '')
    if (!p) {
      setPartyDeposit(0)
      return
    }
    try {
      const data = await api.get<PartyDepositBalance>('/cashbook/party-deposit', {
        party_id: p.id,
      })
      setPartyDeposit(Number(data.balance || 0))
    } catch {
      setPartyDeposit(0)
    }
  }

  const updateLine = (key: string, patch: Partial<LineRow>) => {
    setLines((rows) => {
      const next = rows.map((r) => (r.key === key ? { ...r, ...patch } : r))
      const last = next[next.length - 1]
      if (last && last.ledgerId) {
        return [...next, emptyLine()]
      }
      return next
    })
  }

  const selectLedger = (key: string, l: Ledger) => {
    updateLine(key, {
      ledgerId: l.id,
      ledgerText: `${l.code} — ${l.name}`,
    })
  }

  const addLine = () => setLines((rows) => [...rows, emptyLine()])

  const removeLine = (key: string) => {
    setLines((rows) => {
      const next = rows.filter((r) => r.key !== key)
      return next.length >= 2 ? next : [emptyLine(), emptyLine()]
    })
  }

  const filledLines = lines.filter((l) => l.ledgerId && (amt(l.debit) > 0 || amt(l.credit) > 0))
  const totalDebit = round2(filledLines.reduce((s, l) => s + amt(l.debit), 0))
  const totalCredit = round2(filledLines.reduce((s, l) => s + amt(l.credit), 0))
  const balanced = filledLines.length >= 2 && Math.abs(totalDebit - totalCredit) < 0.009 && totalDebit > 0
  const usesDeposit = filledLines.some((l) => ledgers.find((x) => x.id === l.ledgerId)?.is_party_deposit)

  const resetForm = useCallback(async () => {
    setLoadedId(null)
    setLoadedActive(true)
    setVoucherNo('')
    setVoucherDate(todayISO())
    setHeaderNarration('')
    setLines([emptyLine(), emptyLine()])
    setParty(null)
    setPartyText('')
    setPartyDeposit(0)
    if (isContra) setPartyKind('none')
    setError('')
    await loadMasters(null)
  }, [isContra, loadMasters])

  const populate = (v: JournalVoucher) => {
    setLoadedId(v.id)
    setLoadedActive(v.is_active !== false)
    setVoucherNo(v.voucher_no)
    setVoucherDate(v.voucher_date)
    setHeaderNarration(v.narration || '')
    if (!isContra && (v.kind === 'receipt' || v.kind === 'payment')) setKind(v.kind)
    const mapped: LineRow[] = (v.lines || []).map((ln) => ({
      key: ln.id || newLineKey(),
      ledgerId: ln.ledger_id,
      ledgerText: `${ln.ledger_code || ''} — ${ln.ledger_name || ''}`.trim(),
      debit: Number(ln.debit_amount || 0) > 0 ? String(ln.debit_amount) : '',
      credit: Number(ln.credit_amount || 0) > 0 ? String(ln.credit_amount) : '',
      narration: ln.narration || '',
    }))
    setLines(mapped.length ? [...mapped, emptyLine()] : [emptyLine(), emptyLine()])
    if (v.party_id) {
      const found = parties.find((p) => p.id === v.party_id) || null
      if (found) {
        setPartyKind(found.party_type === 'vendor' ? 'vendor' : 'customer')
        void selectParty(found)
      } else {
        setParty({ id: v.party_id, name: v.party_name || v.party_code || 'Party', code: v.party_code })
        setPartyText(`${v.party_code || ''} — ${v.party_name || ''}`.trim())
      }
    } else {
      setParty(null)
      setPartyText('')
      setPartyKind(isContra ? 'none' : 'none')
    }
    setStatus(`Loaded ${v.voucher_no}${v.is_active === false ? ' (deleted)' : ''}`)
    setError('')
    void loadMasters(v.id)
  }

  const loadVoucher = async (id: string) => {
    setBusy(true)
    setError('')
    try {
      const v = await api.get<JournalVoucher>(`/cashbook/vouchers/${id}`)
      populate(v)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed')
    } finally {
      setBusy(false)
    }
  }

  const deleteVoucher = async (id: string) => {
    if (!confirm('Delete this entry? Ledger balances will reverse. You can restore it from Audit Trail.')) {
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.delete(`/cashbook/vouchers/${id}`)
      setStatus('Entry deleted')
      if (loadedId === id) {
        setLoadedActive(false)
      }
      await loadRecent()
      await loadMasters(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const save = async (andNew: boolean) => {
    if (loadedId && !loadedActive) {
      setError('This entry is deleted. Restore it from Audit Trail.')
      return
    }
    if (!balanced) {
      setError('Total Debit and Credit Amount must be Equal.')
      return
    }
    if (usesDeposit && !party) {
      setError('Select a customer when using a deposit ledger.')
      return
    }
    const payload = {
      voucher_date: voucherDate,
      party_id: partyKind === 'none' && isContra ? null : party?.id ?? null,
      narration: headerNarration.trim() || null,
      entry_type: kind === 'contra' ? undefined : kind,
      kind,
      voucher_no: voucherNo || undefined,
      lines: filledLines.map((l) => ({
        ledger_id: l.ledgerId,
        debit_amount: String(amt(l.debit)),
        credit_amount: String(amt(l.credit)),
        narration: l.narration.trim() || null,
      })),
    }
    setBusy(true)
    setError('')
    try {
      let savedNo = voucherNo
      if (loadedId) {
        const result = await api.put<JournalVoucher>(`/cashbook/vouchers/${loadedId}`, payload)
        savedNo = result.voucher_no
      } else if (isContra) {
        const result = await api.post<AccountingVoucher>('/cashbook/contra', payload)
        savedNo = result.voucher_no
      } else {
        const result = await api.post<AccountingVoucher>('/cashbook/payment', payload)
        savedNo = result.voucher_no
      }
      setStatus(`Saved ${savedNo}`)
      await loadRecent()
      if (andNew) {
        await resetForm()
        setStatus(`Saved ${savedNo}`)
      } else if (!loadedId) {
        await resetForm()
        setStatus(`Saved ${savedNo}`)
      } else {
        await loadVoucher(loadedId)
        setStatus(`Saved ${savedNo}`)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  saveRef.current = save

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        void saveRef.current(false)
      } else if (k === 'n') {
        e.preventDefault()
        void saveRef.current(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const recentPager = useClientPager(
    recent,
    `${variant}|${listFrom}|${listTo}|${recent.length}`,
    TABLE_PAGE_SIZE,
  )

  const exportRecent = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel(isContra ? 'contra-entries' : 'receipt-payment-entries', {
      name: 'Entries',
      headers: ['Voucher No', 'Date', 'Type', 'Accounts', 'Debit', 'Credit', 'Narration', 'Status'],
      rows: recent.map((v) => [
        v.voucher_no,
        v.voucher_date,
        v.kind,
        v.accounts,
        Number(v.total_debit || 0),
        Number(v.total_credit || 0),
        v.narration || '',
        v.is_active ? 'Active' : 'Deleted',
      ]),
    }, format)
  }

  const hint = isContra
    ? 'Transfer between cash and bank accounts. Debit one side, credit the other. Narration can be several lines per account.'
    : kind === 'receipt'
      ? 'Receipt: debit Cash/Bank, credit the other account(s). Each row has its own narration.'
      : 'Payment: debit the expense/party account(s), credit Cash/Bank. Each row has its own narration.'

  return (
    <div
      className="journal-entry-page"
      ref={formRef}
      data-enter-root
      onKeyDown={(e) => handleEnterAsTab(e, formRef.current)}
    >
      <div className="je-head">
        <div>
          <h2>{title}</h2>
          <p className="hint mb-0">
            {hint}
            {status ? ` · ${status}` : ''}
          </p>
        </div>
        <div className="je-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void resetForm()}>
            New
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !balanced}
            onClick={() => void save(true)}
          >
            Save & New [Ctrl+N]
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !balanced || (loadedId != null && !loadedActive)}
            data-enter-activate="save"
            onClick={() => void save(false)}
          >
            Save [Ctrl+S]
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="je-form">
        {!isContra && (
          <div className="je-field">
            <span className="field-label">Entry type</span>
            <div className="je-kind">
              <button
                type="button"
                className={`je-kind-btn${kind === 'receipt' ? ' is-on' : ''}`}
                data-skip-enter="true"
                onClick={() => setKind('receipt')}
              >
                Receipt
              </button>
              <button
                type="button"
                className={`je-kind-btn${kind === 'payment' ? ' is-on' : ''}`}
                data-skip-enter="true"
                onClick={() => setKind('payment')}
              >
                Payment
              </button>
            </div>
          </div>
        )}
        <div className="je-field">
          <span className="field-label">Voucher no</span>
          <input className="input" readOnly value={voucherNo || '(auto on save)'} tabIndex={-1} />
        </div>
        <div className="je-field">
          <span className="field-label">{isContra ? 'Contra date' : kind === 'receipt' ? 'Receipt date' : 'Payment date'}</span>
          <input
            className="input"
            type="date"
            value={voucherDate}
            onChange={(e) => setVoucherDate(e.target.value)}
          />
        </div>
        {isContra && (
          <div className="je-field">
            <span className="field-label">Party type</span>
            <select
              className="input"
              value={partyKind}
              onChange={(e) => {
                const v = e.target.value as 'none' | 'customer' | 'vendor'
                setPartyKind(v)
                void selectParty(null)
              }}
            >
              <option value="none">None</option>
              <option value="customer">Customer</option>
              <option value="vendor">Supplier</option>
            </select>
          </div>
        )}
        {(partyKind !== 'none' || usesDeposit || !isContra) && (
          <div className="je-field je-field-wide">
            <span className="field-label">
              {isContra
                ? partyKind === 'vendor'
                  ? 'Supplier'
                  : 'Customer'
                : usesDeposit
                  ? 'Customer *'
                  : 'Customer (optional)'}
            </span>
            <div className="je-party-row">
              <Typeahead
                value={partyText}
                onChange={setPartyText}
                onSelect={(item) => void selectParty(item)}
                items={isContra ? filteredParties : parties}
                getLabel={(p) => `${p.code || ''} — ${p.name}`}
                getKey={(p) => p.id}
                placeholder="Search party…"
                onEnter={() => {
                  const active = document.activeElement
                  if (formRef.current && active instanceof HTMLElement) {
                    focusNextEnterTarget(formRef.current, active)
                  }
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={!party}
                data-skip-enter="true"
                onClick={() =>
                  party &&
                  setHistory({
                    title: `${party.code} — ${party.name}`,
                    mode: 'party',
                    partyId: party.id,
                  })
                }
              >
                History
              </button>
            </div>
          </div>
        )}
        {party && (
          <div className="je-field">
            <span className="field-label">Advance bal</span>
            <input className="input" readOnly value={fmt(partyDeposit)} tabIndex={-1} />
          </div>
        )}
      </div>

      <div className="je-grid-card">
        <div className="je-grid-wrap">
          <table className="je-table">
            <colgroup>
              <col style={{ width: 40 }} />
              <col style={{ width: '28%' }} />
              <col />
              <col style={{ width: 130 }} />
              <col style={{ width: 130 }} />
            </colgroup>
            <thead>
              <tr>
                <th />
                <th>Account</th>
                <th>Narration</th>
                <th className="num">Credit</th>
                <th className="num">Debit</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const led = ledgers.find((l) => l.id === line.ledgerId)
                const bal = line.ledgerId ? balances[line.ledgerId] : undefined
                return (
                  <tr key={line.key}>
                    <td className="je-del">
                      <button
                        type="button"
                        className="je-icon-btn"
                        data-skip-enter="true"
                        title="Remove row"
                        onClick={() => removeLine(line.key)}
                      >
                        ×
                      </button>
                      <span className="je-rowno">{idx + 1}</span>
                    </td>
                    <td>
                      <Typeahead
                        value={line.ledgerText}
                        onChange={(v) => updateLine(line.key, { ledgerText: v, ledgerId: '' })}
                        onSelect={(l) => selectLedger(line.key, l)}
                        items={ledgerOptions}
                        getLabel={ledgerLabel}
                        getKey={(l) => l.id}
                        placeholder="Select A/C"
                        pickExact={pickExactLedger}
                        onEnter={() => {
                          const active = document.activeElement
                          if (formRef.current && active instanceof HTMLElement) {
                            focusNextEnterTarget(formRef.current, active)
                          }
                        }}
                      />
                      {led && (
                        <div className="je-curbal">
                          <span>{bal ? fmtCur(bal.balance, bal.side) : 'Cur Bal: —'}</span>
                          <button
                            type="button"
                            className="je-link"
                            data-skip-enter="true"
                            onClick={() =>
                              setHistory({
                                title: `Ledger ${led.code} — ${led.name}`,
                                mode: 'ledger',
                                ledgerId: led.id,
                              })
                            }
                          >
                            History
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <textarea
                        className="input je-narration"
                        rows={2}
                        value={line.narration}
                        onChange={(e) => updateLine(line.key, { narration: e.target.value })}
                        placeholder="Enter narration (multiple lines)"
                      />
                    </td>
                    <td>
                      <input
                        className="input je-amt"
                        value={line.credit}
                        inputMode="decimal"
                        placeholder="0.00"
                        onChange={(e) =>
                          updateLine(line.key, {
                            credit: e.target.value,
                            debit: e.target.value ? '' : line.debit,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="input je-amt"
                        value={line.debit}
                        inputMode="decimal"
                        placeholder="0.00"
                        data-enter-refocus={idx === 0 ? true : undefined}
                        onChange={(e) =>
                          updateLine(line.key, {
                            debit: e.target.value,
                            credit: e.target.value ? '' : line.credit,
                          })
                        }
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <button type="button" className="je-add" data-skip-enter="true" onClick={addLine}>
                    +
                  </button>
                </td>
                <td className="je-total-label">Total</td>
                <td className="num je-total">{fmt(totalCredit)}</td>
                <td className="num je-total">{fmt(totalDebit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <label className="je-desc">
          <span className="field-label">Description</span>
          <textarea
            className="input"
            rows={2}
            value={headerNarration}
            onChange={(e) => setHeaderNarration(e.target.value)}
            placeholder="Enter description here"
          />
        </label>

        <div className="je-foot">
          {!balanced && (
            <div className="je-warn">⚠ Total Debit and Credit Amount must be Equal.</div>
          )}
          {balanced && <div className="je-ok">Debit and credit are equal.</div>}
        </div>
      </div>

      <div className="je-list card">
        <div className="je-list-head">
          <h3>Entry list</h3>
          <div className="je-list-filters">
            <input
              className="input"
              type="date"
              value={listFrom}
              onChange={(e) => setListFrom(e.target.value)}
              aria-label="From"
            />
            <input
              className="input"
              type="date"
              value={listTo}
              onChange={(e) => setListTo(e.target.value)}
              aria-label="To"
            />
            <button type="button" className="btn" disabled={busy} onClick={() => void loadRecent()}>
              Refresh
            </button>
          </div>
        </div>
        <p className="hint mb-0">
          Edit or delete from this list. Create / update / delete is also written to Audit Trail.
        </p>
        <div className="table-responsive">
          <table className="table sv-table">
            <thead>
              <tr>
                <th>Voucher</th>
                <th>Date</th>
                <th>Type</th>
                <th>Accounts</th>
                <th className="num">Amount</th>
                <th>Narration</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr>
                  <td colSpan={8} className="hint">
                    No entries in this period.
                  </td>
                </tr>
              )}
              {recentPager.pageRows.map((v) => (
                <tr key={v.id} style={v.is_active ? undefined : { opacity: 0.55 }}>
                  <td>{v.voucher_no}</td>
                  <td>{v.voucher_date}</td>
                  <td style={{ textTransform: 'capitalize' }}>{v.kind}</td>
                  <td>{v.accounts || '—'}</td>
                  <td className="num">{fmt(Number(v.total_debit || 0))}</td>
                  <td className="je-list-narr">{v.narration || '—'}</td>
                  <td>{v.is_active ? 'Active' : 'Deleted'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn" onClick={() => void loadVoucher(v.id)}>
                      Edit
                    </button>{' '}
                    {v.is_active && (
                      <button type="button" className="btn" onClick={() => void deleteVoucher(v.id)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ListPager
          page={recentPager.page}
          totalPages={recentPager.totalPages}
          total={recentPager.total}
          pageSize={recentPager.pageSize}
          onPage={recentPager.setPage}
          onExport={exportRecent}
        />
      </div>

      {history && (
        <TransactionHistoryModal
          title={history.title}
          mode={history.mode}
          ledgerId={history.ledgerId}
          partyId={history.partyId}
          onClose={() => setHistory(null)}
        />
      )}
    </div>
  )
}
