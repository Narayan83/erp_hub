import JsBarcode from 'jsbarcode'
import type { CompanyProfile, Product } from '../../generpTypes'

/** 1 inch = 25.4 mm */
export const INCH_MM = 25.4

export function formatMm(mm: number): string {
  const n = Math.round(Number(mm) * 10) / 10
  if (!Number.isFinite(n)) return '0'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function formatCm(mm: number): string {
  const cm = Math.round((Number(mm) / 10) * 100) / 100
  if (!Number.isFinite(cm)) return '0'
  return String(cm)
}

/** e.g. 50.8 mm (5.08 cm) */
export function mmWithCm(mm: number): string {
  return `${formatMm(mm)} mm (${formatCm(mm)} cm)`
}

/** e.g. 50.8 × 25.4 mm (5.08 × 2.54 cm) */
export function sizeMmCm(widthMm: number, heightMm: number): string {
  return `${formatMm(widthMm)} × ${formatMm(heightMm)} mm (${formatCm(widthMm)} × ${formatCm(heightMm)} cm)`
}

export type BarcodeLayoutId = 'DOUBLE' | 'SINGLE' | 'MINI' | 'CUSTOM'

export type BarcodeFieldSource =
  | 'name'
  | 'code'
  | 'barcode'
  | 'mrp'
  | 'sale_price'
  | 'wholesale_price'
  | 'hsn_code'
  | 'category_name'
  | 'custom'
  | 'expiry'
  | 'company_name'
  | 'company_address_line1'
  | 'company_address_line2'
  | 'company_address_line3'
  | 'company_address_line4'
  | 'company_city'
  | 'company_state'
  | 'company_pin'
  | 'company_phone'
  | 'company_mobile'
  | 'company_email'
  | 'company_website'
  | 'company_gstin'
  | 'company_software_id'
  | 'company_address'
  | 'company_logo'

export type BarcodeFieldMapping = {
  id: string
  label: string
  source: BarcodeFieldSource
  enabled: boolean
  bold?: boolean
}

export type BarcodeGapSettings = {
  gap_left_mm: number
  gap_right_mm: number
  /** Space after the sticker on the roll (physical gap between labels). */
  gap_bottom_mm: number
  show_border: boolean
}

export type TextAlign = 'left' | 'center' | 'right'

export type CanvasBox = {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
}

export type CanvasTextBox = CanvasBox & {
  fontFamily: string
  fontSizePt: number
  bold: boolean
  align: TextAlign
}

export type BarcodeBox = CanvasBox & {
  showText: boolean
  /** Human-readable digits under the bars (pt). */
  fontSizePt: number
}

export type BarcodeCanvas = {
  fields: Record<string, CanvasTextBox>
  barcode: BarcodeBox
  border: CanvasBox & { enabled: boolean }
}

export type BarcodeSheetSpec = {
  /** Full strip width: all stickers in a row plus column gaps. */
  totalWidthMm: number
  columns: number
  columnGapMm: number
  /** Sticker height (does not include row gap). */
  heightMm: number
  rowGapMm: number
}

export type BarcodeLabelSettings = {
  fields: BarcodeFieldMapping[]
  default_layout: BarcodeLayoutId
  gaps: Record<BarcodeLayoutId, BarcodeGapSettings>
  canvases?: Partial<Record<BarcodeLayoutId, BarcodeCanvas>>
  sheet?: BarcodeSheetSpec
}

export const LABEL_FONTS = [
  'Arial',
  'Times New Roman',
  'Calibri',
  'Tahoma',
  'Verdana',
  'Courier New',
] as const

export const SAMPLE_LABEL_PRODUCT: Product = {
  id: 'sample',
  name: 'LEHANGA',
  code: '10',
  barcode: '000010000230',
  mrp: 230,
  sale_price: 230,
  wholesale_price: 200,
  hsn_code: '6104',
  category_name: 'Apparel',
}

export const SAMPLE_COMPANY: CompanyProfile = {
  name: 'Sample Traders',
  address_line1: '12 Market Road',
  address_line2: 'Near Bus Stand',
  city: 'Chennai',
  state: 'Tamil Nadu',
  pin_code: '600001',
  phone: '044-12345678',
  mobile: '9876543210',
  email: 'shop@example.com',
  website: 'www.example.com',
  gstin: '33AAAAA0000A1Z5',
  software_id: 'GEN001',
}

export const DEFAULT_BARCODE_GAP: BarcodeGapSettings = {
  gap_left_mm: 0,
  gap_right_mm: 0,
  /** 0 = sticker size only; thermal printers skip the liner gap themselves. */
  gap_bottom_mm: 0,
  show_border: false,
}

export function emptyLayoutGaps(): Record<BarcodeLayoutId, BarcodeGapSettings> {
  return {
    DOUBLE: { ...DEFAULT_BARCODE_GAP },
    SINGLE: { ...DEFAULT_BARCODE_GAP },
    MINI: { ...DEFAULT_BARCODE_GAP },
    CUSTOM: { ...DEFAULT_BARCODE_GAP },
  }
}

export const DEFAULT_SHEET: BarcodeSheetSpec = {
  totalWidthMm: 101.6,
  columns: 2,
  columnGapMm: 2,
  heightMm: 25.4,
  rowGapMm: 0,
}

function clampSheetMm(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.max(min, Math.min(max, n)) * 10) / 10
}

