import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { ListPager } from '../../components/generp/ListPager'
import { Typeahead } from '../../components/generp/Typeahead'
import { downloadExcel } from '../../lib/generp/exportExcel'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { fmt } from '../../lib/generp/saleBillMath'
import type { Party, PartyLedgerDetails, PartyScheduleRow } from '../../generpTypes'

function money(v: unknown) {
  return fmt(Number(v || 0))
}

type Kind = 'debtor' | 'creditor'

function groupName(kind: Kind) {
  return kind === 'creditor' ? 'Sundry Creditors' : 'Sundry Debtors'
}

export function PartySchedulePage({ kind }: { kind: Kind }) {
  const noun = kind === 'creditor' ? 'Supplier' : 'Customer'
  const [rows, setRows] = useState<PartyScheduleRow[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pager = useClientPager(rows, `${rows.length}-${rows[0]?.ledger_id || ''}`, TABLE_PAGE_SIZE)

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const data = await api.get<PartyScheduleRow[]>('/reports/sundry-debtors', {
        group_name: groupName(kind),
      })
      setRows(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load schedule')
    } finally {
      setBusy(false)
    }
  }, [kind])

  useEffect(() => {
    void load()
  }, [load])

  const total = rows.reduce((s, r) => s + Number(r.balance || 0), 0)
  const balLabel = kind === 'creditor' ? 'Balance (Cr)' : 'Balance (Dr)'

  return (
    <div className="modify-page">
      <h2>{noun} Schedule</h2>
      <p className="modify-hint">
        Outstanding {noun.toLowerCase()} balances from posted bills and payments.
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="sb-row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void load()}>
          Refresh
        </button>
        <ExportFormatButtons
          disabled={!rows.length}
          onExport={(format) =>
            downloadExcel(
              `${noun.toLowerCase()}-schedule`,
              {
                name: `${noun} Schedule`,
                headers: ['Name', 'Debit', 'Credit', balLabel],
                rows: rows.map((r) => [r.name, Number(r.debit || 0), Number(r.credit || 0), Number(r.balance || 0)]),
              },
              format,
            )
          }
        />
        <span className="hint">
          Total outstanding: {money(total)} · {rows.length} {noun.toLowerCase()}(s)
        </span>
      </div>
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
            <th>Name</th>
            <th className="text-end">Debit</th>
            <th className="text-end">Credit</th>
            <th className="text-end">{balLabel}</th>
          </tr>
        </thead>
        <tbody>
          {pager.pageRows.length === 0 && (
            <tr>
              <td colSpan={4} className="text-muted">
                {busy ? 'Loading…' : `No outstanding ${noun.toLowerCase()}s.`}
              </td>
            </tr>
          )}
          {pager.pageRows.map((r) => (
            <tr key={r.ledger_id}>
              <td>{r.name}</td>
              <td className="text-end">{money(r.debit)}</td>
              <td className="text-end">{money(r.credit)}</td>
              <td className="text-end">{money(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PartyDetailsReportPage({ kind }: { kind: Kind }) {
  const noun = kind === 'creditor' ? 'Supplier' : 'Customer'
  const partyType = kind === 'creditor' ? 'vendor' : 'customer'
  const [parties, setParties] = useState<Party[]>([])
  const [party, setParty] = useState<Party | null>(null)
  const [partyText, setPartyText] = useState('')
  const [data, setData] = useState<PartyLedgerDetails | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pager = useClientPager(
    data?.rows || [],
    `${data?.ledger_id || ''}-${data?.rows?.length || 0}`,
    TABLE_PAGE_SIZE,
  )

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<Party[]>('/parties', { party_type: partyType })
        setParties(list)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : `Failed to load ${noun.toLowerCase()}s`)
      }
    })()
  }, [partyType, noun])

  const load = async () => {
    if (!party?.id) {
      setError(`Select a ${noun.toLowerCase()}.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const details = await api.get<PartyLedgerDetails>('/reports/debtor-details', {
        party_id: party.id,
      })
      setData(details)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load details')
    } finally {
      setBusy(false)
    }
  }

  const closing = Number(data?.closing_balance || 0)
  const closingLabel =
    closing < -0.005 ? `${money(Math.abs(closing))} Cr` : closing > 0.005 ? `${money(closing)} Dr` : money(0)

  return (
    <div className="modify-page">
      <h2>{noun} Details</h2>
      <p className="modify-hint">
        Individual {noun.toLowerCase()} ledger — bills, payments, and running balance.
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="sb-row">
        <span className="field-label">{noun}</span>
        <div style={{ minWidth: 260, flex: 1 }}>
          <Typeahead
            value={partyText}
            onChange={(v) => {
              setPartyText(v)
              setParty(null)
            }}
            items={parties}
            getLabel={(p) => `${p.code || ''} — ${p.name}`}
            getKey={(p) => p.id}
            placeholder={`Search ${noun.toLowerCase()}`}
            onSelect={(p) => {
              setParty(p)
              setPartyText(`${p.code || ''} — ${p.name}`)
            }}
          />
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void load()}>
          Show
        </button>
        {data && (
          <ExportFormatButtons
            onExport={(format) =>
              downloadExcel(
                `${noun.toLowerCase()}-details-${party?.code || 'party'}`,
                {
                  name: `${noun} Details`,
                  headers: ['Date', 'Type', 'No', 'Narration', 'Debit', 'Credit', 'Balance'],
                  rows: (data.rows || []).map((r) => [
                    String(r.entry_date || '').slice(0, 10),
                    r.voucher_type,
                    r.voucher_no,
                    r.narration || '',
                    Number(r.debit || 0),
                    Number(r.credit || 0),
                    Number(r.balance || 0),
                  ]),
                },
                format,
              )
            }
          />
        )}
      </div>
      {data && (
        <>
          <p className="hint">
            {data.ledger_name} · Opening {money(data.opening_balance)} · Closing {closingLabel}
          </p>
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
                <th>Type</th>
                <th>No</th>
                <th>Narration</th>
                <th className="text-end">Debit</th>
                <th className="text-end">Credit</th>
                <th className="text-end">Balance</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted">
                    No entries
                  </td>
                </tr>
              )}
              {pager.pageRows.map((r, i) => (
                <tr key={`${r.voucher_no}-${r.entry_date}-${i}`}>
                  <td>{String(r.entry_date || '').slice(0, 10)}</td>
                  <td>{r.voucher_type}</td>
                  <td>{r.voucher_no}</td>
                  <td>{r.narration || ''}</td>
                  <td className="text-end">{money(r.debit)}</td>
                  <td className="text-end">{money(r.credit)}</td>
                  <td className="text-end">{money(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

export function SupplierSchedulePage() {
  return <PartySchedulePage kind="creditor" />
}

export function SupplierDetailsPage() {
  return <PartyDetailsReportPage kind="creditor" />
}

export function CustomerSchedulePage() {
  return <PartySchedulePage kind="debtor" />
}

export function CustomerDetailsPage() {
  return <PartyDetailsReportPage kind="debtor" />
}
