import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BILL_FORMATS, readLocalBillFormat, writeLocalBillFormat } from '../../lib/generp/billFormat'
import { api, ApiError } from '../../api/client'
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'

export type PrintConfig = {
  id: string
  code: string
  name: string
  printer_name?: string | null
  bill_format?: string
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
}

const PAPER_SIZES = ['A4', 'A5', 'LETTER', '3INCH', '4INCH', 'CUSTOM'] as const
const ORIENTATIONS = ['PORTRAIT', 'LANDSCAPE'] as const
const PRINT_MODES = ['NORMAL', 'THERMAL', 'DOT_MATRIX'] as const

type FormState = {
  bill_format: string
  paper_size: string
  custom_width_mm: number
  custom_height_mm: number
  orientation: string
  print_mode: string
  margin_top_mm: number
  margin_right_mm: number
  margin_bottom_mm: number
  margin_left_mm: number
  copies: number
}

const EMPTY_FORM: FormState = {
  bill_format: 'A4',
  paper_size: 'A4',
  custom_width_mm: 0,
  custom_height_mm: 0,
  orientation: 'PORTRAIT',
  print_mode: 'NORMAL',
  margin_top_mm: 12,
  margin_right_mm: 12,
  margin_bottom_mm: 15,
  margin_left_mm: 12,
  copies: 1,
}

function pickOption(value: string | null | undefined, options: readonly string[], fallback: string) {
  const raw = String(value || '').trim()
  if (!raw) return fallback
  const hit = options.find((o) => o.toLowerCase() === raw.toLowerCase())
  return hit ?? fallback
}

function toForm(cfg: PrintConfig): FormState {
  return {
    bill_format: readLocalBillFormat(cfg.code),
    paper_size: pickOption(cfg.paper_size, PAPER_SIZES, 'A4'),
    custom_width_mm: Number(cfg.custom_width_mm || 0),
    custom_height_mm: Number(cfg.custom_height_mm || 0),
    orientation: pickOption(cfg.orientation, ORIENTATIONS, 'PORTRAIT'),
    print_mode: pickOption(cfg.print_mode, PRINT_MODES, 'NORMAL'),
    margin_top_mm: Number(cfg.margin_top_mm ?? 12),
    margin_right_mm: Number(cfg.margin_right_mm ?? 12),
    margin_bottom_mm: Number(cfg.margin_bottom_mm ?? 15),
    margin_left_mm: Number(cfg.margin_left_mm ?? 12),
    copies: Math.max(1, Math.min(10, Number(cfg.copies || 1))),
  }
}

