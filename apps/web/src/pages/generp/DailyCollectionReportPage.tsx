import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { PrintPreview } from '../../components/generp/PrintPreview'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { loadBillFormat, saveBillFormat, voucherReportCode } from '../../lib/generp/billFormat'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { fmt, todayISO } from '../../lib/generp/saleBillMath'
import { ListPager } from '../../components/generp/ListPager'

type AmountMap = Record<string, number>
type DayRow = {
  date: string
  bill_from: string
  bill_to: string
  bill_count: number
  amounts: AmountMap
  total: number
}
type BillRow = {
  id: string
  voucher_no: string
  voucher_type: string
  voucher_date?: string | null
  party_name?: string
  amounts: AmountMap
  total: number
  net_amount?: number
}
type ReportData = {
  date_from: string
  date_to: string
  gst_rates: string[]
  rows: DayRow[]
  totals: { amounts: AmountMap; total: number; bill_count: number }
  payment_rows?: Array<{ payment_mode: string; total: number }>
  payment_total?: number
}

type PreviewState = {
  title: string
  html: string
  reportCode: string
  billId?: string
  billFormat?: string
}

function money(v: unknown) {
  return fmt(Number(v || 0))
}

export function DailyCollectionReportPage() {
  const navigate = useNavigate()
  const [fromDate, setFromDate] = useState(todayISO())
  const [toDate, setToDate] = useState(todayISO())
  const [billFrom, setBillFrom] = useState('')
  const [billTo, setBillTo] = useState('')
  const [data, setData] = useState<ReportData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dayBills, setDayBills] = useState<{
    date: string
    gst_rates: string[]
    bills: BillRow[]
    totals: { amounts: AmountMap; total: number; bill_count: number }
  } | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [formatByCode, setFormatByCode] = useState<Record<string, string>>({})

  const params = useCallback(
    () => ({
      date_from: fromDate,
      date_to: toDate,
      bill_from: billFrom.trim() || undefined,
      bill_to: billTo.trim() || undefined,
    }),
    [fromDate, toDate, billFrom, billTo],
  )

  const refresh = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const result = await api.get<ReportData>('/reports/daily-collection', params())
      setData(result)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load report')
    } finally {
      setBusy(false)
    }
  }, [params])

  useEffect(() => {
    void refresh()
  }, [])

  const openDay = async (day: string) => {
    try {
      const result = await api.get<{
        date: string
        gst_rates: string[]
        bills: BillRow[]
        totals: { amounts: AmountMap; total: number; bill_count: number }
      }>('/reports/daily-collection/bills', {
        day,
        bill_from: billFrom.trim() || undefined,
        bill_to: billTo.trim() || undefined,
      })
      setDayBills(result)
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to load bills')
    }
  }

  const formatFor = async (reportCode: string) => {
    if (formatByCode[reportCode]) return formatByCode[reportCode]
    const fmtCode = await loadBillFormat(reportCode)
    setFormatByCode((prev) => ({ ...prev, [reportCode]: fmtCode }))
    return fmtCode
  }

  const openBill = async (bill: BillRow) => {
    const reportCode = voucherReportCode(bill.voucher_type)
    try {
      const format = await formatFor(reportCode)
      const html = await api.getReportHtml(`/reports/sale-bill/${bill.id}`, { format })
      setPreview({
        title: `Bill ${bill.voucher_no}`,
        html,
        reportCode,
        billId: bill.id,
        billFormat: format,
      })
    } catch (err) {
      const path = bill.voucher_type === 'WHOLESALE' ? '/wholesale_bill_modify' : '/sale_bill_modify'
      navigate(`${path}?voucher_id=${encodeURIComponent(bill.id)}`)
      alert(err instanceof ApiError ? err.message : 'Opening bill in modify screen')
    }
  }

  const changeBillFormat = async (format: string) => {
    if (!preview?.billId) return
    setFormatByCode((prev) => ({ ...prev, [preview.reportCode]: format }))
    void saveBillFormat(preview.reportCode, format)
    try {
      const html = await api.getReportHtml(`/reports/sale-bill/${preview.billId}`, { format })
      setPreview({ ...preview, html, billFormat: format })
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to load format')
    }
  }

  const printReport = async () => {
    try {
      const html = await api.getReportHtml('/reports/daily-collection', params())
      setPreview({ title: 'Daily Collection Report', html, reportCode: 'DAILY_COLLECTION_REPORT' })
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Print failed')
    }
  }

  const printBills = async (opts?: { day?: string }) => {
    try {
      const html = await api.getReportHtml('/reports/daily-collection/bills', {
        ...(opts?.day ? { day: opts.day } : params()),
        bill_from: billFrom.trim() || undefined,
        bill_to: billTo.trim() || undefined,
      })
      setPreview({
        title: opts?.day ? `Bills — ${opts.day}` : 'Bills Summary',
        html,
        reportCode: 'DAILY_COLLECTION_REPORT',
      })
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Print failed')
    }
  }

  const exportExcel = (format: SpreadsheetFormat = 'xlsx') => {
    if (!data) return
    const rates = data.gst_rates || []
    const headers = ['Date', 'Bill From', 'Bill To', ...rates.map((r) => `${r}%`), 'Total']
    const rows = data.rows.map((row) => [
      row.date,
      row.bill_from,
      row.bill_to,
      ...rates.map((r) => Number(row.amounts?.[r] || 0)),
      Number(row.total || 0),
    ])
    rows.push([
      `Total (${data.totals.bill_count} bills)`,
      '',
      '',
      ...rates.map((r) => Number(data.totals.amounts?.[r] || 0)),
      Number(data.totals.total || 0),
    ])
    const sheets = [
      { name: 'Daily Collection', headers, rows },
      {
        name: 'Payments',
        headers: ['Payment mode', 'Total'],
        rows: [
          ...(data.payment_rows || []).map((p) => [p.payment_mode, Number(p.total || 0)]),
          ['Total', Number(data.payment_total || 0)],
        ],
      },
    ]
    downloadExcel(`daily-collection-${data.date_from}-to-${data.date_to}`, sheets, format)
  }

  const exportDayBillsExcel = (format: SpreadsheetFormat = 'xlsx') => {
    if (!dayBills) return
    const rates = dayBills.gst_rates || []
    downloadExcel(
      `bills-${dayBills.date}`,
      {
        name: 'Bills',
        headers: ['Bill No', 'Type', 'Customer', ...rates.map((r) => `${r}%`), 'Total'],
        rows: [
          ...dayBills.bills.map((b) => [
            b.voucher_no,
            b.voucher_type,
            b.party_name || 'Walk-in',
            ...rates.map((r) => Number(b.amounts?.[r] || 0)),
            Number(b.total || 0),
          ]),
          [
            `Total (${dayBills.totals.bill_count})`,
            '',
            '',
            ...rates.map((r) => Number(dayBills.totals.amounts?.[r] || 0)),
            Number(dayBills.totals.total || 0),
          ],
        ],
      },
      format,
    )
  }

  const rates = data?.gst_rates || []
  const rowPager = useClientPager(data?.rows || [], `${fromDate}|${toDate}|${data?.rows.length || 0}`, TABLE_PAGE_SIZE)
  const billPager = useClientPager(
    dayBills?.bills || [],
    dayBills?.date || '',
    TABLE_PAGE_SIZE,
  )

  return (
    <div className="settings-page">
      <h2>Daily Collection Report</h2>
      <p className="hint">
        Date-wise collection by GST %. Click a date to see each bill. Click a bill to preview and print it.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="sb-row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="field-label">From</span>
        <input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <span className="field-label">To</span>
        <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <span className="field-label">Bill from</span>
        <input
          className="input"
          style={{ maxWidth: 140 }}
          placeholder="SAL-00001"
          value={billFrom}
          onChange={(e) => setBillFrom(e.target.value)}
        />
        <span className="field-label">Bill to</span>
        <input
          className="input"
          style={{ maxWidth: 140 }}
          placeholder="SAL-00999"
          value={billTo}
          onChange={(e) => setBillTo(e.target.value)}
        />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void refresh()}>
          Show
        </button>
        <button type="button" className="btn" onClick={() => void printReport()}>
          Print
        </button>
        <button type="button" className="btn" onClick={() => void printBills()}>
          Print bills
        </button>
        <ExportFormatButtons disabled={!data} onExport={exportExcel} />
      </div>

      <div className="table-scroll">
        <ListPager
          topRight
          page={rowPager.page}
          totalPages={rowPager.totalPages}
          total={rowPager.total}
          pageSize={rowPager.pageSize}
          onPage={rowPager.setPage}
        />
        <table className="table data-table report-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Bill From</th>
              <th>Bill To</th>
              {rates.map((r) => (
                <th key={r} className="text-end">
                  {r}%
                </th>
              ))}
              <th className="text-end">Total</th>
            </tr>
          </thead>
          <tbody>
            {!data?.rows.length && (
              <tr>
                <td colSpan={4 + rates.length} className="text-muted">
                  No bills in this range
                </td>
              </tr>
            )}
            {rowPager.pageRows.map((row) => (
              <tr key={row.date} className="clickable-row" onClick={() => void openDay(row.date)}>
                <td>
                  <button type="button" className="link-btn">
                    {row.date}
                  </button>
                </td>
                <td>{row.bill_from}</td>
                <td>{row.bill_to}</td>
                {rates.map((r) => (
                  <td key={r} className="text-end">
                    {money(row.amounts?.[r])}
                  </td>
                ))}
                <td className="text-end">{money(row.total)}</td>
              </tr>
            ))}
          </tbody>
          {data && (
            <tfoot>
              <tr>
                <td colSpan={3}>
                  Report total ({data.totals.bill_count} bills)
                </td>
                {rates.map((r) => (
                  <td key={r} className="text-end">
                    {money(data.totals.amounts?.[r])}
                  </td>
                ))}
                <td className="text-end">{money(data.totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {data?.payment_rows && data.payment_rows.length > 0 && (
        <p className="hint" style={{ fontWeight: 700, marginTop: 12 }}>
          Payment collection:{' '}
          {data.payment_rows.map((p) => `${p.payment_mode} ${money(p.total)}`).join(' · ')} · Total{' '}
          {money(data.payment_total)}
        </p>
      )}

      {dayBills && (
        <div className="modal-backdrop" onClick={() => setDayBills(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h2>Bills — {dayBills.date}</h2>
            <ListPager
              topRight
              page={billPager.page}
              totalPages={billPager.totalPages}
              total={billPager.total}
              pageSize={billPager.pageSize}
              onPage={billPager.setPage}
            />
            <div className="table-scroll">
              <table className="table data-table report-table">
                <thead>
                  <tr>
                    <th>Bill No</th>
                    <th>Type</th>
                    <th>Customer</th>
                    {dayBills.gst_rates.map((r) => (
                      <th key={r} className="text-end">
                        {r}%
                      </th>
                    ))}
                    <th className="text-end">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {billPager.pageRows.map((b) => (
                    <tr key={b.id} className="clickable-row" onClick={() => void openBill(b)}>
                      <td>
                        <button type="button" className="link-btn">
                          {b.voucher_no}
                        </button>
                      </td>
                      <td>{b.voucher_type}</td>
                      <td>{b.party_name || 'Walk-in'}</td>
                      {dayBills.gst_rates.map((r) => (
                        <td key={r} className="text-end">
                          {money(b.amounts?.[r])}
                        </td>
                      ))}
                      <td className="text-end">{money(b.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total ({dayBills.totals.bill_count})</td>
                    {dayBills.gst_rates.map((r) => (
                      <td key={r} className="text-end">
                        {money(dayBills.totals.amounts?.[r])}
                      </td>
                    ))}
                    <td className="text-end">{money(dayBills.totals.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setDayBills(null)}>
                Close
              </button>
              <ExportFormatButtons onExport={exportDayBillsExcel} />
              <button type="button" className="btn btn-primary" onClick={() => void printBills({ day: dayBills.date })}>
                Print bills
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <PrintPreview
          title={preview.title}
          html={preview.html}
          reportCode={preview.reportCode}
          billFormat={preview.billFormat}
          onBillFormatChange={preview.billId ? (fmt) => void changeBillFormat(fmt) : undefined}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}
