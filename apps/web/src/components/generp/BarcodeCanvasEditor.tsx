import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  LABEL_FONTS,
  SAMPLE_LABEL_PRODUCT,
  SAMPLE_COMPANY,
  barcodeCaptionFontPx,
  canvasFor,
  defaultCanvas,
  estimateTextHeightMm,
  estimateTextWidthMm,
  formatFieldLine,
  gapsFor,
  isCompanyLogoSource,
  makeBarcodeSvg,
  sizeMmCm,
  resolveFieldValue,
  resolveLayout,
  withCanvas,
  type BarcodeCanvas,
  type BarcodeLabelSettings,
  type BarcodeLayout,
  type BarcodeLayoutId,
  type CanvasBox,
  type CanvasTextBox,
  type TextAlign,
} from '../../lib/generp/barcodeLabels'
import type { CompanyProfile, Product } from '../../generpTypes'

type ItemId = string | 'barcode' | 'border'
type DragKind = 'move' | 'resize'

function itemLabel(id: ItemId, settings: BarcodeLabelSettings) {
  if (id === 'barcode') return 'Barcode'
  if (id === 'border') return 'Border'
  const f = settings.fields.find((x) => x.id === id)
  return f?.label || f?.source || id
}

export function BarcodeLabelPreview({
  layout,
  canvas,
  settings,
  product,
  extras = {},
  company,
  barcodeValue,
}: {
  layout: BarcodeLayout
  canvas: BarcodeCanvas
  settings: BarcodeLabelSettings
  product: Product
  extras?: Record<string, string>
  company?: CompanyProfile | null
  barcodeValue: string
}) {
  const gap = gapsFor(settings, layout.id)
  const svg = useMemo(() => {
    if (!barcodeValue) return ''
    return makeBarcodeSvg(barcodeValue, layout, {
      barHeight: Math.max(
        10,
        Math.round((canvas.barcode.heightMm / 25.4) * 96 * (canvas.barcode.showText ? 0.7 : 0.92)),
      ),
      fontSize: barcodeCaptionFontPx(canvas.barcode, layout.fontSize),
      displayValue: canvas.barcode.showText,
    })
  }, [
    barcodeValue,
    layout,
    canvas.barcode.heightMm,
    canvas.barcode.showText,
    canvas.barcode.fontSizePt,
  ])

  return (
    <div
      className="label-preview-outer"
      style={{ transform: `scale(${layout.previewScale})` }}
    >
      <div
        className="label-preview label-preview--canvas"
        style={{
          width: `${layout.widthMm}mm`,
          height: `${layout.heightMm}mm`,
          paddingLeft: `${gap.gap_left_mm}mm`,
          paddingRight: `${gap.gap_right_mm}mm`,
        }}
      >
        {canvas.border.enabled && (
          <div
            className="label-preview-border"
            style={{
              left: `${canvas.border.xMm}mm`,
              top: `${canvas.border.yMm}mm`,
              width: `${canvas.border.widthMm}mm`,
              height: `${canvas.border.heightMm}mm`,
            }}
          />
        )}
        {layout.showFields &&
          settings.fields
            .filter((f) => f.enabled && canvas.fields[f.id])
            .map((f) => {
              const box = canvas.fields[f.id]
              const val = resolveFieldValue(f, product, extras, company)
              if (isCompanyLogoSource(f.source)) {
                if (!val) return null
                return (
                  <div
                    key={f.id}
                    className="label-preview-item label-preview-logo"
                    style={{
                      left: `${box.xMm}mm`,
                      top: `${box.yMm}mm`,
                      width: `${box.widthMm}mm`,
                      height: `${box.heightMm}mm`,
                      textAlign: box.align,
                    }}
                  >
                    <img src={val} alt="" />
                  </div>
                )
              }
              const line = formatFieldLine(f, val)
              if (!line) return null
              return (
                <div
                  key={f.id}
                  className="label-preview-item"
                  style={{
                    left: `${box.xMm}mm`,
                    top: `${box.yMm}mm`,
                    width: `${box.widthMm}mm`,
                    height: `${box.heightMm}mm`,
                    fontFamily: box.fontFamily,
                    fontSize: `${box.fontSizePt}pt`,
                    fontWeight: box.bold ? 700 : 400,
                    textAlign: box.align,
                  }}
                >
                  {line}
                </div>
              )
            })}
        {barcodeValue ? (
          <div
            className="label-preview-item label-preview-bar"
            style={{
              left: `${canvas.barcode.xMm}mm`,
              top: `${canvas.barcode.yMm}mm`,
              width: `${canvas.barcode.widthMm}mm`,
              height: `${canvas.barcode.heightMm}mm`,
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : null}
      </div>
      {gap.gap_bottom_mm > 0 ? (
        <div className="label-preview-gap" style={{ height: `${gap.gap_bottom_mm}mm`, width: `${layout.widthMm}mm` }} />
      ) : null}
    </div>
  )
}

export function BarcodeCanvasEditor({
  settings,
  layoutId,
  product,
  extras,
  barcodeValue,
  company,
  onChange,
}: {
  settings: BarcodeLabelSettings
  layoutId: BarcodeLayoutId
  product?: Product | null
  extras?: Record<string, string>
  barcodeValue?: string
  company?: CompanyProfile | null
  onChange: (next: BarcodeLabelSettings) => void
}) {
  const layout = resolveLayout(settings, layoutId)
  const canvas = useMemo(() => canvasFor(settings, layoutId), [settings, layoutId])
  const SCALE = Math.max(3.5, Math.min(8, 380 / Math.max(20, layout.widthMm)))
  const sample = product || SAMPLE_LABEL_PRODUCT
  const companySample = company || SAMPLE_COMPANY
  const extrasMap = extras || {}
  const code = barcodeValue || String(sample.barcode || '000010000230')
  const [selected, setSelected] = useState<ItemId>('heading')
  const stickerRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{
    kind: DragKind
    id: ItemId
    startX: number
    startY: number
    box: CanvasBox
  } | null>(null)

  const svg = useMemo(
    () =>
      makeBarcodeSvg(code, layout, {
        barHeight: Math.max(10, Math.round((canvas.barcode.heightMm / 25.4) * 96 * 0.7)),
        fontSize: barcodeCaptionFontPx(canvas.barcode, layout.fontSize),
        displayValue: canvas.barcode.showText,
      }),
    [code, layout, canvas.barcode.heightMm, canvas.barcode.showText, canvas.barcode.fontSizePt],
  )

  const commit = (next: BarcodeCanvas) => onChange(withCanvas(settings, layoutId, next))

  const selectedBox: (CanvasBox & Partial<CanvasTextBox>) | null = (() => {
    if (selected === 'barcode') return canvas.barcode
    if (selected === 'border') return canvas.border
    return canvas.fields[selected] || null
  })()

  const patchSelected = (patch: Partial<CanvasTextBox> & { showText?: boolean }) => {
    if (selected === 'barcode') {
      commit({ ...canvas, barcode: { ...canvas.barcode, ...patch } })
      return
    }
    if (selected === 'border') {
      commit({ ...canvas, border: { ...canvas.border, ...patch, enabled: true } })
      return
    }
    const cur = canvas.fields[selected]
    if (!cur) return
    commit({ ...canvas, fields: { ...canvas.fields, [selected]: { ...cur, ...patch } } })
  }

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLElement>, id: ItemId, kind: DragKind) => {
    e.preventDefault()
    e.stopPropagation()
    setSelected(id)
    const box =
      id === 'barcode' ? canvas.barcode : id === 'border' ? canvas.border : canvas.fields[id]
    if (!box) return
    drag.current = { kind, id, startX: e.clientX, startY: e.clientY, box: { ...box } }
    stickerRef.current?.setPointerCapture(e.pointerId)
  }

  const onCanvasPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.startX) / SCALE
    const dy = (e.clientY - d.startY) / SCALE
    let next: CanvasBox = { ...d.box }
    if (d.kind === 'move') {
      next = {
        ...next,
        xMm: Math.round((d.box.xMm + dx) * 10) / 10,
        yMm: Math.round((d.box.yMm + dy) * 10) / 10,
      }
    } else {
      next = {
        ...next,
        widthMm: Math.max(2, Math.round((d.box.widthMm + dx) * 10) / 10),
        heightMm: Math.max(1.5, Math.round((d.box.heightMm + dy) * 10) / 10),
      }
    }
    if (d.id === 'barcode') commit({ ...canvas, barcode: { ...canvas.barcode, ...next } })
    else if (d.id === 'border') commit({ ...canvas, border: { ...canvas.border, ...next, enabled: true } })
    else if (canvas.fields[d.id]) {
      commit({ ...canvas, fields: { ...canvas.fields, [d.id]: { ...canvas.fields[d.id], ...next } } })
    }
  }

  const onCanvasPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null
    try {
      stickerRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  const fieldItems = settings.fields.filter((f) => f.enabled && layout.showFields && canvas.fields[f.id])
  const hiddenFields = settings.fields.filter((f) => !f.enabled)

  const setFieldEnabled = (id: string, enabled: boolean) => {
    onChange({
      ...settings,
      fields: settings.fields.map((f) => (f.id === id ? { ...f, enabled } : f)),
    })
    if (!enabled && selected === id) setSelected('barcode')
  }

  const hideSelected = () => {
    if (selected === 'border') {
      commit({ ...canvas, border: { ...canvas.border, enabled: false } })
      setSelected('barcode')
      return
    }
    if (selected === 'barcode') return
    setFieldEnabled(selected, false)
  }

  const onEditorKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    if (selected === 'barcode') return
    e.preventDefault()
    hideSelected()
  }

  return (
    <div className="barcode-canvas-editor" tabIndex={0} onKeyDown={onEditorKeyDown}>
      <div className="settings-box-title" style={{ fontSize: 12, marginTop: 12 }}>
        Sticker designer — {layout.title}
      </div>
      <p className="hint" style={{ margin: '0 0 8px' }}>
        Click a variable, then drag it on the sticker like Word. × removes it from the print — put it back
        from Removed. Change font and size above the sticker. Drag the bottom-right corner of any field
        (same as the border) to shrink the box to the text. Preview is on the right.
      </p>
      <div className="bcd-toolbar">
        <select
          className="input"
          value={selectedBox && 'fontFamily' in selectedBox ? selectedBox.fontFamily : 'Arial'}
          disabled={selected === 'barcode' || selected === 'border'}
          onChange={(e) => patchSelected({ fontFamily: e.target.value })}
        >
          {LABEL_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <input
          className="input"
          type="number"
          min={5}
          max={24}
          step={0.5}
          title="Font size (pt)"
          disabled={selected === 'border'}
          value={selectedBox && 'fontSizePt' in selectedBox ? selectedBox.fontSizePt : 8}
          onChange={(e) => patchSelected({ fontSizePt: Number(e.target.value) || 8 })}
        />
        <button
          type="button"
          className={`btn${selectedBox && 'bold' in selectedBox && selectedBox.bold ? ' btn-primary' : ''}`}
          disabled={selected === 'barcode' || selected === 'border'}
          onClick={() => patchSelected({ bold: !(selectedBox && 'bold' in selectedBox && selectedBox.bold) })}
        >
          B
        </button>
        {(['left', 'center', 'right'] as TextAlign[]).map((a) => (
          <button
            key={a}
            type="button"
            className={`btn${selectedBox && 'align' in selectedBox && selectedBox.align === a ? ' btn-primary' : ''}`}
            disabled={selected === 'barcode' || selected === 'border'}
            onClick={() => patchSelected({ align: a })}
          >
            {a === 'left' ? 'L' : a === 'right' ? 'R' : 'C'}
          </button>
        ))}
        {selected === 'barcode' ? (
          <label className="bcd-check">
            <input
              type="checkbox"
              checked={canvas.barcode.showText}
              onChange={(e) => {
                commit({ ...canvas, barcode: { ...canvas.barcode, showText: e.target.checked } })
              }}
            />
            Code text
          </label>
        ) : null}
        <label className="bcd-check">
          <input
            type="checkbox"
            checked={canvas.border.enabled}
            onChange={(e) => {
              commit({ ...canvas, border: { ...canvas.border, enabled: e.target.checked } })
              if (e.target.checked) setSelected('border')
            }}
          />
          Border
        </label>
        <button
          type="button"
          className="btn"
          title="Shrink each text box to the current sample/product text"
          onClick={() => {
            const pad = 0.6
            const innerW = Math.max(4, layout.widthMm - pad * 2)
            const fields = { ...canvas.fields }
            for (const f of fieldItems) {
              const box = fields[f.id]
              if (!box || isCompanyLogoSource(f.source)) continue
              const val = resolveFieldValue(f, sample, extrasMap, companySample)
              const text = formatFieldLine(f, val) || itemLabel(f.id, settings)
              const w = Math.min(innerW, estimateTextWidthMm(text, box.fontSizePt, box.bold))
              const h = estimateTextHeightMm(box.fontSizePt)
              let x = box.xMm
              if (box.align === 'center') x = box.xMm + (box.widthMm - w) / 2
              else if (box.align === 'right') x = box.xMm + box.widthMm - w
              fields[f.id] = {
                ...box,
                xMm: Math.round(Math.max(0, x) * 10) / 10,
                widthMm: w,
                heightMm: h,
              }
            }
            commit({ ...canvas, fields })
          }}
        >
          Fit to text
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const fresh = defaultCanvas(layout, settings.fields)
            commit({ ...fresh, border: { ...fresh.border, enabled: canvas.border.enabled } })
          }}
        >
          Reset positions
        </button>
        <button
          type="button"
          className="btn"
          disabled={selected === 'barcode'}
          title="Remove from print"
          onClick={hideSelected}
        >
          Remove
        </button>
      </div>
      {selectedBox && (
        <div className="bcd-nudge">
          <span>{itemLabel(selected, settings)}</span>
          <label>
            X
            <input
              className="input"
              type="number"
              step={0.1}
              value={selectedBox.xMm}
              onChange={(e) => patchSelected({ xMm: Number(e.target.value) })}
            />
          </label>
          <label>
            Y
            <input
              className="input"
              type="number"
              step={0.1}
              value={selectedBox.yMm}
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
              value={selectedBox.widthMm}
              onChange={(e) => patchSelected({ widthMm: Number(e.target.value) })}
            />
          </label>
          <label>
            H
            <input
              className="input"
              type="number"
              step={0.1}
              min={1.5}
              value={selectedBox.heightMm}
              onChange={(e) => patchSelected({ heightMm: Number(e.target.value) })}
            />
          </label>
          <span className="hint">
            mm (cm)
            {selectedBox ? ` · ${sizeMmCm(selectedBox.widthMm, selectedBox.heightMm)}` : ''}
          </span>
        </div>
      )}
      <div className="bcd-work">
        <div className="bcd-list" role="listbox" aria-label="Label variables">
          {fieldItems.map((f) => (
            <div key={f.id} className="bcd-list-row">
              <button
                type="button"
                className={`bcd-list-item${selected === f.id ? ' active' : ''}`}
                onClick={() => setSelected(f.id)}
              >
                {itemLabel(f.id, settings)}
              </button>
              <button
                type="button"
                className="btn bcd-list-x"
                title="Remove from print"
                onClick={() => setFieldEnabled(f.id, false)}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className={`bcd-list-item${selected === 'barcode' ? ' active' : ''}`}
            onClick={() => setSelected('barcode')}
          >
            Barcode
          </button>
          {canvas.border.enabled ? (
            <div className="bcd-list-row">
              <button
                type="button"
                className={`bcd-list-item${selected === 'border' ? ' active' : ''}`}
                onClick={() => setSelected('border')}
              >
                Border
              </button>
              <button
                type="button"
                className="btn bcd-list-x"
                title="Remove border"
                onClick={() => {
                  commit({ ...canvas, border: { ...canvas.border, enabled: false } })
                  if (selected === 'border') setSelected('barcode')
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`bcd-list-item${selected === 'border' ? ' active' : ''}`}
              onClick={() => {
                setSelected('border')
                commit({ ...canvas, border: { ...canvas.border, enabled: true } })
              }}
            >
              Border
            </button>
          )}
          {hiddenFields.length > 0 && (
            <div className="bcd-removed">
              <div className="bcd-removed-label">Removed — click to put back</div>
              {hiddenFields.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="btn"
                  onClick={() => {
                    setFieldEnabled(f.id, true)
                    setSelected(f.id)
                  }}
                >
                  + {itemLabel(f.id, settings)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          ref={stickerRef}
          className="bcd-sticker"
          style={{ width: layout.widthMm * SCALE, height: layout.heightMm * SCALE }}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
        >
          {canvas.border.enabled && (
            <div
              className={`bcd-item bcd-border${selected === 'border' ? ' selected' : ''}`}
              style={{
                left: canvas.border.xMm * SCALE,
                top: canvas.border.yMm * SCALE,
                width: canvas.border.widthMm * SCALE,
                height: canvas.border.heightMm * SCALE,
              }}
              onPointerDown={(e) => onCanvasPointerDown(e, 'border', 'move')}
            >
              <span
                className="bcd-handle"
                onPointerDown={(e) => onCanvasPointerDown(e, 'border', 'resize')}
              />
              {selected === 'border' && (
                <button
                  type="button"
                  className="bcd-item-remove"
                  title="Remove border"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    commit({ ...canvas, border: { ...canvas.border, enabled: false } })
                    setSelected('barcode')
                  }}
                >
                  ×
                </button>
              )}
            </div>
          )}
          {fieldItems.map((f) => {
            const box = canvas.fields[f.id]
            const val = resolveFieldValue(f, sample, extrasMap, companySample)
            const logo = isCompanyLogoSource(f.source)
            const text = logo ? '' : formatFieldLine(f, val) || itemLabel(f.id, settings)
            return (
              <div
                key={f.id}
                className={`bcd-item${selected === f.id ? ' selected' : ''}${logo ? ' bcd-logo' : ''}`}
                style={{
                  left: box.xMm * SCALE,
                  top: box.yMm * SCALE,
                  width: box.widthMm * SCALE,
                  height: box.heightMm * SCALE,
                  fontFamily: box.fontFamily,
                  fontSize: `${box.fontSizePt * (SCALE / 3.8)}px`,
                  fontWeight: box.bold ? 700 : 400,
                  textAlign: box.align,
                }}
                onPointerDown={(e) => onCanvasPointerDown(e, f.id, 'move')}
              >
                {logo ? (
                  val ? (
                    <img src={val} alt="" className="print-logo-img" draggable={false} />
                  ) : (
                    'Logo'
                  )
                ) : (
                  text
                )}
                <span
                  className="bcd-handle"
                  onPointerDown={(e) => onCanvasPointerDown(e, f.id, 'resize')}
                />
                {selected === f.id && (
                  <button
                    type="button"
                    className="bcd-item-remove"
                    title="Remove from print"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setFieldEnabled(f.id, false)
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
          <div
            className={`bcd-item bcd-bar${selected === 'barcode' ? ' selected' : ''}`}
            style={{
              left: canvas.barcode.xMm * SCALE,
              top: canvas.barcode.yMm * SCALE,
              width: canvas.barcode.widthMm * SCALE,
              height: canvas.barcode.heightMm * SCALE,
            }}
            onPointerDown={(e) => onCanvasPointerDown(e, 'barcode', 'move')}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <span
            className="bcd-handle bcd-handle-bar"
            style={{
              left: (canvas.barcode.xMm + canvas.barcode.widthMm) * SCALE - 6,
              top: (canvas.barcode.yMm + canvas.barcode.heightMm) * SCALE - 6,
            }}
            onPointerDown={(e) => onCanvasPointerDown(e, 'barcode', 'resize')}
          />
        </div>
        <div className="bcd-live-preview">
          <div className="bcd-live-preview-title">Preview</div>
          <p className="hint" style={{ margin: '0 0 6px' }}>
            Print size · {sizeMmCm(layout.widthMm, layout.heightMm)}
          </p>
          <BarcodeLabelPreview
            layout={layout}
            canvas={canvas}
            settings={settings}
            product={sample}
            extras={extrasMap}
            company={companySample}
            barcodeValue={code}
          />
        </div>
      </div>
    </div>
  )
}
