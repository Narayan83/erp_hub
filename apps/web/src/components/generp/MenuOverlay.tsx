import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'

export type WorkspaceTab = { code: string; title: string; search?: string }

function prettyMenuTitle(code: string) {
  return code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

type MenuOverlayContextValue = {
  tabs: WorkspaceTab[]
  activeCode: string
  openOverlay: (code: string, title?: string, search?: string) => void
  registerTab: (code: string, title?: string) => void
  closeTab: (code: string) => void
  closeTop: () => void
  closeAll: () => void
}

const MenuOverlayContext = createContext<MenuOverlayContextValue | null>(null)
const TABS_KEY = 'generp.workspace.tabs'
const HOME: WorkspaceTab = { code: 'dashboard', title: 'Dashboard' }

export function useMenuOverlay() {
  const ctx = useContext(MenuOverlayContext)
  if (!ctx) throw new Error('useMenuOverlay must be used within MenuOverlayProvider')
  return ctx
}

function normalizeCode(code: string) {
  return code.replace(/^\//, '').trim().toLowerCase()
}

function asTab(code: string, title?: string): WorkspaceTab {
  const normalized = normalizeCode(code)
  return { code: normalized, title: title || prettyMenuTitle(normalized) }
}

function pathFor(code: string, search?: string) {
  const path = `/${normalizeCode(code) || HOME.code}`
  if (!search) return path
  return search.startsWith('?') ? `${path}${search}` : `${path}?${search}`
}

function readStoredTabs(): WorkspaceTab[] {
  try {
    const raw = sessionStorage.getItem(TABS_KEY)
    if (!raw) return [HOME]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [HOME]
    const tabs = parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const code = normalizeCode(String((item as { code?: unknown }).code || ''))
        if (!code) return null
        const title = String((item as { title?: unknown }).title || prettyMenuTitle(code))
        const searchRaw = (item as { search?: unknown }).search
        const search = typeof searchRaw === 'string' && searchRaw ? searchRaw : undefined
        const tab: WorkspaceTab = search ? { code, title, search } : { code, title }
        return tab
      })
      .filter((t): t is WorkspaceTab => Boolean(t))
    if (!tabs.some((t) => t.code === HOME.code)) tabs.unshift(HOME)
    return tabs.length ? tabs : [HOME]
  } catch {
    return [HOME]
  }
}

function withTab(prev: WorkspaceTab[], code: string, title?: string, search?: string): WorkspaceTab[] {
  const tab = asTab(code, title)
  if (!tab.code) return prev
  const existing = prev.find((t) => t.code === tab.code)
  if (existing) {
    const nextTitle = title || existing.title
    const nextSearch = search !== undefined ? search : existing.search
    if (nextTitle === existing.title && nextSearch === existing.search) return prev
    return prev.map((t) =>
      t.code === tab.code ? { ...t, title: nextTitle, search: nextSearch } : t,
    )
  }
  const base = prev.some((t) => t.code === HOME.code) ? prev : [HOME, ...prev]
  return [...base, { ...tab, search }]
}

export function MenuOverlayProvider({
  currentCode,
  currentTitle,
  children,
}: {
  currentCode: string
  currentTitle?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  const active = normalizeCode(currentCode) || HOME.code
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => withTab(readStoredTabs(), active, currentTitle))

  useEffect(() => {
    const label = currentTitle?.trim() || prettyMenuTitle(active)
    setTabs((prev) => withTab(prev, active, label))
  }, [active, currentTitle])

  useEffect(() => {
    try {
      sessionStorage.setItem(TABS_KEY, JSON.stringify(tabs))
    } catch {
      /* ignore quota / private mode */
    }
  }, [tabs])

  const registerTab = useCallback((rawCode: string, title?: string) => {
    setTabs((prev) => withTab(prev, rawCode, title))
  }, [])

  const openOverlay = useCallback(
    (rawCode: string, title?: string, search?: string) => {
      const tab = asTab(rawCode, title)
      if (!tab.code) return
      let nextSearch = search
      setTabs((prev) => {
        const existing = prev.find((t) => t.code === tab.code)
        if (nextSearch === undefined) nextSearch = existing?.search
        return withTab(prev, tab.code, tab.title, search)
      })
      const next = pathFor(tab.code, nextSearch)
      const here = `${window.location.pathname}${window.location.search}`
      if (here !== next) navigate(next)
    },
    [navigate],
  )

  const closeTab = useCallback(
    (rawCode: string) => {
      const code = normalizeCode(rawCode)
      if (!code || code === HOME.code) return
      let fallback = HOME
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.code === code)
        const next = prev.filter((t) => t.code !== code)
        const kept = next.some((t) => t.code === HOME.code) ? next : [HOME, ...next]
        fallback = kept[Math.min(Math.max(idx, 0), kept.length - 1)] ?? HOME
        return kept.length ? kept : [HOME]
      })
      if (active === code) {
        navigate(pathFor(fallback.code, fallback.search))
      }
    },
    [active, navigate],
  )

  const closeTop = useCallback(() => {
    if (active !== HOME.code) closeTab(active)
  }, [active, closeTab])

  const closeAll = useCallback(() => {
    setTabs([HOME])
    if (active !== HOME.code) navigate(`/${HOME.code}`)
  }, [active, navigate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('.modal-backdrop')) return
      if (active === HOME.code) return
      e.preventDefault()
      closeTab(active)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, closeTab])

  const value = useMemo(
    () => ({
      tabs,
      activeCode: active,
      openOverlay,
      registerTab,
      closeTab,
      closeTop,
      closeAll,
    }),
    [tabs, active, openOverlay, registerTab, closeTab, closeTop, closeAll],
  )

  return <MenuOverlayContext.Provider value={value}>{children}</MenuOverlayContext.Provider>
}