export function parseSheet(raw: unknown): BarcodeSheetSpec {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const columnsRaw = Number(o.columns)
  return {
    totalWidthMm: clampSheetMm(o.totalWidthMm ?? o.total_width_mm, DEFAULT_SHEET.totalWidthMm, 20, 400),
    columns: Number.isFinite(columnsRaw) ? Math.max(1, Math.min(8, Math.round(columnsRaw))) : DEFAULT_SHEET.columns,
    columnGapMm: clampSheetMm(o.columnGapMm ?? o.column_gap_mm, DEFAULT_SHEET.columnGapMm, 0, 40),
    heightMm: clampSheetMm(o.heightMm ?? o.height_mm, DEFAULT_SHEET.heightMm, 8, 150),
    rowGapMm: clampSheetMm(o.rowGapMm ?? o.row_gap_mm, DEFAULT_SHEET.rowGapMm, 0, 40),
  }
}

/** Width of one sticker from the custom sheet. */
export function stickerWidthMm(sheet: BarcodeSheetSpec): number {
  const cols = Math.max(1, sheet.columns)
  const usable = sheet.totalWidthMm - (cols - 1) * sheet.columnGapMm
  return Math.round(Math.max(8, usable / cols) * 10) / 10
}

export function clampGapMm(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.max(0, Math.min(20, n)) * 10) / 10
}

function parseGapBlock(raw: unknown): BarcodeGapSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const hasBottom = Object.prototype.hasOwnProperty.call(o, 'gap_bottom_mm')
  return {
    gap_left_mm: clampGapMm(o.gap_left_mm, DEFAULT_BARCODE_GAP.gap_left_mm),
    gap_right_mm: clampGapMm(o.gap_right_mm, DEFAULT_BARCODE_GAP.gap_right_mm),
    gap_bottom_mm: clampGapMm(o.gap_bottom_mm, hasBottom ? 0 : DEFAULT_BARCODE_GAP.gap_bottom_mm),
    show_border: Boolean(o.show_border),
  }
}

export function gapsFor(settings: BarcodeLabelSettings, layoutId: BarcodeLayoutId): BarcodeGapSettings {
  return settings.gaps?.[layoutId] ?? { ...DEFAULT_BARCODE_GAP }
}

export type BarcodeLayout = {
  id: BarcodeLayoutId
  title: string
  /** Label width in mm (50.8 mm / 2 inch default) */
  widthMm: number
  /** Label height in mm */
  heightMm: number
  perRow: number
  columnGapMm: number
  rowGapMm: number
  showBarcodeText: boolean
  showFields: boolean
  barHeight: number
  fontSize: number
  previewScale: number
}

