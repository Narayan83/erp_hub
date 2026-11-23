/**
 * Bill Template Designer — React port of hospital/desktop/app/ui/widgets/bill_template_designer.py.
 *
 * The layout is held in a ref and edited in place (as the desktop widget does); `rev` is bumped to
 * re-render. Undo keeps deep-cloned snapshots of the active page (capped at 40).
 *
 * Open it at /print_template_designer (menu code `print_template_designer`), optionally
 * /print_template_designer?code=OPD_BILL. Close returns to `location.state.returnTo` or /print_master.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../../api/client'
import { TplPreviewPanel } from '../../../components/generp/TplPreviewPanel'
import { BillPaperCanvas, type CanvasHandle } from './BillPaperCanvas'
import {
  STANDARD_PAGE_LABELS,
  STANDARD_PAGE_MM,
  STATIC_TEXT_PLACEHOLDERS,
  TEXT_FIELDS,
  bakeStackedPositions,
  clamp,
  compactForSmallPaper,
  contentWidth,
  deepClone,
  defaultBold,
  defaultUnderline,
  fitFieldsToWidth,
  isSmallPaper,
  num,
  packColumns,
  paperMm,
  prepareBill,
  r1,
  shapeKind,
} from './layoutUtils'
import {
  BANDS,
  BAND_IDS,
  CLOSED_SHAPES,
  type Align,
  type BandFields,
  type BandId,
  type Catalog,
  type CatalogDocument,
  type Clip,
  type CustomPage,
  type Field,
  type Layout,
  type LayoutPayload,
  type PageMeta,
  type Selection,
  type Shape,
  type SharedPage,
  type UndoState,
} from './types'
import './billDesigner.css'

const FONT_FAMILIES = [
  'Times New Roman',
  'Arial',
  'Calibri',
  'Cambria',
  'Courier New',
  'Georgia',
  'Segoe UI',
  'Tahoma',
  'Trebuchet MS',
  'Verdana',
  'Consolas',
]

const HELP_TEXT = [
  'The white sheet is the page that prints. Drag the blue dashed line to set the margin — that line is only a guide and is not printed. Turn on Print border when the page should print a black border.',
  'Drag a field to move it, and drag the blue corner handle to resize it. On the Columns tab, drag column boxes left or right to reorder them. Select a field to set font name, size, and style. Add caption inserts custom printed text.',
  'Shapes: line, rectangle, square, ellipse, triangle, diamond and rounded rectangle. Drag any side or corner to resize. The round handle above a shape rotates it (or use the rotate buttons for 15° steps). "Line on every detail row" repeats a line on each detail row.',
  'Free placement lets you drag any field anywhere on the page (including column headings up and down). End page when data ends trims blank paper. Push totals to bottom makes the detail area fill the page. Fit small page keeps the essential fields for quarter-page stock.',
  'Click a ribbon section title (Document, Page, Size, …) to collapse or expand that section; the arrow next to the title collapses the whole ribbon. Printing uses this computer\'s print dialog. Bills keep the old layout until you save a design here.',
  'Page name and millimetres are under Size. Change the name, then press Enter or click the pencil to apply. Plus copies the current page with that name and size. Standard sizes (A4, A5, …) cannot be changed — use + to create a custom size.',
  'Keyboard (click the sheet first): arrow keys move the selection (Shift = 5 mm), Ctrl+Z undo, Ctrl+C copy, Ctrl+V paste, Delete removes a selected shape. Ctrl+wheel zooms.',
]

type Notice = { kind: 'ok' | 'err' | 'info'; text: string }

const isCustom = (code: string) => String(code || '').startsWith('CUSTOM_')
const isStaticId = (id: string) => String(id || '').startsWith('static_')
const placed = (f: Field) => f.x_mm !== null && f.x_mm !== undefined

/* ───────────────────────── small UI pieces ───────────────────────── */

function CommitInput(props: {
  value: string
  rev: number
  onCommit: (v: string) => void
  disabled?: boolean
  className?: string
  title?: string
  type?: string
  placeholder?: string
  min?: number
  max?: number
  step?: number
}) {
  const { value, rev, onCommit, ...rest } = props
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value, rev])
  return (
    <input
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value) onCommit(v)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        else if (e.key === 'Escape') setV(value)
      }}
    />
  )
}

function Tool(props: {
  glyph: ReactNode
  tip: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  wide?: boolean
}) {
  return (
    <button
      type="button"
      className={`bd-tool ${props.active ? 'on' : ''} ${props.wide ? 'wide' : ''}`}
      title={props.tip}
      aria-label={props.tip}
      aria-pressed={props.active === undefined ? undefined : props.active}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.glyph}
    </button>
  )
}

function Group(props: {
  title: string
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="bd-group">
      <div className={`bd-group-body ${props.collapsed ? 'hidden' : ''}`}>{props.children}</div>
      <button
        type="button"
        className="bd-group-title"
        title={`Click to expand or collapse ${props.title}`}
        onClick={props.onToggle}
      >
        {props.collapsed ? '▸' : '▾'} {props.title}
      </button>
    </div>
  )
}

