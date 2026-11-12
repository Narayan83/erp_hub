export type LayoutAlign = 'left' | 'center' | 'right'
export type LayoutKind = 'bill' | 'report' | 'barcode'
export type BandId = 'header' | 'meta' | 'columns' | 'totals' | 'footer'
export type PageOrientation = 'portrait' | 'landscape'

export type LayoutField = {
  id: string
  visible: boolean
  label?: string
  align?: LayoutAlign
  width?: number
  full_row?: boolean
  prefix?: string
  text?: string
  bold?: boolean
  band?: string
  fontFamily?: string
  fontSizePt?: number
  border?: boolean
  xMm?: number
  yMm?: number
  widthMm?: number
  heightMm?: number
  paddingLeftMm?: number
  paddingRightMm?: number
  paddingTopMm?: number
  paddingBottomMm?: number
}

export type PagePadding = {
  paddingLeftMm: number
  paddingRightMm: number
  paddingTopMm: number
  paddingBottomMm: number
}

export type BandLayout = {
  header: LayoutField[]
  meta: LayoutField[]
  columns: LayoutField[]
  totals: LayoutField[]
  footer: LayoutField[]
}

export type BarcodeLayoutField = {
  id: string
  label: string
  source: string
  enabled: boolean
  bold?: boolean
}

export type CustomPage = {
  name: string
  widthMm: number
  heightMm: number
}

export type DocumentLayout = {
  version?: number
  kind: LayoutKind
  formats?: Record<string, BandLayout>
  fields?: BarcodeLayoutField[]
  default_layout?: string
  gaps?: Record<
    string,
    { gap_left_mm: number; gap_right_mm: number; gap_bottom_mm: number; show_border: boolean }
  >
  canvases?: Record<string, unknown>
  page_borders?: Record<string, boolean>
  page_paddings?: Record<string, Partial<PagePadding>>
  page_orientations?: Record<string, PageOrientation>
  custom_pages?: Record<string, CustomPage>
  sheet?: Record<string, unknown>
}

export type CatalogDoc = { code: string; name: string; kind: LayoutKind }
export type CatalogField = { id: string; label: string; band: BandId }

export type LayoutCatalog = {
  documents: CatalogDoc[]
  formats: { code: string; name: string }[]
  bands: BandId[]
  catalogs: {
    bill: CatalogField[]
    report: CatalogField[]
  }
}

export const BAND_LABELS: Record<BandId, string> = {
  header: 'Header (company / title)',
  meta: 'Bill details (customer, date, number)',
  columns: 'Item columns',
  totals: 'Totals',
  footer: 'Footer (payment, terms, signature)',
}

export function emptyBand(): BandLayout {
  return { header: [], meta: [], columns: [], totals: [], footer: [] }
}

export function bandOf(layout: DocumentLayout, format: string): BandLayout {
  return layout.formats?.[format] || emptyBand()
}

