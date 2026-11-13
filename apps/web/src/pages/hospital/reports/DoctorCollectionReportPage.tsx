import { useEffect, useState } from 'react'
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
  bill_type: string
  bill_no: string
  patient_no: string
  payment_mode: string
  service_name: string
  original_rate: Amount
  hospital_amount: Amount
  doctor_amount: Amount
  total_amount: Amount
}

type Split = { total_amount: Amount; hospital_amount: Amount; doctor_amount: Amount }

type DoctorsReport = {
  report_type: 'normal' | 'sharing' | 'day_wise_summary'
  doctors: {
    doctor_id: string
    doctor_name: string
    date_groups: ({ bill_date: string; rows: DetailRow[] } & Split)[]
    service_summary: ({ service_name: string } & Split)[]
    grand_total_amount: Amount
    grand_hospital_amount: Amount
    grand_doctor_amount: Amount
  }[]
  overall_total_amount: Amount
  overall_hospital_amount: Amount
  overall_doctor_amount: Amount
}

type ColumnRow = {
  bill_date: string
  bill_type: string
  bill_no: string
  patient_no: string
  patient_name: string
  payment_mode: string
  amounts: Record<string, Amount>
  total_amount: Amount
}

type ColumnReport = {
  report_type: 'column_wise'
  service_columns: { service_id: string; service_name: string }[]
  doctors: {
    doctor_id: string
    doctor_name: string
    rows: ColumnRow[]
    column_totals: Record<string, Amount>
    grand_total_amount: Amount
  }[]
  overall_column_totals: Record<string, Amount>
  overall_total_amount: Amount
}

type PaymentModeReport = {
  report_type: 'payment_mode_summary'
  payment_modes: ({
    payment_mode: string
    doctors: ({ doctor_id: string; doctor_name: string } & Split)[]
  } & Split)[]
  overall_total_amount: Amount
  overall_hospital_amount: Amount
  overall_doctor_amount: Amount
}

type DateServiceReport = {
  report_type: 'date_service_summary' | 'date_service_details'
  date_groups: ({
    bill_date: string
    services: ({ service_name: string; rows: DetailRow[] } & Split)[]
  } & Split)[]
  overall_total_amount: Amount
  overall_hospital_amount: Amount
  overall_doctor_amount: Amount
}

type Form3CRow = {
  serial_no: number
  bill_date: string
  bill_type: string
  bill_no: string
  payment_mode: string
  patient_name: string
  service_name: string
  total_amount: Amount
  discount_amount: Amount
  net_amount: Amount
}

type Form3CReport = {
  report_type: 'form3c'
  rows: Form3CRow[]
  overall_total_amount: Amount
  overall_discount_amount: Amount
  overall_net_amount: Amount
}

type Report = DoctorsReport | ColumnReport | PaymentModeReport | DateServiceReport | Form3CReport

const REPORT_TYPES: { value: string; label: string }[] = [
  { value: 'sharing', label: 'Sharing' },
  { value: 'normal', label: 'Normal' },
  { value: 'day_wise_summary', label: 'Day Wise Summary' },
  { value: 'payment_mode_summary', label: 'Payment Mode Summary' },
  { value: 'column_wise', label: 'Column Wise' },
  { value: 'date_service_summary', label: 'Date / Service Summary' },
  { value: 'date_service_details', label: 'Date / Service Details' },
  { value: 'form3c', label: 'Form 3C' },
]

const SPLIT_COLUMNS: ReportColumn[] = [
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'hospital', label: 'Hospital', align: 'right' },
  { key: 'doctor', label: 'Doctor', align: 'right' },
]

function splitCells(s: Split) {
  return {
    total: fmtMoney(s.total_amount),
    hospital: fmtMoney(s.hospital_amount),
    doctor: fmtMoney(s.doctor_amount),
  }
}

function detailColumns(): ReportColumn[] {
  return [
    { key: 'date', label: 'Date' },
    { key: 'type', label: 'Bill Type' },
    { key: 'bill', label: 'Bill No' },
    { key: 'pno', label: 'Patient No' },
    { key: 'mode', label: 'Payment Mode' },
    { key: 'service', label: 'Service' },
    { key: 'rate', label: 'Rate', align: 'right' },
    ...SPLIT_COLUMNS,
  ]
}

