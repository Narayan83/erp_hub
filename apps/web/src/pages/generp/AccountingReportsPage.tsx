import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { fmt, todayISO } from '../../lib/generp/saleBillMath'
import type {
  CashbookDaybook,
  CashbookEntry,
  CashbookLedgerStatement,
  CashbookPartyAccount,
  Ledger,
} from '../../generpTypes'

function money(v: unknown) {
  return fmt(Number(v || 0))
}

function exportEntries(
  filename: string,
  sheetName: string,
  entries: CashbookEntry[],
  cols: 'ledger' | 'cash' | 'day' | 'party',
  format: SpreadsheetFormat = 'xlsx',
) {
  const headers = ['Date', 'Voucher']
  if (cols === 'day') headers.push('Source')
  if (cols === 'cash' || cols === 'day' || cols === 'party') headers.push('Ledger')
  if (cols === 'ledger' || cols === 'cash' || cols === 'day') headers.push('Party')
  headers.push('Narration', 'Debit', 'Credit')
  if (cols === 'ledger') headers.push('Balance')
  downloadExcel(
    filename,
    {
      name: sheetName,
      headers,
      rows: entries.map((e) => {
        const row: Array<string | number> = [String(e.voucher_date || '').slice(0, 10), e.voucher_no]
        if (cols === 'day') row.push(e.source_type)
        if (cols === 'cash' || cols === 'day' || cols === 'party') row.push(e.ledger_code)
        if (cols === 'ledger' || cols === 'cash' || cols === 'day') row.push(e.party_code || '')
        row.push(e.narration || '', Number(e.debit_amount || 0), Number(e.credit_amount || 0))
        if (cols === 'ledger') row.push(Number(e.running_balance || 0))
        return row
      }),
    },
    format,
  )
}

function firstOfMonthISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function EntryTable({
  entries,
  cols,
}: {
  entries: CashbookEntry[]
  cols: 'ledger' | 'cash' | 'day' | 'party'
}) {
  const pager = useClientPager(entries, `${entries.length}-${entries[0]?.id || ''}`, TABLE_PAGE_SIZE)
  return (
    <>
    <ListPager
      topRight
      page={pager.page}
      totalPages={pager.totalPages}
      total={pager.total}
      pageSize={pager.pageSize}
      onPage={pager.setPage}
    />
    <table className="table data-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Voucher</th>
          {cols === 'day' && <th>Source</th>}
          {(cols === 'cash' || cols === 'day' || cols === 'party') && <th>Ledger</th>}
          {(cols === 'ledger' || cols === 'cash' || cols === 'day') && <th>Party</th>}
          <th>Narration</th>
          <th className="text-end">Debit</th>
          <th className="text-end">Credit</th>
          {cols === 'ledger' && <th className="text-end">Balance</th>}
        </tr>
      </thead>
      <tbody>
        {entries.length === 0 && (
          <tr>
            <td colSpan={8} className="text-muted">
              No entries
            </td>
          </tr>
        )}
        {pager.pageRows.map((e) => (
          <tr key={e.id}>
            <td>{String(e.voucher_date || '').slice(0, 10)}</td>
            <td>{e.voucher_no}</td>
            {cols === 'day' && <td>{e.source_type}</td>}
            {(cols === 'cash' || cols === 'day' || cols === 'party') && <td>{e.ledger_code}</td>}
            {(cols === 'ledger' || cols === 'cash' || cols === 'day') && (
              <td>{e.party_code || ''}</td>
            )}
            <td>{e.narration || ''}</td>
            <td className="text-end">{money(e.debit_amount)}</td>
            <td className="text-end">{money(e.credit_amount)}</td>
            {cols === 'ledger' && <td className="text-end">{money(e.running_balance)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
    </>
  )
}

export function LedgerDetailsPage() {
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [ledgerId, setLedgerId] = useState('')
  const [fromDate, setFromDate] = useState(firstOfMonthISO())
  const [toDate, setToDate] = useState(todayISO())
  const [data, setData] = useState<CashbookLedgerStatement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const rows = await api.get<Ledger[]>('/ledgers')
        setLedgers(rows)
        if (rows[0]) setLedgerId(rows[0].id)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load')
      }
    })()
  }, [])

  const refresh = async () => {
    if (!ledgerId) return
    setError('')
    try {
      const stmt = await api.get<CashbookLedgerStatement>(`/cashbook/ledger/${ledgerId}`, {
        from_date: fromDate,
        to_date: toDate,
      })
      setData(stmt)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load statement')
    }
  }

  useEffect(() => {
    if (ledgerId) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerId])

  return (
    <div className="modify-page">
      <h2>Ledger Details</h2>
      <p className="modify-hint">Statement with opening balance, debit, credit, and running balance.</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="sb-row">
        <span className="field-label">Ledger</span>
        <select className="input" value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}>
          {ledgers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code} — {l.name}
            </option>
          ))}
        </select>
        <span className="field-label">From</span>
        <input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <span className="field-label">To</span>
        <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
          Refresh
        </button>
        {data && (
          <ExportFormatButtons
            onExport={(format) =>
              exportEntries(
                `ledger-details-${data.ledger_name || 'ledger'}`,
                'Ledger Details',
                data.entries || [],
                'ledger',
                format,
              )
            }
          />
        )}
      </div>
      {data && (
        <>
          <p className="hint" style={{ fontWeight: 700 }}>
            Opening: {money(data.opening_balance)} | Debit: {money(data.total_debit)} | Credit:{' '}
            {money(data.total_credit)} | Closing: {money(data.closing_balance)}
          </p>
          <EntryTable entries={data.entries || []} cols="ledger" />
        </>
      )}
    </div>
  )
}

