import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError } from '../../api/client'

type FlatMenu = {
  id: string
  code: string
  label: string
  parent_id: string | null
  sort_order: number
  enabled: boolean
}

type MenuNode = FlatMenu & { children: MenuNode[] }

const LOCKED = 'company_profile'

function buildTree(flat: FlatMenu[]): MenuNode[] {
  const byParent = new Map<string | null, FlatMenu[]>()
  for (const menu of flat) {
    const key = menu.parent_id ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(menu)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.label.localeCompare(b.label))
  }
  const walk = (parentId: string | null): MenuNode[] =>
    (byParent.get(parentId) || []).map((menu) => ({ ...menu, children: walk(menu.id) }))
  return walk(null)
}

function collectDescendants(node: MenuNode): string[] {
  const ids: string[] = []
  for (const child of node.children) ids.push(child.id, ...collectDescendants(child))
  return ids
}

export function PackageMenusDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [tree, setTree] = useState<MenuNode[]>([])
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const parentOf = useMemo(() => {
    const map: Record<string, string | null> = {}
    const walk = (nodes: MenuNode[], parent: string | null) => {
      for (const node of nodes) {
        map[node.id] = parent
        walk(node.children, node.id)
      }
    }
    walk(tree, null)
    return map
  }, [tree])

  const childrenOf = useMemo(() => {
    const map: Record<string, string[]> = {}
    const walk = (nodes: MenuNode[]) => {
      for (const node of nodes) {
        map[node.id] = node.children.map((child) => child.id)
        walk(node.children)
      }
    }
    walk(tree)
    return map
  }, [tree])

  const descendantsOf = useMemo(() => {
    const map: Record<string, string[]> = {}
    const walk = (nodes: MenuNode[]) => {
      for (const node of nodes) {
        map[node.id] = collectDescendants(node)
        walk(node.children)
      }
    }
    walk(tree)
    return map
  }, [tree])

  const codeOf = useMemo(() => {
    const map: Record<string, string> = {}
    const walk = (nodes: MenuNode[]) => {
      for (const node of nodes) {
        map[node.id] = node.code
        walk(node.children)
      }
    }
    walk(tree)
    return map
  }, [tree])

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<{ menus: FlatMenu[] }>('/company-profile/package-menus')
        const nodes = buildTree(data.menus || [])
        setTree(nodes)
        const next: Record<string, boolean> = {}
        const open: Record<string, boolean> = {}
        const walk = (list: MenuNode[]) => {
          for (const node of list) {
            next[node.id] = node.enabled || node.code === LOCKED
            open[node.id] = false
            walk(node.children)
          }
        }
        walk(nodes)
        setChecked(next)
        setExpanded(open)
        setLoaded(true)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load menus')
      }
    })()
  }, [])

  const setNode = (menuId: string, value: boolean) => {
    if (codeOf[menuId] === LOCKED) return
    setChecked((prev) => {
      const next = { ...prev, [menuId]: value }
      for (const id of descendantsOf[menuId] || []) {
        if (codeOf[id] === LOCKED) {
          next[id] = true
          continue
        }
        next[id] = value
      }
      let parent = parentOf[menuId]
      while (parent) {
        const kids = childrenOf[parent] || []
        next[parent] = kids.length > 0 && kids.every((id) => next[id])
        parent = parentOf[parent]
      }
      return next
    })
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const menu_ids = Object.entries(checked)
        .filter(([, on]) => on)
        .map(([id]) => id)
      await api.put('/company-profile/package-menus', { menu_ids })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const renderRows = (nodes: MenuNode[], depth: number): ReactNode[] => {
    const rows: ReactNode[] = []
    for (const node of nodes) {
      const hasKids = node.children.length > 0
      const isOpen = !!expanded[node.id]
      const locked = node.code === LOCKED
      const kids = node.children.map((child) => child.id)
      const some = kids.some((id) => checked[id])
      const all = kids.length > 0 && kids.every((id) => checked[id])
      const on = locked || (hasKids ? all : !!checked[node.id])
      rows.push(
        <div key={node.id} className="rmp-menu-cell" style={{ padding: '6px 10px', paddingLeft: 10 + depth * 18 }}>
          {hasKids ? (
            <button
              type="button"
              className="rmp-toggle"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              onClick={() => setExpanded((prev) => ({ ...prev, [node.id]: !prev[node.id] }))}
            >
              {isOpen ? '−' : '+'}
            </button>
          ) : (
            <span className="rmp-toggle-spacer" />
          )}
          <label className="rmp-label" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <input
              type="checkbox"
              aria-label={node.label}
              checked={on}
              disabled={locked}
              ref={(el) => {
                if (el) el.indeterminate = hasKids && some && !all
              }}
              onChange={(e) => setNode(node.id, e.target.checked)}
            />
            <span>
              {node.label}
              {locked ? ' (always on)' : ''}
            </span>
          </label>
        </div>,
      )
      if (hasKids && isOpen) rows.push(...renderRows(node.children, depth + 1))
    }
    return rows
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="Assign menus"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Assign menus</h2>
        <p className="hint">
          Tick the main menus and sub menus included in this software package. The left pane shows
          only these. Role permissions can hide more of them later. Software Setup stays on.
        </p>
        {error && <div className="error-banner">{error}</div>}
        {!loaded ? (
          <p className="hint">Loading menus…</p>
        ) : (
          <div className="package-menu-list">{renderRows(tree, 0)}</div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !loaded} onClick={() => void save()}>
            Save package
          </button>
        </div>
      </div>
    </div>
  )
}