export const BARCODE_LAYOUTS: Record<BarcodeLayoutId, BarcodeLayout> = {
  DOUBLE: {
    id: 'DOUBLE',
    title: 'Double — 2 per row',
    widthMm: 2 * INCH_MM,
    heightMm: 1 * INCH_MM,
    perRow: 2,
    columnGapMm: 0,
    rowGapMm: 0,
    showBarcodeText: true,
    showFields: true,
    barHeight: 26,
    fontSize: 7,
    previewScale: 1.15,
  },
  SINGLE: {
    id: 'SINGLE',
    title: 'Single — 1 per row',
    widthMm: 2 * INCH_MM,
    heightMm: 1 * INCH_MM,
    perRow: 1,
    columnGapMm: 0,
    rowGapMm: 0,
    showBarcodeText: true,
    showFields: true,
    barHeight: 30,
    fontSize: 8,
    previewScale: 1.2,
  },
  MINI: {
    id: 'MINI',
    title: 'Mini — barcode only',
    widthMm: 2 * INCH_MM,
    heightMm: 10,
    perRow: 1,
    columnGapMm: 0,
    rowGapMm: 0,
    showBarcodeText: true,
    showFields: false,
    barHeight: 14,
    fontSize: 6,
    previewScale: 1.25,
  },
  CUSTOM: {
    id: 'CUSTOM',
    title: 'Custom — set width, columns, gaps',
    widthMm: 49.8,
    heightMm: 25.4,
    perRow: 2,
    columnGapMm: 2,
    rowGapMm: 0,
    showBarcodeText: true,
    showFields: true,
    barHeight: 26,
    fontSize: 8,
    previewScale: 1.15,
  },
}

export function resolveLayout(settings: BarcodeLabelSettings, layoutId: BarcodeLayoutId): BarcodeLayout {
  if (layoutId !== 'CUSTOM') {
    const base = BARCODE_LAYOUTS[layoutId] || BARCODE_LAYOUTS.SINGLE
    return { ...base, rowGapMm: gapsFor(settings, layoutId).gap_bottom_mm }
  }
  const sheet = parseSheet(settings.sheet)
  const widthMm = stickerWidthMm(sheet)
  return {
    id: 'CUSTOM',
    title: `Custom — ${sheet.columns} per row (${sizeMmCm(widthMm, sheet.heightMm)})`,
    widthMm,
    heightMm: sheet.heightMm,
    perRow: sheet.columns,
    columnGapMm: sheet.columnGapMm,
    rowGapMm: sheet.rowGapMm,
    showBarcodeText: true,
    showFields: true,
    barHeight: Math.max(12, Math.round(sheet.heightMm * 0.9)),
    fontSize: 8,
    previewScale: 1.15,
  }
}

export const FIELD_SOURCE_GROUPS: { label: string; options: { value: BarcodeFieldSource; text: string }[] }[] = [
  {
    label: 'Product',
    options: [
      { value: 'name', text: 'Product name (heading)' },
      { value: 'code', text: 'Product code' },
      { value: 'barcode', text: 'Barcode number' },
      { value: 'mrp', text: 'MRP' },
      { value: 'sale_price', text: 'Sale rate' },
      { value: 'wholesale_price', text: 'Wholesale rate' },
      { value: 'hsn_code', text: 'HSN code' },
      { value: 'category_name', text: 'Category' },
    ],
  },
  {
    label: 'Company',
    options: [
      { value: 'company_logo', text: 'Company logo' },
      { value: 'company_name', text: 'Company name' },
      { value: 'company_address', text: 'Full address' },
      { value: 'company_address_line1', text: 'Address line 1' },
      { value: 'company_address_line2', text: 'Address line 2' },
      { value: 'company_address_line3', text: 'Address line 3' },
      { value: 'company_address_line4', text: 'Address line 4' },
      { value: 'company_city', text: 'City' },
      { value: 'company_state', text: 'State' },
      { value: 'company_pin', text: 'PIN' },
      { value: 'company_phone', text: 'Phone' },
      { value: 'company_mobile', text: 'Mobile' },
      { value: 'company_email', text: 'Email' },
      { value: 'company_website', text: 'Website' },
      { value: 'company_gstin', text: 'GSTIN' },
      { value: 'company_software_id', text: 'Software ID' },
    ],
  },
  {
    label: 'Enter at print',
    options: [
      { value: 'expiry', text: 'Expiry date (enter at print)' },
      { value: 'custom', text: 'Custom text (enter at print)' },
    ],
  },
]

export const FIELD_SOURCE_OPTIONS: { value: BarcodeFieldSource; text: string }[] = FIELD_SOURCE_GROUPS.flatMap(
  (g) => g.options,
)

export const DEFAULT_BARCODE_LABEL_SETTINGS: BarcodeLabelSettings = {
  default_layout: 'SINGLE',
  fields: [
    { id: 'heading', label: '', source: 'name', enabled: true, bold: true },
    { id: 'mrp', label: 'MRP', source: 'mrp', enabled: true },
    { id: 'sale', label: 'Rate', source: 'sale_price', enabled: false },
    { id: 'expiry', label: 'Exp', source: 'expiry', enabled: false },
  ],
  gaps: emptyLayoutGaps(),
  sheet: { ...DEFAULT_SHEET },
}

