import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { PrintPreview } from '../../components/generp/PrintPreview'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { loadBillFormat, saveBillFormat, voucherReportCode } from '../../lib/generp/billFormat'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { fmt, todayISO } from '../../lib/generp/saleBillMath'

type TaxRow = {
  id?: string
  voucher_id?: string
  voucher_no?: string
  voucher_type?: string
  voucher_date?: string | null
  party_name?: string
  gst_pct: string
  taxable: number
  cgst: number
  sgst: number
  igst: number
  cess: number
  total: number
}

type TaxTotals = {
  taxable: number
  cgst: number
  sgst: number
  igst: number
  cess: number
  total: number
}

type TaxReport = {
  date_from: string
  date_to: string
  rows: TaxRow[]
  totals: TaxTotals
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

type Mode = 'bills' | 'summary'

function TaxwiseReportPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  const isBills = mode === 'bills'
  const title = isBills ? 'Taxwise Bill Summary' : 'Taxwise Summary'
  const jsonPath = isBills ? '/reports/taxwise-bill-summary' : '/reports/taxwise-summary'
  const reportCode = isBills ? 'TAXWISE_BILL_SUMMARY' : 'TAXWISE_SUMMARY'

  const [fromDate, setFromDate] = useState(todayISO())
  const [toDate, setToDate] = useState(todayISO())
  const [billFrom, setBillFrom] = useState('')
  const [billTo, setBillTo] = useState('')
  const [data, setData] = useState<TaxReport | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
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
      setData(await api.get<TaxReport>(jsonPath, params()))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load report')
    } finally {
      setBusy(false)
    }
  }, [jsonPath, params])

  useEffect(() => {
    void refresh()
  }, [])

  const formatFor = async (code: string) => {
    if (formatByCode[code]) return formatByCode[code]
    const fmtCode = await loadBillFormat(code)
    setFormatByCode((prev) => ({ ...prev, [code]: fmtCode }))
    return fmtCode
  }

  const openBill = async (row: TaxRow) => {
    if (!row.voucher_id) return
    const code = voucherReportCode(row.voucher_type || 'SALE')
    try {
      const format = await formatFor(code)
      const html = await api.getReportHtml(`/reports/sale-bill/${row.voucher_id}`, { format })
      setPreview({
        title: `Bill ${row.voucher_no}`,
        html,
        reportCode: code,
        billId: row.voucher_id,
        billFormat: format,
      })
    } catch (err) {
      const path = row.voucher_type === 'WHOLESALE' ? '/wholesale_bill_modify' : '/sale_bill_modify'
      navigate(`${path}?voucher_id=${encodeURIComponent(row.voucher_id)}`)
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
      const html = await api.getReportHtml(jsonPath, params())
      setPreview({ title, html, reportCode })
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Print failed')
    }
  }

  const exportExcel = (format: SpreadsheetFormat = 'xlsx') => {
    if (!data) return
    if (isBills) {
      downloadExcel(
        `taxwise-bill-summary-${data.date_from}-to-${data.date_to}`,
        {
          name: 'Taxwise Bill Summary',
          headers: ['Date', 'Bill No', 'Customer', 'Tax %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess', 'Total'],
          rows: [
            ...data.rows.map((r) => [
              r.voucher_date || '',
              r.voucher_no || '',
              r.party_name || 'Walk-in',
              r.gst_pct,
              Number(r.taxable || 0),
              Number(r.cgst || 0),
              Number(r.sgst || 0),
              Number(r.igst || 0),
              Number(r.cess || 0),
              Number(r.total || 0),
            ]),
            [
              'Total',
              '',
              '',
              '',
              Number(data.totals.taxable || 0),
              Number(data.totals.cgst || 0),
              Number(data.totals.sgst || 0),
              Number(data.totals.igst || 0),
              Number(data.totals.cess || 0),
              Number(data.totals.total || 0),
            ],
          ],
        },
        format,
      )
      return
    }
    downloadExcel(
      `taxwise-summary-${data.date_from}-to-${data.date_to}`,
      {
        name: 'Taxwise Summary',
        headers: ['Tax %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess', 'Total'],
        rows: [
          ...data.rows.map((r) => [
            r.gst_pct,
            Number(r.taxable || 0),
            Number(r.cgst || 0),
            Number(r.sgst || 0),
            Number(r.igst || 0),
            Number(r.cess || 0),
            Number(r.total || 0),
          ]),
          [
            'Total',
            Number(data.totals.taxable || 0),
            Number(data.totals.cgst || 0),
            Number(data.totals.sgst || 0),
            Number(data.totals.igst || 0),
            Number(data.totals.cess || 0),
            Number(data.totals.total || 0),
          ],
        ],
      },
      format,
    )
  }

  const pager = useClientPager(
    data?.rows || [],
    `${mode}|${fromDate}|${toDate}|${data?.rows.length || 0}`,
    TABLE_PAGE_SIZE,
  )

  return (
    <div className="settings-page">
      <h2>{title}</h2>
      <p className="hint">
        {isBills
          ? 'Each bill is listed by GST rate. A bill with more than one tax rate appears on multiple rows.'
          : 'Totals by tax percentage: taxable value, CGST, SGST, IGST, cess, and total.'}
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
        <ExportFormatButtons disabled={!data} onExport={exportExcel} />
      </div>

      <div className="table-scroll">
        <ListPager
          topRight
          page={pager.page}
          totalPages={pager.totalPages}
          total={pager.total}
          pageSize={pager.pageSize}
          onPage={pager.setPage}
        />
        <table className="table data-table report-table">
          <thead>
            <tr>
              {isBills && (
                <>
                  <th>Date</th>
                  <th>Bill No</th>
                  <th>Customer</th>
                </>
              )}
              <th className="text-end">Tax %</th>
              <th className="text-end">Taxable</th>
              <th className="text-end">CGST</th>
              <th className="text-end">SGST</th>
              <th className="text-end">IGST</th>
              <th className="text-end">Cess</th>
              <th className="text-end">Total</th>
            </tr>
          </thead>
          <tbody>
            {!data?.rows.length && (
              <tr>
                <td colSpan={isBills ? 10 : 7} className="text-muted">
                  No bills in this range
                </td>
              </tr>
            )}
            {pager.pageRows.map((row, idx) => (
              <tr
                key={`${row.voucher_id || 'sum'}-${row.gst_pct}-${idx}`}
                className={isBills ? 'clickable-row' : undefined}
                onClick={isBills ? () => void openBill(row) : undefined}
              >
                {isBills && (
                  <>
                    <td>{row.voucher_date}</td>
                    <td>
                      <button type="button" className="link-btn">
                        {row.voucher_no}
                      </button>
                    </td>
                    <td>{row.party_name || 'Walk-in'}</td>
                  </>
                )}
                <td className="text-end">{row.gst_pct}</td>
                <td className="text-end">{money(row.taxable)}</td>
                <td className="text-end">{money(row.cgst)}</td>
                <td className="text-end">{money(row.sgst)}</td>
                <td className="text-end">{money(row.igst)}</td>
                <td className="text-end">{money(row.cess)}</td>
                <td className="text-end">{money(row.total)}</td>
              </tr>
            ))}
          </tbody>
          {data && (
            <tfoot>
              <tr>
                <td colSpan={isBills ? 4 : 1}>Total</td>
                <td className="text-end">{money(data.totals.taxable)}</td>
                <td className="text-end">{money(data.totals.cgst)}</td>
                <td className="text-end">{money(data.totals.sgst)}</td>
                <td className="text-end">{money(data.totals.igst)}</td>
                <td className="text-end">{money(data.totals.cess)}</td>
                <td className="text-end">{money(data.totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

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

export function TaxwiseBillSummaryPage() {
  return <TaxwiseReportPage mode="bills" />
}

export function TaxwiseSummaryPage() {
  return <TaxwiseReportPage mode="summary" />
}
