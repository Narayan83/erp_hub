import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { BillFormatSelect } from '../components/generp/BillFormatSelect'
import { BillPreviewFrame } from '../components/generp/BillPreviewFrame'
import { downloadAuthedPost } from '../lib/downloadFile'
import { writeLocalBillFormat } from '../lib/generp/billFormat'
import { downloadExcel, type ExcelSheet } from '../lib/generp/exportExcel'
import { pageInfoFromHtml, reportCodeFromHtml } from './pageSize'
import { printHtmlOnThisPc } from './printOnThisPc'
import { subscribePrintPreview, type ProductPrintJob } from './printPreviewBus'
import './print-preview.css'

type PreviewKind = 'thermal' | 'barcode' | 'page'
type WindowMode = 'normal' | 'minimized' | 'maximized'

const TOKEN_KEY = 'erp_token'
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api/v1'

export type CorePrintPreviewProps = {
  title: string
  html: string
  onClose: () => void
  reportCode?: string
  billFormat?: string
  onBillFormatChange?: (format: string) => void
  onPrint?: (html: string) => void
  pdfName?: string
  excelName?: string
  loadError?: string
}

function previewKind(html: string): PreviewKind {
  if (html.includes('data-generp-print="barcode"')) return 'barcode'
  if (html.includes('thermal-slip')) return 'thermal'
  return 'page'
}

function orientationFromHtml(html: string, kind: PreviewKind): string {
  if (kind === 'thermal') return 'Thermal'
  const match = html.match(/data-page-orientation\s*=\s*['"](portrait|landscape)['"]/i)
  if (!match) return kind === 'barcode' ? 'Label' : 'Not specified'
  return match[1].toLowerCase() === 'landscape' ? 'Landscape' : 'Portrait'
}

function sheetsFromHtml(html: string): ExcelSheet[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tables = [...doc.querySelectorAll('table')]
  if (!tables.length) {
    const text = (doc.body?.innerText || '').trim()
    return [{ name: 'Document', headers: ['Text'], rows: text ? text.split(/\n+/).map((line) => [line]) : [] }]
  }
  return tables.map((table, index) => {
    const rows = [...table.querySelectorAll('tr')].map((tr) =>
      [...tr.querySelectorAll('th,td')].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() || ''),
    )
    return { name: `Sheet ${index + 1}`, headers: rows[0] || [], rows: rows.slice(1) }
  })
}

function mmToPx(mm: number) {
  return Math.round((mm / 25.4) * 96)
}

function barcodeFrameGuess(html: string) {
  const wMatch = html.match(/size:\s*([\d.]+)mm/i)
  const rowCount = Math.max(1, (html.match(/class="row"/g) || []).length)
  const hMatch = html.match(/height:([\d.]+)mm/)
  const width = Math.max(120, (wMatch ? mmToPx(Number(wMatch[1])) : 192) + 4)
  const rowH = hMatch ? mmToPx(Number(hMatch[1])) : mmToPx(25.4)
  const maxH = Math.max(200, window.innerHeight - 170)
  return { width, height: Math.min(Math.max(80, rowCount * rowH + 4), maxH) }
}

function measureDocument(doc: Document, kind: PreviewKind) {
  const body = doc.body
  const root = doc.documentElement
  const maxW = Math.max(280, window.innerWidth - 40)
  const maxH = Math.max(200, window.innerHeight - 170)
  if (kind === 'barcode') {
    const sheet = (doc.querySelector('.sheet') as HTMLElement | null) || body
    const rect = sheet.getBoundingClientRect()
    const contentW = Math.ceil(Math.max(rect.width, sheet.scrollWidth, 80))
    const contentH = Math.ceil(Math.max(rect.height, sheet.scrollHeight, 80))
    return {
      width: Math.min(contentW + 4, maxW),
      height: Math.min(contentH + 4, maxH),
    }
  }
  const minW = kind === 'thermal' ? 280 : 480
  const contentW = Math.ceil(Math.max(body.scrollWidth, body.offsetWidth, root.scrollWidth, minW))
  const contentH = Math.ceil(Math.max(body.scrollHeight, body.offsetHeight, root.scrollHeight, 160))
  const padded = contentW + 8
  return {
    width: Math.min(kind === 'thermal' ? Math.min(padded, 320) : padded, maxW),
    height: Math.min(contentH + 8, maxH),
  }
}

function defaultWindowBox() {
  const w = Math.min(720, Math.max(360, window.innerWidth - 32))
  const h = Math.min(Math.max(320, window.innerHeight - 32), 760)
  return {
    w,
    h,
    x: Math.max(8, Math.round((window.innerWidth - w) / 2)),
    y: Math.max(8, Math.round((window.innerHeight - h) / 2)),
  }
}

async function fetchPrintHtml(path: string): Promise<string> {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    let detail: unknown = text
    try {
      detail = JSON.parse(text)?.detail ?? text
    } catch {
      /* keep text */
    }
    throw new Error(typeof detail === 'string' ? detail : 'Could not load the document')
  }
  return text
}

