import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { BillFormatSelect } from './BillFormatSelect'
import { BillPreviewFrame } from './BillPreviewFrame'
import { saveBillFormat } from '../../lib/generp/billFormat'

type PrinterInfo = { name: string; is_default?: boolean }

type PreviewKind = 'thermal' | 'barcode' | 'page'
type WindowMode = 'normal' | 'minimized' | 'maximized'

function pageSizeFromHtml(html: string) {
  const width = html.match(/data-page-w\s*=\s*['"]([\d.]+)['"]/i)
  const height = html.match(/data-page-h\s*=\s*['"]([\d.]+)['"]/i)
  if (width && height && Number(width[1]) > 0 && Number(height[1]) > 0) {
    return { widthMm: Number(width[1]), heightMm: Number(height[1]) }
  }
  const page = html.match(/size:\s*([\d.]+)\s*mm\s+([\d.]+)\s*mm/i)
  if (page && Number(page[1]) > 0 && Number(page[2]) > 0) {
    return { widthMm: Number(page[1]), heightMm: Number(page[2]) }
  }
  return null
}

function orientationFromHtml(html: string, kind: PreviewKind): string {
  if (kind === 'thermal') return 'Thermal'
  const match = html.match(/data-page-orientation\s*=\s*['"](portrait|landscape)['"]/i)
  if (!match) return 'Not specified'
  return match[1].toLowerCase() === 'landscape' ? 'Landscape' : 'Portrait'
}

type Props = {
  title: string
  html: string
  onClose: () => void
  reportCode?: string
  billFormat?: string
  onBillFormatChange?: (format: string) => void
  initialPrinter?: string
  showCopies?: boolean
  saveDefaultLabel?: string
  onSaveDefault?: (printer: string, copies: number) => void | Promise<void>
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

function previewKind(html: string): PreviewKind {
  if (html.includes('data-generp-print="barcode"')) return 'barcode'
  if (html.includes('thermal-slip')) return 'thermal'
  return 'page'
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

export function PrintPreview({
  title,
  html,
  onClose,
  reportCode,
  billFormat,
  onBillFormatChange,
  initialPrinter,
  showCopies = true,
  saveDefaultLabel = 'Save as default for this menu',
  onSaveDefault,
}: Props) {
  const kind = previewKind(html)
  const thermal = kind === 'thermal'
  const pageSize = useMemo(() => (kind === 'page' ? pageSizeFromHtml(html) : null), [html, kind])
  const orientation = useMemo(() => orientationFromHtml(html, kind), [html, kind])
  const start = useMemo(() => defaultWindowBox(), [])
  const [mode, setMode] = useState<WindowMode>('normal')
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [printer, setPrinter] = useState('')
  const [printersReady, setPrintersReady] = useState(false)
  const [copies, setCopies] = useState(1)
  const printerRef = useRef(printer)
  printerRef.current = printer
  const [frameSize, setFrameSize] = useState(() =>
    kind === 'thermal'
      ? { width: 312, height: 360 }
      : kind === 'barcode'
        ? barcodeFrameGuess(html)
        : { width: 720, height: 360 },
  )
  const [pos, setPos] = useState(() => ({ x: start.x, y: start.y }))
  const [box, setBox] = useState(() => ({ w: start.w, h: start.h }))
  const [busy, setBusy] = useState(false)
  const [printError, setPrintError] = useState('')
  const [printOk, setPrintOk] = useState('')
  const dragging = useRef<{ dx: number; dy: number } | null>(null)
  const resizing = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await api.get<{ printers?: PrinterInfo[]; default?: string | null }>(
          '/print-configs/printers',
        )
        const list = data.printers || []
        let chosen = (initialPrinter || '').trim()
        let copiesSaved = 0
        if (reportCode) {
          try {
            const cfg = await api.get<{
              printer_name?: string | null
              copies?: number
            }>(`/print-configs/by-code/${reportCode}`)
            if (!chosen && cfg.printer_name) chosen = cfg.printer_name.trim()
            if (showCopies && cfg.copies) copiesSaved = Math.max(1, Number(cfg.copies) || 1)
          } catch {
            /* ignore */
          }
        }
        const known = list.some((p) => p.name === chosen)
        if (!chosen) {
          const def = list.find((p) => p.is_default) || list[0]
          chosen = def?.name || ''
        } else if (list.length > 0 && !known) {
          const match = list.find((p) => p.name.toLowerCase() === chosen.toLowerCase())
          if (match) chosen = match.name
        }
        if (cancelled) return
        setPrinters(list)
        setPrinter(chosen)
        if (copiesSaved) setCopies(copiesSaved)
      } catch {
        if (!cancelled) setPrinters([])
      } finally {
        if (!cancelled) setPrintersReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reportCode, showCopies])

  const fitFrame = useCallback(() => {
    if (kind === 'page') return
    const iframe = frameRef.current
    const doc = iframe?.contentDocument
    if (!doc) return
    setFrameSize(measureDocument(doc, kind))
  }, [kind])

  useEffect(() => {
    if (kind === 'page') return
    setFrameSize(kind === 'thermal' ? { width: 312, height: 360 } : barcodeFrameGuess(html))
  }, [html, kind])

  const saveDefault = async () => {
    const selected = printerRef.current.trim()
    try {
      if (onSaveDefault) {
        if (selected) await onSaveDefault(selected, copies)
        return
      }
      if (!reportCode) return
      if (billFormat) await saveBillFormat(reportCode, billFormat)
      const rows = await api.get<Array<{ id: string; code: string }>>('/print-configs')
      const row = rows.find((r) => r.code === reportCode)
      if (!row) return
      const payload: { printer_name?: string; copies?: number } = {}
      if (selected) payload.printer_name = selected
      if (showCopies) payload.copies = copies
      await api.patch(`/print-configs/${row.id}`, payload)
    } catch {
      /* ignore — printing still works */
    }
  }

  const print = async () => {
    const selected = printerRef.current.trim()
    setPrintError('')
    setPrintOk('')
    if (printers.length > 0 && !selected) {
      setPrintError('Select a printer first')
      return
    }
    setBusy(true)
    try {
      await saveDefault()
      const result = await api.post<{ ok?: boolean; message?: string; pdf_path?: string; printer?: string }>(
        '/print-configs/print',
        {
          html,
          printer_name: selected || null,
          copies: showCopies ? Math.max(1, copies) : 1,
          bill_format: billFormat || (thermal ? 'THERMAL_80' : undefined),
        },
      )
      setPrintOk(
        result.message ||
          (result.pdf_path
            ? `Saved PDF to ${result.pdf_path}`
            : `Sent to ${result.printer || selected || 'printer'}`),
      )
    } catch (err) {
      setPrintError(err instanceof ApiError ? err.message : 'Print failed')
    } finally {
      setBusy(false)
    }
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

  return (
    <div className={`print-preview-layer${mode === 'minimized' ? ' is-min' : ''}`} role="presentation">
      {mode !== 'minimized' ? (
        <button type="button" className="print-preview-dim modal-backdrop" aria-label="Close preview" onClick={onClose} />
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
          <span className="print-preview-orientation" data-short={orientation}>
            Orientation: {orientation}
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
            {kind === 'page' && pageSize ? (
              <div className="print-frame-well print-frame-well--page">
                <BillPreviewFrame
                  html={html}
                  widthMm={pageSize.widthMm}
                  heightMm={pageSize.heightMm}
                  maxScale={mode === 'maximized' ? 2 : 1}
                  fitMode="contain"
                />
              </div>
            ) : kind === 'barcode' ? (
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
            ) : (
              <div className="print-frame-well print-frame-well--scroll">
                <iframe
                  ref={frameRef}
                  className={`print-frame${thermal ? ' print-frame--thermal' : ''}`}
                  title={title}
                  srcDoc={html}
                  style={{ width: frameSize.width, height: frameSize.height }}
                  onLoad={fitFrame}
                />
              </div>
            )}
            <div className="print-toolbar">
              {onBillFormatChange && billFormat ? (
                <BillFormatSelect value={billFormat} onChange={onBillFormatChange} documentCode={reportCode} />
              ) : null}
              <label>
                Printer (this PC)
                <select
                  className="input"
                  value={printer}
                  disabled={!printersReady}
                  onChange={(e) => setPrinter(e.target.value)}
                >
                  {printers.length === 0 && <option value="">Windows default</option>}
                  {printer && !printers.some((p) => p.name === printer) && (
                    <option value={printer}>{printer} (saved)</option>
                  )}
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                      {p.is_default ? ' (Windows default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {showCopies ? (
                <label>
                  Copies
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={10}
                    style={{ width: 72 }}
                    value={copies}
                    onChange={(e) => setCopies(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                  />
                </label>
              ) : null}
            </div>
            <div className="modal-actions">
              {printError ? <p className="error print-preview-status">{printError}</p> : null}
              {printOk ? <p className="print-preview-ok">{printOk}</p> : null}
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
              {(reportCode || onSaveDefault) && (
                <button type="button" className="btn" onClick={() => void saveDefault()}>
                  {saveDefaultLabel}
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !printersReady || (printers.length > 0 && !printer)}
                onClick={() => void print()}
              >
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
    </div>
  )
}
