import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './tpl-preview-float.css'

type Mode = 'normal' | 'minimized' | 'maximized'

type Box = { x?: number; y?: number; w?: number; h?: number }

export function TplPreviewPanel({
  title,
  children,
  className = '',
  initial,
  onClose,
}: {
  title: string
  children: ReactNode
  className?: string
  initial?: Box
  onClose?: () => void
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const [onScreen, setOnScreen] = useState(true)
  const [mode, setMode] = useState<Mode>('normal')
  const [pos, setPos] = useState(() => {
    const w = initial?.w ?? 390
    return {
      x: initial?.x ?? Math.max(16, window.innerWidth - w - 24),
      y: initial?.y ?? 92,
    }
  })
  const [box, setBox] = useState(() => ({
    w: initial?.w ?? 390,
    h: initial?.h ?? Math.min(560, Math.max(280, window.innerHeight - 140)),
  }))
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const resize = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => {
      const pane = host.closest('.workspace-pane')
      setOnScreen(!pane || pane.classList.contains('is-active'))
    }
    update()
    const pane = host.closest('.workspace-pane')
    if (!pane) return
    const mo = new MutationObserver(update)
    mo.observe(pane, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])

  const onHeadDown = (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (mode === 'maximized') return
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onHeadMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    setPos({
      x: Math.min(window.innerWidth - 80, Math.max(0, e.clientX - d.dx)),
      y: Math.min(window.innerHeight - 40, Math.max(0, e.clientY - d.dy)),
    })
  }
  const onHeadUp = (e: ReactPointerEvent<HTMLElement>) => {
    drag.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    resize.current = { x: e.clientX, y: e.clientY, w: box.w, h: box.h }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resize.current
    if (!r) return
    setBox({
      w: Math.min(Math.max(260, r.w + (e.clientX - r.x)), window.innerWidth - 24),
      h: Math.min(Math.max(180, r.h + (e.clientY - r.y)), window.innerHeight - 24),
    })
  }
  const onResizeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    resize.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  const style =
    mode === 'maximized'
      ? { left: 12, top: 64, width: 'calc(100vw - 24px)', height: 'calc(100vh - 76px)' }
      : mode === 'minimized'
        ? { left: pos.x, top: pos.y, width: 280, height: 'auto' }
        : { left: pos.x, top: pos.y, width: box.w, height: box.h }

  return (
    <>
      <span ref={hostRef} hidden />
      {onScreen
        ? createPortal(
            <div
              className={`tpl-preview-float${mode === 'maximized' ? ' is-max' : ''}${mode === 'minimized' ? ' is-min' : ''}${className ? ` ${className}` : ''}`}
              style={style}
            >
      <header
        className="tpl-preview-float-head"
        onPointerDown={onHeadDown}
        onPointerMove={onHeadMove}
        onPointerUp={onHeadUp}
        onPointerCancel={onHeadUp}
      >
        <span className="tpl-preview-drag" aria-hidden="true">✥</span>
        <span>{title}</span>
        <button
          type="button"
          className="tpl-preview-win-btn"
          title={mode === 'minimized' ? 'Restore' : 'Minimize'}
          onClick={() => setMode((m) => (m === 'minimized' ? 'normal' : 'minimized'))}
        >
          {mode === 'minimized' ? '▢' : '–'}
        </button>
        <button
          type="button"
          className="tpl-preview-win-btn"
          title={mode === 'maximized' ? 'Restore' : 'Maximize'}
          onClick={() => setMode((m) => (m === 'maximized' ? 'normal' : 'maximized'))}
        >
          {mode === 'maximized' ? '❐' : '□'}
        </button>
        {onClose ? (
          <button type="button" className="tpl-preview-win-btn" title="Close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        ) : null}
      </header>
      <div className="tpl-preview-float-body" hidden={mode === 'minimized'}>
        {children}
      </div>
      {mode === 'normal' ? (
        <div
          className="tpl-preview-resize"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
        />
      ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