export function CorePrintPreview({
  title,
  html,
  onClose,
  reportCode,
  billFormat,
  onBillFormatChange,
  onPrint = printHtmlOnThisPc,
  pdfName,
  excelName,
  loadError = '',
}: CorePrintPreviewProps) {
  const kind = html ? previewKind(html) : 'page'
  const pageInfo = useMemo(() => (html ? pageInfoFromHtml(html) : null), [html])
  const orientation = useMemo(() => (html ? orientationFromHtml(html, kind) : 'Loading'), [html, kind])
  const start = useMemo(() => defaultWindowBox(), [])
  const [mode, setMode] = useState<WindowMode>('normal')
  const [frameSize, setFrameSize] = useState(() =>
    kind === 'thermal' ? { width: 312, height: 360 } : kind === 'barcode' ? barcodeFrameGuess(html) : { width: 720, height: 360 },
  )
  const [pos, setPos] = useState(() => ({ x: start.x, y: start.y }))
  const [box, setBox] = useState(() => ({ w: start.w, h: start.h }))
  const [busy, setBusy] = useState(false)
  const [fileBusy, setFileBusy] = useState<'' | 'pdf' | 'excel'>('')
  const [printError, setPrintError] = useState('')
  const [printOk, setPrintOk] = useState('')
  const dragging = useRef<{ dx: number; dy: number } | null>(null)
  const resizing = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)

  const fitFrame = useCallback(() => {
    if (kind === 'page') return
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    setFrameSize(measureDocument(doc, kind))
  }, [kind])

  useEffect(() => {
    if (kind === 'page') return
    setFrameSize(kind === 'thermal' ? { width: 312, height: 360 } : barcodeFrameGuess(html))
  }, [html, kind])

  const print = () => {
    if (!html) return
    setPrintError('')
    setPrintOk('')
    setBusy(true)
    try {
      onPrint(html)
      setPrintOk('Opened the print dialog on this computer')
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'Print failed')
    } finally {
      setBusy(false)
    }
  }

  const exportFile = async (fileKind: 'pdf' | 'excel') => {
    if (!html) return
    const file = (title || 'Document').replace(/\s+/g, '_')
    const pdfFile = pdfName || `${file}.pdf`
    const excelFile = excelName || `${file}.xlsx`
    setPrintError('')
    setPrintOk('')
    setFileBusy(fileKind)
    try {
      if (fileKind === 'pdf') {
        await downloadAuthedPost('/print-configs/pdf', { html, title }, pdfFile)
        setPrintOk(`Saved ${pdfFile}`)
      } else {
        downloadExcel(excelFile, sheetsFromHtml(html))
        setPrintOk(`Exported ${excelFile}`)
      }
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : fileKind === 'pdf' ? 'PDF download failed' : 'Excel export failed')
    } finally {
      setFileBusy('')
    }
  }

  const onFormat = (next: string) => {
    if (reportCode) writeLocalBillFormat(reportCode, next)
    onBillFormatChange?.(next)
  }

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (mode === 'maximized') return
    dragging.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onHeaderPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragging.current
    if (!drag) return
    setPos({
      x: Math.min(window.innerWidth - 80, Math.max(0, e.clientX - drag.dx)),
      y: Math.min(window.innerHeight - 40, Math.max(0, e.clientY - drag.dy)),
    })
  }
  const onHeaderPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    dragging.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    resizing.current = { x: e.clientX, y: e.clientY, w: box.w, h: box.h }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizing.current
    if (!r) return
    setBox({
      w: Math.min(Math.max(320, r.w + (e.clientX - r.x)), window.innerWidth - 16),
      h: Math.min(Math.max(240, r.h + (e.clientY - r.y)), window.innerHeight - 16),
    })
  }
  const onResizeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    resizing.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  const winStyle =
    mode === 'maximized'
      ? { left: 8, top: 8, width: 'calc(100vw - 16px)', height: 'calc(100dvh - 16px)' }
      : mode === 'minimized'
        ? { left: pos.x, top: pos.y, width: 320, height: 'auto' }
        : { left: pos.x, top: pos.y, width: box.w, height: box.h }

  const sizeLabel = pageInfo
    ? `Selected size: ${pageInfo.label}`
    : html
      ? `Orientation: ${orientation}`
      : 'Loading size…'

  return createPortal(
    <div className={`print-preview-layer${mode === 'minimized' ? ' is-min' : ''}`} role="presentation">
      {mode !== 'minimized' ? (
        <button type="button" className="print-preview-dim" aria-label="Close preview" onClick={onClose} />
      ) : null}
      <div
        className={`print-preview-window${mode === 'maximized' ? ' is-max' : ''}${mode === 'minimized' ? ' is-min' : ''}`}
        role="dialog"
        aria-modal={mode !== 'minimized'}
        aria-label={title}
        style={winStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="print-preview-head"
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
        >
          <span className="print-preview-drag-handle" title="Drag preview in any direction" aria-hidden="true">
            ✥
          </span>
          <h2>{title}</h2>
          <span className="print-preview-orientation" data-short={pageInfo?.sizeName || orientation}>
            {sizeLabel}
          </span>
          <button
            type="button"
            className="print-preview-close"
            title={mode === 'minimized' ? 'Restore' : 'Minimize'}
            aria-label={mode === 'minimized' ? 'Restore' : 'Minimize'}
            onClick={() => setMode((m) => (m === 'minimized' ? 'normal' : 'minimized'))}
          >
            {mode === 'minimized' ? '▢' : '–'}
          </button>
          <button
            type="button"
            className="print-preview-close"
            title={mode === 'maximized' ? 'Restore' : 'Maximize'}
            aria-label={mode === 'maximized' ? 'Restore' : 'Maximize'}
            onClick={() => setMode((m) => (m === 'maximized' ? 'normal' : 'maximized'))}
          >
            {mode === 'maximized' ? '❐' : '□'}
          </button>
          <button type="button" className="print-preview-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {mode !== 'minimized' ? (
          <>
            {html && kind === 'page' && pageInfo ? (
              <div className="print-frame-well print-frame-well--page">
                <BillPreviewFrame
                  html={html}
                  widthMm={pageInfo.widthMm}
                  heightMm={pageInfo.heightMm}
                  maxScale={mode === 'maximized' ? 2 : 1}
                  fitMode="contain"
                />
              </div>
            ) : html && kind === 'barcode' ? (
              <div className="print-frame-well print-frame-well--scroll">
                <iframe
                  ref={frameRef}
                  className="print-frame print-frame--barcode"
                  title={title}
                  srcDoc={html}
                  style={{ width: frameSize.width, height: frameSize.height }}
                  onLoad={() => {
                    fitFrame()
                    requestAnimationFrame(() => fitFrame())
                  }}
                />
              </div>
            ) : html ? (
              <div className="print-frame-well print-frame-well--scroll">
                <iframe
                  ref={frameRef}
                  className={`print-frame${kind === 'thermal' ? ' print-frame--thermal' : ''}`}
                  title={title}
                  srcDoc={html}
                  style={{ width: frameSize.width, height: frameSize.height }}
                  onLoad={fitFrame}
                />
              </div>
            ) : (
              <p className="print-preview-empty">{loadError || 'Loading bill…'}</p>
            )}
            <div className="print-toolbar">
              {onBillFormatChange && billFormat ? (
                <BillFormatSelect value={billFormat} onChange={onFormat} documentCode={reportCode} />
              ) : null}
            </div>
            <div className="modal-actions">
              {printError ? <p className="print-preview-status">{printError}</p> : null}
              {printOk ? <p className="print-preview-ok">{printOk}</p> : null}
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
              <button type="button" className="btn" disabled={busy || fileBusy !== '' || !html} onClick={() => void exportFile('excel')}>
                {fileBusy === 'excel' ? 'Exporting…' : 'Excel'}
              </button>
              <button type="button" className="btn" disabled={busy || fileBusy !== '' || !html} onClick={() => void exportFile('pdf')}>
                {fileBusy === 'pdf' ? 'Saving PDF…' : 'Print PDF'}
              </button>
              <button type="button" className="btn btn-primary" disabled={busy || fileBusy !== '' || !html} onClick={print}>
                {busy ? 'Printing…' : 'Print'}
              </button>
            </div>
          </>
        ) : null}
        {mode === 'normal' ? (
          <div
            className="print-preview-resize"
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
          />
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

export function PrintJobPreview({
  job,
  onClose,
  onPrint = printHtmlOnThisPc,
}: {
  job: ProductPrintJob
  onClose: () => void
  onPrint?: (html: string) => void
}) {
  const [html, setHtml] = useState(job.html || '')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoadError('')
    if (job.html) {
      setHtml(job.html)
      return
    }
    setHtml('')
    if (!job.htmlPath) {
      setLoadError('Nothing to print')
      return
    }
    void fetchPrintHtml(job.htmlPath)
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

  const reportCode = (html ? reportCodeFromHtml(html) : '') || job.reportCode || ''

  return (
    <CorePrintPreview
      title={job.title}
      html={html}
      onClose={onClose}
      reportCode={reportCode}
      pdfName={job.pdfName}
      excelName={job.excelName}
      loadError={loadError}
      onPrint={onPrint}
    />
  )
}

/** One preview host for every product that calls openPrintPreview. */
export function CorePrintPreviewHost() {
  const [job, setJob] = useState<ProductPrintJob | null>(null)
  useEffect(() => subscribePrintPreview(setJob), [])
  if (!job) return null
  return <PrintJobPreview job={job} onClose={() => setJob(null)} onPrint={printHtmlOnThisPc} />
}