export function parseBarcodeLabelSettings(raw: unknown): BarcodeLabelSettings {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_BARCODE_LABEL_SETTINGS,
      fields: [...DEFAULT_BARCODE_LABEL_SETTINGS.fields],
      gaps: emptyLayoutGaps(),
      sheet: { ...DEFAULT_SHEET },
    }
  }
  const o = raw as Record<string, unknown>
  const fields = Array.isArray(o.fields)
    ? (o.fields as BarcodeFieldMapping[]).filter((f) => f && f.id && f.source)
    : DEFAULT_BARCODE_LABEL_SETTINGS.fields
  const layout = o.default_layout as BarcodeLayoutId
  const gaps = emptyLayoutGaps()
  const grouped = o.gaps && typeof o.gaps === 'object' ? (o.gaps as Record<string, unknown>) : null
  const flatFallback =
    o.gap_left_mm != null || o.gap_right_mm != null || o.gap_bottom_mm != null || o.show_border
      ? parseGapBlock(o)
      : null
  for (const id of Object.keys(BARCODE_LAYOUTS) as BarcodeLayoutId[]) {
    const piece = grouped?.[id]
    if (piece && typeof piece === 'object') gaps[id] = parseGapBlock(piece)
    else if (flatFallback) gaps[id] = { ...flatFallback }
  }
  const sheet = parseSheet(o.sheet)
  gaps.CUSTOM = { ...gaps.CUSTOM, gap_bottom_mm: sheet.rowGapMm }
  return {
    default_layout: layout && BARCODE_LAYOUTS[layout] ? layout : 'SINGLE',
    fields: fields.length ? fields : [...DEFAULT_BARCODE_LABEL_SETTINGS.fields],
    gaps,
    canvases: o.canvases && typeof o.canvases === 'object' ? (o.canvases as BarcodeLabelSettings['canvases']) : undefined,
    sheet,
  }
}

function clampBoxMm(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.max(min, Math.min(max, n)) * 10) / 10
}

function parseBox(raw: unknown, fallback: CanvasBox): CanvasBox {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    xMm: clampBoxMm(o.xMm ?? o.x_mm, fallback.xMm, -20, 400),
    yMm: clampBoxMm(o.yMm ?? o.y_mm, fallback.yMm, -20, 200),
    widthMm: clampBoxMm(o.widthMm ?? o.width_mm, fallback.widthMm, 2, 400),
    heightMm: clampBoxMm(o.heightMm ?? o.height_mm, fallback.heightMm, 1, 200),
  }
}

function clampFontPt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(5, Math.min(24, n)) : fallback
}

function parseTextBox(raw: unknown, fallback: CanvasTextBox): CanvasTextBox {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const box = parseBox(raw, fallback)
  const font = String(o.fontFamily || o.font_family || fallback.fontFamily)
  const alignRaw = String(o.align || fallback.align)
  const align: TextAlign = alignRaw === 'left' || alignRaw === 'right' ? alignRaw : 'center'
  return {
    ...box,
    fontFamily: LABEL_FONTS.includes(font as (typeof LABEL_FONTS)[number]) ? font : fallback.fontFamily,
    fontSizePt: clampFontPt(o.fontSizePt ?? o.font_size_pt, fallback.fontSizePt),
    bold: o.bold == null ? fallback.bold : Boolean(o.bold),
    align,
  }
}

function parseBarcodeBox(raw: unknown, fallback: BarcodeBox): BarcodeBox {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    ...parseBox(raw, fallback),
    showText: o.showText == null ? fallback.showText : Boolean(o.showText),
    fontSizePt: clampFontPt(o.fontSizePt ?? o.font_size_pt, fallback.fontSizePt),
  }
}

/** Approximate label box size so the selection matches the printed text. */
export function estimateTextWidthMm(text: string, fontSizePt: number, bold?: boolean): number {
  const chars = Math.max(2, String(text || '').length)
  const em = bold ? 0.23 : 0.19
  return Math.round(Math.max(6, chars * fontSizePt * em) * 10) / 10
}

export function estimateTextHeightMm(fontSizePt: number): number {
  return Math.round(Math.max(2, fontSizePt * 0.42) * 10) / 10
}