function detailRow(r: DetailRow): ReportRow {
  return {
    cells: {
      date: fmtDate(r.bill_date),
      type: r.bill_type,
      bill: r.bill_no,
      pno: r.patient_no,
      mode: r.payment_mode,
      service: r.service_name,
      rate: fmtMoney(r.original_rate),
      total: fmtMoney(r.total_amount),
      hospital: fmtMoney(r.hospital_amount),
      doctor: fmtMoney(r.doctor_amount),
    },
  }
}

function buildDoctors(data: DoctorsReport): ReportTableModel[] {
  const columns = detailColumns()
  const tables: ReportTableModel[] = data.doctors.map((d) => {
    const rows: ReportRow[] = []
    for (const dg of d.date_groups) {
      dg.rows.forEach((r) => rows.push(detailRow(r)))
      rows.push({
        kind: 'subtotal',
        cells: { service: `${data.report_type === 'day_wise_summary' ? 'Day' : 'Total for'} ${fmtDate(dg.bill_date)}`, ...splitCells(dg) },
      })
    }
    rows.push({
      kind: 'total',
      cells: {
        service: 'Doctor Total',
        total: fmtMoney(d.grand_total_amount),
        hospital: fmtMoney(d.grand_hospital_amount),
        doctor: fmtMoney(d.grand_doctor_amount),
      },
    })
    if (d.service_summary.length) {
      rows.push({ kind: 'group', cells: { date: 'Service Summary' } })
      d.service_summary.forEach((s) =>
        rows.push({ cells: { service: s.service_name, ...splitCells(s) } }),
      )
    }
    return { key: d.doctor_id, title: d.doctor_name, columns, rows }
  })
  tables.push({
    key: 'overall',
    columns: [{ key: 'label', label: '' }, ...SPLIT_COLUMNS],
    rows: [
      {
        kind: 'total',
        cells: {
          label: 'Overall Total',
          total: fmtMoney(data.overall_total_amount),
          hospital: fmtMoney(data.overall_hospital_amount),
          doctor: fmtMoney(data.overall_doctor_amount),
        },
      },
    ],
  })
  return tables
}