export function reorderById<T extends { id: string }>(list: T[], fromId: string, toId: string): T[] {
  const from = list.findIndex((x) => x.id === fromId)
  const to = list.findIndex((x) => x.id === toId)
  if (from < 0 || to < 0 || from === to) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function patchBand(
  layout: DocumentLayout,
  format: string,
  band: BandId,
  fields: LayoutField[],
): DocumentLayout {
  const current = bandOf(layout, format)
  return {
    ...layout,
    formats: {
      ...(layout.formats || {}),
      [format]: { ...current, [band]: fields },
    },
  }
}

export function newStaticId() {
  return `static_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`
}

export const LAYOUT_FONTS = [
  'Arial',
  'Times New Roman',
  'Calibri',
  'Tahoma',
  'Verdana',
  'Courier New',
] as const

export function isCustomFormat(format: string): boolean {
  return format.toUpperCase().startsWith('CUSTOM_')
}

export function customPagesOf(layout?: DocumentLayout | null): Record<string, CustomPage> {
  const src = layout?.custom_pages
  if (!src) return {}
  const out: Record<string, CustomPage> = {}
  for (const [rawCode, raw] of Object.entries(src)) {
    const code = String(rawCode || '')
      .trim()
      .toUpperCase()
      .replace(/-/g, '_')
      .replace(/\s+/g, '')
    if (!isCustomFormat(code) || !raw) continue
    const widthMm = Math.max(40, Math.min(400, Number(raw.widthMm) || 0))
    const heightMm = Math.max(40, Math.min(600, Number(raw.heightMm) || 0))
    if (!(widthMm && heightMm)) continue
    out[code] = {
      name: String(raw.name || code.replace(/^CUSTOM_/, '').replace(/_/g, ' ')).slice(0, 80),
      widthMm: Math.round(widthMm * 10) / 10,
      heightMm: Math.round(heightMm * 10) / 10,
    }
  }
  return out
}

export function newCustomPageId(name: string, layout?: DocumentLayout | null): string {
  const slug =
    (name || 'PAGE')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 18) || 'PAGE'
  const used = new Set(Object.keys(customPagesOf(layout)))
  let id = `CUSTOM_${slug}`
  let n = 2
  while (used.has(id)) {
    id = `CUSTOM_${slug}_${n}`
    n += 1
  }
  return id
}

export function paperWidthMm(format: string, layout?: DocumentLayout | null): number {
  const custom = customPagesOf(layout)[format]
  if (custom) return custom.widthMm
  switch (format) {
    case 'A5':
      return 210
    case 'THERMAL_80':
      return 80
    case 'THERMAL_58':
      return 58
    default:
      return 210
  }
}

export function paperHeightMm(format: string, layout?: DocumentLayout | null): number {
  const custom = customPagesOf(layout)[format]
  if (custom) return custom.heightMm
  switch (format) {
    case 'A5':
      return 148
    case 'THERMAL_80':
    case 'THERMAL_58':
      return 0
    default:
      return 297
  }
}

export function pageOrientationOf(layout: DocumentLayout, format: string): PageOrientation {
  if (format.startsWith('THERMAL')) return 'portrait'
  return layout.page_orientations?.[format] === 'landscape' ? 'landscape' : 'portrait'
}

export function orientedPaperMm(
  format: string,
  orientation: PageOrientation = 'portrait',
  layout?: DocumentLayout | null,
): { widthMm: number; heightMm: number } {
  const widthMm = paperWidthMm(format, layout)
  const heightMm = paperHeightMm(format, layout) || Math.round(widthMm * 1.414 * 10) / 10
  if (orientation === 'landscape' && !format.startsWith('THERMAL')) {
    return { widthMm: heightMm, heightMm: widthMm }
  }
  return { widthMm, heightMm }
}

export function defaultPagePadding(format: string): PagePadding {
  if (format.startsWith('THERMAL')) {
    return { paddingLeftMm: 2, paddingRightMm: 2, paddingTopMm: 2, paddingBottomMm: 2 }
  }
  if (format === 'A5') {
    return { paddingLeftMm: 6, paddingRightMm: 6, paddingTopMm: 6, paddingBottomMm: 6 }
  }
  return { paddingLeftMm: 8, paddingRightMm: 8, paddingTopMm: 8, paddingBottomMm: 8 }
}

export function pagePaddingOf(layout: DocumentLayout, format: string): PagePadding {
  const stored = layout.page_paddings?.[format] || {}
  const fallback = defaultPagePadding(format)
  const num = (value: unknown, fallbackValue: number) => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.max(0, Math.min(40, n)) : fallbackValue
  }
  return {
    paddingLeftMm: num(stored.paddingLeftMm, fallback.paddingLeftMm),
    paddingRightMm: num(stored.paddingRightMm, fallback.paddingRightMm),
    paddingTopMm: num(stored.paddingTopMm, fallback.paddingTopMm),
    paddingBottomMm: num(stored.paddingBottomMm, fallback.paddingBottomMm),
  }
}