/** JsBarcode caption size is in px. */
export function barcodeCaptionFontPx(bar: { fontSizePt?: number; heightMm: number }, fallbackPt = 8): number {
  const pt = clampFontPt(bar.fontSizePt, fallbackPt)
  return Math.max(5, Math.round(pt * (96 / 72)))
}

export function defaultCanvas(layout: BarcodeLayout, fields: BarcodeFieldMapping[]): BarcodeCanvas {
  const pad = 0.6
  const innerW = Math.max(4, layout.widthMm - pad * 2)
  const enabled = fields.filter((f) => f.enabled && layout.showFields)
  let y = pad
  const fieldBoxes: Record<string, CanvasTextBox> = {}
  for (const f of enabled) {
    const logo = f.source === 'company_logo'
    const fontSizePt = f.source === 'name' || f.source === 'company_name' ? 10 : 8
    const bold = !!f.bold || f.source === 'name'
    const sampleText =
      formatFieldLine(f, resolveFieldValue(f, SAMPLE_LABEL_PRODUCT, {}, SAMPLE_COMPANY)) || f.label || 'Text'
    const widthMm = logo
      ? Math.min(innerW, 18)
      : Math.min(innerW, estimateTextWidthMm(sampleText, fontSizePt, bold))
    const heightMm = logo ? Math.min(12, Math.max(6, layout.heightMm * 0.4)) : estimateTextHeightMm(fontSizePt)
    fieldBoxes[f.id] = {
      xMm: pad + (innerW - widthMm) / 2,
      yMm: y,
      widthMm,
      heightMm,
      fontFamily: 'Arial',
      fontSizePt,
      bold,
      align: 'center',
    }
    y += fieldBoxes[f.id].heightMm
  }
  const barTop = layout.showFields ? y : pad
  const barH = Math.max(5, layout.heightMm - barTop - pad)
  return {
    fields: fieldBoxes,
    barcode: {
      xMm: pad,
      yMm: barTop,
      widthMm: innerW,
      heightMm: barH,
      showText: layout.showBarcodeText,
      fontSizePt: layout.fontSize,
    },
    border: {
      enabled: false,
      xMm: 0.35,
      yMm: 0.35,
      widthMm: Math.max(4, layout.widthMm - 0.7),
      heightMm: Math.max(3, layout.heightMm - 0.7),
    },
  }
}

export function canvasFor(settings: BarcodeLabelSettings, layoutId: BarcodeLayoutId): BarcodeCanvas {
  const layout = resolveLayout(settings, layoutId)
  const base = defaultCanvas(layout, settings.fields)
  const saved = settings.canvases?.[layoutId]
  if (!saved) {
    return { ...base, border: { ...base.border, enabled: gapsFor(settings, layoutId).show_border } }
  }
  const fields: Record<string, CanvasTextBox> = { ...base.fields }
  const savedFields = saved.fields && typeof saved.fields === 'object' ? saved.fields : {}
  for (const id of Object.keys(fields)) {
    if (savedFields[id]) fields[id] = parseTextBox(savedFields[id], fields[id])
  }
  return {
    fields,
    barcode: parseBarcodeBox(saved.barcode, base.barcode),
    border: {
      ...parseBox(saved.border, base.border),
      enabled: saved.border?.enabled ?? gapsFor(settings, layoutId).show_border,
    },
  }
}

export function withCanvas(
  settings: BarcodeLabelSettings,
  layoutId: BarcodeLayoutId,
  canvas: BarcodeCanvas,
): BarcodeLabelSettings {
  return {
    ...settings,
    canvases: { ...settings.canvases, [layoutId]: canvas },
    gaps: {
      ...settings.gaps,
      [layoutId]: { ...gapsFor(settings, layoutId), show_border: canvas.border.enabled },
    },
  }
}

function num(v: unknown): string {
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : ''
}

function companyText(company: CompanyProfile | null | undefined, key: keyof CompanyProfile): string {
  if (!company) return ''
  const v = company[key]
  return v == null ? '' : String(v).trim()
}

export function companyFullAddress(company: CompanyProfile | null | undefined): string {
  if (!company) return ''
  const lines = [company.address_line1, company.address_line2, company.address_line3, company.address_line4]
  const cityLine = [company.city, company.state, company.pin_code].filter(Boolean).join(' ')
  return [...lines, cityLine]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(', ')
}

