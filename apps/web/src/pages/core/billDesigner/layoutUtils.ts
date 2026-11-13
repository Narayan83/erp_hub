/**
 * Layout maths for the Bill Template Designer.
 * Ported from hospital/desktop/app/ui/widgets/bill_paper_canvas.py.
 * Functions mutate the band/field objects in place (like the desktop canvas);
 * the designer page clones the layout before editing and keeps undo snapshots.
 */
import {
  BAND_IDS,
  type BandFields,
  type BandId,
  type Box,
  type Field,
  type Layout,
  type PrintLayout,
  type Shape,
} from './types'

/* ───────────────────────── small helpers ───────────────────────── */

/** Python-style `float(x or d)`. */
export function num(v: unknown, d = 0): number {
  if (v === null || v === undefined || v === '') return d
  const x = Number(v)
  if (!Number.isFinite(x) || x === 0) return d
  return x
}

export const r1 = (v: number) => Math.round(v * 10) / 10

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

const placed = (f: Field) => f.x_mm !== null && f.x_mm !== undefined

export const STANDARD_PAGE_MM: Record<string, [number, number]> = {
  A4: [210.0, 297.0],
  A5: [148.0, 210.0],
  A6: [105.0, 148.0],
  LETTER: [215.9, 279.4],
  LEGAL: [215.9, 355.6],
}

export const STANDARD_PAGE_LABELS: { code: string; label: string }[] = [
  { code: 'A4', label: 'A4' },
  { code: 'A5', label: 'A5' },
  { code: 'A6', label: 'A6' },
  { code: 'LETTER', label: 'Letter' },
  { code: 'LEGAL', label: 'Legal' },
]

export const TEXT_FIELDS = new Set(['bill_title', 'computer_note', 'signature', 'thanks'])
export const STATIC_TEXT_PLACEHOLDERS = new Set(['', 'Caption', 'Custom caption text', 'Text'])

/** Same sample as the server preview, so the sheet matches a printed bill. */
export const SAMPLE: Record<string, unknown> & { lines: Record<string, string>[] } = {
  hospital_name: 'City Care Hospital',
  hospital_address: '12 Main Road, Sample City',
  hospital_phone: '080-4000-1000',
  hospital_mobile: '98765-43210',
  hospital_email: 'billing@hospital.example',
  hospital_gstin: '29AAAAA0000A1Z5',
  hospital_registration_number: 'REG-KA-12345',
  hospital_website: 'www.hospital.example',
  hospital_software_id: 'HMS-001',
  patient_no: 'P00021',
  patient_name: 'Anita Rao',
  patient_age: '34',
  patient_gender: 'Female',
  doctor_name: 'Dr Sharma',
  referring_doctor: 'Dr Iyer',
  department_name: 'General Medicine',
  bill_no: 'OP-1042',
  bill_date: '23/09/2026',
  voucher_no: 'ADV-18',
  voucher_date: '23/09/2026',
  admission_no: 'IP-220',
  ward_bed: 'General / 12',
  stay_days: '3',
  admission_date: '20/09/2026',
  discharge_date: '23/09/2026',
  scheme: 'General',
  cash_credit: 'Cash',
  token_number: '7',
  sample_no: 'S-88',
  visit_category: 'OPD',
  gross_amount: '850.00',
  admin_charges: '0.00',
  scheme_discount: '50.00',
  adjust_advance: '200.00',
  net_amount: '600.00',
  receipt_amount: '5,000.00',
  balance_after: '5,000.00',
  payment_mode: 'Cash',
  remarks: 'Sample preview',
  lines: [
    { sr: '1', code: 'CON', name: 'Consultation', category: 'OPD', rate: '500.00', qty: '1', amount: '500.00' },
    {
      sr: '2',
      code: 'CBC',
      name: 'Complete Blood Count',
      category: 'Lab',
      rate: '350.00',
      qty: '1',
      amount: '350.00',
    },
  ],
}

