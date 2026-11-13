import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'

export type MasterMode = 'Create' | 'Modify' | 'Delete'

export type MasterField = {
  key: string
  label: string
  required?: boolean
  type?: 'text' | 'number' | 'select' | 'checkbox' | 'textarea'
  options?: Array<{ value: string; label: string }>
  readOnlyOnCreate?: boolean
  readOnlyOnModify?: boolean
  readOnlyAlways?: boolean
  placeholder?: string
}

type Props = {
  title: string
  hint?: string
  listPath: string
  createPath?: string
  itemPath?: (id: string) => string
  idKey?: string
  labelKey?: string
  codeKey?: string
  paginated?: boolean
  fields: MasterField[]
  columns: Array<{ key: string; label: string }>
  mapCreate?: (form: Record<string, string | number | boolean>) => unknown
  mapUpdate?: (form: Record<string, string | number | boolean>) => unknown
  defaults?: Record<string, string | number | boolean>
  extraToolbar?: ReactNode
  listParams?: Record<string, string | number | boolean>
}

export function ActionSelectMaster({
  title,
  hint,
  listPath,
  createPath,
  itemPath,
  idKey = 'id',
  labelKey = 'name',
  codeKey = 'code',
  paginated = false,
  fields,
  columns,
  mapCreate,
  mapUpdate,
  defaults = {},
  extraToolbar,
  listParams,
}: Props) {
  const [mode, setMode] = useState<MasterMode>('Create')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState<Record<string, string | number | boolean>>({ ...defaults })
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const postPath = createPath || listPath

  async function load() {
    setError(null)
    const data = await api.get<unknown>(listPath, listParams)
    const items = Array.isArray(data)
      ? data
      : ((data as { items?: Record<string, unknown>[] }).items || [])
    setRows(items as Record<string, unknown>[])
  }

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [listPath, JSON.stringify(listParams || {})])

  useEffect(() => {
    if (mode === 'Create') {
      setSelectedId('')
      setForm({ ...defaults })
    }
  }, [mode])

  const selected = useMemo(
    () => rows.find((r) => String(r[idKey]) === selectedId) || null,
    [rows, selectedId, idKey],
  )

  useEffect(() => {
    if (!selected || mode === 'Create') return
    const next: Record<string, string | number | boolean> = { ...defaults }
    for (const f of fields) {
      const v = selected[f.key]
      if (f.type === 'checkbox') next[f.key] = Boolean(v)
      else if (v == null) next[f.key] = ''
      else next[f.key] = v as string | number | boolean
    }
    setForm(next)
  }, [selectedId, mode])

  function setField(key: string, value: string | number | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      if (mode === 'Create') {
        const body = mapCreate ? mapCreate(form) : form
        await api.post(postPath, body)
        setOk('Created')
        setForm({ ...defaults })
      } else if (mode === 'Modify') {
        if (!selectedId) throw new Error('Select an item')
        const body = mapUpdate ? mapUpdate(form) : form
        const path = itemPath ? itemPath(selectedId) : `${listPath}/${selectedId}`
        await api.patch(path, body)
        setOk('Updated')
      } else {
        if (!selectedId) throw new Error('Select an item')
        const path = itemPath ? itemPath(selectedId) : `${listPath}/${selectedId}`
        // soft-delete via PATCH is_active=false when DELETE not available
        try {
          await api.delete(path)
        } catch {
          await api.patch(path, { is_active: false })
        }
        setOk('Deleted / deactivated')
        setSelectedId('')
        setMode('Create')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>{title}</h1>
      {hint && <div className="hint">{hint}</div>}
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}

      <div className="hms-toolbar">
        <label>Action</label>
        <select className="hms-field" style={{ width: 160 }} value={mode} onChange={(e) => setMode(e.target.value as MasterMode)}>
          <option>Create</option>
          <option>Modify</option>
          <option>Delete</option>
        </select>
        <label>Select</label>
        <select
          className="hms-field"
          style={{ minWidth: 280 }}
          disabled={mode === 'Create'}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">—</option>
          {rows.map((r) => (
            <option key={String(r[idKey])} value={String(r[idKey])}>
              {String(r[codeKey] || '')} — {String(r[labelKey] || '')}
            </option>
          ))}
        </select>
        {extraToolbar}
      </div>

      <form className="hms-box" onSubmit={onSubmit}>
        <div className="hms-box-title">Details</div>
        <div className="hms-grid hms-grid-3" style={{ marginTop: 4 }}>
          {fields.map((f) => (
            <div className="hms-field-wrap" key={f.key}>
              <label>
                {f.label}
                {f.required ? ' *' : ''}
              </label>
              {f.type === 'select' ? (
                <select
                  className="hms-field"
                  required={f.required}
                  disabled={mode === 'Delete' || f.readOnlyAlways || (mode === 'Create' && f.readOnlyOnCreate) || (mode === 'Modify' && f.readOnlyOnModify)}
                  value={String(form[f.key] ?? '')}
                  onChange={(e) => setField(f.key, e.target.value)}
                >
                  <option value="">—</option>
                  {(f.options || []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === 'checkbox' ? (
                <input
                  type="checkbox"
                  disabled={mode === 'Delete'}
                  checked={Boolean(form[f.key])}
                  onChange={(e) => setField(f.key, e.target.checked)}
                />
              ) : f.type === 'textarea' ? (
                <textarea
                  className="hms-field"
                  disabled={mode === 'Delete'}
                  value={String(form[f.key] ?? '')}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              ) : (
                <input
                  className="hms-field"
                  type={f.type === 'number' ? 'number' : 'text'}
                  required={f.required && mode !== 'Delete'}
                  readOnly={mode === 'Delete' || f.readOnlyAlways || (mode === 'Create' && f.readOnlyOnCreate) || (mode === 'Modify' && f.readOnlyOnModify)}
                  placeholder={f.placeholder}
                  value={String(form[f.key] ?? '')}
                  onChange={(e) =>
                    setField(f.key, f.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)
                  }
                />
              )}
            </div>
          ))}
        </div>
        <div className="hms-actions">
          <button className={`hms-btn ${mode === 'Delete' ? 'hms-btn-danger' : 'hms-btn-primary'}`} type="submit" disabled={busy}>
            {busy ? '…' : mode === 'Create' ? 'Save' : mode === 'Modify' ? 'Update' : 'Delete'}
          </button>
          <button
            className="hms-btn"
            type="button"
            onClick={() => {
              setMode('Create')
              setForm({ ...defaults })
              setSelectedId('')
            }}
          >
            Clear
          </button>
        </div>
      </form>

      <div className="hms-table-wrap">
        <table className="hms-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={String(r[idKey])}
                className={String(r[idKey]) === selectedId ? 'active' : ''}
                onClick={() => {
                  setSelectedId(String(r[idKey]))
                  if (mode === 'Create') setMode('Modify')
                }}
              >
                {columns.map((c) => (
                  <td key={c.key}>{String(r[c.key] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paginated ? null : null}
    </div>
  )
}
