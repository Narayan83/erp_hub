import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import { DateRangeReportShell, fmtDate, fmtMoney, ReportTableModel } from './DateRangeReportShell'

type BillingType = { id: string; code: string; name: string; is_active: boolean }

type Form3CRow = {
  serial_no: number
  bill_date: string
  bill_no: string
  payment_mode: string
  patient_name: string
  service_name: string
  total_amount: number | string
}

type Form3CReport = {
  billing_type_name: string
  rows: Form3CRow[]
  grand_total: number | string
}

export function Form3CReportPage() {
  const [types, setTypes] = useState<BillingType[]>([])
  const [typeId, setTypeId] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<BillingType[]>('/hospital/billing-types')
      .then((list) => {
        const active = list.filter((t) => t.is_active)
        setTypes(active)
        if (active.length) setTypeId((cur) => cur || active[0].id)
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [])

  function buildTables(data: Form3CReport): ReportTableModel[] {
    return [
      {
        title: `Form 3C — ${data.billing_type_name}`,
        columns: [
          { key: 'sn', label: 'S.No', align: 'right' },
          { key: 'date', label: 'Bill Date' },
          { key: 'bill', label: 'Bill No' },
          { key: 'mode', label: 'Payment Mode' },
          { key: 'patient', label: 'Patient Name' },
          { key: 'service', label: 'Service' },
          { key: 'total', label: 'Total Amount', align: 'right' },
        ],
        rows: [
          ...data.rows.map((r) => ({
            cells: {
              sn: r.serial_no,
              date: fmtDate(r.bill_date),
              bill: r.bill_no,
              mode: r.payment_mode,
              patient: r.patient_name,
              service: r.service_name,
              total: fmtMoney(r.total_amount),
            },
          })),
          ...(data.rows.length
            ? [{ kind: 'total' as const, cells: { service: 'Grand Total', total: fmtMoney(data.grand_total) } }]
            : []),
        ],
      },
    ]
  }

  return (
    <>
      <DateRangeReportShell<Form3CReport>
        title="Form 3C Report"
        endpoint="/hospital/reports/form-3c"
        params={{ billing_type_id: typeId }}
        validate={() => (typeId ? null : loadError ?? 'Select a billing type')}
        buildTables={buildTables}
        filters={
          <div className="hms-field-wrap">
            <label>Billing Type</label>
            <select className="hms-field" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">-- Select --</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        }
      />
    </>
  )
}
