import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'

type PrintConfig = {
  id: string
  code: string
  name: string
  printer_name?: string | null
  paper_size: string
  custom_width_mm?: number | null
  custom_height_mm?: number | null
  orientation: string
  print_mode: string
  margin_top_mm: number
  margin_right_mm: number
  margin_bottom_mm: number
  margin_left_mm: number
  copies: number
  sort_order: number
  is_active: boolean
  layout_options?: { designed?: boolean } | null
}

type Draft = {
  code: string
  name: string
  printer_name: string
  paper_size: string
  custom_width_mm: string
  custom_height_mm: string
  orientation: string
  print_mode: string
  margin_top_mm: string
  margin_right_mm: string
  margin_bottom_mm: string
  margin_left_mm: string
  copies: string
  sort_order: string
  is_active: boolean
}

const PAPER_SIZES = ['A4', 'A5', 'A6', 'LETTER', 'LEGAL', 'CUSTOM']

const emptyDraft = (): Draft => ({
  code: '',
  name: '',
  printer_name: '',
  paper_size: 'A4',
  custom_width_mm: '',
  custom_height_mm: '',
  orientation: 'portrait',
  print_mode: 'preview',
  margin_top_mm: '12',
  margin_right_mm: '12',
  margin_bottom_mm: '15',
  margin_left_mm: '12',
  copies: '1',
  sort_order: '0',
  is_active: true,
})

const toDraft = (c: PrintConfig): Draft => ({
  code: c.code,
  name: c.name,
  printer_name: c.printer_name || '',
  paper_size: c.paper_size || 'A4',
  custom_width_mm: c.custom_width_mm ? String(c.custom_width_mm) : '',
  custom_height_mm: c.custom_height_mm ? String(c.custom_height_mm) : '',
  orientation: c.orientation || 'portrait',
  print_mode: c.print_mode || 'preview',
  margin_top_mm: String(c.margin_top_mm ?? 12),
  margin_right_mm: String(c.margin_right_mm ?? 12),
  margin_bottom_mm: String(c.margin_bottom_mm ?? 15),
  margin_left_mm: String(c.margin_left_mm ?? 12),
  copies: String(c.copies ?? 1),
  sort_order: String(c.sort_order ?? 0),
  is_active: c.is_active !== false,
})

function payloadOf(d: Draft) {
  const custom = d.paper_size === 'CUSTOM'
  return {
    name: d.name.trim(),
    printer_name: d.printer_name.trim() || null,
    paper_size: d.paper_size,
    custom_width_mm: custom ? Number(d.custom_width_mm) || null : null,
    custom_height_mm: custom ? Number(d.custom_height_mm) || null : null,
    orientation: d.orientation,
    print_mode: d.print_mode,
    margin_top_mm: Number(d.margin_top_mm) || 0,
    margin_right_mm: Number(d.margin_right_mm) || 0,
    margin_bottom_mm: Number(d.margin_bottom_mm) || 0,
    margin_left_mm: Number(d.margin_left_mm) || 0,
    copies: Math.max(1, Math.min(20, Math.round(Number(d.copies)) || 1)),
    sort_order: Math.round(Number(d.sort_order)) || 0,
    is_active: d.is_active,
  }
}

type CatalogDoc = {
  code: string
  name: string
  kind?: string
}

type PrinterInfo = { name: string; is_default?: boolean }