export function pageSpec(
  format: string,
  padding?: Partial<PagePadding> | null,
  orientation: PageOrientation = 'portrait',
  layout?: DocumentLayout | null,
): { innerMm: number; scale: number; paperMm: number; paperHeightMm: number; orientation: PageOrientation } {
  const pad = {
    ...defaultPagePadding(format),
    ...(padding || {}),
  }
  const paper = orientedPaperMm(format, orientation, layout)
  const paperMm = paper.widthMm
  const innerMm = Math.max(20, Math.round((paperMm - pad.paddingLeftMm - pad.paddingRightMm) * 10) / 10)
  const scale = format.startsWith('THERMAL_58')
    ? 5.4
    : format.startsWith('THERMAL_80')
      ? 4.4
      : paperMm >= 190
        ? 2.5
        : 3.2
  return { innerMm, scale, paperMm, paperHeightMm: paper.heightMm, orientation }
}

export function pageSpecOf(layout: DocumentLayout, format: string) {
  return pageSpec(format, pagePaddingOf(layout, format), pageOrientationOf(layout, format), layout)
}

function roundMm(n: number) {
  return Math.round(n * 10) / 10
}

export function fieldHasPlace(field: LayoutField): boolean {
  return field.xMm != null && Number.isFinite(field.xMm)
}

export function bandIsPlaced(fields: LayoutField[]): boolean {
  return fields.some((f) => f.visible && fieldHasPlace(f))
}

export function clearFieldPlaces(fields: LayoutField[]): LayoutField[] {
  return fields.map((field) => {
    const next = { ...field }
    delete next.xMm
    delete next.yMm
    delete next.widthMm
    delete next.heightMm
    return next
  })
}

function defaultBox(id: string, format: string): { h: number; font: number } {
  const thermal = format.startsWith('THERMAL')
  if (id === 'company_logo') return { h: thermal ? 12 : 18, font: 10 }
  if (id === 'company_name') return { h: thermal ? 8 : 10, font: thermal ? 12 : 16 }
  if (id === 'company_address' || id === 'terms') return { h: thermal ? 10 : 14, font: thermal ? 8 : 9 }
  if (id === 'tax_invoice_title' || id === 'bill_title' || id === 'report_title') {
    return { h: 7, font: thermal ? 11 : 12 }
  }
  if (id === 'you_save') return { h: thermal ? 6 : 7, font: thermal ? 11 : 12 }
  if (id === 'signature' || id === 'payment_summary') return { h: 14, font: 10 }
  if (id === 'amount_in_words') return { h: 8, font: 9 }
  return { h: thermal ? 5.5 : 6.5, font: thermal ? 9 : 11 }
}