export function resolveFieldValue(
  field: BarcodeFieldMapping,
  product: Product,
  extras: Record<string, string>,
  company?: CompanyProfile | null,
): string {
  switch (field.source) {
    case 'name':
      return String(product.name || '')
    case 'code':
      return String(product.code || '')
    case 'barcode':
      return String(product.barcode || '')
    case 'mrp':
      return num(product.mrp)
    case 'sale_price':
      return num(product.sale_price)
    case 'wholesale_price':
      return num(product.wholesale_price)
    case 'hsn_code':
      return String(product.hsn_code || '')
    case 'category_name':
      return String(product.category_name || '')
    case 'expiry':
      return extras.expiry || extras[field.id] || ''
    case 'custom':
      return extras[field.id] || extras.custom || ''
    case 'company_name':
      return companyText(company, 'name')
    case 'company_address_line1':
      return companyText(company, 'address_line1')
    case 'company_address_line2':
      return companyText(company, 'address_line2')
    case 'company_address_line3':
      return companyText(company, 'address_line3')
    case 'company_address_line4':
      return companyText(company, 'address_line4')
    case 'company_city':
      return companyText(company, 'city')
    case 'company_state':
      return companyText(company, 'state')
    case 'company_pin':
      return companyText(company, 'pin_code')
    case 'company_phone':
      return companyText(company, 'phone')
    case 'company_mobile':
      return companyText(company, 'mobile')
    case 'company_email':
      return companyText(company, 'email')
    case 'company_website':
      return companyText(company, 'website')
    case 'company_gstin':
      return companyText(company, 'gstin')
    case 'company_software_id':
      return companyText(company, 'software_id')
    case 'company_address':
      return companyFullAddress(company)
    case 'company_logo':
      return String(company?.logo_url || '').trim()
    default:
      return ''
  }
}

export function formatFieldLine(field: BarcodeFieldMapping, value: string): string {
  if (!value) return ''
  if (field.source === 'company_logo') return value
  if (field.source === 'name' || field.source === 'company_name' || !field.label) return value
  return `${field.label}: ${value}`
}

export function isCompanyLogoSource(source: string): boolean {
  return source === 'company_logo'
}

export function companyLogoUrl(company?: CompanyProfile | null): string {
  return String(company?.logo_url || '').trim()
}

export function makeBarcodeSvg(
  barcode: string,
  layout: BarcodeLayout,
  opts?: { barHeight?: number; fontSize?: number; displayValue?: boolean },
): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const displayValue = opts?.displayValue ?? layout.showBarcodeText
  const fontSize = opts?.fontSize ?? layout.fontSize
  const barHeight = opts?.barHeight ?? layout.barHeight
  try {
    JsBarcode(svg, barcode, {
      format: 'CODE128',
      displayValue,
      fontSize,
      height: barHeight,
      margin: 0,
      width: 1.2,
    })
  } catch {
    return '<svg></svg>'
  }
  return svg.outerHTML
}

export type LabelPrintInput = {
  product: Product
  barcodeValue: string
  layout: BarcodeLayout
  settings: BarcodeLabelSettings
  copies: number
  extras: Record<string, string>
  company?: CompanyProfile | null
}

