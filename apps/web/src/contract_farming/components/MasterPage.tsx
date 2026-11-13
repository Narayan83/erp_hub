import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'

export type FieldDef = {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'select' | 'checkbox'
  options?: { value: string; label: string }[]
  required?: boolean
  list?: boolean
  form?: boolean
  wide?: boolean
}

type Row = Record<string, unknown> & { id: string }

type Props = {
  title: string
  hint?: string
  path: string
  fields: FieldDef[]
  empty: Record<string, unknown>
}

function fmt(v: unknown) {
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return v == null ? '' : String(v)
}

export function MasterPage({ title, hint, path, fields, empty }: Props) {
  const [rows, setRows] = useState<Row[]>([])
  const [form, setForm] = useState<Record<string, unknown>>({ ...empty })
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const listFields = useMemo(() => fields.filter((f) => f.list !== false), [fields])
  const formFields = useMemo(() => fields.filter((f) => f.form !== false), [fields])

  const load = async () => {
    setRows(await api.get<Row[]>(path))
  }

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message))
  }, [path])

  const save = async () => {
    setError('')
    try {
      if (editId) await api.put(`${path}/${editId}`, form)
      else await api.post(path, form)
      setEditId(null)
      setForm({ ...empty })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    }
  }

  return (
    <div>
      <h1>{title}</h1>
      {hint && <p className="hint">{hint}</p>}
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <div className="grid2">
          {formFields.map((f) => (
            <label key={f.key} style={f.wide ? { gridColumn: '1 / -1' } : undefined}>
              {f.label}
              {f.type === 'textarea' ? (
                <textarea
                  className="input"
                  value={String(form[f.key] ?? '')}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              ) : f.type === 'select' ? (
                <select
                  className="input"
                  value={String(form[f.key] ?? '')}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                >
                  {(f.options || []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === 'checkbox' ? (
                <input
                  type="checkbox"
                  checked={Boolean(form[f.key])}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })}
                />
              ) : (
                <input
                  className="input"
                  value={String(form[f.key] ?? '')}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              )}
            </label>
          ))}
        </div>
        <div className="row">
          <button className="btn primary" type="button" onClick={() => void save()}>
            {editId ? 'Update' : 'Save'}
          </button>
          {editId && (
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setEditId(null)
                setForm({ ...empty })
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {listFields.map((f) => (
                <th key={f.key}>{f.label}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {listFields.map((f) => (
                  <td key={f.key}>
                    {f.key === 'entry_type' ? (
                      <span className={`badge ${String(r[f.key])}`}>{fmt(r[f.key])}</span>
                    ) : (
                      fmt(r[f.key])
                    )}
                  </td>
                ))}
                <td className="row-actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      setEditId(r.id)
                      const next: Record<string, unknown> = {}
                      for (const f of formFields) next[f.key] = r[f.key] ?? empty[f.key]
                      setForm(next)
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn danger"
                    type="button"
                    onClick={async () => {
                      if (!confirm('Delete this record?')) return
                      try {
                        await api.del(`${path}/${r.id}`)
                        await load()
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Delete failed')
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={listFields.length + 1}>No records yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