export function PrintMasterPage() {
  const [configs, setConfigs] = useState<PrintConfig[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const selected = useMemo(
    () => configs.find((c) => c.id === selectedId) ?? null,
    [configs, selectedId],
  )

  const load = useCallback(async () => {
    setError('')
    try {
      const rows = await api.get<PrintConfig[]>('/print-configs')
      setConfigs(rows)
      const keep = rows.find((r) => r.id === selectedId) ?? rows[0]
      if (keep) {
        setSelectedId(keep.id)
        setForm(toForm(keep))
      } else {
        setSelectedId('')
        setForm(EMPTY_FORM)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load print configs')
    }
  }, [selectedId])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSelectDoc = (id: string) => {
    setSelectedId(id)
    const cfg = configs.find((c) => c.id === id)
    if (cfg) setForm(toForm(cfg))
  }

  const setNum =
    (key: keyof FormState) =>
    (raw: string) => {
      const n = Number(raw)
      setForm((f) => ({ ...f, [key]: Number.isFinite(n) ? n : 0 }))
    }

  const save = async () => {
    if (!selectedId) {
      alert('Select a document.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const updated = await api.patch<PrintConfig>(`/print-configs/${selectedId}`, {
        paper_size: form.paper_size,
        custom_width_mm: form.custom_width_mm || null,
        custom_height_mm: form.custom_height_mm || null,
        orientation: form.orientation,
        print_mode: form.print_mode,
        margin_top_mm: form.margin_top_mm,
        margin_right_mm: form.margin_right_mm,
        margin_bottom_mm: form.margin_bottom_mm,
        margin_left_mm: form.margin_left_mm,
        copies: form.copies,
      })
      writeLocalBillFormat(selected?.code || updated.code, form.bill_format)
      setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setForm(toForm(updated))
      alert('Print settings saved.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const exportConfigs = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel('print-master', {
      name: 'Print configs',
      headers: [
        'Code',
        'Name',
        'Bill format',
        'Paper',
        'Orientation',
        'Mode',
        'Copies',
        'Active',
      ],
      rows: configs.map((c) => [
        c.code,
        c.name,
        readLocalBillFormat(c.code),
        c.paper_size,
        c.orientation,
        c.print_mode,
        c.copies,
        c.is_active ? 'Yes' : 'No',
      ]),
    }, format)
  }

  return (
    <div className="settings-page print-master-page">
      <h2>Print Master</h2>
      <p className="hint">
        Paper, orientation, margins and print mode are saved for this product. The paper format
        (A4, A5, A6, thermal) is remembered in this browser only. Printing opens this computer&apos;s
        print dialog. To arrange fields on the bill, use{' '}
        <Link to="/print_template_designer">Print Template Designer</Link>.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="settings-box">
        <label className="settings-field">
          <span>Document</span>
          <select
            className="input"
            value={selectedId}
            onChange={(e) => onSelectDoc(e.target.value)}
            disabled={configs.length === 0}
          >
            {configs.length === 0 && <option value="">No documents</option>}
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <p className="hint" style={{ margin: 0 }}>
            Editing: <strong>{selected.name}</strong> ({selected.code})
          </p>
        )}
      </div>

      <div className="settings-box">
        <div className="settings-box-title">Print Settings</div>

        <label className="settings-field">
          <span>Bill format (this browser)</span>
          <select
            className="input"
            value={form.bill_format}
            onChange={(e) => setForm((f) => ({ ...f, bill_format: e.target.value }))}
          >
            {BILL_FORMATS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-field">
          <span>Paper Size</span>
          <select
            className="input"
            value={form.paper_size}
            onChange={(e) => setForm((f) => ({ ...f, paper_size: e.target.value }))}
          >
            {PAPER_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="settings-field-row">
          <label className="settings-field">
            <span>Custom Width (mm)</span>
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              value={form.custom_width_mm}
              disabled={form.paper_size !== 'CUSTOM'}
              onChange={(e) => setNum('custom_width_mm')(e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>Custom Height (mm)</span>
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              value={form.custom_height_mm}
              disabled={form.paper_size !== 'CUSTOM'}
              onChange={(e) => setNum('custom_height_mm')(e.target.value)}
            />
          </label>
        </div>

        <label className="settings-field">
          <span>Orientation</span>
          <select
            className="input"
            value={form.orientation}
            onChange={(e) => setForm((f) => ({ ...f, orientation: e.target.value }))}
          >
            {ORIENTATIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-field">
          <span>Print Mode</span>
          <select
            className="input"
            value={form.print_mode}
            onChange={(e) => setForm((f) => ({ ...f, print_mode: e.target.value }))}
          >
            {PRINT_MODES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="settings-field-row">
          <label className="settings-field">
            <span>Margin Top (mm)</span>
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              value={form.margin_top_mm}
              onChange={(e) => setNum('margin_top_mm')(e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>Margin Right (mm)</span>
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              value={form.margin_right_mm}
              onChange={(e) => setNum('margin_right_mm')(e.target.value)}
            />
          </label>
        </div>
        <div className="settings-field-row">
          <label className="settings-field">
            <span>Margin Bottom (mm)</span>
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              value={form.margin_bottom_mm}
              onChange={(e) => setNum('margin_bottom_mm')(e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>Margin Left (mm)</span>
            <input
              className="input"
              type="number"
              step={0.1}
              min={0}
              value={form.margin_left_mm}
              onChange={(e) => setNum('margin_left_mm')(e.target.value)}
            />
          </label>
        </div>

        <label className="settings-field">
          <span>Copies</span>
          <input
            className="input"
            type="number"
            min={1}
            max={10}
            style={{ maxWidth: 100 }}
            value={form.copies}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                copies: Math.max(1, Math.min(10, Number(e.target.value) || 1)),
              }))
            }
          />
        </label>
      </div>

      <div className="sb-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" disabled={busy || !selectedId} onClick={() => void save()}>
          Save Print Settings
        </button>
        <ExportFormatButtons disabled={configs.length === 0} onExport={exportConfigs} />
      </div>
    </div>
  )
}