function buildOneLabelHtml(input: LabelPrintInput): string {
  const { product, barcodeValue, layout, settings, extras, company } = input
  const gap = gapsFor(settings, layout.id)
  const canvas = canvasFor(settings, layout.id)
  const items: string[] = []
  if (layout.showFields) {
    for (const f of settings.fields) {
      if (!f.enabled) continue
      const box = canvas.fields[f.id]
      if (!box) continue
      const val = resolveFieldValue(f, product, extras, company)
      if (f.source === 'company_logo') {
        if (!val) continue
        items.push(
          `<div class="item logo" style="left:${box.xMm}mm;top:${box.yMm}mm;width:${box.widthMm}mm;height:${box.heightMm}mm;text-align:${box.align};"><img src="${escapeHtml(val)}" alt="" /></div>`,
        )
        continue
      }
      const text = formatFieldLine(f, val)
      if (!text) continue
      items.push(
        `<div class="item" style="left:${box.xMm}mm;top:${box.yMm}mm;width:${box.widthMm}mm;height:${box.heightMm}mm;font-family:${escapeHtml(box.fontFamily)};font-size:${box.fontSizePt}pt;font-weight:${box.bold ? 700 : 400};text-align:${box.align};">${escapeHtml(text)}</div>`,
      )
    }
  }
  const bar = canvas.barcode
  const barPx = Math.max(10, Math.round((bar.heightMm / 25.4) * 96 * (bar.showText ? 0.7 : 0.92)))
  const svg = makeBarcodeSvg(barcodeValue, layout, {
    barHeight: barPx,
    fontSize: barcodeCaptionFontPx(bar, layout.fontSize),
    displayValue: bar.showText,
  })
  items.push(
    `<div class="item bar" style="left:${bar.xMm}mm;top:${bar.yMm}mm;width:${bar.widthMm}mm;height:${bar.heightMm}mm;">${svg}</div>`,
  )
  if (canvas.border.enabled) {
    const b = canvas.border
    items.push(
      `<div class="item border" style="left:${b.xMm}mm;top:${b.yMm}mm;width:${b.widthMm}mm;height:${b.heightMm}mm;"></div>`,
    )
  }
  const pitchMm = layout.heightMm + (layout.rowGapMm ?? gap.gap_bottom_mm)
  return `<div class="cell" style="width:${layout.widthMm}mm;height:${pitchMm}mm;">
    <div class="label" style="width:${layout.widthMm}mm;height:${layout.heightMm}mm;padding:0 ${gap.gap_right_mm}mm 0 ${gap.gap_left_mm}mm;">
    ${items.join('')}
    </div>
  </div>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildPrintHtmlMany(inputs: LabelPrintInput[], opts?: { autoPrint?: boolean }): string {
  if (!inputs.length) return ''
  const layout = inputs[0].layout
  const autoPrint = opts?.autoPrint !== false
  const labels: string[] = []
  for (const input of inputs) {
    const copies = Math.max(1, input.copies)
    for (let i = 0; i < copies; i++) {
      labels.push(buildOneLabelHtml(input))
    }
  }
  const total = labels.length

  const rows: string[] = []
  for (let i = 0; i < labels.length; i += layout.perRow) {
    const chunk = labels.slice(i, i + layout.perRow)
    rows.push(`<div class="row">${chunk.join('')}</div>`)
  }

  const colGap = layout.columnGapMm || 0
  const pageW = layout.perRow * layout.widthMm + Math.max(0, layout.perRow - 1) * colGap
  const pageH = Math.max(1, Math.ceil(total / layout.perRow)) * (layout.heightMm + (layout.rowGapMm ?? 0))

  return `<!doctype html><html><head><meta charset="utf-8"><title>Barcode labels</title>
<style>
  @page { size: ${pageW}mm ${pageH}mm; margin: 0; }
  html, body {
    margin: 0;
    padding: 0;
    width: ${pageW}mm;
    max-width: ${pageW}mm;
    height: auto;
    background: #fff;
  }
  * { box-sizing: border-box; }
  .sheet { width: ${pageW}mm; max-width: ${pageW}mm; }
  .row { display: flex; flex-direction: row; flex-wrap: nowrap; gap: ${colGap}mm; width: ${pageW}mm; page-break-inside: avoid; }
  .cell { overflow: hidden; flex: none; }
  .label {
    position: relative;
    overflow: hidden;
    box-sizing: border-box;
    background: #fff;
  }
  .item {
    position: absolute;
    overflow: hidden;
    line-height: 1.1;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .item.bar { display: flex; align-items: center; justify-content: center; }
  .item.bar svg { width: 100%; height: 100%; }
  .item.logo { display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .item.logo img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
  .item.border { border: 0.3mm solid #000; pointer-events: none; }
</style></head><body data-generp-print="barcode" data-page-w="${pageW}" data-page-h="${pageH}">
<div class="sheet">
${rows.join('\n')}
</div>
${autoPrint ? '<script>window.onload=function(){window.print();};</script>' : ''}
</body></html>`
}

export function buildPrintHtml(input: LabelPrintInput, opts?: { autoPrint?: boolean }): string {
  return buildPrintHtmlMany([input], opts)
}

export function openBarcodePrint(input: LabelPrintInput) {
  openBarcodePrintMany([input])
}

export function openBarcodePrintMany(inputs: LabelPrintInput[]) {
  if (!inputs.length) return
  const html = buildPrintHtmlMany(inputs)
  const w = window.open('', '_blank', 'width=640,height=480')
  if (!w) {
    alert('Allow pop-ups to print labels.')
    return
  }
  w.document.write(html)
  w.document.close()
}
