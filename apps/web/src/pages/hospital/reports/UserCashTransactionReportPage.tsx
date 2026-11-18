import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import { DateRangeReportShell, fmtDate, fmtMoney, ReportRow, ReportTableModel } from './DateRangeReportShell'
import { SegmentedPicker, SummaryCards } from './ReportFilterControls'

type Amount = number | string

type Row = {
  bill_no: string
  patient_no: string
  patient_name: string
  amount: Amount
  bill_date: string | null
  is_debit: boolean
}

type Report = {
  user_name: string
  report_type: string
  payment_mode_label: string
  bill_type_groups: {
    bill_type: string
    payment_groups: { payment_mode_name: string; rows: Row[]; subtotal: Amount }[]
    grand_total: Amount
    is_debit: boolean
  }[]
  day_groups: {
    bill_date: string
    users: {
      user_id: string
      user_name: string
      bill_type_totals: Record<string, Amount>
      payment_mode_totals: Record<string, Amount>
      day_total: Amount
    }[]
    day_total: Amount
  }[]
  bill_collection_total: Amount
  advance_collection_total: Amount
  payment_debit_total: Amount
  overall_grand_total: Amount
}

type UserOption = { id: string; full_name: string; email?: string; is_active?: boolean }
type PaymentMode = { id: string; name: string; is_cash?: boolean; is_active?: boolean }

const REPORT_TYPES = [
  { value: 'detail', label: 'Detail Report', title: 'Bill lines by payment mode, then receipts, then payments / refunds' },
  { value: 'day_wise', label: 'Day wise Collection', title: 'Collection totals for each day and user' },
]

const joinTotals = (m: Record<string, Amount>) =>
  Object.entries(m)
    .map(([k, v]) => `${k}: ${fmtMoney(v)}`)
    .join(', ')

const signed = (v: Amount, debit: boolean) => fmtMoney(debit ? -Number(v || 0) : v)

function buildTables(data: Report): ReportTableModel[] {
  const tables: ReportTableModel[] = []
  const heading = `${data.user_name} — ${data.payment_mode_label}`

  if (data.report_type === 'day_wise') {
    const rows: ReportRow[] = []
    for (const dg of data.day_groups) {
      rows.push({ kind: 'group', cells: { date: `Date: ${fmtDate(dg.bill_date)}` } })
      dg.users.forEach((u) =>
        rows.push({
          cells: {
            date: fmtDate(dg.bill_date),
            user: u.user_name,
            bill_types: joinTotals(u.bill_type_totals),
            modes: joinTotals(u.payment_mode_totals),
            total: fmtMoney(u.day_total),
          },
        }),
      )
      rows.push({ kind: 'subtotal', cells: { user: `Day Total (${fmtDate(dg.bill_date)})`, total: fmtMoney(dg.day_total) } })
    }
    tables.push({
      key: 'day-wise',
      title: `Day wise Collection — ${heading}`,
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'user', label: 'User' },
        { key: 'bill_types', label: 'Bill Type Totals' },
        { key: 'modes', label: 'Payment Mode Totals' },
        { key: 'total', label: 'Total', align: 'right' },
      ],
      rows,
    })
  } else {
    for (const bg of data.bill_type_groups) {
      const debit = bg.is_debit
      const label = debit ? `${bg.bill_type} (Debit)` : bg.bill_type
      const rows: ReportRow[] = []
      for (const pg of bg.payment_groups) {
        rows.push({ kind: 'group', cells: { date: `Payment Mode: ${pg.payment_mode_name}` } })
        pg.rows.forEach((r) =>
          rows.push({
            cells: {
              date: fmtDate(r.bill_date),
              bill: r.bill_no,
              pno: r.patient_no,
              pname: r.patient_name,
              amount: signed(r.amount, debit || r.is_debit),
            },
          }),
        )
        rows.push({
          kind: 'subtotal',
          cells: { pname: `Sub Total (${pg.payment_mode_name})`, amount: signed(pg.subtotal, debit) },
        })
      }
      rows.push({ kind: 'total', cells: { pname: `${label} Grand Total`, amount: signed(bg.grand_total, debit) } })
      tables.push({
        key: bg.bill_type,
        title: `${label} — ${heading}`,
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'bill', label: 'Bill No' },
          { key: 'pno', label: 'Patient Id' },
          { key: 'pname', label: 'Name' },
          { key: 'amount', label: 'Amount', align: 'right' },
        ],
        rows,
      })
    }
  }

  tables.push({
    key: 'summary',
    title: 'Summary',
    columns: [
      { key: 'label', label: 'Description' },
      { key: 'amount', label: 'Amount', align: 'right' },
    ],
    rows: [
      { cells: { label: 'Bill Collection', amount: fmtMoney(data.bill_collection_total) } },
      { cells: { label: 'Advance / Receipt Collection', amount: fmtMoney(data.advance_collection_total) } },
      { cells: { label: 'Payments / Refunds (Debit)', amount: signed(data.payment_debit_total, true) } },
      { kind: 'total', cells: { label: 'Net Cash Transaction', amount: fmtMoney(data.overall_grand_total) } },
    ],
  })
  return tables
}

function renderSummary(data: Report) {
  return (
    <SummaryCards
      cards={[
        { label: 'Bill Collection', value: fmtMoney(data.bill_collection_total) },
        { label: '+ Advance / Receipt', value: fmtMoney(data.advance_collection_total) },
        { label: '− Payments / Refunds', value: fmtMoney(data.payment_debit_total), tone: 'debit' },
        { label: '= Net Cash', value: fmtMoney(data.overall_grand_total), tone: 'net' },
      ]}
    />
  )
}

export function UserCashTransactionReportPage() {
  const [users, setUsers] = useState<UserOption[]>([])
  const [modes, setModes] = useState<PaymentMode[]>([])
  const [userId, setUserId] = useState('all')
  const [modeId, setModeId] = useState('all')
  const [reportType, setReportType] = useState('detail')

  useEffect(() => {
    api.get<UserOption[]>('/hospital/users').then(setUsers).catch(() => setUsers([]))
    api
      .get<PaymentMode[]>('/hospital/payment-modes')
      .then((list) => {
        const active = list.filter((m) => m.is_active !== false)
        setModes(active)
        const cash = active.find((m) => m.is_cash)
        if (cash) setModeId((cur) => (cur === 'all' ? cash.id : cur))
      })
      .catch(() => setModes([]))
  }, [])

  return (
    <DateRangeReportShell<Report>
      title="User wise Cash Transaction Report"
      hint="Detail shows bill lines by payment mode, then advance collections and receipts, then payments and refunds as debit, so the net matches the cash actually collected. Day wise shows collection totals for each day."
      endpoint="/hospital/reports/user-cash-transaction"
      defaultRange="today"
      runLabel="Load Report"
      excelFileName={reportType === 'day_wise' ? 'User_Day_Wise_Collection.xlsx' : 'User_Cash_Transaction_Report.xlsx'}
      params={{ user_id: userId, payment_mode_id: modeId, report_type: reportType }}
      buildTables={buildTables}
      renderSummary={renderSummary}
      filters={
        <>
          <div className="hms-field-wrap">
            <label>User</label>
            <select className="hms-field" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="all">All Users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email ? `${u.full_name} (${u.email})` : u.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Payment Mode</label>
            <select className="hms-field" value={modeId} onChange={(e) => setModeId(e.target.value)}>
              <option value="all">All Modes</option>
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </>
      }
      belowFilters={<SegmentedPicker options={REPORT_TYPES} value={reportType} onChange={setReportType} />}
    />
  )
}
