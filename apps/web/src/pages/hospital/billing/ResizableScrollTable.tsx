import { PointerEvent as ReactPointerEvent, ReactNode, useCallback, useRef, useState } from 'react'

const ROW_PX = 20
const HEADER_PX = 20

type Props = {
  children: ReactNode
  /** Visible body rows at rest (default 7). */
  defaultRows?: number
  minRows?: number
  maxRows?: number
  className?: string
}

export function ResizableScrollTable({
  children,
  defaultRows = 7,
  minRows = 4,
  maxRows = 24,
  className = '',
}: Props) {
  const [rows, setRows] = useState(defaultRows)
  const startY = useRef(0)
  const startRows = useRef(defaultRows)

  const height = HEADER_PX + rows * ROW_PX

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      startY.current = e.clientY
      startRows.current = rows
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientY - startY.current
        const next = Math.round(startRows.current + delta / ROW_PX)
        setRows(Math.min(maxRows, Math.max(minRows, next)))
      }
      const onUp = (ev: PointerEvent) => {
        el.releasePointerCapture(ev.pointerId)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [maxRows, minRows, rows],
  )

  return (
    <div className={`hms-resizable-table ${className}`.trim()}>
      <div className="hms-scroll-table-10" style={{ height, maxHeight: height }}>
        {children}
      </div>
      <div
        className="hms-table-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to resize grid"
        title="Drag to expand or shrink"
        onPointerDown={onPointerDown}
      >
        <span className="hms-table-resize-icon" aria-hidden>
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
            <path d="M2 3h10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </div>
    </div>
  )
}
