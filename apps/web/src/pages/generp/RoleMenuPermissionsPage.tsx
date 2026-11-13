import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError } from '../../api/client'

type FlatMenu = {
  id: string
  code: string
  label: string
  parent_id: string | null
  sort_order: number
}

type RoleRow = {
  id: string
  role_name: string
  is_active?: boolean
}

type PermFlags = {
  can_view: boolean
  can_create: boolean
  can_update: boolean
  can_delete: boolean
}

type MenuNode = FlatMenu & {
  children: MenuNode[]
}

const EMPTY: PermFlags = {
  can_view: false,
  can_create: false,
  can_update: false,
  can_delete: false,
}

const PERM_KEYS = ['can_view', 'can_create', 'can_update', 'can_delete'] as const

function buildTree(flat: FlatMenu[]): MenuNode[] {
  const byParent = new Map<string | null, FlatMenu[]>()
  for (const m of flat) {
    const key = m.parent_id ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(m)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.label.localeCompare(b.label))
  }
  const walk = (parentId: string | null): MenuNode[] =>
    (byParent.get(parentId) || []).map((m) => ({
      ...m,
      children: walk(m.id),
    }))
  return walk(null)
}

function collectDescendants(node: MenuNode): string[] {
  const ids: string[] = []
  for (const c of node.children) {
    ids.push(c.id, ...collectDescendants(c))
  }
  return ids
}

function collectAllIds(nodes: MenuNode[]): string[] {
  const ids: string[] = []
  for (const n of nodes) {
    ids.push(n.id, ...collectAllIds(n.children))
  }
  return ids
}