export function autoPlaceBand(
  fields: LayoutField[],
  format: string,
  bandId: BandId,
  innerMmOverride?: number,
): LayoutField[] {
  const { innerMm } = pageSpec(format)
  const inner = innerMmOverride ?? innerMm
  const thermal = format.startsWith('THERMAL')
  const pad = 1
  const next = fields.map((f) => ({ ...f }))
  const visible = next.filter((f) => f.visible)
  if (!visible.length) return next

  const apply = (field: LayoutField, x: number, y: number, w: number, h: number, font: number) => {
    field.xMm = Math.round(x * 10) / 10
    field.yMm = Math.round(y * 10) / 10
    field.widthMm = Math.round(w * 10) / 10
    field.heightMm = Math.round(h * 10) / 10
    if (!field.fontFamily) field.fontFamily = thermal ? 'Courier New' : 'Times New Roman'
    if (field.fontSizePt == null) field.fontSizePt = font
  }

  if (bandId === 'columns') {
    const totalW = visible.reduce((sum, f) => sum + (f.width || 10), 0) || 1
    let x = pad
    const usable = inner - pad * 2
    for (const field of visible) {
      const w = ((field.width || 10) / totalW) * usable
      apply(field, x, pad, w, thermal ? 6 : 7, thermal ? 8 : 10)
      field.width = Math.max(2, Math.min(400, Math.round(w)))
      x += w
    }
    return next
  }

  const perRow = bandId === 'header' ? 1 : bandId === 'totals' ? (thermal ? 1 : 2) : thermal ? 2 : 3
  const stackedIds = new Set([
    'company_logo',
    'company_name',
    'company_address',
    'tax_invoice_title',
    'bill_title',
    'report_title',
    'terms',
    'thanks',
    'computer_note',
    'amount_in_words',
    'you_save',
    'signature',
    'payment_summary',
  ])

  let y = pad
  let row: LayoutField[] = []
  const flush = () => {
    if (!row.length) return
    const cellW = (inner - pad * 2) / row.length
    let rowH = 6
    row.forEach((field, i) => {
      const size = defaultBox(field.id, format)
      rowH = Math.max(rowH, size.h)
      const w = field.full_row || row.length === 1 ? inner - pad * 2 : cellW - 0.6
      apply(field, pad + i * cellW, y, w, size.h, size.font)
    })
    y += rowH + 0.8
    row = []
  }

  for (const field of visible) {
    const alone = !!field.full_row || stackedIds.has(field.id) || field.id.startsWith('static_')
    if (alone) {
      flush()
      row = [field]
      flush()
    } else {
      row.push(field)
      if (row.length >= perRow) flush()
    }
  }
  flush()
  return next
}

/** Pack columns left, then stretch their millimetre widths so they fill the printable inner width. */
export function packColumnsFill(fields: LayoutField[], format: string, innerMm: number): LayoutField[] {
  const usable = Math.max(2, innerMm - 2)
  const next = fields.map((f) => ({ ...f }))
  const visible = next.filter((f) => f.visible)
  const sum = visible.reduce((s, f) => s + Math.max(2, f.widthMm ?? f.width ?? 10), 0)
  if (visible.length && sum > 0) {
    const ratio = usable / sum
    for (const field of visible) {
      const w = Math.max(2, (field.widthMm ?? field.width ?? 10) * ratio)
      field.widthMm = roundMm(w)
      field.width = Math.max(2, Math.min(400, Math.round(w)))
    }
  }
  return packColumnsLeft(next, format, innerMm)
}

/** Keep each column's millimetre width and pack them left. Do not stretch to fill the page. */
export function packColumnsLeft(fields: LayoutField[], format: string, innerMm?: number): LayoutField[] {
  const usable = (innerMm ?? pageSpec(format).innerMm) - 2
  const thermal = format.startsWith('THERMAL')
  const next = fields.map((f) => ({ ...f }))
  const visible = next.filter((f) => f.visible)
  let x = 1
  for (const field of visible) {
    const fallback = Math.max(2, field.width || 10)
    let w = Math.max(2, field.widthMm ?? fallback)
    const maxW = Math.max(2, usable - (x - 1))
    w = Math.min(w, maxW)
    field.xMm = roundMm(x)
    field.yMm = 1
    field.widthMm = roundMm(w)
    field.heightMm = field.heightMm || (thermal ? 6 : 7)
    field.width = Math.max(2, Math.min(400, Math.round(w)))
    if (!field.fontFamily) field.fontFamily = thermal ? 'Courier New' : 'Times New Roman'
    if (field.fontSizePt == null) field.fontSizePt = thermal ? 8 : 10
    x += w
  }
  return next
}

