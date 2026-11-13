import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import { DateRangeReportShell, fmtDate, fmtMoney, ReportRow, ReportTableModel } from './DateRangeReportShell'

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

type UserOption = { id: string; full_name: string }
type PaymentMode = { id: string; name: string }

const joinTotals = (m: Record<string, Amount>) =>
  Object.entries(m)
    .map(([k, v]) => `${k}: ${fmtMoney(v)}`)
    .join(', ')

function buildTables(data: Report): ReportTableModel[] {
  const tables: ReportTableModel[] = []

  if (data.report_type === 'day_wise') {
    const rows: ReportRow[] = []
    for (const dg of data.day_groups) {
      rows.push({ kind: 'group', cells: { date: fmtDate(dg.bill_date) } })
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
      rows.push({ kind: 'subtotal', cells: { user: 'Day Total', total: fmtMoney(dg.day_total) } })
    }
    tables.push({
      key: 'day-wise',
      title: `User Cash Transactions (Day Wise) — ${data.user_name} — ${data.payment_mode_label}`,
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'user', label: 'User' },
        { key: 'bill_types', label: 'Bill Types' },
        { key: 'modes', label: 'Payment Modes' },
        { key: 'total', label: 'Total', align: 'right' },
      ],
      rows,
    })
  } else {
    for (const bg of data.bill_type_groups) {
      const rows: ReportRow[] = []
      for (const pg of bg.payment_groups) {
        rows.push({ kind: 'group', cells: { date: pg.payment_mode_name } })
        pg.rows.forEach((r) =>
          rows.push({
            cells: {
              date: fmtDate(r.bill_date),
              bill: r.bill_no,
              pno: r.patient_no,
              pname: r.patient_name,
              amount: `${r.is_debit ? '-' : ''}${fmtMoney(r.amount)}`,
            },
          }),
        )
        rows.push({ kind: 'subtotal', cells: { pname: `Subtotal ${pg.payment_mode_name}`, amount: fmtMoney(pg.subtotal) } })
      }
      rows.push({ kind: 'total', cells: { pname: `Total ${bg.bill_type}`, amount: fmtMoney(bg.grand_total) } })
      tables.push({
        key: bg.bill_type,
        title: `${bg.bill_type} — ${data.user_name} — ${data.payment_mode_label}`,
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'bill', label: 'Bill No' },
          { key: 'pno', label: 'Patient No' },
          { key: 'pname', label: 'Patient Name' },
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
      { cells: { label: 'Advance Collection', amount: fmtMoney(data.advance_collection_total) } },
      { cells: { label: 'Payment (Debit)', amount: fmtMoney(data.payment_debit_total) } },
      { kind: 'total', cells: { label: 'Overall Grand Total', amount: fmtMoney(data.overall_grand_total) } },
    ],
  })
  return tables
}

export function UserCashTransactionReportPage() {
  const [users, setUsers] = useState<UserOption[]>([])
  const [modes, setModes] = useState<PaymentMode[]>([])
  const [userId, setUserId] = useState('all')
  const [modeId, setModeId] = useState('all')
  const [reportType, setReportType] = useState('detail')

  useEffect(() => {
    api.get<UserOption[]>('/hospital/users').then(setUsers).catch(() => setUsers([]))
    api.get<PaymentMode[]>('/hospital/payment-modes').then(setModes).catch(() => setModes([]))
  }, [])

  return (
    <DateRangeReportShell<Report>
      title="User Wise Cash Transaction Report"
      endpoint="/hospital/reports/user-cash-transaction"
      params={{ user_id: userId, payment_mode_id: modeId, report_type: reportType }}
      buildTables={buildTables}
      filters={
        <>
          <div className="hms-field-wrap">
            <label>User</label>
            <select className="hms-field" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="all">All Users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
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
          <div className="hms-field-wrap">
            <label>Report Type</label>
            <select className="hms-field" value={reportType} onChange={(e) => setReportType(e.target.value)}>
              <option value="detail">Detail</option>
              <option value="day_wise">Day Wise</option>
            </select>
          </div>
        </>
      }
    />
  )
}