export function RoleMenuPermissionsPage() {
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [roleId, setRoleId] = useState('')
  const [tree, setTree] = useState<MenuNode[]>([])
  const [perms, setPerms] = useState<Record<string, PermFlags>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const parentOf = useMemo(() => {
    const map: Record<string, string | null> = {}
    const walk = (nodes: MenuNode[], parent: string | null) => {
      for (const n of nodes) {
        map[n.id] = parent
        walk(n.children, n.id)
      }
    }
    walk(tree, null)
    return map
  }, [tree])

  const childrenOf = useMemo(() => {
    const map: Record<string, string[]> = {}
    const walk = (nodes: MenuNode[]) => {
      for (const n of nodes) {
        map[n.id] = n.children.map((c) => c.id)
        walk(n.children)
      }
    }
    walk(tree)
    return map
  }, [tree])

  const descendantsOf = useMemo(() => {
    const map: Record<string, string[]> = {}
    const walk = (nodes: MenuNode[]) => {
      for (const n of nodes) {
        map[n.id] = collectDescendants(n)
        walk(n.children)
      }
    }
    walk(tree)
    return map
  }, [tree])

  const loadMenusAndRoles = useCallback(async () => {
    setError('')
    try {
      const [menus, roleRows] = await Promise.all([
        api.get<FlatMenu[]>('/role-menu-permissions/menus'),
        api.get<RoleRow[]>('/roles'),
      ])
      const nodes = buildTree(menus)
      setTree(nodes)
      // Collapsed by default — use + or Expand All to open groups
      const open: Record<string, boolean> = {}
      for (const id of collectAllIds(nodes)) {
        open[id] = false
      }
      setExpanded(open)
      const activeRoles = roleRows.filter((r) => r.is_active !== false)
      setRoles(activeRoles)
      if (!roleId && activeRoles[0]) setRoleId(activeRoles[0].id)
      setLoaded(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load menus')
    }
  }, [roleId])

  const loadRolePerms = useCallback(async (id: string) => {
    if (!id) return
    setError('')
    setStatus('')
    try {
      const rows = await api.get<
        Array<{ menu_id: string } & PermFlags>
      >(`/role-menu-permissions/${id}`)
      const next: Record<string, PermFlags> = {}
      for (const row of rows) {
        next[row.menu_id] = {
          can_view: !!row.can_view,
          can_create: !!row.can_create,
          can_update: !!row.can_update,
          can_delete: !!row.can_delete,
        }
      }
      setPerms(next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load permissions')
    }
  }, [])

  useEffect(() => {
    void loadMenusAndRoles()
  }, [loadMenusAndRoles])

  useEffect(() => {
    if (roleId) void loadRolePerms(roleId)
  }, [roleId, loadRolePerms])

  const getFlags = (menuId: string): PermFlags => perms[menuId] ?? EMPTY

  const setFlag = (menuId: string, key: (typeof PERM_KEYS)[number], checked: boolean) => {
    setPerms((prev) => applyFlagCascade(prev, menuId, key, checked))
  }

  const applyFlagCascade = (
    prev: Record<string, PermFlags>,
    menuId: string,
    key: (typeof PERM_KEYS)[number],
    checked: boolean,
  ): Record<string, PermFlags> => {
    const next = { ...prev }
    const apply = (id: string, value: boolean) => {
      next[id] = { ...(next[id] ?? EMPTY), [key]: value }
    }
    apply(menuId, checked)
    for (const childId of descendantsOf[menuId] || []) {
      apply(childId, checked)
    }
    let parent = parentOf[menuId]
    while (parent) {
      const kids = childrenOf[parent] || []
      const anyChild = kids.some((c) => !!(next[c] ?? EMPTY)[key])
      apply(parent, anyChild)
      parent = parentOf[parent]
    }
    return next
  }

  const setRowAll = (menuId: string, checked: boolean) => {
    setPerms((prev) => {
      let next = prev
      for (const key of PERM_KEYS) {
        next = applyFlagCascade(next, menuId, key, checked)
      }
      return next
    })
  }

  const expandAll = () => {
    const open: Record<string, boolean> = {}
    for (const id of collectAllIds(tree)) open[id] = true
    setExpanded(open)
  }

  const collapseAll = () => {
    const open: Record<string, boolean> = {}
    for (const id of collectAllIds(tree)) open[id] = false
    setExpanded(open)
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const save = async () => {
    if (!roleId) {
      setError('Select a role.')
      return
    }
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const permissions = collectAllIds(tree).map((menu_id) => ({
        menu_id,
        ...(perms[menu_id] ?? EMPTY),
      }))
      await api.put('/role-menu-permissions', { role_id: roleId, permissions })
      setStatus('Permissions saved. User must re-login to refresh their sidebar.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const renderRows = (nodes: MenuNode[], depth: number): ReactNode[] => {
    const rows: React.ReactNode[] = []
    for (const node of nodes) {
      const hasKids = node.children.length > 0
      const isOpen = !!expanded[node.id]
      const flags = getFlags(node.id)
      rows.push(
        <tr key={node.id} className={hasKids ? 'rmp-parent' : undefined}>
          <td>
            <div className="rmp-menu-cell" style={{ paddingLeft: depth * 18 }}>
              {hasKids ? (
                <button
                  type="button"
                  className="rmp-toggle"
                  aria-label={isOpen ? 'Collapse' : 'Expand'}
                  onClick={() => toggleExpand(node.id)}
                >
                  {isOpen ? '−' : '+'}
                </button>
              ) : (
                <span className="rmp-toggle-spacer" />
              )}
              <div>
                <div className="rmp-label">{node.label}</div>
                <div className="rmp-code">{node.code}</div>
              </div>
            </div>
          </td>
          {PERM_KEYS.map((key) => (
            <td key={key} className="rmp-check">
              <input
                type="checkbox"
                checked={flags[key]}
                onChange={(e) => setFlag(node.id, key, e.target.checked)}
              />
            </td>
          ))}
          <td className="rmp-quick">
            <button type="button" className="linkish" onClick={() => setRowAll(node.id, true)}>
              All
            </button>
            {' / '}
            <button type="button" className="linkish" onClick={() => setRowAll(node.id, false)}>
              None
            </button>
          </td>
        </tr>,
      )
      if (hasKids && isOpen) {
        rows.push(...renderRows(node.children, depth + 1))
      }
    }
    return rows
  }

  return (
    <div className="settings-page rmp-page">
      <h2>Role Menu Permissions</h2>
      <p className="hint">
        Grant View / Create / Update / Delete per menu for a role. Only menus included in Software
        Setup, Assign menus, are listed here. Use + / − (or Expand All) to open each group.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="hint">{status}</p>}

      <div className="rmp-toolbar">
        <label className="settings-field" style={{ minWidth: 220, margin: 0 }}>
          <span>Role</span>
          <select
            className="input"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.role_name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={expandAll}>
          Expand All
        </button>
        <button type="button" className="btn" onClick={collapseAll}>
          Collapse All
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !roleId}
          onClick={() => void save()}
        >
          Save Permissions
        </button>
      </div>

      {!loaded ? (
        <p className="hint">Loading menus…</p>
      ) : (
        <div className="sb-table-wrap rmp-table-wrap">
          <table className="data-table rmp-table">
            <thead>
              <tr>
                <th>Menu</th>
                <th className="rmp-check">View</th>
                <th className="rmp-check">Create</th>
                <th className="rmp-check">Update</th>
                <th className="rmp-check">Delete</th>
                <th>Quick</th>
              </tr>
            </thead>
            <tbody>
              {tree.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted">
                    No active menus found. Restart the backend so seed can sync menu definitions.
                  </td>
                </tr>
              ) : (
                renderRows(tree, 0)
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