/* ───────────────────────── paper helpers ───────────────────────── */

export function isSmallPaper(paperW: number, paperH: number): boolean {
  return paperW <= 100 || paperH <= 120
}

/** Paper size in mm for a page code, with orientation applied. */
export function paperMm(
  layout: Layout | null | undefined,
  format: string,
  orientation: string,
  fallbackPages?: Record<string, { width_mm?: number; height_mm?: number }>,
): [number, number] {
  const code = String(format || 'A4').toUpperCase()
  const page = layout?.custom_pages?.[format] || fallbackPages?.[format]
  let w: number
  let h: number
  if (page) {
    w = Number(page.width_mm) || 210
    h = Number(page.height_mm) || 297
  } else {
    ;[w, h] = STANDARD_PAGE_MM[code] || STANDARD_PAGE_MM.A4
  }
  return orientation === 'landscape' ? [h, w] : [w, h]
}

/* ───────────────────────── default font / box sizes ───────────────────────── */

export function fontPt(fieldId: string, band: string, paperW: number): number {
  let pt: number
  if (fieldId === 'hospital_name') pt = 16
  else if (fieldId === 'bill_title') pt = 12
  else if (fieldId === 'computer_note' || fieldId === 'thanks') pt = 8
  else if (band === 'columns') pt = 9
  else pt = 10
  if (paperW < 110) pt = Math.max(7, Math.round((pt * paperW) / 148))
  else if (paperW < 160) pt = Math.max(8, Math.round((pt * paperW) / 180))
  return pt
}

function boxHeight(fieldId: string, band: string, paperW: number): number {
  if (fieldId === 'hospital_name') return paperW < 110 ? 6.5 : 8.5
  if (fieldId === 'signature') return 10
  if (band === 'columns') return 6
  return paperW < 110 ? 5.2 : 6.2
}

const STACKED = new Set([
  'hospital_name',
  'hospital_address',
  'hospital_phone',
  'hospital_mobile',
  'hospital_email',
  'hospital_gstin',
  'hospital_registration_number',
  'hospital_website',
  'hospital_software_id',
  'bill_title',
  'computer_note',
  'thanks',
  'signature',
])

/** Give visible fields that have never been dragged a starting box on this paper. */
export function placeMissing(fields: Field[], band: string, paperW: number): void {
  const visible = fields.filter((f) => f.visible)
  const missing = visible.filter((f) => !placed(f))
  if (!missing.length) return
  const pad = 1.5
  const inner = Math.max(30, paperW - pad * 2)
  const already = visible.filter(placed)
  let y = 1.0
  if (already.length) {
    y = Math.max(...already.map((f) => num(f.y_mm) + num(f.height_mm, 6))) + 0.8
  }

  const apply = (f: Field, x: number, top: number, width: number, height: number) => {
    f.x_mm = r1(x)
    f.y_mm = r1(top)
    f.width_mm = r1(Math.max(6, width))
    f.height_mm = r1(height)
    if (f.font_size_pt === null || f.font_size_pt === undefined) {
      f.font_size_pt = fontPt(String(f.id || ''), band, paperW)
    }
    if (band === 'columns') f.width = f.width_mm
  }

  if (band === 'columns') {
    const total = missing.reduce((s, f) => s + num(f.width, 10), 0) || 1
    let x = pad
    for (const f of missing) {
      const width = (inner * num(f.width, 10)) / total
      apply(f, x, y, width, boxHeight(String(f.id || ''), band, paperW))
      x += width
    }
    return
  }

  let perRow = 1
  if (band === 'meta') perRow = inner >= 140 ? 3 : inner >= 70 ? 2 : 1
  else if (band === 'totals') perRow = 1

  let row: Field[] = []
  const flush = () => {
    if (!row.length) return
    const cell = inner / row.length
    const height = Math.max(...row.map((f) => boxHeight(String(f.id || ''), band, paperW)))
    row.forEach((f, index) => apply(f, pad + index * cell, y, cell - 0.4, height))
    y += height + 0.6
    row = []
  }

  for (const f of missing) {
    const fid = String(f.id || '')
    if (band === 'header' || STACKED.has(fid) || fid.startsWith('static_')) {
      flush()
      row = [f]
      flush()
      continue
    }
    if (band === 'totals') {
      flush()
      apply(f, pad + inner * 0.45, y, inner * 0.55, boxHeight(fid, band, paperW))
      y += num(f.height_mm) + 0.4
      continue
    }
    row.push(f)
    if (row.length >= perRow) flush()
  }
  flush()
}

