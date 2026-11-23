/**
 * Interactive paper canvas: a white sheet at real millimetre size (scaled by zoom).
 * Port of hospital/desktop/app/ui/widgets/bill_paper_canvas.py using absolutely
 * positioned DOM boxes (fields) + an SVG overlay (shapes and handles).
 *
 * The `bands` / `shapes` objects are edited in place (like the desktop canvas);
 * the parent owns undo snapshots (via onBeforeEdit) and re-renders on onGeometryChange.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  BAND_IDS,
  type BandFields,
  type BandId,
  type Box,
  type Field,
  type Selection,
  type Shape,
} from './types'
import {
  clamp,
  computePrintLayout,
  contentWidth,
  defaultBold,
  defaultUnderline,
  fieldById,
  fitFieldsToWidth,
  keyOf,
  normalizePrintY,
  num,
  previewText,
  r1,
  reorderColumnsByX,
  sampleFromFields,
  shapeAngle,
  shapeKind,
  shapePageBoxes,
  shapeSpan,
  type LayoutCtx,
  type ShapeCtx,
} from './layoutUtils'

const PX_PER_MM_100 = 96 / 25.4
const MM_TO_PX_FONT = 25.4 / 72

export interface CanvasHandle {
  zoomIn(): void
  zoomOut(): void
  zoomFit(): void
  zoomActual(): void
  focus(): void
}

interface Props {
  bands: BandFields
  paperW: number
  paperH: number
  pageLabel: string
  billTitle: string
  /** left, top, right, bottom (mm) */
  margins: [number, number, number, number]
  showBorder: boolean
  free: boolean
  fitDetail: boolean
  detailBoxes: boolean
  shapes: Shape[]
  selection: Selection | null
  /** Bumped by the parent after it mutates the layout. */
  rev: number
  onBeforeEdit: () => void
  onSelect: (sel: Selection | null) => void
  onGeometryChange: () => void
  onMarginsChange: (l: number, t: number, r: number, b: number) => void
  onUndo: () => void
  onCopy: () => void
  onPaste: () => void
  onZoomChange: (percent: number) => void
}

interface PX {
  x: number
  y: number
}
interface Rect {
  x: number
  y: number
  w: number
  h: number
}

type FieldDrag = {
  kind: 'move' | 'resize'
  band: BandId
  field: Field
  start: PX
  x: number
  y: number
  w: number
  h: number
}

type ShapeDrag = {
  index: number
  kind: 'move' | 'resize' | 'rotate'
  handle: string
  start: PX
  x: number
  y: number
  length: number
  w: number
  h: number
  cx: number
  cy: number
  angle: number
  pointer: number
}

type MarginSide = 'left' | 'right' | 'top' | 'bottom'

const rotatePoint = (cx: number, cy: number, angleDeg: number, px: number, py: number): PX => {
  const a = (angleDeg * Math.PI) / 180
  const dx = px - cx
  const dy = py - cy
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) }
}

const cursorForHandle = (handle: string): string => {
  if (handle === 'n' || handle === 's') return 'ns-resize'
  if (handle === 'e' || handle === 'w') return 'ew-resize'
  if (handle === 'ne' || handle === 'sw') return 'nesw-resize'
  if (handle === 'nw' || handle === 'se') return 'nwse-resize'
  return 'crosshair'
}

