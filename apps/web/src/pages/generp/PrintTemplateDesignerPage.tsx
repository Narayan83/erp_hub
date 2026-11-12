import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { canEditPrintTemplates } from '../../auth/roles'
import { BarcodeCanvasEditor } from '../../components/generp/BarcodeCanvasEditor'
import { BarcodeFieldSourceSelect } from '../../components/generp/BarcodeFieldSourceSelect'
import { BarcodeGapSettings } from '../../components/generp/BarcodeGapSettings'
import { BarcodeSheetSettings } from '../../components/generp/BarcodeSheetSettings'
import { BillCanvasEditor } from '../../components/generp/BillCanvasEditor'
import { BillPreviewFrame } from '../../components/generp/BillPreviewFrame'
import {
  BARCODE_LAYOUTS,
  parseBarcodeLabelSettings,
  type BarcodeLayoutId,
} from '../../lib/generp/barcodeLabels'
import {
  BAND_LABELS,
  addCustomPage,
  bandIsPlaced,
  bandOf,
  customPagesOf,
  fitLayoutToPage,
  isCustomFormat,
  newStaticId,
  packColumnsLeft,
  pageOrientationOf,
  pagePaddingOf,
  pageSpecOf,
  patchBand,
  removeCustomPage,
  reorderById,
  setPageBorder,
  setPageOrientation,
  setPagePadding,
  type BandId,
  type DocumentLayout,
  type LayoutAlign,
  type LayoutCatalog,
  type LayoutField,
  type PageOrientation,
} from '../../lib/generp/printLayout'
import { TplPreviewPanel } from '../../components/generp/TplPreviewPanel'
import type { CompanyProfile } from '../../generpTypes'

const BAND_ORDER: BandId[] = ['header', 'meta', 'columns', 'totals', 'footer']

type LayoutResponse = {
  id: string | null
  code: string
  name: string
  kind: DocumentLayout['kind']
  layout: DocumentLayout
}

function FieldRow({
  field,
  band,
  dragId,
  dropId,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onPatch,
  onRemove,
}: {
  field: LayoutField
  band: BandId
  dragId: string | null
  dropId: string | null
  onDragStart: (e: DragEvent<HTMLDivElement>, id: string) => void
  onDragOver: (e: DragEvent<HTMLDivElement>, id: string) => void
  onDrop: (e: DragEvent<HTMLDivElement>, id: string) => void
  onDragEnd: () => void
  onPatch: (id: string, patch: Partial<LayoutField>) => void
  onRemove: (id: string) => void
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, field.id)}
      onDragOver={(e) => onDragOver(e, field.id)}
      onDrop={(e) => onDrop(e, field.id)}
      onDragEnd={onDragEnd}
      className={`tpl-field${dropId === field.id ? ' drag-over' : ''}${dragId === field.id ? ' dragging' : ''}${
        field.visible ? '' : ' is-hidden'
      }`}
    >
      <span className="drag-handle" title="Drag to move">
        ⋮⋮
      </span>
      <label className="tpl-check" title="Print this field">
        <input
          type="checkbox"
          checked={field.visible}
          onChange={(e) => onPatch(field.id, { visible: e.target.checked })}
        />
      </label>
      <input
        className="input"
        value={field.label || ''}
        title="Caption on the print"
        onChange={(e) => onPatch(field.id, { label: e.target.value })}
      />
      {band === 'columns' ? (
        <input
          className="input tpl-width"
          type="number"
          min={2}
          max={400}
          step={0.1}
          value={field.widthMm ?? field.width ?? 10}
          title="Column width (mm)"
          onChange={(e) => {
            const widthMm = Math.max(2, Number(e.target.value) || 10)
            onPatch(field.id, { widthMm, width: Math.max(2, Math.round(widthMm)) })
          }}
        />
      ) : (
        <label className="tpl-check tpl-full" title="Take a whole row">
          <input
            type="checkbox"
            checked={!!field.full_row}
            onChange={(e) => onPatch(field.id, { full_row: e.target.checked })}
          />
          <span>Row</span>
        </label>
      )}
      <select
        className="input tpl-align"
        value={field.align || 'left'}
        onChange={(e) => onPatch(field.id, { align: e.target.value as LayoutAlign })}
      >
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </select>
      {(field.id.startsWith('static_') || field.id === 'terms' || field.id === 'thanks' || field.id === 'computer_note' || field.id === 'signature' || field.id === 'tax_invoice_title' || field.id === 'report_title') && (
        <input
          className="input tpl-text"
          value={field.text || ''}
          placeholder="Printed text"
          onChange={(e) => onPatch(field.id, { text: e.target.value })}
        />
      )}
      <button type="button" className="btn tpl-remove" title="Remove from print" onClick={() => onRemove(field.id)}>
        ×
      </button>
    </div>
  )
}