function buildColumnWise(data: ColumnReport): ReportTableModel[] {
  const columns: ReportColumn[] = [
    { key: 'date', label: 'Date' },
    { key: 'type', label: 'Bill Type' },
    { key: 'bill', label: 'Bill No' },
    { key: 'pno', label: 'Patient No' },
    { key: 'pname', label: 'Patient Name' },
    { key: 'mode', label: 'Payment Mode' },
    ...data.service_columns.map((c) => ({ key: `s:${c.service_id}`, label: c.service_name, align: 'right' as const })),
    { key: 'total', label: 'Total', align: 'right' },
  ]
  const amountCells = (m: Record<string, Amount>) =>
    Object.fromEntries(data.service_columns.map((c) => [`s:${c.service_id}`, fmtMoney(m[c.service_id])]))

  const tables: ReportTableModel[] = data.doctors.map((d) => ({
    key: d.doctor_id,
    title: d.doctor_name,
    columns,
    rows: [
      ...d.rows.map((r) => ({
        cells: {
          date: fmtDate(r.bill_date),
          type: r.bill_type,
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
        cells: { pname: 'Doctor Total', ...amountCells(d.column_totals), total: fmtMoney(d.grand_total_amount) },
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

function buildPaymentMode(data: PaymentModeReport): ReportTableModel[] {
  const cells = (label: string, s: Split) => ({
    label,
    total: fmtMoney(s.total_amount),
    hospital: fmtMoney(s.hospital_amount),
    doctor: fmtMoney(s.doctor_amount),
  })
  const rows: ReportRow[] = []
  for (const pm of data.payment_modes) {
    rows.push({ kind: 'group', cells: { label: pm.payment_mode } })
    pm.doctors.forEach((d) => rows.push({ cells: cells(d.doctor_name, d) }))
    rows.push({ kind: 'subtotal', cells: cells(`Total ${pm.payment_mode}`, pm) })
  }
  rows.push({
    kind: 'total',
    cells: cells('Overall Total', {
      total_amount: data.overall_total_amount,
      hospital_amount: data.overall_hospital_amount,
      doctor_amount: data.overall_doctor_amount,
    }),
  })
  return [
    {
      title: 'Payment Mode Summary',
      columns: [{ key: 'label', label: 'Payment Mode / Doctor' }, ...SPLIT_COLUMNS],
      rows,
    },
  ]
}

function buildDateService(data: DateServiceReport): ReportTableModel[] {
  const columns = detailColumns()
  const rows: ReportRow[] = []
  for (const dg of data.date_groups) {
    rows.push({ kind: 'group', cells: { date: fmtDate(dg.bill_date) } })
    for (const s of dg.services) {
      if (s.rows.length) {
        rows.push({ kind: 'group', cells: { date: `${fmtDate(dg.bill_date)} — ${s.service_name}` } })
        s.rows.forEach((r) => rows.push(detailRow(r)))
        rows.push({ kind: 'subtotal', cells: { service: `Total ${s.service_name}`, ...splitCells(s) } })
      } else {
        rows.push({ cells: { date: fmtDate(dg.bill_date), service: s.service_name, ...splitCells(s) } })
      }
    }
    rows.push({ kind: 'subtotal', cells: { service: `Day Total ${fmtDate(dg.bill_date)}`, ...splitCells(dg) } })
  }
  rows.push({
    kind: 'total',
    cells: {
      service: 'Overall Total',
      total: fmtMoney(data.overall_total_amount),
      hospital: fmtMoney(data.overall_hospital_amount),
      doctor: fmtMoney(data.overall_doctor_amount),
    },
  })
  return [{ title: data.report_type === 'date_service_summary' ? 'Date / Service Summary' : 'Date / Service Details', columns, rows }]
}

function buildForm3C(data: Form3CReport): ReportTableModel[] {
  return [
    {
      title: 'Form 3C',
      columns: [
        { key: 'sn', label: 'S.No', align: 'right' },
        { key: 'date', label: 'Date' },
        { key: 'type', label: 'Bill Type' },
        { key: 'bill', label: 'Bill No' },
        { key: 'mode', label: 'Payment Mode' },
        { key: 'patient', label: 'Patient Name' },
        { key: 'service', label: 'Service' },
        { key: 'total', label: 'Total', align: 'right' },
        { key: 'discount', label: 'Discount', align: 'right' },
        { key: 'net', label: 'Net', align: 'right' },
      ],
      rows: [
        ...data.rows.map((r) => ({
          cells: {
            sn: r.serial_no,
            date: fmtDate(r.bill_date),
            type: r.bill_type,
            bill: r.bill_no,
            mode: r.payment_mode,
            patient: r.patient_name,
            service: r.service_name,
            total: fmtMoney(r.total_amount),
            discount: fmtMoney(r.discount_amount),
            net: fmtMoney(r.net_amount),
          },
        })),
        {
          kind: 'total' as const,
          cells: {
            service: 'Overall Total',
            total: fmtMoney(data.overall_total_amount),
            discount: fmtMoney(data.overall_discount_amount),
            net: fmtMoney(data.overall_net_amount),
          },
        },
      ],
    },
  ]
}

function buildTables(data: Report): ReportTableModel[] {
  switch (data.report_type) {
    case 'column_wise':
      return buildColumnWise(data)
    case 'payment_mode_summary':
      return buildPaymentMode(data)
    case 'date_service_summary':
    case 'date_service_details':
      return buildDateService(data)
    case 'form3c':
      return buildForm3C(data)
    default:
      return buildDoctors(data)
  }
}

export function DoctorCollectionReportPage() {
  const [reportType, setReportType] = useState('sharing')
  const [doctorId, setDoctorId] = useState('')
  const [doctors, setDoctors] = useState<DoctorOption[]>([])

  useEffect(() => {
    loadAllDoctors().then(setDoctors).catch(() => setDoctors([]))
  }, [])

  return (
    <DateRangeReportShell<Report>
      title="Doctor Collection Report"
      endpoint="/hospital/reports/doctor-collection"
      params={{ report_type: reportType, doctor_ids: doctorId ? [doctorId] : undefined }}
      buildTables={buildTables}
      filters={
        <>
          <div className="hms-field-wrap">
            <label>Report Type</label>
            <select className="hms-field" value={reportType} onChange={(e) => setReportType(e.target.value)}>
              {REPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
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
        </>
      }
    />
  )
}
