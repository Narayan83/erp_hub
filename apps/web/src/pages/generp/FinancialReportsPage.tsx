import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from '../../api/client'
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel } from '../../lib/generp/exportExcel'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { fmt, todayISO } from '../../lib/generp/saleBillMath'
import type { CashbookLedgerStatement } from '../../generpTypes'

function money(v: unknown) {
  return fmt(Number(v || 0))
}

function firstOfMonthISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function fyStartISO(iso?: string) {
  const d = iso ? new Date(iso) : new Date()
  const y = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-04-01`
}

type DrillLedger = {
  kind: 'ledger'
  title: string
  ledgerId: string
  fromDate: string
  toDate: string
}

type DrillVoucher = {
  kind: 'voucher'
  title: string
  voucherId: string
}

type DrillStep = DrillLedger | DrillVoucher

type TrialBalance = {
  from_date: string
  to_date: string
  rows: Array<{
    ledger_id: string
    ledger_code: string
    ledger_name: string
    group_name: string
    ledger_type: string
    opening_debit: string | number
    opening_credit: string | number
    period_debit: string | number
    period_credit: string | number
    closing_debit: string | number
    closing_credit: string | number
  }>
  totals: Record<string, string | number>
}

type ProfitLoss = {
  from_date: string
  to_date: string
  income: Array<{
    ledger_id: string
    ledger_code: string
    ledger_name: string
    amount: string | number
  }>
  expense: Array<{
    ledger_id: string
    ledger_code: string
    ledger_name: string
    amount: string | number
  }>
  total_income: string | number
  total_expense: string | number
  net_profit: string | number
  net_loss: string | number
  net: string | number
}

type BalanceSheet = {
  as_of: string
  fy_from: string
  assets: Array<{
    ledger_id: string | null
    ledger_code: string
    ledger_name: string
    group_name: string
    amount: string | number
    is_pl_plug?: boolean
  }>
  liabilities: Array<{
    ledger_id: string | null
    ledger_code: string
    ledger_name: string
    group_name: string
    amount: string | number
    is_pl_plug?: boolean
  }>
  total_assets: string | number
  total_liabilities: string | number
}

type ReceiptPayment = {
  from_date: string
  to_date: string
  entries: Array<{
    id: string
    voucher_id: string
    voucher_no: string
    voucher_date: string
    entry_type: string
    ledger_code: string
    ledger_id: string
    party_code?: string | null
    narration?: string | null
    amount: string | number
  }>
  total_receipt: string | number
  total_payment: string | number
  net: string | number
}

type VoucherDetail = {
  id: string
  voucher_no: string
  voucher_date: string
  source_type: string
  party_code?: string | null
  party_name?: string | null
  narration?: string | null
  lines: Array<{
    id: string
    ledger_id: string
    ledger_code: string
    ledger_name: string
    debit_amount: string | number
    credit_amount: string | number
    narration?: string | null
  }>
}

function AmountLink({
  value,
  onClick,
  disabled,
}: {
  value: unknown
  onClick?: () => void
  disabled?: boolean
}) {
  const n = Number(value || 0)
  if (!n || disabled || !onClick) {
    return <span className="text-end d-block">{money(n)}</span>
  }
  return (
    <button type="button" className="rmp-amount-link text-end" onClick={onClick}>
      {money(n)}
    </button>
  )
}

function DrillPanel({
  stack,
  onBack,
  onClear,
  onOpenVoucher,
  children,
}: {
  stack: DrillStep[]
  onBack: () => void
  onClear: () => void
  onOpenVoucher?: (voucherId: string, title: string) => void
  children: ReactNode
}) {
  if (!stack.length) return null
  return (
    <div className="fin-drill">
      <div className="fin-drill-bar">
        <button type="button" className="btn" onClick={onBack}>
          ← Back
        </button>
        <button type="button" className="btn" onClick={onClear}>
          Close drill-down
        </button>
        <div className="fin-crumb">
          {stack.map((s, i) => (
            <span key={`${s.kind}-${i}`}>
              {i > 0 ? ' › ' : ''}
              <strong>{s.title}</strong>
            </span>
          ))}
        </div>
      </div>
      {children}
      {onOpenVoucher ? null : null}
    </div>
  )
}

function useDrill() {
  const [stack, setStack] = useState<DrillStep[]>([])
  const [ledgerData, setLedgerData] = useState<CashbookLedgerStatement | null>(null)
  const [voucherData, setVoucherData] = useState<VoucherDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const loadTop = useCallback(async (step: DrillStep) => {
    setBusy(true)
    setError('')
    try {
      if (step.kind === 'ledger') {
        const data = await api.get<CashbookLedgerStatement>(`/cashbook/ledger/${step.ledgerId}`, {
          from_date: step.fromDate,
          to_date: step.toDate,
        })
        setLedgerData(data)
        setVoucherData(null)
      } else {
        const data = await api.get<VoucherDetail>(`/financial-reports/voucher/${step.voucherId}`)
        setVoucherData(data)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Drill-down failed')
    } finally {
      setBusy(false)
    }
  }, [])

  const openLedger = async (ledgerId: string, title: string, fromDate: string, toDate: string) => {
    const step: DrillLedger = { kind: 'ledger', title, ledgerId, fromDate, toDate }
    setStack((s) => [...s, step])
    await loadTop(step)
  }

  const openVoucher = async (voucherId: string, title: string) => {
    const step: DrillVoucher = { kind: 'voucher', title, voucherId }
    setStack((s) => [...s, step])
    await loadTop(step)
  }

  const back = async () => {
    setStack((prev) => {
      const next = prev.slice(0, -1)
      const top = next[next.length - 1]
      if (top) void loadTop(top)
      else {
        setLedgerData(null)
        setVoucherData(null)
      }
      return next
    })
  }

  const clear = () => {
    setStack([])
    setLedgerData(null)
    setVoucherData(null)
    setError('')
  }

  return {
    stack,
    ledgerData,
    voucherData,
    error,
    busy,
    openLedger,
    openVoucher,
    back,
    clear,
  }
}

function DrillBody({
  drill,
}: {
  drill: ReturnType<typeof useDrill>
}) {
  const entries = drill.ledgerData?.entries || []
  const pager = useClientPager(entries, drill.ledgerData?.ledger_id || '', TABLE_PAGE_SIZE)
  const top = drill.stack[drill.stack.length - 1]
  if (!top) return null

  if (drill.busy) return <p className="hint">Loading…</p>
  if (drill.error) return <div className="error-banner">{drill.error}</div>

  if (top.kind === 'ledger' && drill.ledgerData) {
    const d = drill.ledgerData
    return (
      <div>
        <p className="hint" style={{ fontWeight: 700 }}>
          {d.ledger_code} — {d.ledger_name} | Opening {money(d.opening_balance)} | Dr{' '}
          {money(d.total_debit)} | Cr {money(d.total_credit)} | Closing {money(d.closing_balance)}
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
              <th>Voucher</th>
              <th>Party</th>
              <th>Narration</th>
              <th className="text-end">Debit</th>
              <th className="text-end">Credit</th>
              <th className="text-end">Balance</th>
            </tr>
          </thead>
          <tbody>
            {pager.pageRows.map((e) => (
              <tr key={e.id}>
                <td>{String(e.voucher_date || '').slice(0, 10)}</td>
                <td>
                  <button
                    type="button"
                    className="rmp-amount-link"
                    onClick={() => void drill.openVoucher(e.voucher_id, e.voucher_no)}
                  >
                    {e.voucher_no}
                  </button>
                </td>
                <td>{e.party_code || ''}</td>
                <td>{e.line_narration || e.narration || ''}</td>
                <td className="text-end">{money(e.debit_amount)}</td>
                <td className="text-end">{money(e.credit_amount)}</td>
                <td className="text-end">{money(e.running_balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (top.kind === 'voucher' && drill.voucherData) {
    const v = drill.voucherData
    return (
      <div>
        <p className="hint" style={{ fontWeight: 700 }}>
          {v.voucher_no} | {String(v.voucher_date).slice(0, 10)} | {v.source_type}
          {v.party_code ? ` | ${v.party_code} ${v.party_name || ''}` : ''}
        </p>
        {v.narration && <p className="hint">{v.narration}</p>}
        <table className="table data-table">
          <thead>
            <tr>
              <th>Ledger</th>
              <th>Narration</th>
              <th className="text-end">Debit</th>
              <th className="text-end">Credit</th>
            </tr>
          </thead>
          <tbody>
            {v.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  {line.ledger_code} — {line.ledger_name}
                </td>
                <td>{line.narration || ''}</td>
                <td className="text-end">{money(line.debit_amount)}</td>
                <td className="text-end">{money(line.credit_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return null
}

/* ---------- Trial Balance ---------- */
export function TrialBalancePage() {
  const [fromDate, setFromDate] = useState(fyStartISO())
  const [toDate, setToDate] = useState(todayISO())
  const [data, setData] = useState<TrialBalance | null>(null)
  const [error, setError] = useState('')
  const drill = useDrill()
  const pager = useClientPager(
    data?.rows || [],
    `${fromDate}|${toDate}|${data?.rows.length || 0}`,
    TABLE_PAGE_SIZE,
  )

  const refresh = async () => {
    setError('')
    drill.clear()
    try {
      const res = await api.get<TrialBalance>('/financial-reports/trial-balance', {
        from_date: fromDate,
        to_date: toDate,
      })
      setData(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="modify-page">
      <h2>Trial Balance</h2>
      <p className="modify-hint">
        Click any amount to open the ledger statement, then click a voucher number to see the entry
        lines.
      </p>
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
              downloadExcel(
                `trial-balance-${fromDate}-to-${toDate}`,
                {
                  name: 'Trial Balance',
                  headers: ['Ledger', 'Group', 'Op. Dr', 'Op. Cr', 'Dr', 'Cr', 'Cl. Dr', 'Cl. Cr'],
                  rows: [
                    ...data.rows.map((r) => [
                      `${r.ledger_code} — ${r.ledger_name}`,
                      r.group_name,
                      Number(r.opening_debit || 0),
                      Number(r.opening_credit || 0),
                      Number(r.period_debit || 0),
                      Number(r.period_credit || 0),
                      Number(r.closing_debit || 0),
                      Number(r.closing_credit || 0),
                    ]),
                    [
                      'Total',
                      '',
                      Number(data.totals.opening_debit || 0),
                      Number(data.totals.opening_credit || 0),
                      Number(data.totals.period_debit || 0),
                      Number(data.totals.period_credit || 0),
                      Number(data.totals.closing_debit || 0),
                      Number(data.totals.closing_credit || 0),
                    ],
                  ],
                },
                format,
              )
            }
          />
        )}
      </div>

      {drill.stack.length > 0 ? (
        <DrillPanel stack={drill.stack} onBack={() => void drill.back()} onClear={drill.clear}>
          <DrillBody drill={drill} />
        </DrillPanel>
      ) : (
        data && (
          <>
            <div className="sb-table-wrap">
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
                    <th>Ledger</th>
                    <th>Group</th>
                    <th className="text-end">Op. Dr</th>
                    <th className="text-end">Op. Cr</th>
                    <th className="text-end">Dr</th>
                    <th className="text-end">Cr</th>
                    <th className="text-end">Cl. Dr</th>
                    <th className="text-end">Cl. Cr</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.pageRows.map((r) => (
                    <tr key={r.ledger_id}>
                      <td>
                        {r.ledger_code} — {r.ledger_name}
                      </td>
                      <td>{r.group_name}</td>
                      <td>
                        <AmountLink
                          value={r.opening_debit}
                          onClick={() =>
                            void drill.openLedger(
                              r.ledger_id,
                              `${r.ledger_code} (opening)`,
                              fromDate,
                              toDate,
                            )
                          }
                        />
                      </td>
                      <td>
                        <AmountLink
                          value={r.opening_credit}
                          onClick={() =>
                            void drill.openLedger(r.ledger_id, r.ledger_code, fromDate, toDate)
                          }
                        />
                      </td>
                      <td>
                        <AmountLink
                          value={r.period_debit}
                          onClick={() =>
                            void drill.openLedger(r.ledger_id, r.ledger_code, fromDate, toDate)
                          }
                        />
                      </td>
                      <td>
                        <AmountLink
                          value={r.period_credit}
                          onClick={() =>
                            void drill.openLedger(r.ledger_id, r.ledger_code, fromDate, toDate)
                          }
                        />
                      </td>
                      <td>
                        <AmountLink
                          value={r.closing_debit}
                          onClick={() =>
                            void drill.openLedger(r.ledger_id, r.ledger_code, fromDate, toDate)
                          }
                        />
                      </td>
                      <td>
                        <AmountLink
                          value={r.closing_credit}
                          onClick={() =>
                            void drill.openLedger(r.ledger_id, r.ledger_code, fromDate, toDate)
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 700 }}>
                      Total
                    </td>
                    <td className="text-end" style={{ fontWeight: 700 }}>
                      {money(data.totals.opening_debit)}
                    </td>
                    <td className="text-end" style={{ fontWeight: 700 }}>
                      {money(data.totals.opening_credit)}
                    </td>
                    <td className="text-end" style={{ fontWeight: 700 }}>
                      {money(data.totals.period_debit)}
                    </td>
                    <td className="text-end" style={{ fontWeight: 700 }}>
                      {money(data.totals.period_credit)}
                    </td>
                    <td className="text-end" style={{ fontWeight: 700 }}>
                      {money(data.totals.closing_debit)}
                    </td>
                    <td className="text-end" style={{ fontWeight: 700 }}>
                      {money(data.totals.closing_credit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )
      )}
    </div>
  )
}

/* ---------- P&L ---------- */
export function ProfitAndLossPage() {
  const [fromDate, setFromDate] = useState(fyStartISO())
  const [toDate, setToDate] = useState(todayISO())
  const [data, setData] = useState<ProfitLoss | null>(null)
  const [error, setError] = useState('')
  const drill = useDrill()
  const incomePager = useClientPager(
    data?.income || [],
    `${fromDate}|${toDate}|${data?.income.length || 0}`,
    TABLE_PAGE_SIZE,
  )
  const expensePager = useClientPager(
    data?.expense || [],
    `${fromDate}|${toDate}|${data?.expense.length || 0}`,
    TABLE_PAGE_SIZE,
  )

  const refresh = async () => {
    setError('')
    drill.clear()
    try {
      setData(
        await api.get<ProfitLoss>('/financial-reports/profit-and-loss', {
          from_date: fromDate,
          to_date: toDate,
        }),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="modify-page">
      <h2>Profit &amp; Loss Account</h2>
      <p className="modify-hint">Click an amount to drill into that ledger’s entries for the period.</p>
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
              downloadExcel(
                `profit-and-loss-${fromDate}-to-${toDate}`,
                [
                  {
                    name: 'Income',
                    headers: ['Ledger', 'Amount'],
                    rows: [
                      ...data.income.map((r) => [
                        `${r.ledger_code} — ${r.ledger_name}`,
                        Number(r.amount || 0),
                      ]),
                      ['Total income', Number(data.total_income || 0)],
                      ['Net profit', Number(data.net_profit || 0)],
                    ],
                  },
                  {
                    name: 'Expense',
                    headers: ['Ledger', 'Amount'],
                    rows: [
                      ...data.expense.map((r) => [
                        `${r.ledger_code} — ${r.ledger_name}`,
                        Number(r.amount || 0),
                      ]),
                      ['Total expense', Number(data.total_expense || 0)],
                      ['Net loss', Number(data.net_loss || 0)],
                    ],
                  },
                ],
                format,
              )
            }
          />
        )}
      </div>

      {drill.stack.length > 0 ? (
        <DrillPanel stack={drill.stack} onBack={() => void drill.back()} onClear={drill.clear}>
          <DrillBody drill={drill} />
        </DrillPanel>
      ) : (
        data && (
          <div className="fin-two-col">
            <div className="settings-box">
              <div className="settings-box-title">Income</div>
              <ListPager
                compact
                topRight
                page={incomePager.page}
                totalPages={incomePager.totalPages}
                total={incomePager.total}
                pageSize={incomePager.pageSize}
                onPage={incomePager.setPage}
              />
              <table className="table data-table">
                <thead>
                  <tr>
                    <th>Ledger</th>
                    <th className="text-end">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {incomePager.pageRows.map((r) => (
                    <tr key={r.ledger_id}>
                      <td>
                        {r.ledger_code} — {r.ledger_name}
                      </td>
                      <td>
                        <AmountLink
                          value={r.amount}
                          onClick={() =>
                            void drill.openLedger(r.ledger_id, r.ledger_code, fromDate, toDate)
                          }
                        />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ fontWeight: 700 }}>Total Income</td>
                    <td className="text-end" style={{ fontWeight: 700 }}>
                      {money(data.total_income)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="settings-box">
              <div className="settings-box-title">Expense</div>
              <ListPager
                compact
                topRight
                page={expensePager.page}
                totalPages={expensePager.totalPages}
                total={expensePager.total}
                pageSize={expensePager.pageSize}
                onPage={expensePager.setPage}
              />
              <table className="table data-table">
                <thead>
                  <tr>
                    <th>Ledger</th>
                    <th className="text-end">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {expensePager.pageRows.map((r) => (
                    <tr key={r.ledger_id}>
                      <td>
                        {r.ledger_code} — {r.ledger_name}
                      </td>
                      <td>
                        <AmountLink
                          value={r.amount}
                          onClick={() =>
                            void drill.openLedger(r.ledger_id, r.ledger_code, fromDate, toDate)
                          }
                        />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ fontWeight: 700 }}>Total Expense</td>
                    <td className="text-end" style={{ fontWeight: 700 }}>
                      {money(data.total_expense)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="hint" style={{ fontWeight: 700, gridColumn: '1 / -1' }}>
              {Number(data.net) >= 0
                ? `Net Profit: ${money(data.net_profit)}`
                : `Net Loss: ${money(data.net_loss)}`}
            </p>
          </div>
        )
      )}
    </div>
  )
}

/* ---------- Balance Sheet ---------- */
export function BalanceSheetPage() {
  const [asOf, setAsOf] = useState(todayISO())
  const [data, setData] = useState<BalanceSheet | null>(null)
  const [error, setError] = useState('')
  const drill = useDrill()
  const assetPager = useClientPager(
    data?.assets || [],
    `${asOf}|${data?.assets.length || 0}`,
    TABLE_PAGE_SIZE,
  )
  const liabPager = useClientPager(
    data?.liabilities || [],
    `${asOf}|${data?.liabilities.length || 0}`,
    TABLE_PAGE_SIZE,
  )

  const refresh = async () => {
    setError('')
    drill.clear()
    try {
      setData(await api.get<BalanceSheet>('/financial-reports/balance-sheet', { as_of: asOf }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openRow = (ledgerId: string | null, code: string, isPlug?: boolean) => {
    if (!ledgerId || isPlug) return
    const from = data?.fy_from || fyStartISO(asOf)
    void drill.openLedger(ledgerId, code, from, asOf)
  }

  return (
    <div className="modify-page">
      <h2>Balance Sheet</h2>
      <p className="modify-hint">
        Click an amount to see the ledger movements that make up the balance, then open the voucher
        for the full entry.
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="sb-row">
        <span className="field-label">As of</span>
        <input className="input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
          Refresh
        </button>
        {data && (
          <ExportFormatButtons
            onExport={(format) =>
              downloadExcel(
                `balance-sheet-${asOf}`,
                [
                  {
                    name: 'Assets',
                    headers: ['Ledger', 'Group', 'Amount'],
                    rows: [
                      ...data.assets.map((r) => [
                        `${r.ledger_code} — ${r.ledger_name}`,
                        r.group_name,
                        Number(r.amount || 0),
                      ]),
                      ['Total assets', '', Number(data.total_assets || 0)],
                    ],
                  },
                  {
                    name: 'Liabilities',
                    headers: ['Ledger', 'Group', 'Amount'],
                    rows: [
                      ...data.liabilities.map((r) => [
                        `${r.ledger_code} — ${r.ledger_name}`,
                        r.group_name,
                        Number(r.amount || 0),
                      ]),
                      ['Total liabilities', '', Number(data.total_liabilities || 0)],
                    ],
                  },
                ],
                format,
              )
            }
          />
        )}
      </div>

      {drill.stack.length > 0 ? (
        <DrillPanel stack={drill.stack} onBack={() => void drill.back()} onClear={drill.clear}>
          <DrillBody drill={drill} />
        </DrillPanel>
      ) : (
        data && (
          <div className="fin-two-col">
            <div className="settings-box">
              <div className="settings-box-title">Assets</div>
              <ListPager
                compact
                topRight
                page={assetPager.page}
                totalPages={assetPager.totalPages}
                total={assetPager.total}
                pageSize={assetPager.pageSize}
                onPage={assetPager.setPage}
              />
              <table className="table data-table">
                <thead>
                  <tr>
                    <th>Ledger</th>
                    <th>Group</th>
                    <th className="text-end">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {assetPager.pageRows.map((r, i) => (
                    <tr key={`${r.ledger_code}-${i}`}>
                      <td>
                        {r.ledger_code} — {r.ledger_name}
                      </td>
                      <td>{r.group_name}</td>
                      <td>
                        <AmountLink
                          value={r.amount}
                          disabled={!!r.is_pl_plug || !r.ledger_id}
                          onClick={() => openRow(r.ledger_id, r.ledger_code, r.is_pl_plug)}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 700 }}>
                      Total Assets
                    </td>
                    <td className="text-end" style={{ fontWeight: 700 }}>
                      {money(data.total_assets)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="settings-box">
              <div className="settings-box-title">Liabilities &amp; Equity</div>
              <ListPager
                compact
                topRight
                page={liabPager.page}
                totalPages={liabPager.totalPages}
                total={liabPager.total}
                pageSize={liabPager.pageSize}
                onPage={liabPager.setPage}
              />
              <table className="table data-table">
                <thead>
                  <tr>
                    <th>Ledger</th>
                    <th>Group</th>
                    <th className="text-end">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {liabPager.pageRows.map((r, i) => (
                    <tr key={`${r.ledger_code}-${i}`}>
                      <td>
                        {r.ledger_code} — {r.ledger_name}
                      </td>
                      <td>{r.group_name}</td>
                      <td>
                        <AmountLink
                          value={r.amount}
                          disabled={!!r.is_pl_plug || !r.ledger_id}
                          onClick={() => openRow(r.ledger_id, r.ledger_code, r.is_pl_plug)}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 700 }}>
                      Total Liabilities
                    </td>
                    <td className="text-end" style={{ fontWeight: 700 }}>
                      {money(data.total_liabilities)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  )
}

/* ---------- Receipt & Payment ---------- */
export function ReceiptPaymentReportPage() {
  const [fromDate, setFromDate] = useState(firstOfMonthISO())
  const [toDate, setToDate] = useState(todayISO())
  const [entryType, setEntryType] = useState<'all' | 'receipt' | 'payment'>('all')
  const [data, setData] = useState<ReceiptPayment | null>(null)
  const [error, setError] = useState('')
  const drill = useDrill()
  const rpPager = useClientPager(
    data?.entries || [],
    `${fromDate}|${toDate}|${entryType}|${data?.entries.length || 0}`,
    TABLE_PAGE_SIZE,
  )

  const refresh = async () => {
    setError('')
    drill.clear()
    try {
      setData(
        await api.get<ReceiptPayment>('/financial-reports/receipt-payment', {
          from_date: fromDate,
          to_date: toDate,
          entry_type: entryType,
        }),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="modify-page">
      <h2>Receipt &amp; Payment</h2>
      <p className="modify-hint">
        Cash/Bank receipts (debit) and payments (credit). Click amount or voucher to drill down.
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="sb-row">
        <span className="field-label">From</span>
        <input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <span className="field-label">To</span>
        <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <span className="field-label">Type</span>
        <select
          className="input"
          value={entryType}
          onChange={(e) => setEntryType(e.target.value as 'all' | 'receipt' | 'payment')}
        >
          <option value="all">All</option>
          <option value="receipt">Receipt</option>
          <option value="payment">Payment</option>
        </select>
        <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
          Refresh
        </button>
        {data && (
          <ExportFormatButtons
            onExport={(format) =>
              downloadExcel(
                `receipt-payment-${fromDate}-to-${toDate}`,
                {
                  name: 'Receipt Payment',
                  headers: ['Date', 'Voucher', 'Type', 'Ledger', 'Party', 'Narration', 'Amount'],
                  rows: [
                    ...data.entries.map((e) => [
                      String(e.voucher_date || '').slice(0, 10),
                      e.voucher_no,
                      e.entry_type,
                      e.ledger_code,
                      e.party_code || '',
                      e.narration || '',
                      Number(e.amount || 0),
                    ]),
                    ['Total receipt', '', '', '', '', '', Number(data.total_receipt || 0)],
                    ['Total payment', '', '', '', '', '', Number(data.total_payment || 0)],
                    ['Net', '', '', '', '', '', Number(data.net || 0)],
                  ],
                },
                format,
              )
            }
          />
        )}
      </div>

      {drill.stack.length > 0 ? (
        <DrillPanel stack={drill.stack} onBack={() => void drill.back()} onClear={drill.clear}>
          <DrillBody drill={drill} />
        </DrillPanel>
      ) : (
        data && (
          <>
            <p className="hint" style={{ fontWeight: 700 }}>
              Receipts {money(data.total_receipt)} | Payments {money(data.total_payment)} | Net{' '}
              {money(data.net)}
            </p>
            <ListPager
              topRight
              page={rpPager.page}
              totalPages={rpPager.totalPages}
              total={rpPager.total}
              pageSize={rpPager.pageSize}
              onPage={rpPager.setPage}
            />
            <table className="table data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Voucher</th>
                  <th>Type</th>
                  <th>Cash/Bank</th>
                  <th>Party</th>
                  <th>Narration</th>
                  <th className="text-end">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-muted">
                      No entries
                    </td>
                  </tr>
                )}
                {rpPager.pageRows.map((e) => (
                  <tr key={e.id}>
                    <td>{String(e.voucher_date).slice(0, 10)}</td>
                    <td>
                      <button
                        type="button"
                        className="rmp-amount-link"
                        onClick={() => void drill.openVoucher(e.voucher_id, e.voucher_no)}
                      >
                        {e.voucher_no}
                      </button>
                    </td>
                    <td>{e.entry_type}</td>
                    <td>{e.ledger_code}</td>
                    <td>{e.party_code || ''}</td>
                    <td>{e.narration || ''}</td>
                    <td>
                      <AmountLink
                        value={e.amount}
                        onClick={() =>
                          void drill.openLedger(e.ledger_id, e.ledger_code, fromDate, toDate)
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )
      )}
    </div>
  )
}