/** Scale every field so nothing sticks out past the paper edge. */
export function fitToPaper(bands: BandFields, paperW: number): void {
  const rights: number[] = []
  for (const id of BAND_IDS) {
    for (const f of bands[id] || []) {
      if (f.visible && placed(f)) rights.push(num(f.x_mm) + num(f.width_mm))
    }
  }
  if (!rights.length || Math.max(...rights) <= paperW + 0.4) return
  const ratio = paperW / Math.max(...rights)
  for (const id of BAND_IDS) {
    for (const f of bands[id] || []) {
      if (!placed(f)) continue
      f.x_mm = r1(Number(f.x_mm) * ratio)
      f.width_mm = r1(Math.max(6, num(f.width_mm, 10) * ratio))
      if (id === 'columns') f.width = f.width_mm
    }
  }
}

/** Stretch or shrink every box so the row stays inside the margin on both sides. */
export function fitFieldsToWidth(bands: BandFields, contentW: number): void {
  contentW = Math.max(12, Number(contentW))
  const rights: number[] = []
  for (const id of BAND_IDS) {
    for (const f of bands[id] || []) {
      if (f.visible && placed(f)) rights.push(num(f.x_mm) + num(f.width_mm))
    }
  }
  if (!rights.length) return
  const span = Math.max(...rights)
  if (span <= 0 || Math.abs(span - contentW) < 0.35) return
  const ratio = contentW / span
  for (const id of BAND_IDS) {
    for (const f of bands[id] || []) {
      if (!placed(f)) continue
      f.x_mm = r1(Math.max(0, Number(f.x_mm) * ratio))
      f.width_mm = r1(Math.max(0.1, num(f.width_mm, 10) * ratio))
      if (id === 'columns') f.width = f.width_mm
    }
  }
}

/** Row height the bill HTML actually prints (font size), not a stretched box. */
export function printLineMm(f: Field, band: string, paperW: number): number {
  let points: number
  const size = f.font_size_pt
  if (size === null || size === undefined) points = fontPt(String(f.id || ''), band, paperW)
  else {
    points = Number(size)
    if (!Number.isFinite(points)) points = fontPt(String(f.id || ''), band, paperW)
  }
  return Math.max(3.4, points * 0.3528 * 1.25 + 0.7)
}

/** Same row grouping as the print HTML: a Y gap does not become blank paper. */
export function rowsForPrint(fields: Field[]): Field[][] {
  const visible = fields.filter((f) => f.visible && placed(f))
  const rows: Field[][] = []
  const sorted = [...visible].sort((a, b) => num(a.y_mm) - num(b.y_mm) || num(a.x_mm) - num(b.x_mm))
  for (const f of sorted) {
    const y = num(f.y_mm)
    const last = rows[rows.length - 1]
    if (last && Math.abs(y - num(last[0].y_mm)) < 2.0) last.push(f)
    else rows.push([f])
  }
  return rows
}

