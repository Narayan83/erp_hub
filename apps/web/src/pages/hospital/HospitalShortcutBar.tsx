import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import type { MenuNode } from '../../types'
import {
  HOSPITAL_SHORTCUTS_CHANGED,
  HospitalMenu,
  HospitalShortcut,
  SHORTCUT_HIDDEN_HOSTS,
  notifyHospitalShortcutsChanged,
} from './shortcuts'
import {
  HospitalModulePopupStack,
  HospitalPopupLayer,
  newHospitalPopupLayer,
} from './HospitalModulePopup'
import './billing/hospital-shortcuts.css'

const COLLAPSED_KEY = 'hospital-shortcuts-collapsed'

function findMenuLabel(nodes: MenuNode[], code: string): string | null {
  for (const node of nodes) {
    if (node.code === code) return node.label
    const hit = node.children?.length ? findMenuLabel(node.children, code) : null
    if (hit) return hit
  }
  return null
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function HospitalShortcutBar() {
  const { code } = useParams()
  const host = (code || 'dashboard').trim().toLowerCase() || 'dashboard'
  const hidden = SHORTCUT_HIDDEN_HOSTS.has(host)
  const { menus: authMenus } = useAuth()
  const pageTitle =
    host === 'dashboard'
      ? 'Dashboard'
      : findMenuLabel(authMenus, host) || host.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  const [shortcuts, setShortcuts] = useState<HospitalShortcut[]>([])
  const [menus, setMenus] = useState<HospitalMenu[]>([])
  const [pick, setPick] = useState('')
  const [customName, setCustomName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [popups, setPopups] = useState<HospitalPopupLayer[]>([])

  function openShortcutPopup(moduleCode: string, title?: string, search?: string) {
    const next = newHospitalPopupLayer(moduleCode, title, search)
    if (!next.code || next.code === host) return
    setPopups((prev) => [...prev, next])
  }

  function closeTopPopup() {
    setPopups((prev) => prev.slice(0, -1))
  }

  const load = useCallback(async () => {
    if (hidden) return
    try {
      const [rows, available] = await Promise.all([
        api.get<HospitalShortcut[]>('/hospital/dashboard/shortcuts', {
          active_only: true,
          host_code: host,
        }),
        api.get<HospitalMenu[]>('/hospital/dashboard/shortcut-menus', { host_code: host }),
      ])
      setShortcuts((rows || []).filter((row) => row.is_active && !row.module_code.startsWith('_')))
      setMenus(available || [])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Shortcuts unavailable')
    }
  }, [host, hidden])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onChange = () => {
      void load()
    }
    window.addEventListener(HOSPITAL_SHORTCUTS_CHANGED, onChange)
    return () => window.removeEventListener(HOSPITAL_SHORTCUTS_CHANGED, onChange)
  }, [load])

  const used = useMemo(() => new Set(shortcuts.map((row) => row.module_code)), [shortcuts])
  const unused = useMemo(
    () => menus.filter((menu) => menu.code !== host && !used.has(menu.code)),
    [menus, used, host],
  )

  if (hidden) return null

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  async function addShortcut() {
    const menu = unused.find((item) => item.code === pick)
    if (!menu || busy) return
    const button_label = customName.trim() || menu.label
    setBusy(true)
    setError('')
    try {
      await api.post<HospitalShortcut>('/hospital/dashboard/shortcuts', {
        host_code: host,
        module_code: menu.code,
        button_label,
        description: null,
        sort_order: shortcuts.length + 1,
        is_active: true,
      })
      setPick('')
      setCustomName('')
      notifyHospitalShortcutsChanged()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add shortcut')
    } finally {
      setBusy(false)
    }
  }

  async function removeShortcut(row: HospitalShortcut) {
    if (!row.id || busy) return
    setBusy(true)
    setError('')
    try {
      await api.delete(`/hospital/dashboard/shortcuts/${row.id}`)
      if (editingId === row.id) {
        setEditingId(null)
        setEditLabel('')
      }
      notifyHospitalShortcutsChanged()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove shortcut')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(row: HospitalShortcut) {
    setEditingId(row.id)
    setEditLabel(row.button_label)
  }

  async function saveEdit(row: HospitalShortcut) {
    const button_label = editLabel.trim()
    if (!button_label || busy) return
    if (button_label === row.button_label) {
      setEditingId(null)
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.post<HospitalShortcut>('/hospital/dashboard/shortcuts', {
        host_code: host,
        module_code: row.module_code,
        button_label,
        description: row.description ?? null,
        sort_order: row.sort_order,
        is_active: true,
      })
      setEditingId(null)
      setEditLabel('')
      notifyHospitalShortcutsChanged()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename shortcut')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`hms-shortcut-bar${collapsed ? ' is-collapsed' : ''}`} role="navigation" aria-label="Menu shortcuts">
      <div className="hms-shortcut-header">
        <span className="hms-shortcut-page-title" title={pageTitle}>
          {pageTitle}
        </span>
        <button
          type="button"
          className="hms-shortcut-toggle"
          aria-expanded={!collapsed}
          aria-controls="hms-shortcut-body"
          title={collapsed ? 'Expand shortcuts' : 'Collapse shortcuts'}
          onClick={toggleCollapsed}
        >
          <span className="hms-shortcut-chevron" aria-hidden>
            {collapsed ? '▸' : '▾'}
          </span>
          <span className="hms-shortcut-kicker">Shortcuts</span>
          {collapsed ? (
            <span className="hms-shortcut-count">
              {shortcuts.length ? `${shortcuts.length} pinned` : 'None pinned'}
            </span>
          ) : null}
        </button>
        {collapsed ? (
          <button type="button" className="hms-shortcut-expand-link" onClick={toggleCollapsed}>
            Show
          </button>
        ) : null}
      </div>

      {!collapsed ? (
        <div id="hms-shortcut-body" className="hms-shortcut-body">
          {shortcuts.length === 0 ? <span className="hms-shortcut-empty">No shortcuts on this screen</span> : null}
          {shortcuts.map((row) => (
            <span key={row.id} className="hms-shortcut-chip">
              {editingId === row.id ? (
                <input
                  className="hms-shortcut-rename"
                  value={editLabel}
                  autoFocus
                  aria-label={`Rename ${row.button_label}`}
                  disabled={busy}
                  onChange={(e) => setEditLabel(e.target.value)}
                  onBlur={() => void saveEdit(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void saveEdit(row)
                    }
                    if (e.key === 'Escape') {
                      setEditingId(null)
                      setEditLabel('')
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  title={`Open ${row.button_label} as popup`}
                  onClick={() => openShortcutPopup(row.module_code, row.button_label)}
                >
                  {row.button_label}
                </button>
              )}
              <button
                type="button"
                className="hms-shortcut-edit-chip"
                title={`Rename ${row.button_label}`}
                aria-label={`Rename ${row.button_label} shortcut`}
                disabled={busy}
                onClick={() => startEdit(row)}
              >
                ✎
              </button>
              <button
                type="button"
                className="hms-shortcut-x"
                title={`Remove ${row.button_label}. The menu stays in the sidebar.`}
                aria-label={`Remove ${row.button_label} shortcut`}
                disabled={busy}
                onClick={() => void removeShortcut(row)}
              >
                ×
              </button>
            </span>
          ))}
          <select
            className="hms-shortcut-pick"
            aria-label="Menu to pin"
            value={pick}
            onChange={(e) => {
              const next = e.target.value
              setPick(next)
              const menu = unused.find((item) => item.code === next)
              setCustomName(menu?.label || '')
            }}
          >
            <option value="">Add shortcut…</option>
            {unused.map((menu) => (
              <option key={menu.code} value={menu.code}>
                {menu.label}
              </option>
            ))}
          </select>
          <input
            className="hms-shortcut-name"
            placeholder="Custom name"
            aria-label="Custom shortcut name"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addShortcut()
            }}
          />
          <button type="button" className="hms-shortcut-add" disabled={!pick || busy} onClick={() => void addShortcut()}>
            Add
          </button>
          <button
            type="button"
            className="hms-shortcut-edit"
            onClick={() =>
              openShortcutPopup(
                'dashboard_shortcut_setup',
                'Menu Shortcuts',
                `?host=${encodeURIComponent(host)}`,
              )
            }
          >
            Manage…
          </button>
          {error ? <span className="hms-shortcut-error">{error}</span> : null}
        </div>
      ) : null}
      <HospitalModulePopupStack layers={popups} onCloseTop={closeTopPopup} />
    </div>
  )
}