export function PrintMasterPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<PrintConfig[]>([])
  const [catalogDocs, setCatalogDocs] = useState<CatalogDoc[]>([])
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  const designable = useMemo(() => new Set(catalogDocs.map((d) => d.code)), [catalogDocs])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [configs, catalog, printerData] = await Promise.all([
        api.get<PrintConfig[]>('/print-configs'),
        api
          .get<{ documents?: CatalogDoc[] }>('/print-configs/layouts/catalog')
          .catch(() => ({ documents: [] })),
        api
          .get<{ printers?: PrinterInfo[] }>('/print-configs/printers')
          .catch(() => ({ printers: [] })),
      ])
      setRows(configs)
      setCatalogDocs(catalog.documents || [])
      setPrinters(printerData.printers || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const unconfiguredDocs = useMemo(() => {
    const existingCodes = new Set(rows.map((r) => r.code.toUpperCase()))
    return catalogDocs.filter((doc) => !existingCodes.has(doc.code.toUpperCase()))
  }, [catalogDocs, rows])

  const openDesigner = (code?: string) =>
    navigate(`/print_template_designer${code ? `?code=${encodeURIComponent(code)}` : ''}`, {
      state: { returnTo: 'print_master' },
    })

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => `${r.code} ${r.name} ${r.printer_name || ''}`.toLowerCase().includes(q))
  }, [rows, filter])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, [key]: value } } : e))

  async function save(ev: FormEvent) {
    ev.preventDefault()
    if (!editing) return
    const { id, draft } = editing
    if (draft.name.trim().length < 2) return setError('Name must be at least 2 characters.')
    if (!id && !draft.code.trim()) return setError('Code is required for a new print configuration.')
    if (draft.paper_size === 'CUSTOM' && !(Number(draft.custom_width_mm) > 0 && Number(draft.custom_height_mm) > 0)) {
      return setError('Enter custom width and height (mm).')
    }
    setSaving(true)
    setError(null)
    try {
      if (id) {
        await api.patch(`/print-configs/${id}`, payloadOf(draft))
        setMessage(`Saved "${draft.name.trim()}".`)
      } else {
        await api.post('/print-configs', { code: draft.code.trim().toUpperCase(), ...payloadOf(draft) })
        setMessage(`Created "${draft.name.trim()}".`)
      }
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: PrintConfig) {
    if (!window.confirm(`Delete print configuration ${row.code} (${row.name})? Its saved bill design is deleted too.`)) return
    try {
      await api.delete(`/print-configs/${row.id}`)
      setMessage(`Deleted ${row.code}.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const d = editing?.draft
  const num = (key: keyof Draft, label: string, min = 0, max = 100, step = 0.5) => (
    <div className="col-6 col-md-3">
      <label className="form-label small mb-1">{label}</label>
      <input
        className="form-control form-control-sm"
        type="number"
        min={min}
        max={max}
        step={step}
        value={String(d?.[key] ?? '')}
        onChange={(e) => set(key, e.target.value as never)}
      />
    </div>
  )

  return (
    <div className="erp-card print-master">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h1 className="h4 mb-0 me-auto">Print Master</h1>
        <input
          className="form-control form-control-sm pm-filter"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => void load()}>
          Refresh
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => setEditing({ id: null, draft: emptyDraft() })}
        >
          New configuration
        </button>
        <button type="button" className="btn btn-sm btn-erp pm-design-btn" onClick={() => openDesigner()}>
          Design bill template
        </button>
      </div>
      <p className="text-secondary small mb-3">
        Choose the printer, paper, orientation, margins and print mode for each document. Printer choice
        is saved on <strong>this PC only</strong> — other billing stations keep their own printer (or
        Windows default if unset). Use <strong>Design bill template</strong> to arrange fields, margins,
        lines and shapes on the page.
      </p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between" role="alert">
          <span>{error}</span>
          <button type="button" className="btn-close" aria-label="Dismiss" onClick={() => setError(null)} />
        </div>
      )}
      {message && (
        <div className="alert alert-success py-2 d-flex justify-content-between" role="status">
          <span>{message}</span>
          <button type="button" className="btn-close" aria-label="Dismiss" onClick={() => setMessage(null)} />
        </div>
      )}

      <div className="table-responsive">
        <table className="table table-sm table-hover align-middle">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Printer</th>
              <th>Paper</th>
              <th>Orientation</th>
              <th>Mode</th>
              <th className="text-end">Copies</th>
              <th>Design</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className={r.is_active ? '' : 'text-secondary'}>
                <td>
                  <code>{r.code}</code>
                </td>
                <td>{r.name}</td>
                <td>{r.printer_name || 'Windows default'}</td>
                <td>
                  {r.paper_size === 'CUSTOM' && r.custom_width_mm && r.custom_height_mm
                    ? `Custom ${r.custom_width_mm} × ${r.custom_height_mm} mm`
                    : r.paper_size}
                </td>
                <td>{r.orientation}</td>
                <td>{r.print_mode}</td>
                <td className="text-end">{r.copies}</td>
                <td>
                  {r.layout_options?.designed ? (
                    <span className="badge text-bg-primary">Custom</span>
                  ) : (
                    <span className="text-secondary small">Built-in</span>
                  )}
                </td>
                <td>{r.is_active ? 'Yes' : 'No'}</td>
                <td className="text-nowrap text-end">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary me-1"
                    onClick={() => setEditing({ id: r.id, draft: toDraft(r) })}
                  >
                    Edit
                  </button>
                  {designable.has(r.code) && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary me-1"
                      onClick={() => openDesigner(r.code)}
                      title="Open this document in the bill template designer"
                    >
                      Design
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void remove(r)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={10} className="text-center text-secondary py-3">
                  {loading ? 'Loading…' : 'No print configurations yet. Use "Design bill template" to create one.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && d && (
        <div className="pm-backdrop" onMouseDown={() => !saving && setEditing(null)}>
          <form className="pm-dialog" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
            <div className="d-flex align-items-center mb-3">
              <h2 className="h5 mb-0 me-auto">{editing.id ? `Edit ${d.code}` : 'New print configuration'}</h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={() => setEditing(null)} />
            </div>
            <div className="row g-2">
              {!editing.id && unconfiguredDocs.length > 0 && (
                <div className="col-12">
                  <label className="form-label small mb-1">Menu / document (optional)</label>
                  <select
                    className="form-select form-select-sm"
                    value={unconfiguredDocs.some((doc) => doc.code === d.code) ? d.code : ''}
                    onChange={(e) => {
                      const picked = unconfiguredDocs.find((doc) => doc.code === e.target.value)
                      if (!picked) return
                      setEditing((cur) =>
                        cur
                          ? {
                              ...cur,
                              draft: {
                                ...cur.draft,
                                code: picked.code,
                                name: picked.name || picked.code,
                              },
                            }
                          : cur,
                      )
                    }}
                  >
                    <option value="">Custom code…</option>
                    {unconfiguredDocs.map((doc) => (
                      <option key={doc.code} value={doc.code}>
                        {doc.name} ({doc.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="col-md-4">
                <label className="form-label small mb-1">Code</label>
                <input
                  className="form-control form-control-sm"
                  value={d.code}
                  maxLength={80}
                  disabled={!!editing.id}
                  onChange={(e) => set('code', e.target.value.toUpperCase())}
                />
              </div>
              <div className="col-md-8">
                <label className="form-label small mb-1">Name</label>
                <input
                  className="form-control form-control-sm"
                  value={d.name}
                  maxLength={200}
                  onChange={(e) => set('name', e.target.value)}
                />
              </div>
              <div className="col-12">
                <label className="form-label small mb-1">Printer</label>
                <select
                  className="form-select form-select-sm"
                  value={d.printer_name}
                  onChange={(e) => set('printer_name', e.target.value)}
                >
                  <option value="">Windows default printer</option>
                  {d.printer_name && !printers.some((p) => p.name === d.printer_name) ? (
                    <option value={d.printer_name}>{d.printer_name} (unavailable)</option>
                  ) : null}
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                      {p.is_default ? ' (Windows default)' : ''}
                    </option>
                  ))}
                </select>
                <div className="form-text">
                  Applies only on this computer. Leave as Windows default if this station has no dedicated printer.
                </div>
              </div>
              <div className="col-6 col-md-3">
                <label className="form-label small mb-1">Paper</label>
                <select
                  className="form-select form-select-sm"
                  value={d.paper_size}
                  onChange={(e) => set('paper_size', e.target.value)}
                >
                  {PAPER_SIZES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              {d.paper_size === 'CUSTOM' && (
                <>
                  {num('custom_width_mm', 'Width (mm)', 40, 1000, 0.1)}
                  {num('custom_height_mm', 'Height (mm)', 40, 1000, 0.1)}
                </>
              )}
              <div className="col-6 col-md-3">
                <label className="form-label small mb-1">Orientation</label>
                <select
                  className="form-select form-select-sm"
                  value={d.orientation}
                  onChange={(e) => set('orientation', e.target.value)}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>
              <div className="col-6 col-md-3">
                <label className="form-label small mb-1">Print mode</label>
                <select
                  className="form-select form-select-sm"
                  value={d.print_mode}
                  onChange={(e) => set('print_mode', e.target.value)}
                >
                  <option value="preview">Preview first</option>
                  <option value="direct">Direct print</option>
                </select>
              </div>
              {num('margin_top_mm', 'Margin top (mm)')}
              {num('margin_right_mm', 'Margin right (mm)')}
              {num('margin_bottom_mm', 'Margin bottom (mm)')}
              {num('margin_left_mm', 'Margin left (mm)')}
              {num('copies', 'Copies', 1, 20, 1)}
              {num('sort_order', 'Sort order', -9999, 9999, 1)}
              <div className="col-6 col-md-3 d-flex align-items-end">
                <div className="form-check">
                  <input
                    id="pm-active"
                    className="form-check-input"
                    type="checkbox"
                    checked={d.is_active}
                    onChange={(e) => set('is_active', e.target.checked)}
                  />
                  <label htmlFor="pm-active" className="form-check-label small">
                    Active
                  </label>
                </div>
              </div>
            </div>
            <p className="text-secondary small mt-3 mb-0">
              Field layout, per-page margins and shapes are edited in the bill template designer.
            </p>
            <div className="d-flex gap-2 justify-content-end mt-3">
              {editing.id && designable.has(d.code) && (
                <button type="button" className="btn btn-sm btn-outline-primary me-auto" onClick={() => openDesigner(d.code)}>
                  Design bill template
                </button>
              )}
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-sm btn-erp" disabled={saving}>
                {editing.id ? 'Save' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
