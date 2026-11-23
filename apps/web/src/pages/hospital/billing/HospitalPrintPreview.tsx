import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../../api/client'
import { BillPreviewFrame } from '../../../components/generp/BillPreviewFrame'
import { downloadAuthedPost } from '../../../lib/downloadFile'
import {
  loadInstalledPrinters,
  loadSavedPrinter,
  matchInstalledPrinter,
  rememberReportPrinter,
  type PrinterInfo,
} from '../../../lib/printPreferences'
import { subscribePrintPreview, type HospitalPrintJob } from '../../../print/printPreviewBus'
import { fetchHospitalHtml } from './report'
import { pageInfoFromHtml, reportCodeFromHtml } from './paperSize'
import './hospital-print-preview.css'

export type { HospitalPrintJob }

export function opdBillPrintJob(id: string, billNo?: string | null): HospitalPrintJob {
  const no = (billNo || '').trim() || id
  return {
    title: `OPD Bill ${billNo || ''}`.trim(),
    htmlPath: `/hospital/reports/opd-bill/${id}/html`,
    reportCode: 'OPD_BILL',
    pdfName: `OPD_Bill_${no}.pdf`,
    excelName: `OPD_Bill_${no}.xlsx`,
  }
}

export function HospitalPrintPreview({ job, onClose }: { job: HospitalPrintJob; onClose: () => void }) {
  const [html, setHtml] = useState('')
  const [loadError, setLoadError] = useState('')
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [printer, setPrinter] = useState('')
  const [printersReady, setPrintersReady] = useState(false)
  const [busy, setBusy] = useState<'print' | 'pdf' | 'excel' | ''>('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const measured = useMemo(() => (html ? pageInfoFromHtml(html) : null), [html])
  const page =
    measured ||
    (html
      ? {
          widthMm: 210,
          heightMm: 297,
          orientation: 'Portrait' as const,
          sizeName: 'A4',
          label: 'A4 · 210 × 297 mm · Portrait',
        }
      : null)
  const reportCode = (html ? reportCodeFromHtml(html) : '') || job.reportCode || ''

  useEffect(() => {
    let cancelled = false
    setHtml('')
    setLoadError('')
    setMessage('')
    setError('')
    if (job.html) {
      setHtml(job.html)
      return
    }
    if (!job.htmlPath) {
      setLoadError('Nothing to print')
      return
    }
    void fetchHospitalHtml(job.htmlPath)
      .then((text) => {
        if (!cancelled) setHtml(text)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load the document')
      })
    return () => {
      cancelled = true
    }
  }, [job.html, job.htmlPath])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await loadInstalledPrinters()
        // Wait for the HTML stamp (option-specific SSO… code) before reading saved printer.
        let chosen = reportCode && html ? await loadSavedPrinter(reportCode) : ''
        chosen = matchInstalledPrinter(chosen, list)
        if (cancelled) return
        setPrinters(list)
        setPrinter(chosen)
      } catch {
        if (!cancelled) {
          setPrinters([])
          setPrinter('')
        }
      } finally {
        if (!cancelled) setPrintersReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reportCode, html])

  async function printNow() {
    if (!html) return
    const selected = printer.trim()
    setBusy('print')
    setError('')
    setMessage('')
    try {
      await rememberReportPrinter(reportCode, selected)
      const result = await api.post<{ message?: string; printer?: string; pdf_path?: string }>(
        '/print-configs/print',
        { html, printer_name: selected || null, copies: 1 },
      )
      setMessage(result.message || `Sent to ${result.printer || selected || 'Windows default'}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Print failed')
    } finally {
      setBusy('')
    }
  }

  async function download(kind: 'pdf' | 'excel') {
    if (!html) return
    const fileName = kind === 'pdf' ? job.pdfName || 'document.pdf' : job.excelName || 'document.xlsx'
    setBusy(kind)
    setError('')
    setMessage('')
    try {
      if (kind === 'pdf') {
        await downloadAuthedPost('/print-configs/pdf', { html, title: job.title }, fileName)
      } else {
        await downloadAuthedPost(
          '/hospital/reports/excel-from-html',
          { html, title: job.title, data_only: false },
          fileName,
        )
      }
      setMessage(kind === 'pdf' ? `Saved ${fileName}` : `Exported ${fileName}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : kind === 'pdf' ? 'PDF download failed' : 'Excel export failed')
    } finally {
      setBusy('')
    }
  }

  const sizeLabel = page?.label || (html ? 'Size not set' : 'Loading size…')

  return (
    <div className="hms-print-layer" role="presentation" onClick={onClose}>
      <div
        className="hms-print-window"
        role="dialog"
        aria-modal="true"
        aria-label={job.title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="hms-print-head">
          <h2>{job.title}</h2>
          <span className="hms-print-size" title={sizeLabel}>
            Selected size: {sizeLabel}
          </span>
          <button type="button" className="hms-print-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="hms-print-stage">
          {page ? (
            <BillPreviewFrame
              html={html}
              widthMm={page.widthMm}
              heightMm={page.heightMm}
              maxScale={1}
              fitMode="contain"
            />
          ) : (
            <p className="hms-print-empty">{loadError || 'Loading bill…'}</p>
          )}
        </div>
        <div className="hms-print-bar">
          <label>
            Printer
            <select
              value={printer}
              disabled={!printersReady || busy !== ''}
              onChange={(event) => setPrinter(event.target.value)}
            >
              <option value="">Windows default</option>
              {printer && !printers.some((item) => item.name === printer) ? (
                <option value={printer}>{printer} (saved / unavailable)</option>
              ) : null}
              {printers.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                  {item.is_default ? ' (Windows default)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="hms-print-actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
            <button type="button" disabled={busy !== '' || !html} onClick={() => void download('excel')}>
              {busy === 'excel' ? 'Exporting…' : 'Excel'}
            </button>
            <button type="button" disabled={busy !== '' || !html} onClick={() => void download('pdf')}>
              {busy === 'pdf' ? 'Saving PDF…' : 'Print PDF'}
            </button>
            <button
              type="button"
              className="is-primary"
              disabled={busy !== '' || !html || !printersReady}
              onClick={() => void printNow()}
            >
              {busy === 'print' ? 'Printing…' : 'Print'}
            </button>
          </div>
        </div>
        {error ? <p className="hms-print-note is-error">{error}</p> : null}
        {message ? <p className="hms-print-note is-ok">{message}</p> : null}
      </div>
    </div>
  )
}

/** Shared preview host (AppLayout) for any product that calls openPrintPreview. */
export function HospitalPrintPreviewHost() {
  const [job, setJob] = useState<HospitalPrintJob | null>(null)
  useEffect(() => subscribePrintPreview(setJob), [])
  if (!job) return null
  return <HospitalPrintPreview job={job} onClose={() => setJob(null)} />
}