/** Copy the stacked print positions into each field so they can move anywhere (Free placement). */
export function bakeStackedPositions(
  bands: BandFields,
  paperW: number,
  margins: [number, number, number, number],
  sampleLines = 3,
): void {
  const top = margins[1]
  let y = top
  for (const band of BAND_IDS) {
    const fields = (bands[band] || []).filter((f) => f.visible && placed(f))
    if (!fields.length) continue
    if (band === 'columns') {
      const height = Math.max(...fields.map((f) => printLineMm(f, band, paperW)))
      for (const f of fields) {
        f.y_mm = r1(Math.max(0, y - top))
        f.height_mm = r1(height)
      }
      y += height + height * sampleLines + 0.6
      continue
    }
    for (const row of rowsForPrint(fields)) {
      const height = Math.max(...row.map((f) => printLineMm(f, band, paperW)))
      for (const f of row) {
        f.y_mm = r1(Math.max(0, y - top))
        f.height_mm = r1(height)
      }
      y += height
    }
    y += 0.4
  }
}

/** Keep row order, drop vertical gaps the printer will not leave. */
export function normalizePrintY(fields: Field[]): void {
  rowsForPrint(fields).forEach((row, index) => {
    for (const f of row) f.y_mm = index * 3
  })
}

const SMALL_KEEP: Record<string, Set<string>> = {
  header: new Set(['hospital_name', 'bill_title', 'hospital_mobile']),
  meta: new Set(['patient_name', 'bill_no', 'bill_date', 'doctor_name']),
  columns: new Set(['name', 'qty', 'amount']),
  totals: new Set(['net_amount']),
  footer: new Set(['payment_mode', 'signature']),
}
const TINY_KEEP: Record<string, Set<string>> = {
  header: new Set(['hospital_name', 'bill_title']),
  meta: new Set(['patient_name', 'bill_no', 'bill_date']),
  columns: new Set(['name', 'amount']),
  totals: new Set(['net_amount']),
  footer: new Set(['payment_mode', 'signature']),
}

function clearGeometry(f: Field) {
  f.x_mm = null
  f.y_mm = null
  f.width_mm = null
  f.height_mm = null
}

/** Hide non-essential fields and reflow so content fits quarter-page stock. */
export function compactForSmallPaper(bands: BandFields, paperW: number, paperH: number, force = false): boolean {
  if (!force && !isSmallPaper(paperW, paperH)) return false
  const keep = paperW <= 80 || paperH <= 110 ? TINY_KEEP : SMALL_KEEP
  for (const band of BAND_IDS) {
    const fields = bands[band] || []
    const allowed = keep[band] || new Set<string>()
    for (const f of fields) {
      const fid = String(f.id || '')
      if (fid.startsWith('static_')) {
        if (f.visible) clearGeometry(f)
        continue
      }
      f.visible = allowed.has(fid)
      clearGeometry(f)
      if (allowed.has(fid) && band === 'header' && fid === 'hospital_name') f.align = 'center'
      if (fid === 'bill_title') f.align = 'center'
      if (f.visible && (f.font_size_pt === null || f.font_size_pt === undefined)) {
        f.font_size_pt = fontPt(fid, band, paperW)
      }
    }
    placeMissing(fields, band, paperW)
  }
  fitToPaper(bands, paperW)
  return true
}

/** Sort columns by dropped X position, then pack them left-to-right. */
export function reorderColumnsByX(fields: Field[], paperW: number): void {
  const visible = fields.filter((f) => f.visible)
  const hidden = fields.filter((f) => !f.visible)
  if (visible.length < 2) return
  visible.sort((a, b) => num(a.x_mm) - num(b.x_mm) || String(a.id).localeCompare(String(b.id)))
  packColumns(visible, paperW)
  fields.splice(0, fields.length, ...visible, ...hidden)
}

/** Pack visible columns left-to-right (in the given order), filling the paper width. */
export function packColumns(visible: Field[], paperW: number): void {
  if (!visible.length) return
  const pad = 1.5
  const inner = Math.max(30, paperW - pad * 2)
  const total = visible.reduce((s, f) => s + num(f.width_mm, num(f.width, 10)), 0) || 1
  const scale = inner / total
  const y = num(visible[0].y_mm, 1)
  const height = Math.max(...visible.map((f) => num(f.height_mm, 6)))
  let x = pad
  for (const f of visible) {
    const width = Math.max(6, num(f.width_mm, num(f.width, 10)) * scale)
    f.x_mm = r1(x)
    f.y_mm = r1(y)
    f.width_mm = r1(width)
    f.height_mm = r1(height)
    f.width = f.width_mm
    x += width
  }
}

