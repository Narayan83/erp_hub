import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { useMenuOverlay } from './MenuOverlay'

export const SHORTCUTS_CHANGED_EVENT = 'generp-shortcuts-changed'

export function notifyShortcutsChanged() {
  window.dispatchEvent(new Event(SHORTCUTS_CHANGED_EVENT))
}

export type MenuShortcut = {
  id: string
  host_code?: string
  menu_code: string
  button_label: string
  sort_order: number
  is_active: boolean
}

type AvailableMenu = { code: string; label: string }

function hostFromPath(pathname: string, searchHost: string | null) {
  const current = pathname.replace(/^\//, '') || 'dashboard'
  if (current === 'dashboard_shortcuts') return searchHost || 'dashboard'
  return current
}

export function MenuShortcutBar() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { tabs, activeCode, openOverlay, closeTab } = useMenuOverlay()
  const current = location.pathname.replace(/^\//, '') || 'dashboard'
  const shortcutHost = hostFromPath(location.pathname, searchParams.get('host'))
  const isShopFront = current === 'shopping_cart' || current === 'shopping_banner'

  const [shortcuts, setShortcuts] = useState<MenuShortcut[]>([])
  const [menus, setMenus] = useState<AvailableMenu[]>([])
  const [pickCode, setPickCode] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [sc, available] = await Promise.all([
        api
          .get<MenuShortcut[]>('/dashboard-shortcuts', { active_only: '1', host_code: shortcutHost })
          .catch(() => [] as MenuShortcut[]),
        api
          .get<AvailableMenu[]>('/dashboard-shortcuts/available-menus', { host_code: shortcutHost })
          .catch(() => [] as AvailableMenu[]),
      ])
      const active = sc.filter((s) => s.is_active && !s.menu_code.startsWith('_'))
      setShortcuts(active)
      setMenus(available)
    } catch {
      /* bar is optional — page still works */
    }
  }, [shortcutHost])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onChange = () => {
      void load()
    }
    window.addEventListener(SHORTCUTS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(SHORTCUTS_CHANGED_EVENT, onChange)
  }, [load])

  const usedPinCodes = useMemo(() => new Set(shortcuts.map((s) => s.menu_code)), [shortcuts])
  const unusedMenus = useMemo(
    () => menus.filter((m) => !usedPinCodes.has(m.code) && m.code !== shortcutHost),
    [menus, usedPinCodes, shortcutHost],
  )

  const addShortcut = async () => {
    if (!pickCode || busy) return
    const menu = menus.find((m) => m.code === pickCode)
    if (!menu) return
    setBusy(true)
    try {
      const created = await api.post<MenuShortcut>('/dashboard-shortcuts', {
        host_code: shortcutHost,
        menu_code: menu.code,
        button_label: menu.label,
        sort_order: shortcuts.length + 1,
        is_active: true,
      })
      setShortcuts((prev) => [...prev, created])
      setPickCode('')
      notifyShortcutsChanged()
    } catch {
      await load()
    } finally {
      setBusy(false)
    }
  }

  const unpinShortcut = async (s: MenuShortcut) => {
    if (!s.id || busy) return
    setBusy(true)
    try {
      await api.delete(`/dashboard-shortcuts/${s.id}`)
      setShortcuts((prev) => prev.filter((x) => x.id !== s.id))
      notifyShortcutsChanged()
    } catch {
      await load()
    } finally {
      setBusy(false)
    }
  }

  const closeMenu = (code: string) => {
    if (!code || code === 'dashboard') return
    closeTab(code)
  }

  const openSettings = () => {
    openOverlay('dashboard_shortcuts', 'Menu Shortcuts', `host=${encodeURIComponent(shortcutHost)}`)
  }

  if (isShopFront) return null

  const hostLabel =
    menus.find((m) => m.code === shortcutHost)?.label ||
    (shortcutHost === 'dashboard' ? 'Dashboard' : shortcutHost.replace(/_/g, ' '))

  return (
    <div className="menu-shortcut-bar" role="navigation" aria-label="Open menus">
      <div className="menu-shortcut-group" aria-label="Open screens">
        <span className="menu-shortcut-kicker">Open</span>
        {tabs.map((tab) => {
          const active = tab.code === activeCode
          return (
            <span key={tab.code} className="menu-shortcut-chip">
              <button
                type="button"
                className={`btn${active ? ' btn-primary' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => openOverlay(tab.code, tab.title, tab.search)}
              >
                {tab.title}
              </button>
              {tab.code !== 'dashboard' ? (
                <button
                  type="button"
                  className="menu-shortcut-x"
                  title={`Close ${tab.title}`}
                  aria-label={`Close ${tab.title}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    closeMenu(tab.code)
                  }}
                >
                  ×
                </button>
              ) : null}
            </span>
          )
        })}
      </div>

      <span className="menu-shortcut-split" aria-hidden="true" />

      <div className="menu-shortcut-group" aria-label={`${hostLabel} shortcuts`}>
        <span className="menu-shortcut-kicker">Shortcuts</span>
        {shortcutHost === 'dashboard' &&
        menus.some((m) => m.code === 'company_profile') &&
        !shortcuts.some((s) => s.menu_code === 'company_profile') ? (
          <span className="menu-shortcut-chip menu-shortcut-pin-chip">
            <button
              type="button"
              className={`btn menu-shortcut-pin${activeCode === 'company_profile' ? ' btn-primary' : ''}`}
              title="Open Software Setup"
              onClick={() => openOverlay('company_profile', 'Software Setup')}
            >
              Software Setup
            </button>
            <button
              type="button"
              className="menu-shortcut-x"
              title="Close Software Setup"
              aria-label="Close Software Setup"
              onClick={(e) => {
                e.stopPropagation()
                closeTab('company_profile')
              }}
            >
              ×
            </button>
          </span>
        ) : null}
        {shortcuts.map((s) => (
          <span key={s.id} className="menu-shortcut-chip menu-shortcut-pin-chip">
            <button
              type="button"
              className={`btn menu-shortcut-pin${s.menu_code === activeCode ? ' btn-primary' : ''}`}
              title={`Open ${s.button_label}`}
              onClick={() => openOverlay(s.menu_code, s.button_label)}
            >
              {s.button_label}
            </button>
            <button
              type="button"
              className="menu-shortcut-x"
              title={`Remove ${s.button_label} shortcut. The menu stays in the sidebar.`}
              aria-label={`Remove ${s.button_label} shortcut`}
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation()
                void unpinShortcut(s)
              }}
            >
              ×
            </button>
          </span>
        ))}
        {unusedMenus.length > 0 ? (
          <span className="menu-shortcut-add">
            <select
              className="input"
              value={pickCode}
              aria-label={`Add shortcut for ${hostLabel}`}
              onChange={(e) => setPickCode(e.target.value)}
            >
              <option value="">Add shortcut…</option>
              {unusedMenus.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={!pickCode || busy} onClick={() => void addShortcut()}>
              Add
            </button>
          </span>
        ) : null}
        <button type="button" className="btn" title={`Customize shortcuts for ${hostLabel}`} onClick={openSettings}>
          ⚙ Shortcuts
        </button>
      </div>
    </div>
  )
}