export function CashBookPage() {
  const [fromDate, setFromDate] = useState(firstOfMonthISO())
  const [toDate, setToDate] = useState(todayISO())
  const [data, setData] = useState<CashbookDaybook | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setError('')
    try {
      const rows = await api.get<CashbookDaybook>('/cashbook/cash-book', {
        from_date: fromDate,
        to_date: toDate,
      })
      setData(rows)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    }
  }, [fromDate, toDate])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="modify-page">
      <h2>Cash Book</h2>
      <p className="modify-hint">All voucher lines on Cash or Bank ledgers for the date range.</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="sb-row">
        <span className="field-label">From</span>
        <input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <span className="field-label">To</span>
        <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
          Refresh
        </button>
        {data && (
          <ExportFormatButtons
            onExport={(format) =>
              exportEntries(`cash-book-${fromDate}-to-${toDate}`, 'Cash Book', data.entries || [], 'cash', format)
            }
          />
        )}
      </div>
      {data && (
        <>
          <p className="hint" style={{ fontWeight: 700 }}>
            Debit: {money(data.total_debit)} | Credit: {money(data.total_credit)}
          </p>
          <EntryTable entries={data.entries || []} cols="cash" />
        </>
      )}
    </div>
  )
}

export function DaybookPage() {
  const [fromDate, setFromDate] = useState(todayISO())
  const [toDate, setToDate] = useState(todayISO())
  const [data, setData] = useState<CashbookDaybook | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setError('')
    try {
      const rows = await api.get<CashbookDaybook>('/cashbook/daybook', {
        from_date: fromDate,
        to_date: toDate,
      })
      setData(rows)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    }
  }, [fromDate, toDate])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="modify-page">
      <h2>Daybook</h2>
      <p className="modify-hint">All cashbook voucher lines for the selected period.</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="sb-row">
        <span className="field-label">From</span>
        <input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <span className="field-label">To</span>
        <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
          Refresh
        </button>
        {data && (
          <ExportFormatButtons
            onExport={(format) =>
              exportEntries(`daybook-${fromDate}-to-${toDate}`, 'Daybook', data.entries || [], 'day', format)
            }
          />
        )}
      </div>
      {data && (
        <>
          <p className="hint" style={{ fontWeight: 700 }}>
            Debit: {money(data.total_debit)} | Credit: {money(data.total_credit)}
          </p>
          <EntryTable entries={data.entries || []} cols="day" />
        </>
      )}
    </div>
  )
}

