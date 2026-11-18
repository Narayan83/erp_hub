import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../auth/AuthContext'
import { renderMenuPage } from '../../menuPages'
import { DashboardShortcutPage } from './masters/DashboardShortcutPage'

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
  closeOnEscape = false,
  closeOnBackdrop = false,
}: {
  layer: HospitalPopupLayer
  onClose: () => void
  closeOnEscape?: boolean
  closeOnBackdrop?: boolean
}) {
  const title = layer.title.trim() || prettyTitle(layer.code)

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
        className="hms-module-popup"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="hms-module-popup-head">
          <h2>{title}</h2>
          <button type="button" className="hms-module-popup-close" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="hms-module-popup-body">
          <PopupPage code={layer.code} search={layer.search} />
        </div>
      </div>
    </div>
  )
}

export function HospitalModulePopupStack({
  layers,
  onCloseTop,
}: {
  layers: HospitalPopupLayer[]
  onCloseTop: () => void
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
