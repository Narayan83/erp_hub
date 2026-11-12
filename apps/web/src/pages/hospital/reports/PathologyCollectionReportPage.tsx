import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import {
  DateRangeReportShell,
  DoctorOption,
  fmtDate,
  fmtMoney,
  loadAllDoctors,
  ReportColumn,
  ReportRow,
  ReportTableModel,
} from './DateRangeReportShell'

type Amount = number | string

type DetailRow = {
  bill_date: string
  bill_no: string
  patient_no: string
  patient_name: string
  payment_mode: string
  pathologist_name: string
  referring_doctor: string
  service_name: string
  rate: Amount
  amount: Amount
}

type NormalReport = {
  report_type: 'normal' | 'referral_wise'
  groups: {
    group_key: string
    group_name: string
    date_groups: { bill_date: string; rows: DetailRow[]; total_amount: Amount }[]
    service_summary: { service_name: string; total_amount: Amount }[]
    grand_total_amount: Amount
  }[]
  overall_total_amount: Amount
}

type ColumnReport = {
  report_type: 'column_wise'
  service_columns: { service_id: string; service_name: string }[]
  groups: {
    group_key: string
    group_name: string
    rows: {
      bill_date: string
      bill_no: string
      patient_no: string
      patient_name: string
      payment_mode: string
      amounts: Record<string, Amount>
      total_amount: Amount
    }[]
    column_totals: Record<string, Amount>
    grand_total_amount: Amount
  }[]
  overall_column_totals: Record<string, Amount>
  overall_total_amount: Amount
}

type Report = NormalReport | ColumnReport

const DETAIL_COLUMNS: ReportColumn[] = [
  { key: 'date', label: 'Date' },
  { key: 'bill', label: 'Bill No' },
  { key: 'pno', label: 'Patient No' },
  { key: 'pname', label: 'Patient Name' },
  { key: 'mode', label: 'Payment Mode' },
  { key: 'pathologist', label: 'Pathologist' },
  { key: 'ref', label: 'Referring Doctor' },
  { key: 'service', label: 'Service' },
  { key: 'rate', label: 'Rate', align: 'right' },
  { key: 'amount', label: 'Amount', align: 'right' },
]

function buildNormal(data: NormalReport): ReportTableModel[] {
  const tables: ReportTableModel[] = data.groups.map((g) => {
    const rows: ReportRow[] = []
    for (const dg of g.date_groups) {
      for (const r of dg.rows) {
        rows.push({
          cells: {
            date: fmtDate(r.bill_date),
            bill: r.bill_no,
            pno: r.patient_no,
            pname: r.patient_name,
            mode: r.payment_mode,
            pathologist: r.pathologist_name,
            ref: r.referring_doctor,
            service: r.service_name,
            rate: fmtMoney(r.rate),
            amount: fmtMoney(r.amount),
          },
        })
      }
      rows.push({
        kind: 'subtotal',
        cells: { service: `Total for ${fmtDate(dg.bill_date)}`, amount: fmtMoney(dg.total_amount) },
      })
    }
    rows.push({ kind: 'total', cells: { service: 'Group Total', amount: fmtMoney(g.grand_total_amount) } })
    return {
      key: g.group_key,
      title: data.report_type === 'referral_wise' ? `Referral: ${g.group_name}` : g.group_name,
      columns: DETAIL_COLUMNS,
      rows,
    }
  })

  const summaryRows: ReportRow[] = []
  for (const g of data.groups) {
    if (!g.service_summary.length) continue
    summaryRows.push({ kind: 'group', cells: { service: g.group_name } })
    for (const s of g.service_summary) {
      summaryRows.push({ cells: { service: s.service_name, amount: fmtMoney(s.total_amount) } })
    }
  }
  if (summaryRows.length) {
    tables.push({
      key: 'service-summary',
      title: 'Service Summary',
      columns: [
        { key: 'service', label: 'Service' },
        { key: 'amount', label: 'Amount', align: 'right' },
      ],
      rows: summaryRows,
    })
  }
  tables.push({
    key: 'overall',
    columns: [
      { key: 'label', label: '' },
      { key: 'amount', label: 'Amount', align: 'right' },
    ],
    rows: [{ kind: 'total', cells: { label: 'Overall Total', amount: fmtMoney(data.overall_total_amount) } }],
  })
  return tables
}

function buildColumnWise(data: ColumnReport): ReportTableModel[] {
  const columns: ReportColumn[] = [
    { key: 'date', label: 'Date' },
    { key: 'bill', label: 'Bill No' },
    { key: 'pno', label: 'Patient No' },
    { key: 'pname', label: 'Patient Name' },
    { key: 'mode', label: 'Payment Mode' },
    ...data.service_columns.map((c) => ({ key: `s:${c.service_id}`, label: c.service_name, align: 'right' as const })),
    { key: 'total', label: 'Total', align: 'right' },
  ]
  const amountCells = (m: Record<string, Amount>) =>
    Object.fromEntries(data.service_columns.map((c) => [`s:${c.service_id}`, fmtMoney(m[c.service_id])]))

  const tables: ReportTableModel[] = data.groups.map((g) => ({
    key: g.group_key,
    title: g.group_name,
    columns,
    rows: [
      ...g.rows.map((r) => ({
        cells: {
          date: fmtDate(r.bill_date),
          bill: r.bill_no,
          pno: r.patient_no,
          pname: r.patient_name,
          mode: r.payment_mode,
          ...amountCells(r.amounts),
          total: fmtMoney(r.total_amount),
        },
      })),
      {
        kind: 'total' as const,
        cells: { pname: 'Group Total', ...amountCells(g.column_totals), total: fmtMoney(g.grand_total_amount) },
      },
    ],
  }))
  tables.push({
    key: 'overall',
    columns,
    rows: [
      {
        kind: 'total',
        cells: {
          pname: 'Overall Total',
          ...amountCells(data.overall_column_totals),
          total: fmtMoney(data.overall_total_amount),
        },
      },
    ],
  })
  return tables
}

export function PathologyCollectionReportPage() {
  const [reportType, setReportType] = useState('normal')
  const [doctorId, setDoctorId] = useState('')
  const [referral, setReferral] = useState('')
  const [doctors, setDoctors] = useState<DoctorOption[]>([])
  const [referrals, setReferrals] = useState<string[]>([])

  useEffect(() => {
    loadAllDoctors().then(setDoctors).catch(() => setDoctors([]))
    api
      .get<{ items: string[] }>('/hospital/reports/pathology-collection/referring-doctors')
      .then((r) => setReferrals(r.items ?? []))
      .catch(() => setReferrals([]))
  }, [])

  return (
    <DateRangeReportShell<Report>
      title="Pathology Collection Report"
      endpoint="/hospital/reports/pathology-collection"
      params={{
        report_type: reportType,
        doctor_ids: doctorId ? [doctorId] : undefined,
        referral_names: referral ? [referral] : undefined,
      }}
      buildTables={(d) => (d.report_type === 'column_wise' ? buildColumnWise(d) : buildNormal(d))}
      filters={
        <>
          <div className="hms-field-wrap">
            <label>Report Type</label>
            <select className="hms-field" value={reportType} onChange={(e) => setReportType(e.target.value)}>
              <option value="normal">Normal</option>
              <option value="column_wise">Column Wise</option>
              <option value="referral_wise">Referral Wise</option>
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Doctor</label>
            <select className="hms-field" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">All Doctors</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Referring Doctor</label>
            <select className="hms-field" value={referral} onChange={(e) => setReferral(e.target.value)}>
              <option value="">All Referrals</option>
              {referrals.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </>
      }
    />
  )
}
