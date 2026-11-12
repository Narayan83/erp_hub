import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import './billing/hms-master.css'

type Mode = 'Create' | 'Modify' | 'Delete'

type Menu = {
  id: string
  code: string
  label: string
  parent_id: string | null
  icon: string | null
  sort_order: number
  legacy_mcode: number | null
  legacy_form: string | null
  parameters: string | null
  is_active: boolean
}

export function MenuCreationPage() {
  const [mode, setMode] = useState<Mode>('Create')
  const [rows, setRows] = useState<Menu[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [parentId, setParentId] = useState('')
  const [icon, setIcon] = useState('')
  const [sortOrder, setSortOrder] = useState(0)
  const [legacyForm, setLegacyForm] = useState('')
  const [parameters, setParameters] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const data = await api.get<Menu[]>('/hospital/menus', { include_inactive: true })
    setRows(data)
  }

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [])

  const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r])), [rows])
  const selected = selectedId ? byId[selectedId] : null

  useEffect(() => {
    if (mode === 'Create') {
      setSelectedId('')
      setCode('')
      setLabel('')
      setParentId('')
      setIcon('')
      setSortOrder(0)
      setLegacyForm('')
      setParameters('')
      return
    }
    if (!selected) return
    setCode(selected.code)
    setLabel(selected.label)
    setParentId(selected.parent_id || '')
    setIcon(selected.icon || '')
    setSortOrder(selected.sort_order ?? 0)
    setLegacyForm(selected.legacy_form || '')
    setParameters(selected.parameters || '')
  }, [mode, selectedId, selected])

  function clearForm() {
    setMode('Create')
    setSelectedId('')
    setCode('')
    setLabel('')
    setParentId('')
    setIcon('')
    setSortOrder(0)
    setLegacyForm('')
    setParameters('')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      if (mode === 'Create') {
        await api.post('/hospital/menus', {
          code: code || null,
          label,
          parent_id: parentId || null,
          icon: icon || null,
          sort_order: sortOrder,
          legacy_form: legacyForm || null,
          parameters: parameters || null,
        })
        setOk('Menu created — refresh sidebar to see it')
        clearForm()
      } else if (mode === 'Modify') {
        if (!selectedId) throw new Error('Select a menu')
        await api.patch(`/hospital/menus/${selectedId}`, {
          label,
          parent_id: parentId || null,
          icon: icon || null,
          sort_order: sortOrder,
          legacy_form: legacyForm || null,
          parameters: parameters || null,
        })
        setOk('Updated')
      } else {
        if (!selectedId) throw new Error('Select a menu')
        await api.delete(`/hospital/menus/${selectedId}`)
        setOk('Deleted')
        clearForm()
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const locked = mode === 'Delete'

  return (
    <div className="hms-page">
      <h1>Menu Creation</h1>
      <div className="hint">
        Menus are stored in the database and drive the sidebar. New entries appear after Save (reload
        the app to refresh). Screens still need a matching page implementation to open.
      </div>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}

      <div className="hms-toolbar">
        <label>Action</label>
        <select className="hms-field" style={{ width: 140 }} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option>Create</option>
          <option>Modify</option>
          <option>Delete</option>
        </select>
        <label>Select Menu</label>
        <select
          className="hms-field"
          style={{ minWidth: 280 }}
          disabled={mode === 'Create'}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">—</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} — {r.label}
            </option>
          ))}
        </select>
      </div>

      <form className="hms-box" onSubmit={onSubmit}>
        <div className="hms-box-title">Menu</div>
        <div className="hms-grid hms-grid-3" style={{ marginTop: 4 }}>
          <div className="hms-field-wrap">
            <label>Code</label>
            <input
              className="hms-field"
              readOnly={mode !== 'Create'}
              placeholder="Generated on Save"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className="hms-field-wrap" style={{ gridColumn: 'span 2' }}>
            <label>Label *</label>
            <input
              className="hms-field"
              required={!locked}
              disabled={locked}
              placeholder="Display name in sidebar"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="hms-field-wrap">
            <label>Parent</label>
            <select className="hms-field" disabled={locked} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">(root)</option>
              {rows
                .filter((r) => r.id !== selectedId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Icon</label>
            <input className="hms-field" disabled={locked} value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="Optional" />
          </div>
          <div className="hms-field-wrap">
            <label>Sort Order</label>
            <input
              className="hms-field"
              type="number"
              disabled={locked}
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
            />
          </div>
          <div className="hms-field-wrap">
            <label>Legacy Form</label>
            <input className="hms-field" disabled={locked} value={legacyForm} onChange={(e) => setLegacyForm(e.target.value)} />
          </div>
          <div className="hms-field-wrap">
            <label>Parameters</label>
            <input className="hms-field" disabled={locked} value={parameters} onChange={(e) => setParameters(e.target.value)} />
          </div>
        </div>
        <div className="hms-actions">
          <button className={`hms-btn ${mode === 'Delete' ? 'hms-btn-danger' : 'hms-btn-primary'}`} type="submit" disabled={busy}>
            {busy ? '…' : mode === 'Create' ? 'Save' : mode === 'Modify' ? 'Update' : 'Delete'}
          </button>
          <button className="hms-btn" type="button" onClick={clearForm}>
            Clear
          </button>
        </div>
      </form>

      <div className="hms-table-wrap">
        <table className="hms-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Parent</th>
              <th>Sort</th>
              <th>Icon</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={r.id === selectedId ? 'active' : ''}
                onClick={() => {
                  setSelectedId(r.id)
                  if (mode === 'Create') setMode('Modify')
                }}
              >
                <td>{r.code}</td>
                <td>{r.label}</td>
                <td>{r.parent_id ? byId[r.parent_id]?.label || '' : ''}</td>
                <td>{r.sort_order}</td>
                <td>{r.icon}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