const SAMPLE_FIELD_TEXT: Record<string, string> = {
  company_name: 'Sample Traders',
  company_logo: 'Logo',
  company_address: '12 Market Street\nChennai, 600001',
  company_phone_email: 'Tel: 044-12345678 | Email: shop@example.com',
  company_phone: 'MOB : 044-12345678',
  company_email: 'Email : shop@example.com',
  company_gstin: 'GSTIN : 33BBBBB0000B1Z2',
  company_website: 'www.example.com',
  tax_invoice_title: 'TAX INVOICE',
  bill_title: 'Tax Invoice / Sale Bill',
  report_title: 'Daily Collection Report',
  customer_name: 'Customer : Sample Customer',
  customer_mobile: 'Mobile : 9876543210',
  customer_gstin: 'GSTIN : 33AAAAA0000A1Z5',
  cash_credit: 'Cash / Credit : Cash',
  bill_no: 'Bill No : SB-001',
  bill_date: 'Date : 27/08/2026',
  date_range: 'From 27/08/2026 to 27/08/2026',
  bill_range: 'Bill SB-001 to SB-015',
  gross_amount: 'Gross : 1300.00',
  discount_amount: 'Discount : 20.00',
  tax_total: 'Tax : 64.00',
  net_amount: 'Total : 1180.00',
  paid_amount: 'Paid : 1180.00',
  credit_amount: 'Credit : 0.00',
  payment_mode: 'Mode : Cash',
  paid_due: 'Paid 1180.00   Due 0.00',
  amount_in_words: 'Rupees One Thousand One Hundred Eighty only',
  narration: 'Sample preview bill',
  terms: 'Goods once sold will not be taken back.',
  thanks: 'THANK YOU VISIT AGAIN',
  computer_note: 'This is a computer generated invoice.',
  signature: 'Authorised Signatory',
  for_company: 'for: Sample Traders',
  you_save: 'You Save : 355.00',
  gst_split: 'CGST : 32.00   SGST : 32.00',
  payment_summary: 'Collection by payment mode',
}

export function sampleFieldText(field: LayoutField): string {
  if (field.text) return field.text
  if (SAMPLE_FIELD_TEXT[field.id]) return SAMPLE_FIELD_TEXT[field.id]
  return field.label || field.id
}

export function setPageBorder(layout: DocumentLayout, format: string, enabled: boolean): DocumentLayout {
  return {
    ...layout,
    page_borders: { ...(layout.page_borders || {}), [format]: enabled },
  }
}

export function setPagePadding(
  layout: DocumentLayout,
  format: string,
  patch: Partial<PagePadding>,
): DocumentLayout {
  const current = pagePaddingOf(layout, format)
  return {
    ...layout,
    page_paddings: {
      ...(layout.page_paddings || {}),
      [format]: { ...current, ...patch },
    },
  }
}

export function setPageOrientation(
  layout: DocumentLayout,
  format: string,
  orientation: PageOrientation,
): DocumentLayout {
  const next = format.startsWith('THERMAL') ? 'portrait' : orientation
  const orients = { ...(layout.page_orientations || {}) }
  if (next === 'landscape') orients[format] = 'landscape'
  else delete orients[format]
  return { ...layout, page_orientations: orients }
}

export function addCustomPage(
  layout: DocumentLayout,
  fromFormat: string,
  name: string,
  widthMm: number,
  heightMm: number,
): { layout: DocumentLayout; code: string } {
  const code = newCustomPageId(name, layout)
  const source = layout.formats?.[fromFormat] || layout.formats?.A4
  const pages = { ...customPagesOf(layout), [code]: { name: name.trim() || 'Custom', widthMm, heightMm } }
  const next: DocumentLayout = {
    ...layout,
    custom_pages: pages,
    formats: source ? { ...(layout.formats || {}), [code]: structuredClone(source) } : layout.formats,
    page_paddings: {
      ...(layout.page_paddings || {}),
      [code]: structuredClone(layout.page_paddings?.[fromFormat] || pagePaddingOf(layout, fromFormat)),
    },
    page_borders: { ...(layout.page_borders || {}), [code]: !!(layout.page_borders || {})[fromFormat] },
  }
  if (layout.page_orientations?.[fromFormat] === 'landscape') {
    next.page_orientations = { ...(layout.page_orientations || {}), [code]: 'landscape' }
  }
  return { layout: fitLayoutToPage(next, code, pageSpecOf(layout, fromFormat).innerMm), code }
}

