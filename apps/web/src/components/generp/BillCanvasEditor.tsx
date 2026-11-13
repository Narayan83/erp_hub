import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  BAND_LABELS,
  LAYOUT_FONTS,
  autoPlaceBand,
  bandIsPlaced,
  bandOf,
  clearFieldPlaces,
  fitLayoutToPage,
  layoutNeedsFit,
  packColumnsLeft,
  pagePaddingOf,
  pageSpecOf,
  patchBand,
  sampleFieldText,
  setPageBorder,
  setPagePadding,
  type BandId,
  type DocumentLayout,
  type LayoutAlign,
  type LayoutField,
  type PagePadding,
} from '../../lib/generp/printLayout'

type DragKind = 'move' | 'resize'
type Selected = { band: BandId; id: string } | 'page_border'

const BAND_ORDER: BandId[] = ['header', 'meta', 'columns', 'totals', 'footer']

function bandHeightMm(fields: LayoutField[], extra = 2) {
  const vis = fields.filter((f) => f.visible && f.xMm != null)
  if (!vis.length) return 12
  return Math.max(12, ...vis.map((f) => (f.yMm || 0) + (f.heightMm || 6))) + extra
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function BillCanvasEditor({
  layout,
  format,
  logoUrl,
  onChange,
}: {
  layout: DocumentLayout
  format: string
  logoUrl?: string | null
  onChange: (next: DocumentLayout) => void
}) {
  const pagePad = pagePaddingOf(layout, format)
  const spec = pageSpecOf(layout, format)
  const band = bandOf(layout, format)
  const pageBorder = !!(layout.page_borders || {})[format]
  const [selected, setSelected] = useState<Selected>({ band: 'header', id: 'company_name' })
  const pageRef = useRef<HTMLDivElement | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const drag = useRef<{
    kind: DragKind
    band: BandId
    id: string
    startX: number
    startY: number
    xMm: number
    yMm: number
    widthMm: number
    heightMm: number
  } | null>(null)

  const visibleBands = useMemo(
    () => BAND_ORDER.filter((id) => (band[id] || []).some((f) => f.visible)),
    [band],
  )

  const needsPlace = BAND_ORDER.some((id) => {
    const fields = band[id] || []
    return fields.some((f) => f.visible) && !bandIsPlaced(fields)
  })

  useEffect(() => {
    if (!needsPlace) return
    let next = layoutRef.current
    let changed = false
    for (const bandId of BAND_ORDER) {
      const fields = bandOf(next, format)[bandId] || []
      if (!fields.length || !fields.some((f) => f.visible) || bandIsPlaced(fields)) continue
      next = patchBand(next, format, bandId, autoPlaceBand(fields, format, bandId, spec.innerMm))
      changed = true
    }
    if (changed) onChange(next)
  }, [needsPlace, format, onChange])

  const fittedFor = useRef('')
  useEffect(() => {
    const key = `${format}:${spec.orientation}:${Math.round(spec.innerMm * 10)}:${Math.round(spec.paperMm * 10)}x${Math.round(spec.paperHeightMm * 10)}`
    if (fittedFor.current === key) return
    const current = layoutRef.current
    if (!layoutNeedsFit(current, format)) {
      fittedFor.current = key
      return
    }
    fittedFor.current = key
    onChange(fitLayoutToPage(current, format))
  }, [format, spec.orientation, spec.innerMm, spec.paperMm, spec.paperHeightMm, onChange])

  const selectedField: LayoutField | null = (() => {
    if (selected === 'page_border') return null
    return (band[selected.band] || []).find((f) => f.id === selected.id) || null
  })()

  const patchField = (bandId: BandId, id: string, patch: Partial<LayoutField>) => {
    onChange(
      patchBand(
        layout,
        format,
        bandId,
        (band[bandId] || []).map((f) => (f.id === id ? { ...f, ...patch } : f)),
      ),
    )
  }

  const patchSelected = (patch: Partial<LayoutField>) => {
    if (selected === 'page_border' || !selectedField) return
    if (selected.band === 'columns' && (patch.widthMm != null || patch.width != null)) {
      const fields = (band.columns || []).map((f) => (f.id === selected.id ? { ...f, ...patch } : f))
      onChange(patchBand(layout, format, 'columns', packColumnsLeft(fields, format, spec.innerMm)))
      return
    }
    patchField(selected.band, selected.id, patch)
  }

  const patchPagePad = (patch: Partial<PagePadding>) => {
    const fromInner = spec.innerMm
    onChange(fitLayoutToPage(setPagePadding(layout, format, patch), format, fromInner))
  }

  const selectAfterHide = (bandId: BandId, id: string) => {
    if (selected === 'page_border' || selected.band !== bandId || selected.id !== id) return
    for (const b of BAND_ORDER) {
      const next = (band[b] || []).find((f) => f.visible && f.id !== id)
      if (next) {
        setSelected({ band: b, id: next.id })
        return
      }
    }
    setSelected('page_border')
  }

  const hideField = (bandId: BandId, id: string) => {
    if (id.startsWith('static_')) {
      onChange(patchBand(layout, format, bandId, (band[bandId] || []).filter((f) => f.id !== id)))
    } else {
      patchField(bandId, id, { visible: false })
    }
    selectAfterHide(bandId, id)
  }

  const restoreField = (bandId: BandId, id: string) => {
    const field = (band[bandId] || []).find((f) => f.id === id)
    if (!field) return
    const inner = spec.innerMm
    const y =
      Math.max(0, ...(band[bandId] || []).filter((f) => f.visible).map((f) => (f.yMm || 0) + (f.heightMm || 6))) + 1
    patchField(bandId, id, {
      visible: true,
      xMm: field.xMm ?? 1,
      yMm: field.yMm ?? y,
      widthMm: field.widthMm ?? inner - 2,
      heightMm: field.heightMm ?? 6,
    })
    setSelected({ band: bandId, id })
  }

  const hideSelected = () => {
    if (selected === 'page_border') {
      onChange(setPageBorder(layout, format, false))
      return
    }
    hideField(selected.band, selected.id)
  }

  const onEditorKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    e.preventDefault()
    hideSelected()
  }

  const onPointerDown = (
    e: ReactPointerEvent<HTMLElement>,
    bandId: BandId,
    id: string,
    kind: DragKind,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const field = (band[bandId] || []).find((f) => f.id === id)
    if (!field) return
    setSelected({ band: bandId, id })
    drag.current = {
      kind,
      band: bandId,
      id,
      startX: e.clientX,
      startY: e.clientY,
      xMm: field.xMm || 0,
      yMm: field.yMm || 0,
      widthMm: field.widthMm || 20,
      heightMm: field.heightMm || 6,
    }
    pageRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const page = pageRef.current
    const pxPerMm = page && spec.innerMm > 0 ? page.getBoundingClientRect().width / spec.innerMm : spec.scale
    const dx = (e.clientX - d.startX) / pxPerMm
    const dy = (e.clientY - d.startY) / pxPerMm
    const inner = spec.innerMm
    let next: Partial<LayoutField>
    if (d.kind === 'move') {
      const maxX = Math.max(0, inner - (d.widthMm || 2))
      next = {
        xMm: Math.round(clamp(d.xMm + dx, 0, maxX) * 10) / 10,
        yMm: Math.round(clamp(d.yMm + dy, 0, 120) * 10) / 10,
      }
    } else {
      const maxW = Math.max(2, inner - d.xMm)
      next = {
        widthMm: Math.round(clamp(d.widthMm + dx, 2, maxW) * 10) / 10,
        heightMm: Math.round(clamp(d.heightMm + dy, 1.5, 40) * 10) / 10,
      }
      if (d.band === 'columns') {
        next.width = Math.max(2, Math.min(400, Math.round(next.widthMm || 10)))
      }
    }
    patchField(d.band, d.id, next)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    try {
      pageRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    if (d?.band === 'columns') {
      const current = bandOf(layoutRef.current, format)
      const fields = current.columns
      const vis = fields.filter((f) => f.visible).sort((a, b) => (a.xMm || 0) - (b.xMm || 0))
      const hidden = fields.filter((f) => !f.visible)
      const inner = pageSpecOf(layoutRef.current, format).innerMm
      onChange(patchBand(layoutRef.current, format, 'columns', packColumnsLeft([...vis, ...hidden], format, inner)))
    }
  }

  const resetPositions = () => {
    let next = layout
    for (const bandId of BAND_ORDER) {
      const fields = bandOf(next, format)[bandId] || []
      if (!fields.length) continue
      next = patchBand(next, format, bandId, autoPlaceBand(clearFieldPlaces(fields), format, bandId, spec.innerMm))
    }
    onChange(next)
  }

  return (
    <div className="bill-canvas-editor" tabIndex={0} onKeyDown={onEditorKeyDown}>
      <div className="settings-box-title" style={{ fontSize: 12 }}>
        Bill designer — {format.replace('_', ' ')} {spec.orientation}
      </div>
      <p className="hint" style={{ margin: '0 0 8px' }}>
        Click a variable, then drag it on the page like Word. × removes it from the print — put it back from
        Removed. Item columns stay a table that grows with bill lines. Footer stays below the items.
      </p>
      <div className="bcd-toolbar">
        <select
          className="input"
          value={selectedField?.fontFamily || 'Times New Roman'}
          disabled={selected === 'page_border'}
          onChange={(e) => patchSelected({ fontFamily: e.target.value })}
        >
          {LAYOUT_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <input
          className="input"
          type="number"
          min={5}
          max={36}
          step={0.5}
          title="Font size (pt)"
          disabled={selected === 'page_border'}
          value={selectedField?.fontSizePt ?? 11}
          onChange={(e) => patchSelected({ fontSizePt: Number(e.target.value) || 11 })}
        />
        <button
          type="button"
          className={`btn${selectedField?.bold ? ' btn-primary' : ''}`}
          disabled={selected === 'page_border'}
          onClick={() => patchSelected({ bold: !selectedField?.bold })}
        >
          B
        </button>
        {(['left', 'center', 'right'] as LayoutAlign[]).map((a) => (
          <button
            key={a}
            type="button"
            className={`btn${selectedField?.align === a ? ' btn-primary' : ''}`}
            disabled={selected === 'page_border'}
            onClick={() => patchSelected({ align: a })}
          >
            {a === 'left' ? 'L' : a === 'right' ? 'R' : 'C'}
          </button>
        ))}
        <label className="bcd-check">
          <input
            type="checkbox"
            checked={selected === 'page_border' ? pageBorder : !!selectedField?.border}
            onChange={(e) => {
              if (selected === 'page_border') onChange(setPageBorder(layout, format, e.target.checked))
              else patchSelected({ border: e.target.checked })
            }}
          />
          Border
        </label>
        <label className="bcd-check">
          <input
            type="checkbox"
            checked={pageBorder}
            onChange={(e) => {
              onChange(setPageBorder(layout, format, e.target.checked))
              if (e.target.checked) setSelected('page_border')
            }}
          />
          Page border
        </label>
        <button type="button" className="btn" onClick={resetPositions}>
          Reset positions
        </button>
        <button
          type="button"
          className="btn"
          title="Stretch fields and columns across the printable width"
          onClick={() => onChange(fitLayoutToPage(layout, format))}
        >
          Fit to page
        </button>
        <button type="button" className="btn" title="Remove from print" onClick={hideSelected}>
          Remove
        </button>
      </div>
      {selected === 'page_border' && (
        <div className="bcd-nudge">
          <span>Page inset</span>
          <label>
            L
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              max={40}
              value={pagePad.paddingLeftMm}
              onChange={(e) => patchPagePad({ paddingLeftMm: Number(e.target.value) })}
            />
          </label>
          <label>
            R
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              max={40}
              value={pagePad.paddingRightMm}
              onChange={(e) => patchPagePad({ paddingRightMm: Number(e.target.value) })}
            />
          </label>
          <label>
            T
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              max={40}
              value={pagePad.paddingTopMm}
              onChange={(e) => patchPagePad({ paddingTopMm: Number(e.target.value) })}
            />
          </label>
          <label>
            B
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              max={40}
              value={pagePad.paddingBottomMm}
              onChange={(e) => patchPagePad({ paddingBottomMm: Number(e.target.value) })}
            />
          </label>
          <span className="hint">mm page margin on the printer</span>
        </div>
      )}
      {selectedField && (
        <div className="bcd-nudge">
          <span>{selectedField.label || selectedField.id}</span>
          <label>
            X
            <input
              className="input"
              type="number"
              step={0.1}
              value={selectedField.xMm ?? 0}
              onChange={(e) => {
                const widthMm = selectedField.widthMm || 20
                const maxX = Math.max(0, spec.innerMm - widthMm)
                patchSelected({ xMm: clamp(Number(e.target.value), 0, maxX) })
              }}
            />
          </label>
          <label>
            Y
            <input
              className="input"
              type="number"
              step={0.1}
              value={selectedField.yMm ?? 0}
              onChange={(e) => patchSelected({ yMm: Number(e.target.value) })}
            />
          </label>
          <label>
            W
            <input
              className="input"
              type="number"
              step={0.1}
              min={2}
              value={selectedField.widthMm ?? 20}
              onChange={(e) => {
                const xMm = selectedField.xMm || 0
                const maxW = Math.max(2, spec.innerMm - xMm)
                patchSelected({ widthMm: clamp(Number(e.target.value), 2, maxW) })
              }}
            />
          </label>
          <label>
            H
            <input
              className="input"
              type="number"
              step={0.1}
              min={1.5}
              value={selectedField.heightMm ?? 6}
              onChange={(e) => patchSelected({ heightMm: Number(e.target.value) })}
            />
          </label>
          <label>
            Pad L
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              max={20}
              value={selectedField.paddingLeftMm ?? 0}
              onChange={(e) => patchSelected({ paddingLeftMm: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <label>
            R
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              max={20}
              value={selectedField.paddingRightMm ?? 0}
              onChange={(e) => patchSelected({ paddingRightMm: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <label>
            T
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              max={20}
              value={selectedField.paddingTopMm ?? 0}
              onChange={(e) => patchSelected({ paddingTopMm: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <label>
            B
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              max={20}
              value={selectedField.paddingBottomMm ?? 0}
              onChange={(e) => patchSelected({ paddingBottomMm: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <span className="hint">mm from the section; L/C/R aligns text inside the box — drag the box to move it</span>
        </div>
      )}
      <div className="bcd-work">
        <div className="bcd-list bill-var-list" role="listbox" aria-label="Bill variables">
          {visibleBands.map((bandId) => (
            <div key={bandId}>
              <div className="bill-var-group">{BAND_LABELS[bandId]}</div>
              {(band[bandId] || [])
                .filter((f) => f.visible)
                .map((f) => (
                  <div key={f.id} className="bcd-list-row">
                    <button
                      type="button"
                      className={`bcd-list-item${
                        selected !== 'page_border' && selected.band === bandId && selected.id === f.id
                          ? ' active'
                          : ''
                      }`}
                      onClick={() => setSelected({ band: bandId, id: f.id })}
                    >
                      {f.label || f.id}
                    </button>
                    <button
                      type="button"
                      className="btn bcd-list-x"
                      title="Remove from print"
                      onClick={() => hideField(bandId, f.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
            </div>
          ))}
          {pageBorder ? (
            <div className="bcd-list-row">
              <button
                type="button"
                className={`bcd-list-item${selected === 'page_border' ? ' active' : ''}`}
                onClick={() => setSelected('page_border')}
              >
                Page border
              </button>
              <button
                type="button"
                className="btn bcd-list-x"
                title="Remove page border"
                onClick={() => onChange(setPageBorder(layout, format, false))}
              >
                ×
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`bcd-list-item${selected === 'page_border' ? ' active' : ''}`}
              onClick={() => {
                setSelected('page_border')
                onChange(setPageBorder(layout, format, true))
              }}
            >
              Page border
            </button>
          )}
          {BAND_ORDER.some((id) => (band[id] || []).some((f) => !f.visible)) && (
            <div className="bcd-removed">
              <div className="bcd-removed-label">Removed — click to put back</div>
              {BAND_ORDER.map((bandId) =>
                (band[bandId] || [])
                  .filter((f) => !f.visible)
                  .map((f) => (
                    <button
                      key={`${bandId}-${f.id}`}
                      type="button"
                      className="btn"
                      onClick={() => restoreField(bandId, f.id)}
                    >
                      + {f.label || f.id}
                    </button>
                  )),
              )}
            </div>
          )}
        </div>
        <div
          className={`bill-page-sheet${selected === 'page_border' ? ' is-selected' : ''}`}
          style={{
            width: spec.paperMm * spec.scale,
            minHeight: format.startsWith('THERMAL') ? undefined : spec.paperHeightMm * spec.scale,
            padding: `${pagePad.paddingTopMm * spec.scale}px ${pagePad.paddingRightMm * spec.scale}px ${pagePad.paddingBottomMm * spec.scale}px ${pagePad.paddingLeftMm * spec.scale}px`,
          }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('.bill-item')) return
            setSelected('page_border')
          }}
        >
        <div
          ref={pageRef}
          className={`bill-page${pageBorder ? ' has-border' : ''}`}
          style={{
            width: spec.innerMm * spec.scale,
            minHeight: format.startsWith('THERMAL')
              ? undefined
              : Math.max(40, spec.paperHeightMm - pagePad.paddingTopMm - pagePad.paddingBottomMm) * spec.scale,
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {visibleBands.map((bandId) => {
            const fields = (band[bandId] || []).filter((f) => f.visible)
            const extra = bandId === 'columns' ? 12 : 2
            const height = bandHeightMm(band[bandId] || [], extra)
            return (
              <div
                key={bandId}
                className="bill-band"
                style={{ height: height * spec.scale }}
              >
                <span className="bill-band-tag">{bandId}</span>
                {fields.map((field) => {
                  const x = field.xMm || 0
                  const y = field.yMm || 0
                  const w = field.widthMm || 20
                  const h = field.heightMm || 6
                  const isSel =
                    selected !== 'page_border' && selected.band === bandId && selected.id === field.id
                  return (
                    <div
                      key={field.id}
                      className={`bill-item${isSel ? ' selected' : ''}${field.border ? ' has-box' : ''}`}
                      style={{
                        left: x * spec.scale,
                        top: y * spec.scale,
                        width: w * spec.scale,
                        height: h * spec.scale,
                        fontFamily: field.fontFamily || 'Times New Roman',
                        fontSize: `${(field.fontSizePt || 11) * 0.3528 * spec.scale}px`,
                        fontWeight: field.bold ? 700 : 400,
                        textAlign: field.align || 'left',
                        padding: `${(field.paddingTopMm || 0) * spec.scale}px ${(field.paddingRightMm || 0) * spec.scale}px ${(field.paddingBottomMm || 0) * spec.scale}px ${(field.paddingLeftMm || 0) * spec.scale}px`,
                        overflow: 'hidden',
                        boxSizing: 'border-box',
                      }}
                      onPointerDown={(e) => onPointerDown(e, bandId, field.id, 'move')}
                    >
                      {bandId === 'columns' ? (
                        field.label || field.id
                      ) : field.id === 'company_logo' ? (
                        logoUrl ? (
                          <img src={logoUrl} alt="" className="print-logo-img" draggable={false} />
                        ) : (
                          'Logo'
                        )
                      ) : (
                        sampleFieldText(field)
                      )}
                      <span
                        className="bcd-handle"
                        onPointerDown={(e) => onPointerDown(e, bandId, field.id, 'resize')}
                      />
                      {isSel && (
                        <button
                          type="button"
                          className="bcd-item-remove"
                          title="Remove from print"
                          onPointerDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            hideField(bandId, field.id)
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  )
                })}
                {bandId === 'columns' && (
                  <div className="bill-table-hint">Item table grows with bill lines</div>
                )}
              </div>
            )
          })}
        </div>
        </div>
      </div>
    </div>
  )
}