export const BillPaperCanvas = forwardRef<CanvasHandle, Props>(function BillPaperCanvas(props, ref) {
  const {
    bands,
    paperW,
    paperH,
    pageLabel,
    billTitle,
    showBorder,
    free,
    fitDetail,
    detailBoxes,
    shapes,
    selection,
  } = props
  const [, force] = useReducer((n: number) => n + 1, 0)

  const containerRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ w: 800, h: 600 })
  const [fit, setFit] = useState(true)
  const [manualScale, setManualScale] = useState(PX_PER_MM_100)

  /* margins: local while dragging, synced from props otherwise */
  const marginsRef = useRef<[number, number, number, number]>(props.margins)
  const lastMarginKey = useRef('')
  const propKey = props.margins.join('|')
  if (propKey !== lastMarginKey.current) {
    lastMarginKey.current = propKey
    marginsRef.current = [...props.margins] as [number, number, number, number]
  }
  const [mL, mT, mR, mB] = marginsRef.current

  /* interaction refs */
  const fieldDrag = useRef<FieldDrag | null>(null)
  const shapeDrag = useRef<ShapeDrag | null>(null)
  const marginDrag = useRef<MarginSide | null>(null)
  const editMarked = useRef(false)
  const selRef = useRef<Selection | null>(selection)
  selRef.current = selection
  const propsRef = useRef(props)
  propsRef.current = props

  /* viewport size → fit scale */
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setViewport({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const availW = Math.max(viewport.w, 40)
  const fitScale = Math.max(0.2, availW / paperW)
  const scale = fit ? fitScale : manualScale

  useEffect(() => {
    props.onZoomChange(Math.round((scale / PX_PER_MM_100) * 100))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale])

  const setZoom = useCallback(
    (next: number) => {
      setFit(false)
      setManualScale(clamp(next, 0.8, 16))
    },
    [setFit, setManualScale],
  )

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => setZoom(scale * 1.2),
      zoomOut: () => setZoom(scale / 1.2),
      zoomFit: () => setFit(true),
      zoomActual: () => setZoom(PX_PER_MM_100),
      focus: () => containerRef.current?.focus({ preventScroll: true }),
    }),
    [scale, setZoom],
  )

  /* Ctrl+wheel zoom (plain wheel scrolls the sheet) */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom(e.deltaY < 0 ? scale * 1.15 : scale / 1.15)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scale, setZoom])

  /* ───────── derived layout ───────── */
  const { sample, lines } = sampleFromFields(bands, billTitle)
  const lineCount = Math.max(1, lines.length || 1)
  const ctx: LayoutCtx = {
    free,
    fitDetail,
    paperW,
    paperH,
    marginL: mL,
    marginT: mT,
    marginR: mR,
    marginB: mB,
    lineCount,
  }
  const pl = computePrintLayout(bands, ctx)
  const shapeCtx: ShapeCtx = { bands, pl, marginL: mL, marginT: mT, lineCount }
  const sheetW = paperW * scale
  const sheetH = paperH * scale

  /* ───────── geometry helpers ───────── */
  const px = (v: number) => v * scale

  const fieldRect = (box: Box): Rect => ({
    x: px(box[0]),
    y: px(box[1]),
    w: Math.max(4, px(box[2])),
    h: Math.max(4, px(box[3])),
  })

  const pixelRect = (box: Box, padLine: boolean): Rect => {
    const r: Rect = { x: px(box[0]), y: px(box[1]), w: Math.max(1, px(box[2])), h: Math.max(1, px(box[3])) }
    if (padLine && Math.min(r.w, r.h) < 8) {
      if (r.w <= r.h) return { x: r.x + r.w / 2 - 3, y: r.y, w: 6, h: r.h }
      return { x: r.x, y: r.y + r.h / 2 - 3, w: r.w, h: 6 }
    }
    return r
  }

  const shapeRects = (shape: Shape): Rect[] =>
    shapePageBoxes(shape, shapeCtx).map((b) => pixelRect(b, shapeKind(shape) === 'line'))

  const handlePoints = (rect: Rect, kind: string, shape: Shape): Record<string, PX> => {
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    let points: Record<string, PX>
    if (kind === 'line') {
      points =
        shape.axis === 'v'
          ? { n: { x: cx, y: rect.y }, s: { x: cx, y: rect.y + rect.h } }
          : { w: { x: rect.x, y: cy }, e: { x: rect.x + rect.w, y: cy } }
    } else {
      points = {
        nw: { x: rect.x, y: rect.y },
        n: { x: cx, y: rect.y },
        ne: { x: rect.x + rect.w, y: rect.y },
        e: { x: rect.x + rect.w, y: cy },
        se: { x: rect.x + rect.w, y: rect.y + rect.h },
        s: { x: cx, y: rect.y + rect.h },
        sw: { x: rect.x, y: rect.y + rect.h },
        w: { x: rect.x, y: cy },
      }
    }
    points.rotate = { x: cx, y: rect.y - 16 }
    return points
  }

  const localPoint = (rect: Rect, angle: number, pos: PX): PX =>
    angle ? rotatePoint(rect.x + rect.w / 2, rect.y + rect.h / 2, -angle, pos.x, pos.y) : pos

  const hitHandle = (shape: Shape, pos: PX): string | null => {
    if ((shape.mode || 'fixed') === 'content' && shapeKind(shape) === 'line') return null
    const rects = shapeRects(shape)
    const rect = rects[0]
    if (!rect) return null
    const local = localPoint(rect, shapeAngle(shape), pos)
    let best: string | null = null
    let bestD = 8
    for (const [name, p] of Object.entries(handlePoints(rect, shapeKind(shape), shape))) {
      const d = Math.hypot(local.x - p.x, local.y - p.y)
      if (d <= bestD) {
        best = name
        bestD = d
      }
    }
    return best
  }

  const hitShape = (pos: PX): number | null => {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i]
      const rect = shapeRects(shape)[0]
      if (!rect) continue
      const l = localPoint(rect, shapeAngle(shape), pos)
      const inside = l.x >= rect.x && l.x <= rect.x + rect.w && l.y >= rect.y && l.y <= rect.y + rect.h
      if (inside || hitHandle(shape, pos)) return i
    }
    return null
  }

  const hitField = (pos: PX): { band: BandId; field: Field; kind: 'move' | 'resize' } | null => {
    const sel = selRef.current
    for (let b = BAND_IDS.length - 1; b >= 0; b--) {
      const band = BAND_IDS[b]
      const fields = (bands[band] || []).filter((f) => f.visible && f.x_mm !== null && f.x_mm !== undefined)
      for (let i = fields.length - 1; i >= 0; i--) {
        const field = fields[i]
        const box = pl.placed[keyOf(band, String(field.id || ''))]
        if (!box) continue
        const r = fieldRect(box)
        const isSel = sel?.kind === 'field' && sel.band === band && sel.id === field.id
        if (isSel && pos.x >= r.x + r.w - 8 && pos.x <= r.x + r.w && pos.y >= r.y + r.h - 8 && pos.y <= r.y + r.h) {
          return { band, field, kind: 'resize' }
        }
        if (pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h) {
          return { band, field, kind: 'move' }
        }
      }
    }
    return null
  }

  const marginRectPx = (): Rect => ({
    x: px(mL),
    y: px(mT),
    w: Math.max(4, px(paperW - mL - mR)),
    h: Math.max(4, px(paperH - mT - mB)),
  })

  const hitMargin = (pos: PX): MarginSide | null => {
    const r = marginRectPx()
    const tol = 7
    const nearL = Math.abs(pos.x - r.x) <= tol
    const nearR = Math.abs(pos.x - (r.x + r.w)) <= tol
    const nearT = Math.abs(pos.y - r.y) <= tol
    const nearB = Math.abs(pos.y - (r.y + r.h)) <= tol
    const inY = r.y - tol <= pos.y && pos.y <= r.y + r.h + tol
    const inX = r.x - tol <= pos.x && pos.x <= r.x + r.w + tol
    if (nearL && inY) return 'left'
    if (nearR && inY) return 'right'
    if (nearT && inX) return 'top'
    if (nearB && inX) return 'bottom'
    return null
  }

  const contentMm = (pos: PX): PX => ({ x: pos.x / scale - mL, y: pos.y / scale - mT })

  const markEdit = () => {
    if (editMarked.current) return
    editMarked.current = true
    props.onBeforeEdit()
  }

  const setMargins = (l: number, t: number, r: number, b: number, reflow = true) => {
    const prevW = paperW - marginsRef.current[0] - marginsRef.current[2]
    const span = 12
    l = Math.min(Math.max(0, l), Math.max(0, paperW - span))
    r = Math.min(Math.max(0, r), Math.max(0, paperW - l - span))
    t = Math.min(Math.max(0, t), Math.max(0, paperH - span))
    b = Math.min(Math.max(0, b), Math.max(0, paperH - t - span))
    marginsRef.current = [r1(l), r1(t), r1(r), r1(b)]
    const cur = contentWidth(paperW, marginsRef.current[0], marginsRef.current[2])
    if (reflow && Math.abs(cur - prevW) > 0.05) fitFieldsToWidth(bands, cur)
    force()
  }

  /* ───────── shape resize / rotate ───────── */
  const applyShapeResize = (shape: Shape, drag: ShapeDrag, pos: PX) => {
    const m = contentMm(pos)
    const { angle, cx, cy } = drag
    if (drag.handle === 'rotate') {
      const pointer = (Math.atan2(m.x - cx, -(m.y - cy)) * 180) / Math.PI
      shape.rotate_deg = r1((((drag.angle + pointer - drag.pointer) % 360) + 360) % 360)
      return
    }
    const l = rotatePoint(0, 0, -angle, m.x - cx, m.y - cy)
    let left = -drag.w / 2
    let right = drag.w / 2
    let top = -drag.h / 2
    let bottom = drag.h / 2
    const handle = drag.handle || 'se'
    if (handle.includes('e')) right = Math.max(left + 2, l.x)
    else if (handle.includes('w')) left = Math.min(right - 2, l.x)
    if (handle.includes('s')) bottom = Math.max(top + 2, l.y)
    else if (handle.includes('n')) top = Math.min(bottom - 2, l.y)
    const newW = Math.max(2, right - left)
    const newH = Math.max(2, bottom - top)
    const c = rotatePoint(cx, cy, angle, (left + right) / 2, (top + bottom) / 2)
    if (shapeKind(shape) === 'line') {
      if (shape.axis === 'v') {
        shape.length_mm = r1(newH)
        shape.height_mm = r1(newH)
        shape.x_mm = r1(Math.max(0, c.x - 0.2))
        shape.y_mm = r1(Math.max(0, c.y - newH / 2))
      } else {
        shape.length_mm = r1(newW)
        shape.width_mm = r1(newW)
        shape.x_mm = r1(Math.max(0, c.x - newW / 2))
        shape.y_mm = r1(Math.max(0, c.y - 0.2))
      }
      return
    }
    shape.width_mm = r1(newW)
    shape.height_mm = r1(newH)
    shape.length_mm = r1(newW)
    shape.x_mm = r1(Math.max(0, c.x - newW / 2))
    shape.y_mm = r1(Math.max(0, c.y - newH / 2))
  }

  const beginShapeDrag = (index: number, pos: PX, handle: string | null) => {
    const shape = shapes[index]
    const shapeId = String(shape.id || index)
    containerRef.current?.focus({ preventScroll: true })
    editMarked.current = false
    const [, , length] = shapeSpan(shape, bands)
    const kind = shapeKind(shape)
    let width: number
    let height: number
    if (kind === 'line' && shape.axis === 'v') {
      width = 0.4
      height = length
    } else if (kind === 'line') {
      width = length
      height = 0.4
    } else {
      width = Math.max(2, num(shape.width_mm, length))
      height = Math.max(2, num(shape.height_mm, width))
    }
    const cx = num(shape.x_mm) + width / 2
    const cy = num(shape.y_mm) + height / 2
    const m = contentMm(pos)
    const pointer = (Math.atan2(m.x - cx, -(m.y - cy)) * 180) / Math.PI
    shapeDrag.current = {
      index,
      kind: handle === 'rotate' ? 'rotate' : handle ? 'resize' : 'move',
      handle: handle || '',
      start: pos,
      x: num(shape.x_mm),
      y: num(shape.y_mm),
      length,
      w: width,
      h: height,
      cx,
      cy,
      angle: shapeAngle(shape),
      pointer,
    }
    fieldDrag.current = null
    props.onSelect({ kind: 'shape', id: shapeId })
    force()
  }

  /* ───────── pointer handling ───────── */
  const posOf = (e: ReactPointerEvent): PX => {
    const rect = sheetRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const pos = posOf(e)
    const side = hitMargin(pos)
    if (side) {
      marginDrag.current = side
      fieldDrag.current = null
      props.onSelect(null)
      editMarked.current = false
      sheetRef.current?.setPointerCapture(e.pointerId)
      return
    }
    const hit = hitField(pos)
    const sh = (() => {
      const idx = hitShape(pos)
      if (idx === null) return null
      return { index: idx, handle: hitHandle(shapes[idx], pos) || '' }
    })()
    sheetRef.current?.setPointerCapture(e.pointerId)
    if (sh && (!hit || sh.handle)) {
      beginShapeDrag(sh.index, pos, sh.handle || null)
      return
    }
    containerRef.current?.focus({ preventScroll: true })
    if (!hit) {
      shapeDrag.current = null
      fieldDrag.current = null
      props.onSelect(null)
      return
    }
    shapeDrag.current = null
    editMarked.current = false
    const box = pl.placed[keyOf(hit.band, String(hit.field.id || ''))]
    fieldDrag.current = {
      kind: hit.kind,
      band: hit.band,
      field: hit.field,
      start: pos,
      x: num(hit.field.x_mm),
      y: num(hit.field.y_mm),
      w: num(hit.field.width_mm, 10),
      h: box ? box[3] : num(hit.field.height_mm, 6),
    }
    props.onSelect({ kind: 'field', band: hit.band, id: String(hit.field.id || '') })
  }

  const setCursor = (c: string) => {
    if (sheetRef.current) sheetRef.current.style.cursor = c
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pos = posOf(e)
    const sd = shapeDrag.current
    if (sd) {
      const shape = shapes[sd.index]
      if (!shape) return
      const kind = shapeKind(shape)
      const content = kind === 'line' && (shape.mode || 'fixed') === 'content'
      const dx = (pos.x - sd.start.x) / scale
      const dy = (pos.y - sd.start.y) / scale
      markEdit()
      if (sd.kind === 'resize' || sd.kind === 'rotate') applyShapeResize(shape, sd, pos)
      else if (content && shape.axis === 'v') shape.x_mm = r1(Math.max(0, sd.x + dx))
      else if (content) shape.y_mm = r1(Math.max(0, sd.y + dy))
      else {
        shape.x_mm = r1(Math.max(0, sd.x + dx))
        shape.y_mm = r1(Math.max(0, sd.y + dy))
      }
      if (sd.handle) setCursor(cursorForHandle(sd.handle))
      force()
      return
    }
    const md = marginDrag.current
    if (md) {
      const mmX = pos.x / scale
      const mmY = pos.y / scale
      let [l, t, r, b] = marginsRef.current
      if (md === 'left') l = mmX
      else if (md === 'right') r = paperW - mmX
      else if (md === 'top') t = mmY
      else b = paperH - mmY
      setMargins(l, t, r, b)
      setCursor(md === 'left' || md === 'right' ? 'ew-resize' : 'ns-resize')
      return
    }
    const fd = fieldDrag.current
    if (!fd) {
      /* hover cursor */
      const side = hitMargin(pos)
      if (side === 'left' || side === 'right') return setCursor('ew-resize')
      if (side === 'top' || side === 'bottom') return setCursor('ns-resize')
      const idx = hitShape(pos)
      if (idx !== null) {
        const h = hitHandle(shapes[idx], pos)
        return setCursor(h ? cursorForHandle(h) : 'move')
      }
      const hit = selRef.current ? hitField(pos) : null
      if (hit?.kind === 'resize') return setCursor('nwse-resize')
      if (hit) return setCursor('move')
      return setCursor('')
    }
    const dx = (pos.x - fd.start.x) / scale
    const dy = (pos.y - fd.start.y) / scale
    const field = fd.field
    markEdit()
    const cw = contentWidth(paperW, mL, mR)
    if (fd.kind === 'resize') {
      const width = Math.max(8, Math.min(cw - fd.x, fd.w + dx))
      const height = Math.max(3.4, fd.h + dy)
      field.width_mm = r1(width)
      field.height_mm = r1(height)
      // Printed row height follows font size, so the corner changes that size.
      field.font_size_pt = r1(Math.max(6, Math.min(36, (height - 0.7) / (0.3528 * 1.25))))
      if (fd.band === 'columns') field.width = field.width_mm
    } else {
      const width = num(field.width_mm, fd.w)
      field.x_mm = r1(Math.min(Math.max(0, fd.x + dx), Math.max(0, cw - width)))
      if (fd.band === 'columns' && !free) field.y_mm = r1(fd.y)
      else field.y_mm = r1(Math.min(Math.max(0, fd.y + dy), Math.max(0, paperH - 4)))
    }
    force()
  }

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      sheetRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* not captured */
    }
    if (shapeDrag.current) {
      shapeDrag.current = null
      props.onGeometryChange()
      force()
      return
    }
    if (marginDrag.current) {
      marginDrag.current = null
      const [l, t, r, b] = marginsRef.current
      props.onMarginsChange(l, t, r, b)
      props.onGeometryChange()
      setCursor('')
      force()
      return
    }
    const fd = fieldDrag.current
    if (fd) {
      const cw = contentWidth(paperW, mL, mR)
      if (free) {
        /* keep where it was dropped */
      } else if (fd.band === 'columns' && fd.kind === 'move') {
        reorderColumnsByX(bands.columns || [], cw)
      } else if (fd.band !== 'columns') {
        normalizePrintY(bands[fd.band] || [])
      }
      fieldDrag.current = null
      props.onGeometryChange()
      setCursor('')
      force()
    }
  }

  /* ───────── keyboard ───────── */
  const nudge = (dxStep: number, dyStep: number) => {
    const sel = selRef.current
    if (!sel) return
    editMarked.current = false
    markEdit()
    if (sel.kind === 'shape') {
      const shape = shapes.find((s) => String(s.id || '') === sel.id)
      if (!shape) return
      shape.x_mm = r1(Math.max(0, num(shape.x_mm) + dxStep))
      shape.y_mm = r1(Math.max(0, num(shape.y_mm) + dyStep))
    } else {
      const field = fieldById(bands, sel.id)
      if (!field) return
      const cw = contentWidth(paperW, mL, mR)
      const width = num(field.width_mm, 10)
      field.x_mm = r1(Math.min(Math.max(0, num(field.x_mm) + dxStep), Math.max(0, cw - width)))
      if (sel.band !== 'columns' || free) field.y_mm = r1(Math.max(0, num(field.y_mm) + dyStep))
    }
    editMarked.current = false
    props.onGeometryChange()
    force()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const key = e.key
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && key.toLowerCase() === 'z') {
      e.preventDefault()
      props.onUndo()
      return
    }
    if (ctrl && key.toLowerCase() === 'c') {
      e.preventDefault()
      props.onCopy()
      return
    }
    if (ctrl && key.toLowerCase() === 'v') {
      e.preventDefault()
      props.onPaste()
      return
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      e.preventDefault()
      const step = e.shiftKey ? 5 : 1
      nudge(
        key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0,
        key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0,
      )
      return
    }
    if (key !== 'Delete' && key !== 'Backspace') return
    const sel = selRef.current
    if (!sel || sel.kind !== 'shape') return
    e.preventDefault()
    editMarked.current = false
    markEdit()
    const kept = shapes.filter((s) => String(s.id || '') !== sel.id)
    shapes.splice(0, shapes.length, ...kept)
    editMarked.current = false
    props.onSelect(null)
    props.onGeometryChange()
    force()
  }

  /* ───────── render ───────── */
  const limit = paperH - mB
  const overflow = pl.bottom > limit
  const detailFont = Math.max(10, Math.round(8 * scale * MM_TO_PX_FONT))

  const cellText = (line: Record<string, string>, fid: string) =>
    line[fid] === undefined || line[fid] === null ? '' : String(line[fid])

  const renderDetail = () => {
    const cols = (bands.columns || []).filter((f) => f.visible && f.x_mm !== null && f.x_mm !== undefined)
    if (!cols.length) return null
    const boxes = cols.map((f) => pl.placed[keyOf('columns', String(f.id || ''))]).filter(Boolean)
    if (!boxes.length) return null
    const ordered = [...cols].sort((a, b) => num(a.x_mm) - num(b.x_mm))
    const out: ReactElement[] = []
    const justify = (a?: string) => (a === 'center' ? 'center' : a === 'right' ? 'flex-end' : 'flex-start')
    if (free) {
      lines.forEach((line, index) => {
        for (const f of ordered) {
          const b = pl.placed[keyOf('columns', String(f.id || ''))]
          if (!b) continue
          const [x, y, w, h] = b
          out.push(
            <div
              key={`d${index}-${f.id}`}
              className={`bd-cell ${detailBoxes ? 'boxed' : ''}`}
              style={{
                left: px(x),
                top: px(y + h * (index + 1)),
                width: Math.max(2, px(w)),
                height: Math.max(2, px(h)),
                fontSize: detailFont,
                justifyContent: justify(f.align),
              }}
            >
              <span>{cellText(line, String(f.id))}</span>
            </div>,
          )
        }
      })
      return out
    }
    const headerBottom = Math.max(...boxes.map((b) => b[1] + b[3]))
    const left = mL + Math.min(...cols.map((f) => num(f.x_mm)))
    const right = mL + Math.max(...cols.map((f) => num(f.x_mm) + num(f.width_mm)))
    const rowH = Math.max(...boxes.map((b) => b[3])) * scale
    lines.forEach((line, index) => {
      const y = headerBottom * scale + index * rowH
      out.push(
        <div
          key={`r${index}`}
          className={`bd-cell-row ${detailBoxes ? 'boxed' : ''}`}
          style={{ left: px(left), top: y, width: Math.max(4, px(right - left)), height: rowH }}
        />,
      )
      for (const f of ordered) {
        out.push(
          <div
            key={`c${index}-${f.id}`}
            className="bd-cell"
            style={{
              left: px(mL + num(f.x_mm)),
              top: y,
              width: Math.max(2, px(num(f.width_mm, 10))),
              height: rowH,
              fontSize: detailFont,
              justifyContent: justify(f.align),
            }}
          >
            <span>{cellText(line, String(f.id))}</span>
          </div>,
        )
      }
    })
    return out
  }

  const renderFields = () => {
    const out: ReactElement[] = []
    for (const band of BAND_IDS) {
      for (const f of bands[band] || []) {
        if (!f.visible || f.x_mm === null || f.x_mm === undefined) continue
        const box = pl.placed[keyOf(band, String(f.id || ''))]
        if (!box) continue
        const r = fieldRect(box)
        const fid = String(f.id || '')
        const isSel = selection?.kind === 'field' && selection.band === band && selection.id === fid
        const pt = num(f.font_size_pt, 10)
        const family = String(f.font_family || 'Times New Roman').trim() || 'Times New Roman'
        const bold = f.font_bold !== undefined ? !!f.font_bold : defaultBold(f)
        const underline = f.font_underline !== undefined ? !!f.font_underline : defaultUnderline(f)
        const align = f.align || (band === 'header' ? 'center' : 'left')
        out.push(
          <div
            key={`${band}:${fid}`}
            className={`bd-field ${isSel ? 'selected' : ''}`}
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              fontFamily: `"${family}", "Times New Roman", serif`,
              fontSize: Math.max(11, Math.round(pt * scale * MM_TO_PX_FONT)),
              fontWeight: bold ? 700 : 400,
              fontStyle: f.font_italic ? 'italic' : 'normal',
              textDecoration: underline ? 'underline' : 'none',
              justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
              textAlign: align,
            }}
          >
            {fid === 'signature' && <i className="bd-sigline" />}
            <span>{previewText(f, band, sample)}</span>
            {isSel && <b className="bd-resize" />}
          </div>,
        )
      }
    }
    return out
  }

  const renderShapes = () =>
    shapes.map((shape, index) => {
      const kind = shapeKind(shape)
      const rects = shapeRects(shape)
      const sid = String(shape.id || index)
      const isSel = selection?.kind === 'shape' && selection.id === sid
      const content = (shape.mode || 'fixed') === 'content'
      const angle = shapeAngle(shape)
      const stroke = isSel ? '#1d4ed8' : '#000000'
      const sw = isSel ? 1.6 : 1.2
      return rects.map((r, ri) => {
        const cx = r.x + r.w / 2
        const cy = r.y + r.h / 2
        let glyph: ReactElement
        if (kind === 'line') {
          glyph =
            shape.axis === 'v' ? (
              <line x1={cx} y1={r.y} x2={cx} y2={r.y + r.h} />
            ) : (
              <line x1={r.x} y1={cy} x2={r.x + r.w} y2={cy} />
            )
        } else if (kind === 'ellipse') {
          glyph = <ellipse cx={cx} cy={cy} rx={r.w / 2} ry={r.h / 2} />
        } else if (kind === 'triangle') {
          glyph = <polygon points={`${cx},${r.y} ${r.x + r.w},${r.y + r.h} ${r.x},${r.y + r.h}`} />
        } else if (kind === 'diamond') {
          glyph = <polygon points={`${cx},${r.y} ${r.x + r.w},${cy} ${cx},${r.y + r.h} ${r.x},${cy}`} />
        } else if (kind === 'round') {
          const rad = Math.min(r.w, r.h) * 0.22
          glyph = <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={rad} ry={rad} />
        } else {
          glyph = <rect x={r.x} y={r.y} width={r.w} height={r.h} />
        }
        const showHandles = isSel && ri === 0 && !content
        const pts = showHandles ? handlePoints(r, kind, shape) : null
        return (
          <g
            key={`${sid}-${ri}`}
            transform={angle ? `rotate(${angle} ${cx} ${cy})` : undefined}
            stroke={stroke}
            strokeWidth={sw}
            fill="none"
          >
            {glyph}
            {pts &&
              Object.entries(pts).map(([name, p]) =>
                name === 'rotate' ? (
                  <g key={name}>
                    <line x1={cx} y1={r.y} x2={p.x} y2={p.y} strokeWidth={1} />
                    <circle cx={p.x} cy={p.y} r={5} strokeWidth={1} fill="#ffffff" />
                  </g>
                ) : (
                  <rect key={name} x={p.x - 3.5} y={p.y - 3.5} width={7} height={7} fill="#1d4ed8" stroke="none" />
                ),
              )}
          </g>
        )
      })
    })

  const mr = marginRectPx()
  const barW = Math.min(220, Math.max(80, viewport.w - 180))

  return (
    <div
      className="bd-canvas"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Bill paper canvas"
    >
      <div className="bd-canvas-inner">
        <div className="bd-canvas-caption">
          {pageLabel} · {paperW.toFixed(1)} × {paperH.toFixed(1)} mm · margin {mL.toFixed(1)}, {mT.toFixed(1)},{' '}
          {mR.toFixed(1)}, {mB.toFixed(1)}
        </div>
        <div className="bd-sheet-shadow" style={{ width: sheetW, height: sheetH }}>
          <div
            ref={sheetRef}
            className="bd-sheet"
            style={{ width: sheetW, height: sheetH }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {showBorder && (
              <div className="bd-print-border" style={{ left: mr.x, top: mr.y, width: mr.w, height: mr.h }} />
            )}
            <div className="bd-margin-guide" style={{ left: mr.x, top: mr.y, width: mr.w, height: mr.h }} />
            {overflow && <div className="bd-cut-line" style={{ top: px(limit), width: sheetW }} />}
            {renderDetail()}
            {renderFields()}
            <svg className="bd-shapes" width={sheetW} height={sheetH}>
              {renderShapes()}
            </svg>
          </div>
        </div>
        <div className="bd-canvas-sizekey">
          <span>Page {paperW.toFixed(0)} mm</span>
          <i style={{ width: barW }} />
        </div>
        <div className={`bd-canvas-note ${overflow ? 'warn' : ''}`}>
          {overflow
            ? 'Content is taller than this paper — drag fields up, hide some, or use a larger page.'
            : showBorder
              ? 'Dashed line is the margin (not printed). The black line is the border and will print.'
              : 'Dashed line is the margin. Drag it to resize. It does not print.'}
        </div>
      </div>
    </div>
  )
})
