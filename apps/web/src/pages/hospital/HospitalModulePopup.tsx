import { useEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../auth/AuthContext'
import { renderMenuPage } from '../../menuPages'
import { DashboardShortcutPage } from './masters/DashboardShortcutPage'

type EmbeddedShortcutBarProps = {
  hostCode?: string
  onOpenPopup?: (moduleCode: string, title?: string, search?: string) => void
  embedded?: boolean
}

function PopupShortcutBar(props: EmbeddedShortcutBarProps) {
  const [Bar, setBar] = useState<ComponentType<EmbeddedShortcutBarProps> | null>(null)
  useEffect(() => {
    let alive = true
    void import('./HospitalShortcutBar').then((mod) => {
      if (alive) setBar(() => mod.HospitalShortcutBar)
    })
    return () => {
      alive = false
    }
  }, [])
  if (!Bar) return null
  return <Bar {...props} />
}

export type HospitalPopupLayer = {
  id: string
  code: string
  title: string
  search?: string
}

function prettyTitle(code: string) {
  return code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function hostFromSearch(search?: string) {
  if (!search) return 'dashboard'
  const raw = search.startsWith('?') ? search.slice(1) : search
  return (new URLSearchParams(raw).get('host') || 'dashboard').trim().toLowerCase() || 'dashboard'
}

function PopupPage({ code, search }: { code: string; search?: string }) {
  const { product } = useAuth()
  if (code === 'dashboard_shortcut_setup') {
    return <DashboardShortcutPage initialHost={hostFromSearch(search)} />
  }
  return <>{renderMenuPage(code || 'dashboard', product || 'hospital')}</>
}

function PopupFrame({
  layer,
  onClose,
  onOpenPopup,
  closeOnEscape = false,
  closeOnBackdrop = false,
}: {
  layer: HospitalPopupLayer
  onClose: () => void
  onOpenPopup?: (moduleCode: string, title?: string, search?: string) => void
  closeOnEscape?: boolean
  closeOnBackdrop?: boolean
}) {
  const title = layer.title.trim() || prettyTitle(layer.code)
  const popupRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; ox: number; oy: number } | null>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  function clampOffset(x: number, y: number) {
    const el = popupRef.current
    const parent = el?.parentElement
    if (!el || !parent) return { x, y }
    const bounds = parent.getBoundingClientRect()
    const baseLeft = (bounds.width - el.offsetWidth) / 2
    const baseTop = (bounds.height - el.offsetHeight) / 2
    const minX = 8 - baseLeft
    const maxX = Math.max(minX, bounds.width - 80 - baseLeft)
    const minY = 8 - baseTop
    const maxY = Math.max(minY, bounds.height - 40 - baseTop)
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    }
  }

  function onHeadPointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('button, a, input, select, textarea')) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
  }

  function onHeadPointerMove(e: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    setOffset(clampOffset(drag.ox + e.clientX - drag.x, drag.oy + e.clientY - drag.y))
  }

  function endDrag(e: ReactPointerEvent<HTMLElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  useEffect(() => {
    if (!closeOnEscape) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('.modal-backdrop')) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeOnEscape, onClose])

  return (
    <div
      className="hms-module-popup-back"
      role="presentation"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={popupRef}
        className={`hms-module-popup${dragging ? ' is-dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={offset.x || offset.y ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header
          className="hms-module-popup-head"
          title="Drag to move"
          onPointerDown={onHeadPointerDown}
          onPointerMove={onHeadPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <h2>{title}</h2>
          <button type="button" className="hms-module-popup-close" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="hms-module-popup-body">
          {layer.code !== 'dashboard_shortcut_setup' ? (
            <PopupShortcutBar hostCode={layer.code} embedded onOpenPopup={onOpenPopup} />
          ) : null}
          <PopupPage code={layer.code} search={layer.search} />
        </div>
      </div>
    </div>
  )
}

export function HospitalModulePopupStack({
  layers,
  onCloseTop,
  onOpenPopup,
}: {
  layers: HospitalPopupLayer[]
  onCloseTop: () => void
  onOpenPopup?: (moduleCode: string, title?: string, search?: string) => void
}) {
  useEffect(() => {
    if (!layers.length) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [layers.length])

  if (!layers.length || typeof document === 'undefined') return null

  return createPortal(
    <>
      {layers.map((layer, index) => {
        const top = index === layers.length - 1
        return (
          <PopupFrame
            key={layer.id}
            layer={layer}
            onClose={onCloseTop}
            onOpenPopup={onOpenPopup}
            closeOnEscape={top}
            closeOnBackdrop={top}
          />
        )
      })}
    </>,
    document.body,
  ) as ReactNode
}

export function newHospitalPopupLayer(code: string, title?: string, search?: string): HospitalPopupLayer {
  const normalized = code.replace(/^\//, '').trim().toLowerCase()
  return {
    id: `popup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    code: normalized,
    title: (title || '').trim() || prettyTitle(normalized),
    search,
  }
}