/* ───────────────────────── preview text ───────────────────────── */

const HEADER_LABELED = new Set([
  'hospital_phone',
  'hospital_mobile',
  'hospital_email',
  'hospital_gstin',
  'hospital_registration_number',
  'hospital_website',
  'hospital_software_id',
])

export function previewText(field: Field, band: string, sample: Record<string, unknown>): string {
  let fid = String(field.id || '')
  if (fid.startsWith('copy_')) {
    fid = String(field.source_id || fid)
    field = { ...field, id: fid }
  }
  if (fid.startsWith('static_') || ['computer_note', 'signature', 'thanks', 'bill_title'].includes(fid)) {
    let text = String(field.text || field.label || '')
    if (fid === 'bill_title' && !String(field.text || '').trim()) {
      text = String(sample.bill_title || field.label || 'Bill')
    }
    return text
  }
  if (band === 'columns') return String(field.label || fid)
  const raw = sample[fid]
  const value = raw === null || raw === undefined ? '' : String(raw)
  if (band === 'header') {
    const text = value.trim()
    const label = String(field.label || '').trim()
    if (HEADER_LABELED.has(fid) && text && label) return `${label}: ${text}`
    return text || label
  }
  if (band === 'totals') {
    const label = String(field.label || '')
    return `${label}   ${value}`.trim()
  }
  if (!value.trim()) return String(field.label || fid)
  const label = String(field.label || '')
  return label ? `${label} : ${value}` : value
}

export function defaultBold(field: Field): boolean {
  const fid = String(field.id || '')
  return fid !== 'computer_note' && fid !== 'thanks' && !fid.startsWith('static_')
}

export function defaultUnderline(field: Field): boolean {
  return String(field.id || '') === 'bill_title'
}

/* ───────────────────────── print layout (field boxes in mm) ───────────────────────── */

export interface LayoutCtx {
  free: boolean
  fitDetail: boolean
  paperW: number
  paperH: number
  marginL: number
  marginT: number
  marginR: number
  marginB: number
  lineCount: number
}

export const keyOf = (band: string, id: string) => `${band}:${id}`

function applyFit(placedBoxes: Record<string, Box>, bottom: number, ctx: LayoutCtx, out: PrintLayout): PrintLayout {
  if (!ctx.fitDetail) return { ...out, placed: placedBoxes, bottom }
  const foot = Object.keys(placedBoxes).filter((k) => k.startsWith('totals:') || k.startsWith('footer:'))
  if (!foot.length) return { ...out, placed: placedBoxes, bottom }
  const footBottom = Math.max(...foot.map((k) => placedBoxes[k][1] + placedBoxes[k][3]))
  const slack = ctx.paperH - ctx.marginB - footBottom
  if (slack <= 0.4) return { ...out, placed: placedBoxes, bottom }
  let bandShift = out.bandShift
  if (out.shiftFrom < 1e8) bandShift += slack
  for (const k of foot) {
    const [x, y, w, h] = placedBoxes[k]
    placedBoxes[k] = [x, y + slack, w, h]
  }
  return { placed: placedBoxes, bottom: bottom + slack, bandShift, shiftFrom: out.shiftFrom }
}

