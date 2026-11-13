/** Types for the Bill Template Designer (mirrors core/erp_core/printing/layouts.py). */

export type BandId = 'header' | 'meta' | 'columns' | 'totals' | 'footer'

export const BANDS: { id: BandId; label: string }[] = [
  { id: 'header', label: 'Header' },
  { id: 'meta', label: 'Patient details' },
  { id: 'columns', label: 'Columns' },
  { id: 'totals', label: 'Totals' },
  { id: 'footer', label: 'Footer' },
]

export const BAND_IDS: BandId[] = BANDS.map((b) => b.id)

export type Align = 'left' | 'center' | 'right'

export interface Field {
  id: string
  band: BandId | string
  visible: boolean
  label: string
  align: Align
  /** Column weight (columns band only). */
  width?: number | null
  x_mm?: number | null
  y_mm?: number | null
  width_mm?: number | null
  height_mm?: number | null
  font_family?: string
  font_size_pt?: number | null
  font_bold?: boolean
  font_italic?: boolean
  font_underline?: boolean
  /** Printed text (static_*, bill_title, computer_note, signature, thanks). */
  text?: string
  /** copy_* fields print the value of this catalog field. */
  source_id?: string
}

export type ShapeKind = 'line' | 'rect' | 'square' | 'ellipse' | 'triangle' | 'diamond' | 'round'

export const CLOSED_SHAPES: ReadonlySet<string> = new Set([
  'rect',
  'square',
  'ellipse',
  'triangle',
  'diamond',
  'round',
])

export interface Shape {
  id: string
  kind: ShapeKind | string
  axis?: 'h' | 'v'
  x_mm: number
  y_mm: number
  length_mm?: number
  width_mm?: number
  height_mm?: number
  mode?: 'content' | 'fixed'
  field_id?: string
  /** Backend field name: "detail" repeats the line on every detail row. */
  repeat?: '' | 'detail'
  rotate_deg?: number
}

export type BandFields = Record<BandId, Field[]> & Record<string, Field[]>

export interface PageMeta {
  orientation?: 'portrait' | 'landscape'
  margin_top_mm?: number
  margin_right_mm?: number
  margin_bottom_mm?: number
  margin_left_mm?: number
  border?: boolean
  free_place?: boolean
  y_origin?: '' | 'page'
  trim_to_content?: boolean
  fit_detail?: boolean
  detail_boxes?: boolean
  shapes?: Shape[]
}

export interface CustomPage {
  name: string
  width_mm: number
  height_mm: number
}

export interface Layout {
  version?: number
  kind?: string
  designed?: boolean
  active_format?: string
  formats: Record<string, BandFields>
  page: Record<string, PageMeta>
  custom_pages: Record<string, CustomPage>
}

export interface SharedPage {
  name?: string
  width_mm?: number
  height_mm?: number
  orientation?: string
  format?: BandFields | null
  page?: PageMeta | null
}

export interface CatalogDocument {
  code: string
  name: string
  kind: string
}

export interface Catalog {
  version?: number
  documents: CatalogDocument[]
  formats?: { code: string; name: string }[]
  bands?: { id: string; label: string }[]
  fields?: unknown[]
  shared_pages?: Record<string, SharedPage>
}

export interface LayoutPayload {
  id: string | null
  code: string
  name: string
  paper_size: string
  custom_width_mm: number | null
  custom_height_mm: number | null
  orientation: string
  layout: Layout
}

export type Selection =
  | { kind: 'field'; band: BandId; id: string }
  | { kind: 'shape'; id: string }

/** x, y, width, height in page millimetres. */
export type Box = [number, number, number, number]

export interface PrintLayout {
  placed: Record<string, Box>
  bottom: number
  bandShift: number
  shiftFrom: number
}

export interface UndoState {
  format: string
  bands: BandFields
  page: PageMeta
}

export type Clip =
  | { kind: 'shape'; shape: Shape }
  | { kind: 'field'; band: BandId; field: Field }