function Modal(props: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])
  return (
    <div className="bd-modal-backdrop" onMouseDown={props.onClose}>
      <div
        className={`bd-modal ${props.wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bd-modal-head">
          <strong>{props.title}</strong>
          <button type="button" className="bd-tool" onClick={props.onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="bd-modal-body">{props.children}</div>
      </div>
    </div>
  )
}

/* ───────────────────────── page ───────────────────────── */

export function BillTemplateDesignerPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [search] = useSearchParams()
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo || 'print_master'

  const layoutRef = useRef<Layout | null>(null)
  const sharedRef = useRef<Record<string, SharedPage>>({})
  const undoRef = useRef<UndoState[]>([])
  const clipRef = useRef<Clip | null>(null)
  const canvasRef = useRef<CanvasHandle>(null)
  const noticeTimer = useRef<number | undefined>(undefined)

  const [rev, setRev] = useState(0)
  const bump = useCallback(() => setRev((r) => r + 1), [])

  const [documents, setDocuments] = useState<CatalogDocument[]>([])
  const [bandTabs, setBandTabs] = useState(BANDS)
  const [code, setCode] = useState('')
  const [format, setFormat] = useState('A4')
  const [band, setBand] = useState<BandId>('header')
  const [sel, setSel] = useState<Selection | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadingDoc, setLoadingDoc] = useState(true)
  const [notice, setNoticeState] = useState<Notice | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [ribbonOpen, setRibbonOpen] = useState(true)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [zoomPct, setZoomPct] = useState(100)
  const [pageName, setPageName] = useState('')
  const [pageW, setPageW] = useState('148')
  const [pageH, setPageH] = useState('210')

  const setNotice = useCallback((n: Notice | null) => {
    window.clearTimeout(noticeTimer.current)
    setNoticeState(n)
    if (n && n.kind !== 'err') noticeTimer.current = window.setTimeout(() => setNoticeState(null), 6000)
  }, [])
  const fail = useCallback((e: unknown) => setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) }), [setNotice])
  const touch = useCallback(() => setDirty(true), [])
  const toggleGroup = (name: string) => setCollapsed((c) => ({ ...c, [name]: !c[name] }))

  const layout = layoutRef.current
  // Refs so memoised loaders (and adopt/publish) always see the latest document list / code.
  const documentsRef = useRef<CatalogDocument[]>([])
  const codeRef = useRef('')
  documentsRef.current = documents
  if (code) codeRef.current = code
  const currentIsBill = () => documentsRef.current.find((d) => d.code === codeRef.current)?.kind === 'bill'

  /* ───────── layout accessors ───────── */

  function bandsOf(fmt: string): BandFields {
    const L = layoutRef.current!
    L.formats = L.formats || {}
    const f = (L.formats[fmt] = L.formats[fmt] || ({} as BandFields))
    for (const b of BAND_IDS) f[b] = f[b] || []
    return f
  }
  function metaOf(fmt: string): PageMeta {
    const L = layoutRef.current!
    L.page = L.page || {}
    return (L.page[fmt] = L.page[fmt] || {})
  }
  const orientationOf = (fmt: string) => (metaOf(fmt).orientation === 'landscape' ? 'landscape' : 'portrait')
  const paperOf = (fmt: string): [number, number] => paperMm(layoutRef.current, fmt, orientationOf(fmt))
  function readMargins(fmt: string): [number, number, number, number] {
    const meta = metaOf(fmt) as Record<string, unknown>
    const n = (k: string) => {
      const v = meta[k]
      if (v === null || v === undefined) return 5
      const x = Number(v)
      return Number.isFinite(x) ? x : 5
    }
    return [n('margin_left_mm'), n('margin_top_mm'), n('margin_right_mm'), n('margin_bottom_mm')]
  }
  const shapesOf = (fmt: string): Shape[] => {
    const meta = metaOf(fmt)
    meta.shapes = meta.shapes || []
    return meta.shapes
  }
  const isFree = (fmt: string) => {
    const m = metaOf(fmt)
    return !!m.free_place && m.y_origin === 'page'
  }
  const fieldsOf = (fmt: string, b: BandId) => bandsOf(fmt)[b]
  const findField = (fmt: string, b: BandId, id: string) => fieldsOf(fmt, b).find((f) => String(f.id || '') === id)

  /** Re-place unplaced fields and re-render (desktop `_sync_canvas`). */
  const syncCanvas = useCallback(
    (fmt: string) => {
      const L = layoutRef.current
      if (!L) return
      const bands = bandsOf(fmt)
      const [w] = paperOf(fmt)
      const [ml, , mr] = readMargins(fmt)
      prepareBill(bands, w, { l: ml, r: mr }, isFree(fmt))
      bump()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bump],
  )

  /* ───────── undo / clipboard ───────── */

  const remember = () => {
    if (!layoutRef.current) return
    const state: UndoState = {
      format,
      bands: deepClone(bandsOf(format)),
      page: deepClone(metaOf(format)),
    }
    const last = undoRef.current[undoRef.current.length - 1]
    if (last && JSON.stringify(last) === JSON.stringify(state)) return
    undoRef.current.push(state)
    if (undoRef.current.length > 40) undoRef.current.splice(0, undoRef.current.length - 40)
    touch()
  }

  const undo = () => {
    const L = layoutRef.current
    const state = undoRef.current.pop()
    if (!L || !state) return
    L.formats[state.format] = state.bands
    L.page[state.format] = state.page
    setSel(null)
    touch()
    bump()
  }

  const nextId = (prefix: string, existing: string[]) => {
    let n = existing.length + 1
    while (existing.includes(`${prefix}${n}`)) n += 1
    return `${prefix}${n}`
  }

  const copySelection = () => {
    if (!sel || !layoutRef.current) return
    if (sel.kind === 'shape') {
      const shape = shapesOf(format).find((s) => String(s.id || '') === sel.id)
      if (shape) clipRef.current = { kind: 'shape', shape: deepClone(shape) }
      return
    }
    const field = findField(format, sel.band, sel.id)
    if (field) clipRef.current = { kind: 'field', band: sel.band, field: deepClone(field) }
  }

  const pasteSelection = () => {
    const clip = clipRef.current
    if (!clip || !layoutRef.current) return
    remember()
    if (clip.kind === 'shape') {
      const shapes = shapesOf(format)
      const shape = deepClone(clip.shape)
      shape.id = nextId('line_', shapes.map((s) => String(s.id)))
      shape.x_mm = r1(num(shape.x_mm) + 3)
      shape.y_mm = r1(num(shape.y_mm) + 3)
      shapes.push(shape)
      setSel({ kind: 'shape', id: shape.id })
      bump()
      canvasRef.current?.focus()
      return
    }
    const fields = fieldsOf(format, clip.band)
    const field = deepClone(clip.field)
    const fid = String(field.id || '')
    const ids = fields.map((f) => String(f.id))
    if (isStaticId(fid)) {
      field.id = nextId(`static_${clip.band}_`, ids)
      delete field.source_id
    } else {
      field.source_id = String(field.source_id || fid)
      field.id = nextId(`copy_${clip.band}_`, ids)
    }
    field.x_mm = r1(num(field.x_mm) + 3)
    field.y_mm = r1(num(field.y_mm) + 3)
    fields.push(field)
    setBand(clip.band)
    setSel({ kind: 'field', band: clip.band, id: field.id })
    bump()
    canvasRef.current?.focus()
  }

  /* ───────── custom / shared pages ───────── */

  const pageChoices = (): Record<string, SharedPage | CustomPage> => {
    const combined: Record<string, SharedPage | CustomPage> = {}
    for (const [c, p] of Object.entries(sharedRef.current)) {
      if (isCustom(c) && p && typeof p === 'object') combined[c] = p
    }
    for (const [c, p] of Object.entries(layoutRef.current?.custom_pages || {})) {
      if (!isCustom(c) || !p || typeof p !== 'object') continue
      combined[c] = { ...(combined[c] || {}), ...p }
    }
    return combined
  }

  /** Remember this document's custom pages so another bill can reuse them. */
  const publishPages = () => {
    const L = layoutRef.current
    if (!L) return
    const isBill = currentIsBill()
    for (const [c, page] of Object.entries(L.custom_pages || {})) {
      if (!isCustom(c) || !page) continue
      const previous = sharedRef.current[c] || {}
      const meta = L.page?.[c]
      const item: SharedPage = {
        name: page.name || c,
        width_mm: page.width_mm,
        height_mm: page.height_mm,
        orientation: meta?.orientation || previous.orientation || 'portrait',
        page: meta ? deepClone(meta) : previous.page || { orientation: (previous.orientation as 'portrait') || 'portrait' },
        format: isBill && L.formats?.[c] ? deepClone(L.formats[c]) : previous.format ?? null,
      }
      sharedRef.current[c] = item
    }
  }

  /** Selecting a saved page uses that page's size, fields, lines and placement. */
  const adoptSharedPage = (c: string, replace = false) => {
    const L = layoutRef.current
    if (!L || !isCustom(c)) return
    L.custom_pages = L.custom_pages || {}
    if (L.custom_pages[c] && !replace) return
    const shared = sharedRef.current[c]
    if (!shared) return
    L.custom_pages[c] = {
      name: shared.name || c,
      width_mm: Number(shared.width_mm),
      height_mm: Number(shared.height_mm),
    }
    L.formats = L.formats || {}
    const copied = currentIsBill() ? shared.format : null
    if (copied && BAND_IDS.some((b) => (copied[b] || []).length)) {
      L.formats[c] = deepClone(copied)
    } else if (!L.formats[c]) {
      L.formats[c] = deepClone(L.formats.A4 || ({} as BandFields))
      const w = Number(shared.width_mm || 0)
      const h = Number(shared.height_mm || 0)
      if (isSmallPaper(w, h)) {
        for (const b of BAND_IDS) L.formats[c][b] = L.formats[c][b] || []
        compactForSmallPaper(L.formats[c], w, h, true)
      }
    }
    L.page = L.page || {}
    const settings = shared.page && Object.keys(shared.page).length ? shared.page : null
    L.page[c] = settings ? deepClone(settings) : { orientation: (shared.orientation as 'portrait') || 'portrait' }
    if (!L.page[c].orientation) L.page[c].orientation = (shared.orientation as 'portrait') || 'portrait'
  }

  const pageDims = (c: string): [string, number, number] => {
    const L = layoutRef.current
    let page: SharedPage | CustomPage | undefined = L?.custom_pages?.[c]
    if (!page && isCustom(c)) page = pageChoices()[c]
    if (page) return [String(page.name || c), Number(page.width_mm) || 210, Number(page.height_mm) || 297]
    const [w, h] = STANDARD_PAGE_MM[String(c || 'A4').toUpperCase()] || STANDARD_PAGE_MM.A4
    return ['', w, h]
  }

  const loadSizeControls = (fmt: string) => {
    const [name, w, h] = pageDims(fmt)
    const wide = !isCustom(fmt) && (layoutRef.current ? orientationOf(fmt) : 'portrait') === 'landscape'
    setPageName(name)
    setPageW(String(wide ? h : w))
    setPageH(String(wide ? w : h))
  }

  const pageOptions = (): { code: string; label: string }[] => {
    const L = layoutRef.current
    const out = STANDARD_PAGE_LABELS.map((p) => ({ code: p.code, label: p.label }))
    if (!L) return out
    const choices = pageChoices()
    const own = Object.keys(L.custom_pages || {}).filter(isCustom).filter((c) => c in choices)
    const ordered = [...own, ...Object.keys(choices).filter((c) => !own.includes(c))]
    for (const c of ordered) {
      const p = choices[c]
      out.push({ code: c, label: `${p.name || c} (${p.width_mm} × ${p.height_mm} mm)` })
    }
    // Selected page might not be listed yet (e.g. shared page not adopted)
    if (!out.some((o) => o.code === format)) out.push({ code: format, label: format })
    return out
  }

  /* ───────── load catalog / document ───────── */

  const loadDocument = useCallback(
    async (target: string, opts?: { keepPublish?: boolean }) => {
      setLoadingDoc(true)
      try {
        if (layoutRef.current && !opts?.keepPublish) publishPages()
        const payload = await api.get<LayoutPayload>(
          `/print-configs/layouts/by-code/${encodeURIComponent(target)}`,
        )
        const L = payload.layout
        L.formats = L.formats || {}
        L.page = L.page || {}
        L.custom_pages = L.custom_pages || {}
        layoutRef.current = L
        let paper = String(payload.paper_size || 'A4').toUpperCase()
        if (paper === 'CUSTOM') paper = Object.keys(L.custom_pages)[0] || 'A4'
        if (!STANDARD_PAGE_MM[paper] && !L.custom_pages[paper] && !sharedRef.current[paper]) paper = 'A4'
        codeRef.current = target
        setCode(target)
        setFormat(paper)
        if (isCustom(paper)) adoptSharedPage(paper, false)
        const meta = metaOf(paper)
        if (payload.orientation === 'landscape' || payload.orientation === 'portrait') {
          meta.orientation = payload.orientation
        }
        loadSizeControls(paper)
        undoRef.current = []
        setSel(null)
        setDirty(false)
        syncCanvas(paper)
      } catch (e) {
        fail(e)
      } finally {
        setLoadingDoc(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const loadCatalog = useCallback(async (opts?: { replaceShared?: boolean }) => {
    const catalog = await api.get<Catalog>('/print-configs/layouts/catalog')
    sharedRef.current = opts?.replaceShared
      ? { ...(catalog.shared_pages || {}) }
      : { ...(catalog.shared_pages || {}), ...sharedRef.current }
    documentsRef.current = catalog.documents || []
    setDocuments(catalog.documents || [])
    if (catalog.bands?.length) {
      const labelById = new Map(catalog.bands.map((b) => [b.id, b.label]))
      setBandTabs(BANDS.map((b) => ({ ...b, label: labelById.get(b.id) || b.label })))
    }
    return catalog
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const catalog = await loadCatalog({ replaceShared: true })
        if (cancelled) return
        const wanted = (search.get('code') || '').toUpperCase()
        const docs = catalog.documents || []
        const first = docs.find((d) => d.code === wanted)?.code || docs[0]?.code
        if (first) await loadDocument(first, { keepPublish: true })
        else setLoadingDoc(false)
      } catch (e) {
        if (!cancelled) {
          fail(e)
          setLoadingDoc(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ───────── toolbar actions ───────── */

  const onDocument = (target: string) => {
    if (!target || target === code) return
    if (dirty && !window.confirm('Discard unsaved changes to this template?')) return
    setBand('header')
    void loadDocument(target)
  }

  const onPage = (fmt: string) => {
    if (!layoutRef.current) return
    setFormat(fmt)
    adoptSharedPage(fmt, false)
    loadSizeControls(fmt)
    setSel(null)
    syncCanvas(fmt)
  }

  const onOrientation = (value: string) => {
    if (!layoutRef.current) return
    remember()
    metaOf(format).orientation = value === 'landscape' ? 'landscape' : 'portrait'
    loadSizeControls(format)
    const bands = bandsOf(format)
    const [w] = paperOf(format)
    const [ml, , mr] = readMargins(format)
    const cw = contentWidth(w, ml, mr)
    if (!isFree(format)) packColumns(bands.columns.filter((f) => f.visible), cw)
    fitFieldsToWidth(bands, cw)
    syncCanvas(format)
  }

  const addPage = (nameOverride?: string) => {
    const L = layoutRef.current
    if (!L) return
    const name = (nameOverride ?? pageName).trim()
    if (!name) {
      setNotice({ kind: 'err', text: 'Enter a name for the page under Size.' })
      return
    }
    const w = clamp(Number(pageW) || 148, 40, 1000)
    const h = clamp(Number(pageH) || 210, 40, 1000)
    const shared = pageChoices()
    let c = 'CUSTOM_' + name.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 24)
    const base = c
    let suffix = 2
    while (L.custom_pages[c] || shared[c]) c = `${base}_${suffix++}`
    L.custom_pages[c] = { name, width_mm: w, height_mm: h }
    L.formats[c] = deepClone(bandsOf(format))
    if (isSmallPaper(w, h)) compactForSmallPaper(L.formats[c], w, h, true)
    const src = metaOf(format)
    L.page[c] = deepClone(src) || {}
    L.page[c].orientation = orientationOf(format)
    setFormat(c)
    setPageName(name)
    setPageW(String(w))
    setPageH(String(h))
    publishPages()
    setSel(null)
    touch()
    syncCanvas(c)
    return c
  }

  /** Stretch field boxes and lines so the design keeps its proportions on the new size. */
  const rescalePage = (c: string, sxIn: number, syIn: number) => {
    const L = layoutRef.current!
    const meta = (L.page?.[c] || {}) as PageMeta
    const sx = sxIn
    const sy = syIn
    const scaleY = meta.y_origin === 'page'
    const bands = bandsOf(c)
    for (const b of BAND_IDS) {
      for (const f of bands[b]) {
        if (placed(f)) f.x_mm = r1(Number(f.x_mm) * sx)
        if (f.width_mm !== null && f.width_mm !== undefined) f.width_mm = r1(Math.max(4, Number(f.width_mm) * sx))
        if (b === 'columns' && f.width !== null && f.width !== undefined) f.width = r1(Math.max(4, Number(f.width) * sx))
        if (scaleY && f.y_mm !== null && f.y_mm !== undefined) f.y_mm = r1(Number(f.y_mm) * sy)
      }
    }
    for (const s of meta.shapes || []) {
      s.x_mm = r1(num(s.x_mm) * sx)
      s.y_mm = r1(num(s.y_mm) * sy)
      const ratio = s.axis === 'v' ? sy : sx
      s.length_mm = r1(num(s.length_mm, 10) * ratio)
      if (s.width_mm !== undefined && s.width_mm !== null) s.width_mm = r1(Number(s.width_mm) * sx)
      if (s.height_mm !== undefined && s.height_mm !== null) s.height_mm = r1(Number(s.height_mm) * sy)
    }
  }

  const updatePage = (): string => {
    const L = layoutRef.current
    if (!L) return format
    const w = clamp(Number(pageW) || 148, 40, 1000)
    const h = clamp(Number(pageH) || 210, 40, 1000)
    const [curW, curH] = paperOf(format)
    if (Math.abs(curW - w) < 0.1 && Math.abs(curH - h) < 0.1) return format
    if (!isCustom(format)) {
      return addPage(pageName.trim() || `${format} ${w} x ${h}`) || format
    }
    remember()
    adoptSharedPage(format, false)
    const page = (L.custom_pages[format] = L.custom_pages[format] || ({} as CustomPage))
    const oldW = Number(page.width_mm) || w
    const oldH = Number(page.height_mm) || h
    page.name = pageName.trim() || String(page.name || format)
    page.width_mm = w
    page.height_mm = h
    if (Math.abs(oldW - w) >= 0.1 || Math.abs(oldH - h) >= 0.1) {
      rescalePage(format, w / Math.max(oldW, 0.1), h / Math.max(oldH, 0.1))
    }
    publishPages()
    loadSizeControls(format)
    syncCanvas(format)
    return format
  }

  const removePage = () => {
    const L = layoutRef.current
    if (!L) return
    if (!isCustom(format)) {
      setNotice({ kind: 'info', text: 'Select a custom page to remove. Standard sizes stay.' })
      return
    }
    if (!window.confirm('Remove this custom page and its design?')) return
    delete L.custom_pages[format]
    delete L.formats[format]
    delete L.page[format]
    delete sharedRef.current[format]
    setFormat('A4')
    loadSizeControls('A4')
    setSel(null)
    touch()
    syncCanvas('A4')
  }

  /* ───────── page options / shapes ───────── */

  const meta = layout ? metaOf(format) : ({} as PageMeta)

  const setMeta = (patch: Partial<PageMeta>, withRemember = true) => {
    if (!layoutRef.current) return
    if (withRemember) remember()
    Object.assign(metaOf(format), patch)
    touch()
    syncCanvas(format)
  }

  const onFreePlace = (checked: boolean) => {
    if (!layoutRef.current) return
    remember()
    const m = metaOf(format)
    if (checked && m.y_origin !== 'page') {
      const [w] = paperOf(format)
      bakeStackedPositions(bandsOf(format), w, readMargins(format))
      m.y_origin = 'page'
    }
    m.free_place = checked
    touch()
    syncCanvas(format)
  }

  const newShape = (extra: Partial<Shape>): Shape => {
    const shapes = shapesOf(format)
    return {
      id: nextId('line_', shapes.map((s) => String(s.id))),
      kind: 'line',
      axis: 'h',
      x_mm: 4,
      y_mm: 12 + shapes.length * 6,
      length_mm: 40,
      width_mm: 40,
      height_mm: 12,
      mode: 'fixed',
      field_id: '',
      repeat: '',
      rotate_deg: 0,
      ...extra,
    }
  }

  const pushShape = (shape: Shape) => {
    shapesOf(format).push(shape)
    setSel({ kind: 'shape', id: shape.id })
    bump()
    canvasRef.current?.focus()
  }

  const addLine = (axis: 'h' | 'v') => {
    if (!layoutRef.current) return
    remember()
    pushShape(newShape({ axis, length_mm: axis === 'v' ? 30 : 50, width_mm: axis === 'v' ? 30 : 50 }))
  }

  const addShape = (kind: string) => {
    if (!layoutRef.current) return
    remember()
    const k = CLOSED_SHAPES.has(kind) ? kind : 'rect'
    const wide = k === 'rect'
    pushShape(
      newShape({
        kind: k,
        width_mm: wide ? 40 : 22,
        height_mm: wide ? 16 : 22,
        length_mm: wide ? 40 : 22,
        rotate_deg: 0,
      }),
    )
  }

  const addDetailLine = () => {
    if (!layoutRef.current) return
    remember()
    const visible = fieldsOf(format, 'columns').filter((f) => f.visible)
    let left = 0
    let right = 80
    let height = 6
    if (visible.length) {
      left = Math.min(...visible.map((f) => num(f.x_mm)))
      right = Math.max(...visible.map((f) => num(f.x_mm) + num(f.width_mm, num(f.width, 10))))
      height = Math.max(...visible.map((f) => num(f.height_mm, 6)))
    }
    pushShape(
      newShape({
        axis: 'h',
        x_mm: r1(left),
        y_mm: r1(height),
        length_mm: r1(Math.max(10, right - left)),
        repeat: 'detail',
      }),
    )
  }

  const selShape: Shape | null =
    layout && sel?.kind === 'shape' ? shapesOf(format).find((s) => String(s.id || '') === sel.id) || null : null

  const rotateSelected = (delta: number) => {
    if (!selShape) return
    remember()
    selShape.rotate_deg = r1((((num(selShape.rotate_deg) + delta) % 360) + 360) % 360)
    bump()
  }

  const removeSelectedShape = () => {
    if (!selShape) return
    remember()
    const shapes = shapesOf(format)
    shapes.splice(0, shapes.length, ...shapes.filter((s) => s !== selShape))
    setSel(null)
    bump()
  }

  const patchShape = (patch: Partial<Shape>) => {
    if (!selShape) return
    Object.assign(selShape, patch)
    touch()
    bump()
  }

  const onShapeSize = (value: string, dim: 'length' | 'height') => {
    if (!selShape) return
    const size = r1(clamp(Number(value) || 2, 2, 1000))
    const kind = shapeKind(selShape)
    if (dim === 'length') {
      if (kind === 'line') {
        if (selShape.axis === 'v') patchShape({ length_mm: size, height_mm: size })
        else patchShape({ length_mm: size, width_mm: size })
      } else patchShape({ width_mm: size, length_mm: size })
    } else patchShape({ height_mm: size })
  }

  const visibleFieldChoices = () => {
    const out: { id: string; label: string }[] = []
    if (!layoutRef.current) return out
    for (const b of BANDS) {
      for (const f of fieldsOf(format, b.id)) {
        if (f.visible) out.push({ id: String(f.id), label: `${f.label || f.id} (${b.label})` })
      }
    }
    return out
  }

  /* ───────── field table ───────── */

  const fields: Field[] = layout ? fieldsOf(format, band) : []
  const selField: Field | null =
    layout && sel?.kind === 'field' ? findField(format, sel.band, sel.id) || null : null
  const selRow = selField && sel?.kind === 'field' && sel.band === band ? fields.indexOf(selField) : -1

  const alignStatic = (f: Field) => {
    if (!isStaticId(String(f.id))) return
    const label = String(f.label || '').trim()
    const text = String(f.text || '')
    if (label && STATIC_TEXT_PLACEHOLDERS.has(text.trim()) && !STATIC_TEXT_PLACEHOLDERS.has(label)) f.text = label
    else if (text.trim() && STATIC_TEXT_PLACEHOLDERS.has(label)) f.label = text.trim()
    else if (label && !text.trim()) f.text = label
    else if (text.trim() && !label) f.label = text.trim()
  }

  const resequenceColumns = () => {
    if (isFree(format)) return
    const [w] = paperOf(format)
    const [ml, , mr] = readMargins(format)
    packColumns(fieldsOf(format, 'columns').filter((f) => f.visible), contentWidth(w, ml, mr))
  }

  const onShow = (f: Field, checked: boolean) => {
    remember()
    f.visible = checked
    if (band === 'columns') {
      if (checked && !placed(f)) f.width_mm = null
      resequenceColumns()
    }
    syncCanvas(format)
  }

  const onAlign = (f: Field, value: Align) => {
    remember()
    f.align = value
    syncCanvas(format)
  }

  const onCaption = (f: Field, typed: string) => {
    remember()
    if (isStaticId(String(f.id))) {
      const value = typed.trim() || String(f.label || 'Caption')
      f.label = value
      f.text = value
    } else {
      f.label = typed.trim() || String(f.label || f.id)
    }
    syncCanvas(format)
  }

  const onWidth = (f: Field, typed: string) => {
    const w = Number(typed)
    if (!Number.isFinite(w)) return
    remember()
    f.width = Math.max(4, w)
    if (placed(f)) {
      f.width_mm = f.width
      resequenceColumns()
    }
    syncCanvas(format)
  }

  const onText = (f: Field, typed: string) => {
    remember()
    if (isStaticId(String(f.id))) {
      f.text = typed
      f.label = typed.trim() || String(f.label || 'Caption')
    } else f.text = typed
    syncCanvas(format)
  }

  const selectRow = (f: Field) => setSel({ kind: 'field', band, id: String(f.id || '') })

  const moveRow = (delta: number) => {
    if (selRow < 0) return
    const target = selRow + delta
    if (target < 0 || target >= fields.length) return
    remember()
    ;[fields[selRow], fields[target]] = [fields[target], fields[selRow]]
    if (band === 'columns') resequenceColumns()
    syncCanvas(format)
  }

  const addCaption = () => {
    if (!layoutRef.current) return
    remember()
    let n = 1
    for (const f of fields) {
      const id = String(f.id || '')
      if (id.startsWith(`static_${band}_`)) {
        const k = parseInt(id.split('_').pop() || '', 10)
        n = Number.isFinite(k) ? Math.max(n, k + 1) : n + 1
      }
    }
    const field: Field = {
      id: `static_${band}_${n}`,
      band,
      visible: true,
      label: 'Caption',
      align: 'left',
      text: 'Caption',
      font_family: 'Times New Roman',
      font_size_pt: 10,
      font_bold: false,
      font_italic: false,
      font_underline: false,
    }
    fields.push(field)
    setSel({ kind: 'field', band, id: field.id })
    syncCanvas(format)
  }

  const removeCaption = () => {
    if (!selField || selRow < 0) return
    const id = String(selField.id || '')
    if (!isStaticId(id) && !id.startsWith('copy_')) {
      setNotice({ kind: 'info', text: 'Only custom captions and copies can be removed. Hide a standard field instead.' })
      return
    }
    remember()
    fields.splice(selRow, 1)
    setSel(null)
    syncCanvas(format)
  }

  /* ───────── font controls ───────── */

  const fontValues = (f: Field) => ({
    family: String(f.font_family || 'Times New Roman'),
    size: num(f.font_size_pt, 10),
    bold: f.font_bold !== undefined ? !!f.font_bold : defaultBold(f),
    italic: !!f.font_italic,
    underline: f.font_underline !== undefined ? !!f.font_underline : defaultUnderline(f),
  })

  const onFont = (patch: Partial<ReturnType<typeof fontValues>>) => {
    if (!selField) return
    remember()
    const v = { ...fontValues(selField), ...patch }
    selField.font_family = v.family.trim() || 'Times New Roman'
    selField.font_size_pt = clamp(v.size, 6, 36)
    selField.font_bold = v.bold
    selField.font_italic = v.italic
    selField.font_underline = v.underline
    syncCanvas(format)
  }

  /* ───────── template-level actions ───────── */

  const fitSmall = () => {
    if (!layoutRef.current) return
    remember()
    const [w, h] = paperOf(format)
    compactForSmallPaper(bandsOf(format), w, h, true)
    syncCanvas(format)
    setNotice({
      kind: 'ok',
      text: `Packed the first fields for ${w.toFixed(0)} × ${h.toFixed(0)} mm. Extra fields were hidden. Click Save template, then open a bill preview.`,
    })
  }

  const doReset = async () => {
    if (!code) return
    if (!window.confirm('Clear the custom design and use the built-in bill again?')) return
    setBusy(true)
    try {
      const saved = await api.post<{ layout: Layout }>(
        `/print-configs/layouts/by-code/${encodeURIComponent(code)}/reset`,
      )
      const L = saved.layout
      L.formats = L.formats || {}
      L.page = L.page || {}
      L.custom_pages = L.custom_pages || {}
      layoutRef.current = L
      setFormat('A4')
      loadSizeControls('A4')
      undoRef.current = []
      setSel(null)
      setDirty(false)
      syncCanvas('A4')
      setNotice({ kind: 'ok', text: 'Template reset to the built-in design. Save to keep any new design.' })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const doSave = async () => {
    const L = layoutRef.current
    if (!L || !code) return
    setBusy(true)
    try {
      const active = updatePage()
      L.active_format = active
      publishPages()
      const saved = await api.put<LayoutPayload>(`/print-configs/layouts/by-code/${encodeURIComponent(code)}`, {
        layout: L,
        paper_size: active,
        orientation: orientationOf(active),
      })
      const next = saved.layout
      next.formats = next.formats || {}
      next.page = next.page || {}
      next.custom_pages = next.custom_pages || {}
      layoutRef.current = next
      setFormat(active)
      loadSizeControls(active)
      let msg = `Template saved (${saved.paper_size || active}). New prints use this page size and layout.`
      if (isCustom(active)) {
        try {
          const verify = await api.get<{ paper_size?: string; custom_width_mm?: number; custom_height_mm?: number; layout_options?: { designed?: boolean } }>(
            `/print-configs/by-code/${encodeURIComponent(code)}`,
          )
          const ok =
            String(verify.paper_size || '').toUpperCase() === 'CUSTOM' &&
            verify.custom_width_mm &&
            verify.custom_height_mm &&
            verify.layout_options?.designed
          if (!ok) {
            setNotice({
              kind: 'err',
              text: `Save reported OK but the server still shows paper=${verify.paper_size || '—'}, designed=${!!verify.layout_options?.designed}. Save again, then open a bill preview.`,
            })
            setBusy(false)
            return
          }
          msg = `Template saved at ${Number(verify.custom_width_mm).toFixed(1)} × ${Number(verify.custom_height_mm).toFixed(1)} mm. Open a new bill preview — page size should match.`
        } catch {
          /* verification is best-effort */
        }
      }
      setDirty(false)
      syncCanvas(active)
      setNotice({ kind: 'ok', text: msg })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const doServerPreview = async () => {
    const L = layoutRef.current
    if (!L || !code) return
    setBusy(true)
    try {
      const active = updatePage()
      L.active_format = active
      const res = await api.post<{ html: string }>('/print-configs/layouts/preview', {
        code,
        bill_format: active,
        layout: L,
      })
      setPreviewHtml(res.html)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const doRefresh = async () => {
    try {
      await loadCatalog()
    } catch {
      /* optional */
    }
    syncCanvas(format)
  }

  const doClose = () => {
    if (dirty && !window.confirm('Close the designer and discard unsaved changes?')) return
    navigate(`/${returnTo.replace(/^\//, '')}`)
  }

  /* warn on browser close with unsaved work */
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  /* ───────── render ───────── */

  const orientation = layout ? orientationOf(format) : 'portrait'
  const [stockW, stockH] = layout ? paperOf(format) : [210, 297]
  const typedW = Number(pageW)
  const typedH = Number(pageH)
  const typedSize =
    typedW >= 40 && typedH >= 40 && (Math.abs(typedW - stockW) >= 0.1 || Math.abs(typedH - stockH) >= 0.1)
  const paperWmm = typedSize ? typedW : stockW
  const paperHmm = typedSize ? typedH : stockH
  const margins = layout ? readMargins(format) : ([5, 5, 5, 5] as [number, number, number, number])
  const bandsNow = layout ? bandsOf(format) : null
  const free = layout ? isFree(format) : false
  const pageLabel = pageOptions().find((o) => o.code === format)?.label || format
  const docName = documents.find((d) => d.code === code)?.name || 'Bill'
  const showWidthCol = band === 'columns'
  const detailBoxes = meta.detail_boxes !== false
  const colG = (name: string) => !!collapsed[name]

  return (
    <div className="bill-designer">
      <div className="bd-titlebar">
        <h1 className="bd-title">Bill Template Designer</h1>
        <Tool glyph="?" tip="Show how the designer works" onClick={() => setHelpOpen(true)} />
        <Tool
          glyph={ribbonOpen ? '⌃' : '⌄'}
          tip={ribbonOpen ? 'Collapse the ribbon' : 'Expand the ribbon'}
          onClick={() => setRibbonOpen((o) => !o)}
        />
        {dirty && <span className="bd-dirty">● Unsaved changes</span>}
        <span className="bd-spacer" />
        <button
          type="button"
          className="bd-btn"
          onClick={() => void doServerPreview()}
          disabled={busy || !layout}
          title="Render this design with the server (HTML preview with sample data)"
        >
          Server preview
        </button>
        <button
          type="button"
          className="bd-btn primary"
          data-save-shortcut
          onClick={() => void doSave()}
          disabled={busy || !layout}
          title="Save this design. Bills keep the old layout until you save."
        >
          Save template
        </button>
        <button type="button" className="bd-btn" onClick={doClose} title="Leave the designer and return to Print Master">
          Close
        </button>
      </div>

      {notice && (
        <div className={`bd-notice ${notice.kind}`} role={notice.kind === 'err' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      {ribbonOpen && (
        <div className="bd-ribbon">
          <div className="bd-ribbon-row">
            <Group title="Document" collapsed={colG('Document')} onToggle={() => toggleGroup('Document')}>
              <select
                className="bd-input"
                style={{ minWidth: 200 }}
                value={code}
                title="Bill or report to design"
                onChange={(e) => onDocument(e.target.value)}
                disabled={!documents.length}
              >
                {documents.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name || d.code}
                  </option>
                ))}
              </select>
            </Group>
            <Group title="Page" collapsed={colG('Page')} onToggle={() => toggleGroup('Page')}>
              <select
                className="bd-input"
                style={{ minWidth: 200 }}
                value={format}
                title="Paper size or custom page"
                onChange={(e) => onPage(e.target.value)}
                disabled={!layout}
              >
                {pageOptions().map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                className="bd-input"
                value={orientation}
                title="Page orientation"
                onChange={(e) => onOrientation(e.target.value)}
                disabled={!layout}
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </Group>
            <Group title="Size" collapsed={colG('Size')} onToggle={() => toggleGroup('Size')}>
              <CommitInput
                className="bd-input"
                rev={rev}
                value={pageName}
                placeholder={isCustom(format) ? 'Page name' : 'Name for a new custom page'}
                title={
                  isCustom(format)
                    ? 'Edit the name, then press Enter or click the pencil to save.'
                    : 'Type a name here, then click + to copy this page, or the pencil to create a custom size.'
                }
                onCommit={(v) => {
                  setPageName(v)
                  if (isCustom(format) && v.trim()) {
                    const L = layoutRef.current
                    if (L?.custom_pages[format]) {
                      remember()
                      L.custom_pages[format].name = v.trim()
                      publishPages()
                      syncCanvas(format)
                    }
                  }
                }}
              />
              <label className="bd-mini">W</label>
              <input
                className="bd-input num"
                type="number"
                min={40}
                max={1000}
                step={0.1}
                value={pageW}
                title="Page width in millimetres"
                onChange={(e) => setPageW(e.target.value)}
              />
              <label className="bd-mini">H</label>
              <input
                className="bd-input num"
                type="number"
                min={40}
                max={1000}
                step={0.1}
                value={pageH}
                title="Page height in millimetres"
                onChange={(e) => setPageH(e.target.value)}
              />
              <span className="bd-mini">mm</span>
              <Tool glyph="+" tip="Copy this page: create a new page with the name and size shown" onClick={() => addPage()} />
              <Tool glyph="✎" tip="Apply the name and size to the selected custom page" onClick={updatePage} />
              <Tool glyph="✕" tip="Remove the selected custom page" onClick={removePage} />
            </Group>
            <Group title="View" collapsed={colG('View')} onToggle={() => toggleGroup('View')}>
              <Tool glyph="⤢" tip="Fit the page in the window" onClick={() => canvasRef.current?.zoomFit()} />
              <Tool glyph="−" tip="Zoom out" onClick={() => canvasRef.current?.zoomOut()} />
              <Tool glyph="+" tip="Zoom in" onClick={() => canvasRef.current?.zoomIn()} />
              <Tool glyph="1:1" tip="Actual size (100%)" onClick={() => canvasRef.current?.zoomActual()} />
              <span className="bd-zoom">{zoomPct}%</span>
            </Group>
            <Group title="Page options" collapsed={colG('Page options')} onToggle={() => toggleGroup('Page options')}>
              <Tool
                glyph="▢"
                tip="Print a black border on the page. The dashed margin line stays off the printout."
                active={!!meta.border}
                onClick={() => setMeta({ border: !meta.border })}
              />
              <Tool
                glyph="✥"
                tip="Drag any field to any place on the page, including columns up and down."
                active={!!meta.free_place}
                onClick={() => onFreePlace(!meta.free_place)}
              />
              <Tool
                glyph="⤓"
                tip="End the printed page when the data ends, instead of leaving blank paper."
                active={!!meta.trim_to_content}
                onClick={() => setMeta({ trim_to_content: !meta.trim_to_content })}
              />
            </Group>
            <Group title="Template" collapsed={colG('Template')} onToggle={() => toggleGroup('Template')}>
              <Tool glyph="⟳" tip="Refresh the preview and document list" onClick={() => void doRefresh()} />
              <Tool
                glyph="⇲"
                tip="For a quarter page: keep essential fields and pack them so the content fits."
                onClick={fitSmall}
              />
              <Tool
                glyph="⟲"
                tip="Clear the custom design and use the built-in bill again"
                onClick={() => void doReset()}
                disabled={busy}
              />
              <Tool glyph="↶" tip="Undo (Ctrl+Z)" onClick={undo} disabled={!undoRef.current.length} />
            </Group>
          </div>
          <div className="bd-ribbon-row">
            <Group title="Shapes" collapsed={colG('Shapes')} onToggle={() => toggleGroup('Shapes')}>
              <Tool glyph="—" tip="Insert a horizontal line" onClick={() => addLine('h')} />
              <Tool glyph="|" tip="Insert a vertical line" onClick={() => addLine('v')} />
              <Tool glyph="▭" tip="Insert a rectangle. Drag any side or corner to resize it." onClick={() => addShape('rect')} />
              <Tool glyph="□" tip="Insert a square. Drag any side or corner — it does not stay locked." onClick={() => addShape('square')} />
              <Tool glyph="◯" tip="Insert an ellipse" onClick={() => addShape('ellipse')} />
              <Tool glyph="△" tip="Insert a triangle" onClick={() => addShape('triangle')} />
              <Tool glyph="◇" tip="Insert a diamond" onClick={() => addShape('diamond')} />
              <Tool glyph="▢" tip="Insert a rounded rectangle" onClick={() => addShape('round')} />
              <Tool
                glyph="≡"
                tip="Add a line that prints on every detail row. Select it and press Delete to remove it."
                onClick={addDetailLine}
              />
            </Group>
            <Group title="Rotate" collapsed={colG('Rotate')} onToggle={() => toggleGroup('Rotate')}>
              <Tool glyph="↺" tip="Rotate the selected shape left by 15 degrees" onClick={() => rotateSelected(-15)} disabled={!selShape} />
              <Tool glyph="↻" tip="Rotate the selected shape right by 15 degrees" onClick={() => rotateSelected(15)} disabled={!selShape} />
            </Group>
            <Group title="Detail" collapsed={colG('Detail')} onToggle={() => toggleGroup('Detail')}>
              <Tool
                glyph="⊞"
                tip="Draw a box around each detail cell. Turn this off to keep only the lines you insert."
                active={detailBoxes}
                onClick={() => setMeta({ detail_boxes: !detailBoxes })}
              />
              <Tool
                glyph="⇕"
                tip="Push totals and the signature to the bottom so the detail area fills the page."
                active={!!meta.fit_detail}
                onClick={() => setMeta({ fit_detail: !meta.fit_detail }, false)}
              />
            </Group>
          </div>
        </div>
      )}

      {selShape && (
        <div className="bd-linebar">
          <strong>{shapeKind(selShape) === 'line' ? 'Line' : 'Shape'}</strong>
          {shapeKind(selShape) === 'line' && (
            <select
              className="bd-input"
              value={selShape.mode === 'content' ? 'content' : 'fixed'}
              title="To content matches the chosen field. Fixed length uses the millimetres you set."
              onChange={(e) => {
                remember()
                const mode = e.target.value === 'content' ? 'content' : 'fixed'
                const first = visibleFieldChoices()[0]?.id || ''
                patchShape({ mode, field_id: selShape.field_id || (mode === 'content' ? first : '') })
              }}
            >
              <option value="content">To content</option>
              <option value="fixed">Fixed length</option>
            </select>
          )}
          {shapeKind(selShape) === 'line' && selShape.mode === 'content' && (
            <select
              className="bd-input"
              style={{ minWidth: 180 }}
              value={selShape.field_id || ''}
              title="The line uses this field's width (or height for a vertical line)."
              onChange={(e) => {
                remember()
                patchShape({ field_id: e.target.value })
              }}
            >
              {visibleFieldChoices().map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          {!(shapeKind(selShape) === 'line' && selShape.mode === 'content') && (
            <>
              <label className="bd-mini">{shapeKind(selShape) === 'line' ? 'Length' : 'Width'}</label>
              <input
                className="bd-input num"
                type="number"
                min={2}
                max={1000}
                step={0.5}
                value={num(selShape.width_mm, num(selShape.length_mm, 20))}
                onFocus={remember}
                onChange={(e) => onShapeSize(e.target.value, 'length')}
              />
              <span className="bd-mini">mm</span>
            </>
          )}
          {shapeKind(selShape) !== 'line' && (
            <>
              <label className="bd-mini">Height</label>
              <input
                className="bd-input num"
                type="number"
                min={2}
                max={1000}
                step={0.5}
                value={num(selShape.height_mm, num(selShape.width_mm, 12))}
                onFocus={remember}
                onChange={(e) => onShapeSize(e.target.value, 'height')}
              />
              <span className="bd-mini">mm</span>
            </>
          )}
          <span className="bd-mini">Rotation {num(selShape.rotate_deg)}°</span>
          <button type="button" className="bd-btn" onClick={removeSelectedShape}>
            Remove
          </button>
        </div>
      )}

      <div className="bd-body">
        <div className="bd-left">
          <div className="bd-tabs" role="tablist">
            {bandTabs.map((b) => (
              <button
                key={b.id}
                type="button"
                role="tab"
                aria-selected={band === b.id}
                className={`bd-tab ${band === b.id ? 'active' : ''}`}
                onClick={() => setBand(b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
          <div className="bd-table-wrap">
            <table className="bd-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>Show</th>
                  <th>Caption label</th>
                  <th style={{ width: 84 }}>Align</th>
                  {showWidthCol ? <th style={{ width: 62 }}>Width</th> : <th>Printed text</th>}
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const id = String(f.id || '')
                  const textEditable = isStaticId(id) || TEXT_FIELDS.has(id)
                  const isSelRow = sel?.kind === 'field' && sel.band === band && sel.id === id
                  return (
                    <tr key={id} className={isSelRow ? 'selected' : ''} onClick={() => selectRow(f)}>
                      <td className="c">
                        <input
                          type="checkbox"
                          checked={!!f.visible}
                          aria-label={`Show ${f.label || id}`}
                          onChange={(e) => onShow(f, e.target.checked)}
                        />
                      </td>
                      <td>
                        <CommitInput
                          className="bd-cell-input"
                          rev={rev}
                          value={String(f.label || '')}
                          onCommit={(v) => onCaption(f, v)}
                        />
                      </td>
                      <td>
                        <select
                          className="bd-cell-input"
                          value={f.align || 'left'}
                          onChange={(e) => onAlign(f, e.target.value as Align)}
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </td>
                      {showWidthCol ? (
                        <td>
                          <CommitInput
                            className="bd-cell-input"
                            rev={rev}
                            type="number"
                            value={f.width === null || f.width === undefined ? '' : String(r1(Number(f.width)))}
                            onCommit={(v) => onWidth(f, v)}
                          />
                        </td>
                      ) : (
                        <td>
                          <CommitInput
                            className="bd-cell-input"
                            rev={rev}
                            value={String(f.text || '')}
                            disabled={!textEditable}
                            title={textEditable ? undefined : 'Printed from bill data'}
                            onCommit={(v) => onText(f, v)}
                          />
                        </td>
                      )}
                    </tr>
                  )
                })}
                {!fields.length && (
                  <tr>
                    <td colSpan={4} className="bd-empty">
                      {loadingDoc ? 'Loading…' : 'No fields in this band. Use Add caption to insert text.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="bd-fontrow">
            <label className="bd-mini">Font</label>
            <input
              className="bd-input"
              list="bd-fonts"
              style={{ width: 130 }}
              disabled={!selField}
              value={selField ? fontValues(selField).family : ''}
              onChange={(e) => onFont({ family: e.target.value })}
              title="Font family"
            />
            <datalist id="bd-fonts">
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            <label className="bd-mini">Size</label>
            <input
              className="bd-input num"
              type="number"
              min={6}
              max={36}
              step={0.5}
              disabled={!selField}
              value={selField ? fontValues(selField).size : 10}
              onChange={(e) => onFont({ size: Number(e.target.value) || 10 })}
              title="Font size (pt)"
            />
            <Tool glyph={<b>B</b>} tip="Bold" disabled={!selField} active={!!selField && fontValues(selField).bold} onClick={() => selField && onFont({ bold: !fontValues(selField).bold })} />
            <Tool glyph={<i>I</i>} tip="Italic" disabled={!selField} active={!!selField && fontValues(selField).italic} onClick={() => selField && onFont({ italic: !fontValues(selField).italic })} />
            <Tool glyph={<u>U</u>} tip="Underline" disabled={!selField} active={!!selField && fontValues(selField).underline} onClick={() => selField && onFont({ underline: !fontValues(selField).underline })} />
          </div>

          <div className="bd-actions">
            <button type="button" className="bd-btn" onClick={() => moveRow(-1)} disabled={selRow <= 0}>
              {band === 'columns' ? 'Move left' : 'Move up'}
            </button>
            <button type="button" className="bd-btn" onClick={() => moveRow(1)} disabled={selRow < 0 || selRow >= fields.length - 1}>
              {band === 'columns' ? 'Move right' : 'Move down'}
            </button>
            <button type="button" className="bd-btn" onClick={addCaption} disabled={!layout}>
              Add caption
            </button>
            <button type="button" className="bd-btn" onClick={removeCaption} disabled={selRow < 0}>
              Remove caption
            </button>
          </div>
        </div>

        <TplPreviewPanel
          className="bill-designer"
          title={`Page preview · ${pageLabel}`}
          initial={{
            y: 72,
            w: Math.min(760, Math.max(420, window.innerWidth - 520)),
            h: Math.max(360, window.innerHeight - 110),
          }}
        >
          {loadingDoc && !layout ? <div className="bd-loading">Loading template…</div> : null}
          {layout && bandsNow ? (
            <BillPaperCanvas
              ref={canvasRef}
              bands={bandsNow}
              paperW={paperWmm}
              paperH={paperHmm}
              pageLabel={pageLabel}
              billTitle={docName}
              margins={margins}
              showBorder={!!meta.border}
              free={free}
              fitDetail={!!meta.fit_detail}
              detailBoxes={detailBoxes}
              shapes={shapesOf(format)}
              selection={sel}
              rev={rev}
              onBeforeEdit={remember}
              onSelect={(s) => {
                setSel(s)
                if (s?.kind === 'field') setBand(s.band)
              }}
              onGeometryChange={() => {
                touch()
                bump()
              }}
              onMarginsChange={(l, t, r, b) => {
                const m = metaOf(format)
                m.margin_left_mm = r1(l)
                m.margin_top_mm = r1(t)
                m.margin_right_mm = r1(r)
                m.margin_bottom_mm = r1(b)
                touch()
              }}
              onUndo={undo}
              onCopy={copySelection}
              onPaste={pasteSelection}
              onZoomChange={setZoomPct}
            />
          ) : null}
        </TplPreviewPanel>
      </div>

      {helpOpen && (
        <Modal title="Bill Template Designer" onClose={() => setHelpOpen(false)}>
          {HELP_TEXT.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </Modal>
      )}
      {previewHtml !== null && (
        <TplPreviewPanel
          className="bill-designer"
          title={`Server preview — ${docName} (${pageLabel})`}
          initial={{
            x: 40,
            y: 64,
            w: Math.min(720, window.innerWidth - 80),
            h: Math.max(360, window.innerHeight - 120),
          }}
          onClose={() => setPreviewHtml(null)}
        >
          <iframe className="bd-preview-frame" title="Server preview" sandbox="" srcDoc={previewHtml} />
        </TplPreviewPanel>
      )}
    </div>
  )
}

export default BillTemplateDesignerPage