function freeLayout(bands: BandFields, ctx: LayoutCtx): PrintLayout {
  const boxes: Record<string, Box> = {}
  let bottom = ctx.marginT
  const out: PrintLayout = { placed: boxes, bottom, bandShift: 0, shiftFrom: 1e9 }
  for (const band of BAND_IDS) {
    for (const f of bands[band] || []) {
      if (!f.visible || !placed(f)) continue
      const height = num(f.height_mm, printLineMm(f, band, ctx.paperW))
      const x = ctx.marginL + num(f.x_mm)
      const y = ctx.marginT + num(f.y_mm)
      const width = num(f.width_mm, 10)
      boxes[keyOf(band, String(f.id || ''))] = [x, y, width, height]
      const extra = band === 'columns' ? height * ctx.lineCount : 0
      bottom = Math.max(bottom, y + height + extra)
    }
  }
  const columns = Object.keys(boxes)
    .filter((k) => k.startsWith('columns:'))
    .map((k) => boxes[k])
  const footKeys = Object.keys(boxes).filter((k) => k.startsWith('totals:') || k.startsWith('footer:'))
  if (columns.length && footKeys.length) {
    const detailBottom = Math.max(...columns.map((b) => b[1] + b[3] * (1 + ctx.lineCount)))
    const footTop = Math.min(...footKeys.map((k) => boxes[k][1]))
    const shift = detailBottom + 0.8 - footTop
    if (shift > 0.4) {
      out.bandShift = shift
      out.shiftFrom = footTop
      for (const k of footKeys) {
        const [x, y, w, h] = boxes[k]
        boxes[k] = [x, y + shift, w, h]
      }
      bottom = Math.max(bottom, Math.max(...footKeys.map((k) => boxes[k][1] + boxes[k][3])))
    }
  }
  return applyFit(boxes, bottom, ctx, out)
}

/**
 * Field boxes in millimetres, stacked the way the printer draws them.
 * (Desktop advances Y once per band; we advance once per row so multi-row bands do not overlap.)
 */
export function computePrintLayout(bands: BandFields, ctx: LayoutCtx): PrintLayout {
  if (ctx.free) return freeLayout(bands, ctx)
  const boxes: Record<string, Box> = {}
  const out: PrintLayout = { placed: boxes, bottom: 0, bandShift: 0, shiftFrom: 1e9 }
  let y = ctx.marginT
  const left = ctx.marginL
  for (const band of BAND_IDS) {
    const fields = (bands[band] || []).filter((f) => f.visible && placed(f))
    if (!fields.length) continue
    if (band === 'columns') {
      const height = Math.max(...fields.map((f) => printLineMm(f, band, ctx.paperW)))
      for (const f of fields) {
        boxes[keyOf(band, String(f.id || ''))] = [left + num(f.x_mm), y, num(f.width_mm, 10), height]
      }
      y += height + height * ctx.lineCount + 0.6
      continue
    }
    for (const row of rowsForPrint(fields)) {
      const height = Math.max(...row.map((f) => printLineMm(f, band, ctx.paperW)))
      for (const f of row) {
        boxes[keyOf(band, String(f.id || ''))] = [left + num(f.x_mm), y, num(f.width_mm, 10), height]
      }
      y += height
    }
    y += 0.4
  }
  return applyFit(boxes, y, ctx, out)
}

/* ───────────────────────── shapes ───────────────────────── */

export const shapeKind = (s: Shape): string => {
  const k = String(s.kind || 'line')
  return k === 'line' || ['rect', 'square', 'ellipse', 'triangle', 'diamond', 'round'].includes(k) ? k : 'line'
}

export const shapeAngle = (s: Shape): number => {
  const a = Number(s.rotate_deg || 0)
  return Number.isFinite(a) ? ((a % 360) + 360) % 360 : 0
}

export function fieldById(bands: BandFields, id: string): Field | null {
  if (!id) return null
  for (const b of BAND_IDS) {
    for (const f of bands[b] || []) if (String(f.id || '') === id) return f
  }
  return null
}