export function removeCustomPage(layout: DocumentLayout, code: string): DocumentLayout {
  if (!isCustomFormat(code)) return layout
  const custom_pages = { ...customPagesOf(layout) }
  delete custom_pages[code]
  const formats = { ...(layout.formats || {}) }
  delete formats[code]
  const page_paddings = { ...(layout.page_paddings || {}) }
  delete page_paddings[code]
  const page_borders = { ...(layout.page_borders || {}) }
  delete page_borders[code]
  const page_orientations = { ...(layout.page_orientations || {}) }
  delete page_orientations[code]
  return {
    ...layout,
    custom_pages,
    formats,
    page_paddings,
    page_borders,
    page_orientations,
  }
}

export function clampBandToPage(fields: LayoutField[], innerMm: number): LayoutField[] {
  return fields.map((field) => {
    if (!field.visible || field.xMm == null) return field
    const widthMm = Math.min(Math.max(2, field.widthMm || 20), innerMm)
    const xMm = Math.min(Math.max(0, field.xMm), Math.max(0, innerMm - widthMm))
    return { ...field, xMm: roundMm(xMm), widthMm: roundMm(widthMm) }
  })
}

export function contentRightMm(fields: LayoutField[]): number {
  const vis = fields.filter((f) => f.visible && f.xMm != null)
  if (!vis.length) return 0
  return Math.max(...vis.map((f) => (f.xMm || 0) + (f.widthMm || 20)))
}

export function scaleBandToInner(fields: LayoutField[], fromInner: number, toInner: number): LayoutField[] {
  if (!(toInner > 0)) return fields
  const from = fromInner > 0.5 ? fromInner : toInner
  if (Math.abs(toInner - from) < 0.2) return clampBandToPage(fields, toInner)
  const ratio = toInner / from
  const scaled = fields.map((field) => {
    if (!field.visible || field.xMm == null) return field
    const widthMm = Math.max(2, (field.widthMm || 20) * ratio)
    const xMm = Math.max(0, (field.xMm || 0) * ratio)
    const next: LayoutField = { ...field, xMm: roundMm(xMm), widthMm: roundMm(widthMm) }
    if (field.width != null) next.width = Math.max(2, Math.min(400, Math.round(widthMm)))
    return next
  })
  return clampBandToPage(scaled, toInner)
}

const FIT_BANDS: BandId[] = ['header', 'meta', 'columns', 'totals', 'footer']

/** Stretch placed fields across the printable inner width (paper minus margins). */
export function fitLayoutToPage(layout: DocumentLayout, format: string, fromInnerMm?: number): DocumentLayout {
  const spec = pageSpecOf(layout, format)
  const toInner = spec.innerMm
  const pageFrom =
    fromInnerMm != null && fromInnerMm > 0.5 && Math.abs(fromInnerMm - toInner) >= 0.2 ? fromInnerMm : 0
  let next = layout
  const band = bandOf(next, format)
  for (const bandId of FIT_BANDS) {
    let fields = band[bandId] || []
    if (!fields.length || !bandIsPlaced(fields)) continue
    const from = pageFrom || contentRightMm(fields) || toInner
    fields = scaleBandToInner(fields, from, toInner)
    if (bandId === 'columns') {
      fields = packColumnsFill(fields, format, toInner)
    }
    next = patchBand(next, format, bandId, fields)
  }
  return next
}

export function layoutNeedsFit(layout: DocumentLayout, format: string): boolean {
  const inner = pageSpecOf(layout, format).innerMm
  const band = bandOf(layout, format)
  return FIT_BANDS.some((id) => {
    const fields = band[id] || []
    if (!bandIsPlaced(fields)) return false
    const right = contentRightMm(fields)
    return right > 4 && right < inner - 6
  })
}
