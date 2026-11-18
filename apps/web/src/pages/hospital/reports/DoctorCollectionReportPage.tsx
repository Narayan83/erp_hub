import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import {
  CheckItem,
  CheckListFilter,
  CheckSelection,
  SegmentedPicker,
  selectionIsEmpty,
  selectionParam,
  SummaryCards,
} from './ReportFilterControls'
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

const REPORT_TYPES: { value: string; label: string; title: string }[] = [
  { value: 'day_wise_summary', label: 'Day wise Summary', title: 'Each doctor, each day total (no bill lines)' },
  { value: 'payment_mode_summary', label: 'Payment Mode Summary', title: 'Totals by payment mode, then doctor' },
  { value: 'sharing', label: 'Doctor wise Sharing', title: 'Hospital / doctor split with bill detail and service summary' },
  { value: 'column_wise', label: 'Column wise', title: 'One row per bill; each marked service is its own column' },
  { value: 'date_service_summary', label: 'Date/Service Summary', title: 'Each date, then service totals' },
  { value: 'date_service_details', label: 'Date/Service Details', title: 'Each date, then service, then each bill line' },
  { value: 'form3c', label: 'Form 3C', title: 'Flat OPD + IPD bill list with discount and net' },
]

const EXCEL_NAMES: Record<string, string> = {
  day_wise_summary: 'Doctor_Day_Wise_Summary.xlsx',
  payment_mode_summary: 'Doctor_Payment_Mode_Summary.xlsx',
  sharing: 'Doctor_Wise_Sharing.xlsx',
  column_wise: 'Doctor_Collection_Column_Wise.xlsx',
  date_service_summary: 'Date_Service_Summary.xlsx',
  date_service_details: 'Date_Service_Details.xlsx',
  form3c: 'Form_3C.xlsx',
}

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

function overallSplitTable(data: { overall_total_amount: Amount; overall_hospital_amount: Amount; overall_doctor_amount: Amount }): ReportTableModel {
  return {
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
  }
}

function buildDayWise(data: DoctorsReport): ReportTableModel[] {
  const columns: ReportColumn[] = [{ key: 'date', label: 'Date' }, ...SPLIT_COLUMNS]
  const tables: ReportTableModel[] = data.doctors.map((d) => ({
    key: d.doctor_id,
    title: `Doctor: ${d.doctor_name}`,
    columns,
    rows: [
      ...d.date_groups.map((dg) => ({ cells: { date: fmtDate(dg.bill_date), ...splitCells(dg) } })),
      {
        kind: 'total' as const,
        cells: {
          date: 'Doctor Total',
          total: fmtMoney(d.grand_total_amount),
          hospital: fmtMoney(d.grand_hospital_amount),
          doctor: fmtMoney(d.grand_doctor_amount),
        },
      },
    ],
  }))
  tables.push(overallSplitTable(data))
  return tables
}