/** Start x, start y and length in mm inside the margin. */
export function shapeSpan(shape: Shape, bands: BandFields): [number, number, number] {
  let x = num(shape.x_mm)
  let y = num(shape.y_mm)
  let length = Math.max(2, num(shape.length_mm, 20))
  if ((shape.mode || 'fixed') !== 'content') return [x, y, length]
  const f = fieldById(bands, String(shape.field_id || ''))
  if (!f) return [x, y, length]
  if (shape.axis === 'v') {
    if (placed(f)) y = num(f.y_mm) // field y
    const height = num(f.height_mm)
    if (height > 0) length = height
    return [x, y, Math.max(2, length)]
  }
  if (placed(f)) x = num(f.x_mm)
  const width = num(f.width_mm, num(f.width))
  if (width > 0) length = width
  return [x, y, Math.max(2, length)]
}

export interface ShapeCtx {
  bands: BandFields
  pl: PrintLayout
  marginL: number
  marginT: number
  lineCount: number
}

/** Detail-row boxes (header row + sample rows) in page mm. */
export function detailRowsMm(sc: ShapeCtx): Box[] {
  const boxes = (sc.bands.columns || [])
    .filter((f) => f.visible && placed(f))
    .map((f) => sc.pl.placed[keyOf('columns', String(f.id || ''))])
    .filter(Boolean)
  if (!boxes.length) return []
  const left = Math.min(...boxes.map((b) => b[0]))
  const right = Math.max(...boxes.map((b) => b[0] + b[2]))
  const top = Math.min(...boxes.map((b) => b[1]))
  const height = Math.max(...boxes.map((b) => b[3]))
  const width = Math.max(2, right - left)
  const rows: Box[] = [[left, top, width, height]]
  for (let i = 0; i < sc.lineCount; i++) rows.push([left, top + height * (i + 1), width, height])
  return rows
}

/** Page-millimetre boxes for a shape (more than one when repeated on every detail row). */
export function shapePageBoxes(shape: Shape, sc: ShapeCtx): Box[] {
  const kind = shapeKind(shape)
  const [xMm, yMm, length] = shapeSpan(shape, sc.bands)
  if (kind === 'line' && shape.repeat === 'detail') {
    const rows = detailRowsMm(sc)
    const boxes: Box[] = []
    for (const [, rowTop, rowW] of rows) {
      if (shape.axis === 'v') boxes.push([sc.marginL + xMm, rowTop + yMm, 0.4, length])
      else boxes.push([sc.marginL + xMm, rowTop + yMm, length || rowW, 0.4])
    }
    if (boxes.length) return boxes
  }
  let pageY = sc.marginT + yMm
  if (pageY >= sc.pl.shiftFrom - 0.2) pageY += sc.pl.bandShift
  const pageX = sc.marginL + xMm
  if (CLOSED.has(kind)) {
    const width = Math.max(2, num(shape.width_mm, length))
    const height = Math.max(2, num(shape.height_mm, width))
    return [[pageX, pageY, width, height]]
  }
  if (shape.axis === 'v') return [[pageX, pageY, 0.4, length]]
  return [[pageX, pageY, length, 0.4]]
}

const CLOSED = new Set(['rect', 'square', 'ellipse', 'triangle', 'diamond', 'round'])

/* ───────────────────────── prepare (desktop `set_bill`) ───────────────────────── */

export function contentWidth(paperW: number, marginL: number, marginR: number): number {
  return Math.max(12, paperW - marginL - marginR)
}

/** Place unplaced fields, normalise stacked Y and fit rows inside the margin. */
export function prepareBill(
  bands: BandFields,
  paperW: number,
  margins: { l: number; r: number },
  free: boolean,
): void {
  const cw = contentWidth(paperW, margins.l, margins.r)
  for (const band of BAND_IDS) {
    const fields = bands[band] || []
    placeMissing(fields, band, cw)
    if (band !== 'columns' && !free) normalizePrintY(fields)
  }
  fitFieldsToWidth(bands, cw)
}

export function bandOf(id: string): BandId | undefined {
  return BAND_IDS.find((b) => b === id)
}
