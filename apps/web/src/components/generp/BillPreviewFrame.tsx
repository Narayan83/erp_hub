import { useCallback, useLayoutEffect, useRef, useState } from 'react'

const PX_PER_MM = 96 / 25.4

export function BillPreviewFrame({
  html,
  widthMm,
  heightMm,
  maxScale = 1,
  fitMode = 'width',
}: {
  html: string
  widthMm: number
  heightMm: number
  /** Allow the sheet to grow past true size so it fills the available width. */
  maxScale?: number
  /** `contain` also shrinks to the available height so the whole page stays on screen. */
  fitMode?: 'width' | 'contain'
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [scale, setScale] = useState(1)
  const [overflows, setOverflows] = useState(false)
  const pageW = Math.max(40, widthMm)
  const pageH = Math.max(40, heightMm || widthMm * 1.414)

  const fit = useCallback(() => {
    const wrap = wrapRef.current
    const frame = frameRef.current
    if (!wrap || !frame) return
    const pagePxW = Math.max(1, frame.offsetWidth)
    const pagePxH = Math.max(1, frame.offsetHeight)
    const pad = 8
    const sx = (wrap.clientWidth - pad) / pagePxW
    const sy = wrap.clientHeight > 40 ? (wrap.clientHeight - pad) / pagePxH : sx
    const next = Math.min(maxScale, Math.max(0.15, fitMode === 'contain' ? Math.min(sx, sy) : sx))
    setScale((prev) => (Math.abs(prev - next) > 0.008 ? next : prev))
    const doc = frame.contentDocument
    if (!doc) return
    const px = Math.max(doc.documentElement?.scrollHeight || 0, doc.body?.scrollHeight || 0)
    if (px < 1) return
    const measuredMm = px / (pagePxW / pageW || PX_PER_MM)
    setOverflows(px > pagePxH + 4 || measuredMm > pageH + 1)
  }, [maxScale, pageW, pageH, fitMode])

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const frame = frameRef.current
    if (!wrap || !frame) return
    fit()
    const ro = new ResizeObserver(() => fit())
    ro.observe(wrap)
    frame.addEventListener('load', fit)
    return () => {
      ro.disconnect()
      frame.removeEventListener('load', fit)
    }
  }, [fit, html, pageW, pageH])

  return (
    <div ref={wrapRef} className={`tpl-preview-stage${fitMode === 'contain' ? ' is-contain' : ''}`}>
      <div
        className="tpl-preview-scaled"
        style={{
          width: `calc(${pageW}mm * ${scale})`,
          height: `calc(${pageH}mm * ${scale})`,
        }}
      >
        <iframe
          ref={frameRef}
          title="Print preview"
          className="tpl-preview-frame"
          scrolling="no"
          style={{
            width: `${pageW}mm`,
            height: `${pageH}mm`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          srcDoc={html || '<p style="padding:12px;font-family:sans-serif;color:#64748b">Updating preview…</p>'}
        />
        {overflows && (
          <div className="tpl-preview-pagebreak" style={{ top: `calc(${pageH}mm * ${scale} - 1px)` }}>
            <span>Page 1 ends here</span>
          </div>
        )}
      </div>
    </div>
  )
}