function buildDoctors(data: DoctorsReport): ReportTableModel[] {
  if (data.report_type === 'day_wise_summary') return buildDayWise(data)
  const columns = detailColumns()
  const tables: ReportTableModel[] = data.doctors.map((d) => {
    const rows: ReportRow[] = []
    for (const dg of d.date_groups) {
      rows.push({ kind: 'group', cells: { date: `Date: ${fmtDate(dg.bill_date)}` } })
      dg.rows.forEach((r) => rows.push(detailRow(r)))
      rows.push({
        kind: 'subtotal',
        cells: { service: `Total for ${fmtDate(dg.bill_date)}`, ...splitCells(dg) },
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
      rows.push({ kind: 'group', cells: { date: `Service Summary — ${d.doctor_name}` } })
      d.service_summary.forEach((s) =>
        rows.push({ cells: { service: s.service_name, ...splitCells(s) } }),
      )
    }
    return { key: d.doctor_id, title: `Doctor: ${d.doctor_name}`, columns, rows }
  })
  tables.push(overallSplitTable(data))
  return tables
}

function buildColumnWise(data: ColumnReport): ReportTableModel[] {
  if (!data.service_columns.length) {
    return [
      {
        key: 'no-columns',
        columns: [{ key: 'msg', label: 'Column wise setup needed' }],
        rows: [
          {
            cells: {
              msg: 'No service is marked for columns. Open Masters → Patient Service Master, set "Dr Collection Col" = Y on the services you want as columns, save, then load again.',
            },
          },
        ],
      },
    ]
  }
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
    title: `Doctor: ${d.doctor_name}`,
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

function renderSummary(data: Report) {
  if (data.report_type === 'form3c') {
    return (
      <SummaryCards
        cards={[
          { label: 'Bills', value: String(data.rows.length) },
          { label: 'Gross', value: fmtMoney(data.overall_total_amount) },
          { label: 'Discount', value: fmtMoney(data.overall_discount_amount), tone: 'debit' },
          { label: 'Net', value: fmtMoney(data.overall_net_amount), tone: 'net' },
        ]}
      />
    )
  }
  if (data.report_type === 'column_wise') {
    if (!data.service_columns.length) return null
    return (
      <SummaryCards
        cards={[
          { label: 'Doctors', value: String(data.doctors.length) },
          { label: 'Overall Total Collection', value: fmtMoney(data.overall_total_amount), tone: 'net' },
        ]}
      />
    )
  }
  return (
    <SummaryCards
      cards={[
        { label: 'Hospital', value: fmtMoney(data.overall_hospital_amount) },
        { label: 'Doctor', value: fmtMoney(data.overall_doctor_amount) },
        { label: 'Total', value: fmtMoney(data.overall_total_amount), tone: 'net' },
      ]}
    />
  )
}

const HELP = (
  <>
    <h3>Quick steps</h3>
    <ol>
      <li>Choose From / To dates (or a quick range like Today / This Month).</li>
      <li>Tick Doctors, Payment Modes and Services in the lists. Search boxes filter the lists as you type.</li>
      <li>Drag the bottom edge of a list to show more items. Select All / Clear act on the items currently shown.</li>
      <li>Pick a report type button, then click Load Report. Print opens a printable preview; Excel downloads the sheet.</li>
    </ol>
    <h3>Report types</h3>
    <ul>
      <li><b>Day wise Summary</b> — each doctor, each day total (no bill lines).</li>
      <li><b>Payment Mode Summary</b> — totals by payment mode, then doctor.</li>
      <li><b>Doctor wise Sharing</b> — hospital / doctor split with bill detail and a service summary per doctor.</li>
      <li><b>Column wise</b> — one row per bill; each marked service is its own amount column.</li>
      <li><b>Date/Service Summary</b> — each date, then totals of the selected services.</li>
      <li><b>Date/Service Details</b> — each date, then service, then each bill line.</li>
      <li><b>Form 3C</b> — flat OPD + IPD bill list: S.No, date, bill type, bill no, payment mode, patient, service, total, discount, net.</li>
    </ul>
    <h3>Column wise setup (one time)</h3>
    <ul>
      <li>Masters → Patient Service Master → open the service (e.g. Consultation, OT) → set “Dr Collection Col” = Y → save.</li>
      <li>Only services marked Y become columns. The Services filter is not used for Column wise.</li>
    </ul>
  </>
)

type ServiceRow = { id: string; name: string; code?: string; is_active?: boolean }
type PaymentModeRow = { id: string; name: string; is_active?: boolean }

export function DoctorCollectionReportPage() {
  const [reportType, setReportType] = useState('sharing')
  const [doctors, setDoctors] = useState<CheckItem[]>([])
  const [modes, setModes] = useState<CheckItem[]>([])
  const [services, setServices] = useState<CheckItem[]>([])
  const [doctorSel, setDoctorSel] = useState<CheckSelection>(null)
  const [modeSel, setModeSel] = useState<CheckSelection>(null)
  const [serviceSel, setServiceSel] = useState<CheckSelection>(null)

  useEffect(() => {
    loadAllDoctors()
      .then((list: DoctorOption[]) =>
        setDoctors(list.map((d) => ({ id: d.id, label: d.full_name || d.doctor_code || d.id }))),
      )
      .catch(() => setDoctors([]))
    api
      .get<PaymentModeRow[]>('/hospital/payment-modes')
      .then((list) =>
        setModes(
          list
            .filter((m) => m.is_active !== false && (m.name || '').trim())
            .map((m) => ({ id: m.name.trim(), label: m.name.trim() })),
        ),
      )
      .catch(() => setModes([]))
    api
      .get<ServiceRow[] | { items: ServiceRow[] }>('/hospital/patient-services')
      .then((res) => {
        const list = Array.isArray(res) ? res : res.items ?? []
        setServices(
          list.filter((s) => s.is_active !== false).map((s) => ({ id: s.id, label: s.name || s.code || s.id })),
        )
      })
      .catch(() => setServices([]))
  }, [])

  const serviceFilterUsed = reportType !== 'column_wise'

  return (
    <DateRangeReportShell<Report>
      title="Doctor wise Collection Report"
      endpoint="/hospital/reports/doctor-collection"
      defaultRange="today"
      runLabel="Load Report"
      excelFileName={EXCEL_NAMES[reportType] ?? 'Doctor_Collection_Report.xlsx'}
      help={HELP}
      params={{
        report_type: reportType,
        doctor_ids: selectionParam(doctors, doctorSel),
        payment_modes: selectionParam(modes, modeSel),
        service_ids: serviceFilterUsed ? selectionParam(services, serviceSel) : undefined,
      }}
      validate={() => {
        if (selectionIsEmpty(doctorSel)) return 'Select at least one doctor, or tick All Doctors.'
        if (selectionIsEmpty(modeSel)) return 'Select at least one payment mode, or tick All Payment Modes.'
        if (serviceFilterUsed && selectionIsEmpty(serviceSel)) return 'Select at least one service, or tick All Services.'
        return null
      }}
      buildTables={buildTables}
      renderSummary={renderSummary}
      belowFilters={
        <>
          <div className="hms-checklist-row">
            <CheckListFilter title="Doctors" items={doctors} value={doctorSel} onChange={setDoctorSel} />
            <CheckListFilter title="Payment Modes" items={modes} value={modeSel} onChange={setModeSel} />
            <CheckListFilter
              title="Services"
              items={services}
              value={serviceSel}
              onChange={setServiceSel}
              disabled={!serviceFilterUsed}
              note={serviceFilterUsed ? undefined : 'Column wise uses the services marked “Dr Collection Col = Y”.'}
            />
          </div>
          <SegmentedPicker options={REPORT_TYPES} value={reportType} onChange={setReportType} />
        </>
      }
    />
  )
}