export function CashbookLedgerViewPage() {
  const [mode, setMode] = useState<'ledger' | 'party'>('ledger')
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [ledgerId, setLedgerId] = useState('')
  const [partyCode, setPartyCode] = useState('')
  const [fromDate, setFromDate] = useState(firstOfMonthISO())
  const [toDate, setToDate] = useState(todayISO())
  const [ledgerData, setLedgerData] = useState<CashbookLedgerStatement | null>(null)
  const [partyData, setPartyData] = useState<CashbookPartyAccount | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const rows = await api.get<Ledger[]>('/ledgers')
        setLedgers(rows)
        if (rows[0]) setLedgerId(rows[0].id)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load')
      }
    })()
  }, [])

  const refresh = async () => {
    setError('')
    try {
      if (mode === 'party') {
        if (!partyCode.trim()) {
          setError('Enter customer code.')
          return
        }
        const data = await api.get<CashbookPartyAccount>('/cashbook/party-account', {
          party_code: partyCode.trim(),
          from_date: fromDate,
          to_date: toDate,
        })
        setPartyData(data)
        setLedgerData(null)
      } else {
        if (!ledgerId) return
        const data = await api.get<CashbookLedgerStatement>(`/cashbook/ledger/${ledgerId}`, {
          from_date: fromDate,
          to_date: toDate,
        })
        setLedgerData(data)
        setPartyData(null)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    }
  }

  return (
    <div className="modify-page">
      <h2>Cashbook / Ledger View</h2>
      <p className="modify-hint">View by ledger statement or by customer account.</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="sb-row">
        <span className="field-label">Mode</span>
        <select
          className="input"
          value={mode}
          onChange={(e) => setMode(e.target.value as 'ledger' | 'party')}
        >
          <option value="ledger">By Ledger</option>
          <option value="party">By Customer Account</option>
        </select>
        {mode === 'ledger' ? (
          <>
            <span className="field-label">Ledger</span>
            <select className="input" value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}>
              {ledgers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <span className="field-label">Customer ID</span>
            <input
              className="input"
              value={partyCode}
              onChange={(e) => setPartyCode(e.target.value)}
              placeholder="e.g. 1"
            />
          </>
        )}
        <span className="field-label">From</span>
        <input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <span className="field-label">To</span>
        <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
          Refresh
        </button>
        {(ledgerData || partyData) && (
          <ExportFormatButtons
            onExport={(format) => {
              if (ledgerData) {
                exportEntries(
                  `cashbook-ledger-${ledgerData.ledger_code || 'ledger'}`,
                  'Ledger',
                  ledgerData.entries || [],
                  'ledger',
                  format,
                )
              } else if (partyData) {
                exportEntries(
                  `cashbook-party-${partyData.party_code || 'party'}`,
                  'Party',
                  partyData.entries || [],
                  'party',
                  format,
                )
              }
            }}
          />
        )}
      </div>
      {ledgerData && (
        <>
          <p className="hint" style={{ fontWeight: 700 }}>
            Opening: {money(ledgerData.opening_balance)} | Closing: {money(ledgerData.closing_balance)}
          </p>
          <EntryTable entries={ledgerData.entries || []} cols="ledger" />
        </>
      )}
      {partyData && (
        <>
          <p className="hint" style={{ fontWeight: 700 }}>
            {partyData.party_code} {partyData.party_name || ''} | Deposit:{' '}
            {money(partyData.deposit_balance)} | Debit: {money(partyData.total_debit)} | Credit:{' '}
            {money(partyData.total_credit)}
          </p>
          <EntryTable entries={partyData.entries || []} cols="party" />
        </>
      )}
    </div>
  )
}