export function PrintTemplateDesignerPage() {
  const { user, menus } = useAuth()
  const allowed = canEditPrintTemplates(user, menus)
  const [catalog, setCatalog] = useState<LayoutCatalog | null>(null)
  const [code, setCode] = useState('SALE_BILL')
  const [format, setFormat] = useState('A4')
  const [layout, setLayout] = useState<DocumentLayout | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const [dragBand, setDragBand] = useState<BandId | null>(null)
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null)
  const [customName, setCustomName] = useState('')
  const [customWidth, setCustomWidth] = useState(210)
  const [customHeight, setCustomHeight] = useState(148)
  const previewTimer = useRef<number | null>(null)

  const kind = layout?.kind || catalog?.documents.find((d) => d.code === code)?.kind || 'bill'
  const isBarcode = kind === 'barcode'
  const band = layout && !isBarcode ? bandOf(layout, format) : null
  const spec = layout && !isBarcode ? pageSpecOf(layout, format) : null
  const pagePad = layout && !isBarcode ? pagePaddingOf(layout, format) : null
  const orientation: PageOrientation = layout && !isBarcode ? pageOrientationOf(layout, format) : 'portrait'
  const thermalPaper = format.startsWith('THERMAL')
  const customPages = layout ? customPagesOf(layout) : {}
  const paperOptions = [
    ...(catalog?.formats || []),
    ...Object.entries(customPages).map(([pageCode, page]) => ({
      code: pageCode,
      name: `${page.name} (${page.widthMm} × ${page.heightMm} mm)`,
    })),
  ]

  const load = useCallback(async (docCode: string) => {
    setError('')
    const data = await api.get<LayoutResponse>(`/print-configs/layouts/by-code/${docCode}`)
    setLayout(data.layout)
    setCode(data.code)
    if (data.kind === 'barcode') setFormat('A4')
    else {
      setFormat((prev) => (isCustomFormat(prev) && !customPagesOf(data.layout)[prev] ? 'A4' : prev))
    }
  }, [])

  useEffect(() => {
    if (!allowed) return
    void (async () => {
      try {
        const cat = await api.get<LayoutCatalog>('/print-configs/layouts/catalog')
        setCatalog(cat)
        await load('SALE_BILL')
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load templates')
      }
    })()
  }, [allowed, load])

  useEffect(() => {
    if (!allowed) return
    void api
      .get<CompanyProfile>('/company-profile')
      .then(setCompanyProfile)
      .catch(() => setCompanyProfile(null))
  }, [allowed])

  useEffect(() => {
    if (!allowed || !layout || isBarcode) return
    if (previewTimer.current) window.clearTimeout(previewTimer.current)
    previewTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const html = await api.post<string>('/print-configs/layouts/preview', {
            code,
            bill_format: format,
            layout,
          })
          setPreviewHtml(typeof html === 'string' ? html : '')
        } catch {
          setPreviewHtml('')
        }
      })()
    }, 350)
    return () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current)
    }
  }, [allowed, layout, code, format, isBarcode])

  const onSelectDoc = async (next: string) => {
    setBusy(true)
    try {
      await load(next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    } finally {
      setBusy(false)
    }
  }

  const updateBand = (bandId: BandId, fields: LayoutField[]) => {
    if (!layout) return
    setLayout(patchBand(layout, format, bandId, fields))
  }

  const patchField = (bandId: BandId, id: string, patch: Partial<LayoutField>) => {
    if (!band) return
    let fields = band[bandId].map((f) => (f.id === id ? { ...f, ...patch } : f))
    if (bandId === 'columns' && (patch.widthMm != null || patch.width != null)) {
      fields = packColumnsLeft(fields, format, pageSpecOf(layout!, format).innerMm)
    }
    updateBand(bandId, fields)
  }

  const removeField = (bandId: BandId, id: string) => {
    if (!band) return
    if (id.startsWith('static_')) {
      updateBand(
        bandId,
        band[bandId].filter((f) => f.id !== id),
      )
      return
    }
    patchField(bandId, id, { visible: false })
  }

  const restoreField = (bandId: BandId, id: string) => {
    if (!band) return
    const placed = bandIsPlaced(band[bandId])
    const inner = layout ? pageSpecOf(layout, format).innerMm : pageSpecOf({ kind: 'bill' }, format).innerMm
    const y = placed
      ? Math.max(0, ...band[bandId].filter((f) => f.visible).map((f) => (f.yMm || 0) + (f.heightMm || 6))) + 1
      : undefined
    const logo = id === 'company_logo'
    let fields = band[bandId].map((f) =>
      f.id === id
        ? {
            ...f,
            visible: true,
            ...(placed
              ? {
                  xMm: f.xMm ?? 1,
                  yMm: f.yMm ?? y,
                  widthMm:
                    f.widthMm ??
                    (bandId === 'columns' ? Math.max(12, f.width || 10) : logo ? Math.min(32, inner - 2) : inner - 2),
                  heightMm: f.heightMm ?? (logo ? (format.startsWith('THERMAL') ? 12 : 18) : 6.5),
                  fontFamily: f.fontFamily || 'Times New Roman',
                  fontSizePt: f.fontSizePt ?? 11,
                }
              : {}),
          }
        : f,
    )
    if (bandId === 'columns' && placed) {
      fields = packColumnsLeft(fields, format, inner)
    }
    updateBand(bandId, fields)
  }

  const addStatic = (bandId: BandId) => {
    if (!band || !layout) return
    const inner = pageSpecOf(layout, format).innerMm
    const placed = bandIsPlaced(band[bandId])
    const y = placed
      ? Math.max(0, ...band[bandId].filter((f) => f.visible).map((f) => (f.yMm || 0) + (f.heightMm || 6))) + 1
      : undefined
    updateBand(bandId, [
      ...band[bandId],
      {
        id: newStaticId(),
        visible: true,
        label: 'Custom text',
        align: 'left',
        full_row: true,
        text: 'Type the line to print',
        ...(placed
          ? {
              xMm: 1,
              yMm: y,
              widthMm: inner - 2,
              heightMm: 6,
              fontFamily: 'Times New Roman',
              fontSizePt: 11,
            }
          : {}),
      },
    ])
  }

  const onDragStart = (e: DragEvent<HTMLDivElement>, id: string, bandId: BandId) => {
    setDragId(id)
    setDragBand(bandId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  const onDragOver = (e: DragEvent<HTMLDivElement>, id: string) => {
    e.preventDefault()
    if (dragId && dragId !== id) setDropId(id)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>, id: string, bandId: BandId) => {
    e.preventDefault()
    const from = dragId || e.dataTransfer.getData('text/plain')
    if (from && from !== id && band && dragBand === bandId) {
      updateBand(bandId, reorderById(band[bandId], from, id))
    }
    setDragId(null)
    setDropId(null)
    setDragBand(null)
  }
  const onDragEnd = () => {
    setDragId(null)
    setDropId(null)
    setDragBand(null)
  }

  const save = async () => {
    if (!layout) return
    setBusy(true)
    setError('')
    try {
      const saved = await api.put<LayoutResponse>(`/print-configs/layouts/by-code/${code}`, { layout })
      setLayout(saved.layout)
      alert('Print template saved. All users will print this layout.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (!confirm('Reset this document to the default layout? Unsaved changes will be lost.')) return
    setBusy(true)
    setError('')
    try {
      const saved = await api.post<LayoutResponse>(`/print-configs/layouts/by-code/${code}/reset`, {})
      setLayout(saved.layout)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed')
    } finally {
      setBusy(false)
    }
  }

  const copyFromA4 = () => {
    if (!layout?.formats?.A4 || format === 'A4') return
    const orients = { ...(layout.page_orientations || {}) }
    if (layout.page_orientations?.A4 === 'landscape') orients[format] = 'landscape'
    else delete orients[format]
    setLayout(
      fitLayoutToPage(
        {
          ...layout,
          formats: { ...layout.formats, [format]: structuredClone(layout.formats.A4) },
          page_paddings: {
            ...(layout.page_paddings || {}),
            [format]: structuredClone(layout.page_paddings?.A4 || pagePaddingOf(layout, 'A4')),
          },
          page_orientations: orients,
        },
        format,
        pageSpecOf(layout, 'A4').innerMm,
      ),
    )
  }

  const applyPageSetup = (next: DocumentLayout) => {
    const fromInner = layout ? pageSpecOf(layout, format).innerMm : undefined
    setLayout(fitLayoutToPage(next, format, fromInner))
  }

  const createCustomTemplate = () => {
    if (!layout) return
    const name = customName.trim()
    if (!name) {
      setError('Enter a name for the custom template')
      return
    }
    const widthMm = Math.max(40, Math.min(400, Number(customWidth) || 0))
    const heightMm = Math.max(40, Math.min(600, Number(customHeight) || 0))
    if (!(widthMm && heightMm)) {
      setError('Enter a custom width and height in millimetres')
      return
    }
    const created = addCustomPage(layout, format, name, widthMm, heightMm)
    setError('')
    setLayout(created.layout)
    setFormat(created.code)
    setCustomName('')
  }

  const deleteCurrentCustom = () => {
    if (!layout || !isCustomFormat(format)) return
    if (!confirm(`Delete custom template “${customPages[format]?.name || format}”?`)) return
    setLayout(removeCustomPage(layout, format))
    setFormat('A4')
  }

  const barcodeSettings = useMemo(
    () => (layout && isBarcode ? parseBarcodeLabelSettings(layout) : null),
    [layout, isBarcode],
  )

  const updateBarcode = (next: ReturnType<typeof parseBarcodeLabelSettings>) => {
    setLayout({
      version: 1,
      kind: 'barcode',
      default_layout: next.default_layout,
      fields: next.fields,
      gaps: next.gaps,
      canvases: next.canvases,
      sheet: next.sheet,
    })
  }

  if (!allowed) {
    return (
      <div className="settings-page">
        <h2>Print Template Designer</h2>
        <p className="hint">Only Super Admin can change print templates. Staff always print the saved layout.</p>
      </div>
    )
  }

  return (
    <div className="settings-page tpl-page">
      <h2>Print Template Designer</h2>
      <p className="hint">
        Click a variable and drag it on the page. <strong>Page setup</strong> sets paper, portrait / landscape,
        and custom sizes. Live preview is a floating window — drag, minimize, or maximize it. Save once; every
        PC prints this layout. Printer name stays in <Link to="/print_master">Print Master</Link>.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="tpl-toolbar">
        <label className="settings-field">
          <span>Document</span>
          <select className="input" value={code} onChange={(e) => void onSelectDoc(e.target.value)} disabled={busy}>
            {(catalog?.documents || []).map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="tpl-toolbar-actions">
          {!isBarcode && format !== 'A4' && (
            <button type="button" className="btn" onClick={copyFromA4} disabled={!layout}>
              Copy A4 onto this format
            </button>
          )}
          <button type="button" className="btn" onClick={() => void reset()} disabled={busy}>
            Reset default
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !layout}>
            Save template
          </button>
        </div>
      </div>

      {!isBarcode && layout && spec && pagePad && (
        <div className="settings-box tpl-page-setup">
          <div className="settings-box-title">Page setup</div>
          <p className="hint" style={{ margin: 0 }}>
            Paper size and orientation for this template. Fields fill the page minus these margins. Drawing and
            preview stay below.
          </p>
          <div className="tpl-page-setup-grid">
            <label className="settings-field">
              <span>Paper</span>
              <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
                {paperOptions.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-field">
              <span>Orientation</span>
              <div className="tpl-orient-toggle">
                <button
                  type="button"
                  className={`btn${orientation === 'portrait' ? ' btn-primary' : ''}`}
                  disabled={thermalPaper}
                  onClick={() => applyPageSetup(setPageOrientation(layout, format, 'portrait'))}
                >
                  Portrait
                </button>
                <button
                  type="button"
                  className={`btn${orientation === 'landscape' ? ' btn-primary' : ''}`}
                  disabled={thermalPaper}
                  onClick={() => applyPageSetup(setPageOrientation(layout, format, 'landscape'))}
                >
                  Landscape
                </button>
              </div>
              {thermalPaper ? (
                <span className="hint">Thermal rolls print in one direction</span>
              ) : (
                <span className="hint">
                  Width {spec.paperMm} mm × Height {spec.paperHeightMm} mm
                </span>
              )}
            </div>
            <label className="settings-field">
              <span>Margin left (mm)</span>
              <input
                className="input"
                type="number"
                min={0}
                max={40}
                step={0.5}
                value={pagePad.paddingLeftMm}
                onChange={(e) => applyPageSetup(setPagePadding(layout, format, { paddingLeftMm: Number(e.target.value) }))}
              />
            </label>
            <label className="settings-field">
              <span>Margin right (mm)</span>
              <input
                className="input"
                type="number"
                min={0}
                max={40}
                step={0.5}
                value={pagePad.paddingRightMm}
                onChange={(e) =>
                  applyPageSetup(setPagePadding(layout, format, { paddingRightMm: Number(e.target.value) }))
                }
              />
            </label>
            <label className="settings-field">
              <span>Margin top (mm)</span>
              <input
                className="input"
                type="number"
                min={0}
                max={40}
                step={0.5}
                value={pagePad.paddingTopMm}
                onChange={(e) => applyPageSetup(setPagePadding(layout, format, { paddingTopMm: Number(e.target.value) }))}
              />
            </label>
            <label className="settings-field">
              <span>Margin bottom (mm)</span>
              <input
                className="input"
                type="number"
                min={0}
                max={40}
                step={0.5}
                value={pagePad.paddingBottomMm}
                onChange={(e) =>
                  applyPageSetup(setPagePadding(layout, format, { paddingBottomMm: Number(e.target.value) }))
                }
              />
            </label>
            <label className="bcd-check tpl-page-border-check">
              <input
                type="checkbox"
                checked={!!(layout.page_borders || {})[format]}
                onChange={(e) => setLayout(setPageBorder(layout, format, e.target.checked))}
              />
              Page border
            </label>
            {isCustomFormat(format) && (
              <button type="button" className="btn" onClick={deleteCurrentCustom}>
                Delete this custom size
              </button>
            )}
          </div>
        </div>
      )}

      {!isBarcode && layout && spec && pagePad && (
        <div className="settings-box tpl-page-setup">
          <div className="settings-box-title">Custom templates</div>
          <p className="hint" style={{ margin: 0 }}>
            Uses the document selected above (for example Sale Bill). Give it a name and a paper size in
            millimetres. Staff can pick it as a bill format after you save.
          </p>
          <div className="tpl-page-setup-grid">
            <label className="settings-field">
              <span>Custom name</span>
              <input
                className="input"
                value={customName}
                placeholder="Half page"
                onChange={(e) => setCustomName(e.target.value)}
              />
            </label>
            <label className="settings-field">
              <span>Width (mm)</span>
              <input
                className="input"
                type="number"
                min={40}
                max={400}
                step={1}
                value={customWidth}
                onChange={(e) => setCustomWidth(Number(e.target.value) || 0)}
              />
            </label>
            <label className="settings-field">
              <span>Height (mm)</span>
              <input
                className="input"
                type="number"
                min={40}
                max={600}
                step={1}
                value={customHeight}
                onChange={(e) => setCustomHeight(Number(e.target.value) || 0)}
              />
            </label>
            <div className="settings-field">
              <span>&nbsp;</span>
              <button type="button" className="btn btn-primary" onClick={createCustomTemplate} disabled={!layout}>
                Add custom template
              </button>
            </div>
          </div>
        </div>
      )}

      {isBarcode && barcodeSettings && (
        <div className="settings-box">
          <div className="settings-box-title">Barcode label fields</div>
          <p className="hint" style={{ margin: '0 0 8px' }}>
            Same as Barcode Generation settings: drag to reorder, hide, or change the data source. Staff cannot
            change this.
          </p>
          <label className="settings-field" style={{ maxWidth: 360 }}>
            <span>Default sticker size</span>
            <select
              className="input"
              value={barcodeSettings.default_layout}
              onChange={(e) =>
                updateBarcode({ ...barcodeSettings, default_layout: e.target.value as BarcodeLayoutId })
              }
            >
              {(Object.keys(BARCODE_LAYOUTS) as BarcodeLayoutId[]).map((id) => (
                <option key={id} value={id}>
                  {BARCODE_LAYOUTS[id].title}
                </option>
              ))}
            </select>
          </label>
          <BarcodeSheetSettings settings={barcodeSettings} onChange={(next) => updateBarcode(next)} />
          <BarcodeGapSettings
            settings={barcodeSettings}
            onChange={(next) => updateBarcode(next)}
          />
          <BarcodeCanvasEditor
            settings={barcodeSettings}
            layoutId={barcodeSettings.default_layout}
            company={companyProfile}
            onChange={(next) => updateBarcode(next)}
          />
          <table className="data-table mapping-table">
            <thead>
              <tr>
                <th className="col-drag" />
                <th>Show</th>
                <th>Line label</th>
                <th>Data source</th>
                <th>Bold</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {barcodeSettings.fields.map((f, index) => (
                <tr key={f.id}>
                  <td className="col-drag">
                    <button
                      type="button"
                      className="btn"
                      disabled={index === 0}
                      onClick={() => {
                        const fields = [...barcodeSettings.fields]
                        const [item] = fields.splice(index, 1)
                        fields.splice(index - 1, 0, item)
                        updateBarcode({ ...barcodeSettings, fields })
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={index === barcodeSettings.fields.length - 1}
                      onClick={() => {
                        const fields = [...barcodeSettings.fields]
                        const [item] = fields.splice(index, 1)
                        fields.splice(index + 1, 0, item)
                        updateBarcode({ ...barcodeSettings, fields })
                      }}
                    >
                      ↓
                    </button>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={f.enabled}
                      onChange={(e) =>
                        updateBarcode({
                          ...barcodeSettings,
                          fields: barcodeSettings.fields.map((x) =>
                            x.id === f.id ? { ...x, enabled: e.target.checked } : x,
                          ),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      value={f.label}
                      onChange={(e) =>
                        updateBarcode({
                          ...barcodeSettings,
                          fields: barcodeSettings.fields.map((x) =>
                            x.id === f.id ? { ...x, label: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </td>
                  <td>
                    <BarcodeFieldSourceSelect
                      value={f.source}
                      onChange={(source) =>
                        updateBarcode({
                          ...barcodeSettings,
                          fields: barcodeSettings.fields.map((x) =>
                            x.id === f.id ? { ...x, source } : x,
                          ),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!f.bold}
                      onChange={(e) =>
                        updateBarcode({
                          ...barcodeSettings,
                          fields: barcodeSettings.fields.map((x) =>
                            x.id === f.id ? { ...x, bold: e.target.checked } : x,
                          ),
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        updateBarcode({
                          ...barcodeSettings,
                          fields: barcodeSettings.fields.filter((x) => x.id !== f.id),
                        })
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="btn"
            onClick={() =>
              updateBarcode({
                ...barcodeSettings,
                fields: [
                  ...barcodeSettings.fields,
                  {
                    id: `f_${Date.now().toString(36)}`,
                    label: 'Label',
                    source: 'custom',
                    enabled: true,
                  },
                ],
              })
            }
          >
            + Add field
          </button>
        </div>
      )}

      {!isBarcode && band && layout && (
        <div className="tpl-design-split">
          <div className="tpl-design">
          <div className="settings-box">
            <BillCanvasEditor
              key={`${code}-${format}`}
              layout={layout}
              format={format}
              logoUrl={companyProfile?.logo_url}
              onChange={setLayout}
            />
          </div>
          <div className="tpl-fields">
              <details className="tpl-field-details">
                <summary>Field list — show / hide, labels, order</summary>
            {BAND_ORDER.filter((b) => b !== 'totals' || (band.totals && band.totals.length > 0)).map((bandId) => {
              const visible = band[bandId].filter((f) => f.visible)
              const hidden = band[bandId].filter((f) => !f.visible)
              return (
                <div key={bandId} className="settings-box tpl-band">
                  <div className="settings-box-title">{BAND_LABELS[bandId]}</div>
                  {visible.length === 0 && <p className="hint">Nothing prints in this section.</p>}
                  {visible.map((field) => (
                    <FieldRow
                      key={field.id}
                      field={field}
                      band={bandId}
                      dragId={dragBand === bandId ? dragId : null}
                      dropId={dragBand === bandId ? dropId : null}
                      onDragStart={(e, id) => onDragStart(e, id, bandId)}
                      onDragOver={onDragOver}
                      onDrop={(e, id) => onDrop(e, id, bandId)}
                      onDragEnd={onDragEnd}
                      onPatch={(id, patch) => patchField(bandId, id, patch)}
                      onRemove={(id) => removeField(bandId, id)}
                    />
                  ))}
                  <div className="tpl-band-actions">
                    {(bandId === 'header' || bandId === 'footer' || bandId === 'meta') && (
                      <button type="button" className="btn" onClick={() => addStatic(bandId)}>
                        + Text line
                      </button>
                    )}
                  </div>
                  {hidden.length > 0 && (
                    <div className="tpl-hidden">
                      <span>Removed — click to put back:</span>
                      {hidden.map((f) => (
                        <button key={f.id} type="button" className="btn" onClick={() => restoreField(bandId, f.id)}>
                          + {f.label || f.id}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
              </details>
            </div>
          </div>
        </div>
      )}
      {!isBarcode && layout && spec && (
        <TplPreviewPanel title="Live preview (sample data)">
          <BillPreviewFrame
            html={previewHtml}
            widthMm={spec.paperMm}
            heightMm={spec.paperHeightMm || spec.paperMm * 1.414}
          />
        </TplPreviewPanel>
      )}
    </div>
  )
}
