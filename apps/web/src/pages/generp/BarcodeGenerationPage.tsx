import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { PrintPreview } from '../../components/generp/PrintPreview'
import { Typeahead } from '../../components/generp/Typeahead'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { LIST_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { BarcodeCanvasEditor, BarcodeLabelPreview } from '../../components/generp/BarcodeCanvasEditor'
import { BarcodeFieldSourceSelect } from '../../components/generp/BarcodeFieldSourceSelect'
import { BarcodeGapSettings } from '../../components/generp/BarcodeGapSettings'
import { BarcodeSheetSettings } from '../../components/generp/BarcodeSheetSettings'
import {
  BARCODE_LAYOUTS,
  DEFAULT_BARCODE_LABEL_SETTINGS,
  mmWithCm,
  openBarcodePrint,
  parseBarcodeLabelSettings,
  buildPrintHtml,
  buildPrintHtmlMany,
  canvasFor,
  resolveLayout,
  sizeMmCm,
  type BarcodeFieldMapping,
  type BarcodeLayoutId,
  type BarcodeLabelSettings,
  type LabelPrintInput,
} from '../../lib/generp/barcodeLabels'
import {
  emptyLayoutPrinters,
  loadInstalledPrinters,
  loadLayoutPrinters,
  saveLayoutPrinter,
  type LayoutPrinters,
  type PrinterInfo,
} from '../../lib/generp/barcodePrinters'
import { useAuth } from '../../auth/AuthContext'
import { canEditPrintTemplates } from '../../auth/roles'
import { encodeOwnBarcode, ownBarcodeMrp } from '../../lib/generp/ownBarcode'
import { readBarcodeBatch } from '../../lib/generp/barcodeBatch'
import type { CompanyProfile, Product, ProductBarcode } from '../../generpTypes'

type PrintConfig = {
  id: string
  code: string
  layout_options?: unknown
}

type EditRow = {
  id?: string
  barcode: string
  sale_rate: string
  ws_rate: string
  mrp: string
}

const EMPTY_DRAFT: EditRow = { barcode: '', sale_rate: '', ws_rate: '', mrp: '' }

type WorkTab = 'single' | 'batch'

type BatchRow = {
  product: Product
  copies: number
  barcodeValue: string
}

function resolvePrintBarcode(product: Product, rows: ProductBarcode[]): string {
  if (product.own_barcode) {
    const mrp = ownBarcodeMrp(product.mrp)
    if (mrp > 0) return encodeOwnBarcode(product.code || product.barcode || '', mrp)
    const own = rows.find((r) => r.kind === 'own')
    if (own?.barcode) return String(own.barcode)
  }
  const company = rows.find((r) => r.kind !== 'own' && r.barcode)
  if (company?.barcode) return String(company.barcode)
  return String(product.barcode || '')
}

function newFieldId() {
  return `f_${Date.now().toString(36)}`
}

function reorderFields(fields: BarcodeFieldMapping[], fromId: string, toId: string) {
  const from = fields.findIndex((f) => f.id === fromId)
  const to = fields.findIndex((f) => f.id === toId)
  if (from < 0 || to < 0 || from === to) return fields
  const next = [...fields]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function LayoutGuide({
  active,
  onPick,
  printers,
  layoutPrinters,
  onPrinterChange,
}: {
  active: BarcodeLayoutId
  onPick: (id: BarcodeLayoutId) => void
  printers?: PrinterInfo[]
  layoutPrinters?: LayoutPrinters
  onPrinterChange?: (id: BarcodeLayoutId, printer: string) => void
}) {
  const items: { id: BarcodeLayoutId; sketch: string; note: string }[] = [
    {
      id: 'DOUBLE',
      sketch: '▢ ▢',
      note: `${sizeMmCm(BARCODE_LAYOUTS.DOUBLE.widthMm, BARCODE_LAYOUTS.DOUBLE.heightMm)} each`,
    },
    {
      id: 'SINGLE',
      sketch: '▢',
      note: sizeMmCm(BARCODE_LAYOUTS.SINGLE.widthMm, BARCODE_LAYOUTS.SINGLE.heightMm),
    },
    {
      id: 'MINI',
      sketch: '▬',
      note: `${sizeMmCm(BARCODE_LAYOUTS.MINI.widthMm, BARCODE_LAYOUTS.MINI.heightMm)} · barcode only`,
    },
    {
      id: 'CUSTOM',
      sketch: '▢ ▢ ▢',
      note: 'Your width, columns, gaps',
    },
  ]
  const showPrinters = Boolean(printers && layoutPrinters && onPrinterChange)
  return (
    <div className={`layout-guide${showPrinters ? ' layout-guide--print' : ''}`}>
      {items.map((it) => {
        const saved = layoutPrinters?.[it.id] || ''
        const known = (printers || []).some((p) => p.name === saved)
        return (
          <div
            key={it.id}
            className={`layout-card${active === it.id ? ' active' : ''}${showPrinters ? ' layout-card--printer' : ''}`}
          >
            <button type="button" className="layout-card-pick" onClick={() => onPick(it.id)}>
              <div className="layout-sketch">{it.sketch}</div>
              <div className="layout-card-title">{BARCODE_LAYOUTS[it.id].title}</div>
              <div className="layout-card-note">{it.note}</div>
            </button>
            {showPrinters && (
              <label className="layout-card-printer">
                <span>Printer (this PC)</span>
                <select
                  className="input"
                  value={saved}
                  onChange={(e) => {
                    onPick(it.id)
                    onPrinterChange?.(it.id, e.target.value)
                  }}
                >
                  <option value="">Windows default</option>
                  {saved && !known && <option value={saved}>{saved} (saved)</option>}
                  {(printers || []).map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                      {p.is_default ? ' (Windows default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function BarcodeGenerationPage() {
  const { user, menus } = useAuth()
  const [searchParams] = useSearchParams()
  const canEditLayout = canEditPrintTemplates(user, menus)
  const [workTab, setWorkTab] = useState<WorkTab>('single')
  const [batchRows, setBatchRows] = useState<BatchRow[]>([])
  const [query, setQuery] = useState('')
  const [product, setProduct] = useState<Product | null>(null)
  const [companyRows, setCompanyRows] = useState<ProductBarcode[]>([])
  const [draft, setDraft] = useState<EditRow>(EMPTY_DRAFT)
  const [ownDraft, setOwnDraft] = useState({ mrp: '', sale_rate: '', ws_rate: '' })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const [labelConfigId, setLabelConfigId] = useState<string | null>(null)
  const [settings, setSettings] = useState<BarcodeLabelSettings>(DEFAULT_BARCODE_LABEL_SETTINGS)
  const [layoutId, setLayoutId] = useState<BarcodeLayoutId>('SINGLE')
  const [copies, setCopies] = useState(1)
  const [printBarcode, setPrintBarcode] = useState<'ours' | string>('ours')
  const [extras, setExtras] = useState<Record<string, string>>({ expiry: '' })
  const [dragFieldId, setDragFieldId] = useState<string | null>(null)
  const [dropFieldId, setDropFieldId] = useState<string | null>(null)
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [layoutPrinters, setLayoutPrinters] = useState<LayoutPrinters>(emptyLayoutPrinters)
  const [printOk, setPrintOk] = useState('')
  const [printError, setPrintError] = useState('')
  const [sheetPreview, setSheetPreview] = useState<{ title: string; html: string } | null>(null)
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null)

  const layout = resolveLayout(settings, layoutId)
  const canvas = canvasFor(settings, layoutId)

  const searchProducts = useCallback(async (q: string) => {
    const text = q.trim()
    if (!text) return []
    return api.get<Product[]>('/products', { q: text, limit: 20 })
  }, [])

  const productLabel = useCallback(
    (p: Product) => `${p.code || ''} — ${p.name || ''}${p.barcode ? ` [${p.barcode}]` : ''}`,
    [],
  )

  const loadBarcodes = useCallback(async (productId: string) => {
    const rows = await api.get<ProductBarcode[]>(`/products/${productId}/barcodes`)
    setCompanyRows(rows)
  }, [])

  const loadBatch = useCallback(async () => {
    const seed = readBarcodeBatch()
    if (!seed?.items.length) {
      setBatchRows([])
      return
    }
    setBusy(true)
    setError('')
    try {
      const rows: BatchRow[] = []
      for (const item of seed.items) {
        const p = await api.get<Product>(`/products/${item.product_id}`)
        const barcodes = await api.get<ProductBarcode[]>(`/products/${p.id}/barcodes`)
        rows.push({
          product: p,
          copies: Math.max(1, Math.min(500, Number(item.qty || 1))),
          barcodeValue: resolvePrintBarcode(p, barcodes),
        })
      }
      setBatchRows(rows)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load batch barcodes')
      setBatchRows([])
    } finally {
      setBusy(false)
    }
  }, [])

  const loadLabelSettings = useCallback(async () => {
    try {
      const cfg = await api.get<PrintConfig>('/print-configs/by-code/BARCODE_LABEL')
      setLabelConfigId(cfg.id)
      const parsed = parseBarcodeLabelSettings(cfg.layout_options)
      setSettings(parsed)
      setLayoutId(parsed.default_layout)
    } catch {
      setSettings({ ...DEFAULT_BARCODE_LABEL_SETTINGS, fields: [...DEFAULT_BARCODE_LABEL_SETTINGS.fields] })
    }
  }, [])

  useEffect(() => {
    void loadLabelSettings()
  }, [loadLabelSettings])

  useEffect(() => {
    if (searchParams.get('tab') === 'batch') {
      setWorkTab('batch')
      void loadBatch()
    }
  }, [searchParams, loadBatch])

  useEffect(() => {
    void api
      .get<CompanyProfile>('/company-profile')
      .then(setCompanyProfile)
      .catch(() => setCompanyProfile(null))
  }, [])

  useEffect(() => {
    void (async () => {
      const [list, saved] = await Promise.all([loadInstalledPrinters(), loadLayoutPrinters()])
      setPrinters(list)
      setLayoutPrinters(saved)
    })()
  }, [])

  const persistLayoutPrinter = async (id: BarcodeLayoutId, printer: string) => {
    setLayoutPrinters((prev) => ({ ...prev, [id]: printer }))
    try {
      await saveLayoutPrinter(id, printer)
    } catch {
      /* kept in this browser even if the PC file cannot be written */
    }
  }

  const selectProduct = async (p: Product) => {
    setError('')
    setPrintBarcode('ours')
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    try {
      const fresh = await api.get<Product>(`/products/${p.id}`)
      setProduct(fresh)
      setQuery(productLabel(fresh))
      setOwnDraft({
        mrp: ownBarcodeMrp(fresh.mrp) ? String(ownBarcodeMrp(fresh.mrp)) : '',
        sale_rate: '',
        ws_rate: '',
      })
      const rows = await api.get<ProductBarcode[]>(`/products/${fresh.id}/barcodes`)
      setCompanyRows(rows)
      const expected =
        fresh.own_barcode && ownBarcodeMrp(fresh.mrp)
          ? encodeOwnBarcode(fresh.code || fresh.barcode || '', ownBarcodeMrp(fresh.mrp))
          : ''
      const match = expected ? rows.find((r) => r.barcode === expected) : undefined
      const firstOwn = rows.find((r) => r.kind === 'own')
      if (fresh.own_barcode && (match || firstOwn)) {
        setPrintBarcode((match || firstOwn)!.id)
      }
    } catch (err) {
      setProduct(p)
      setQuery(productLabel(p))
      setError(err instanceof ApiError ? err.message : 'Failed to load barcodes')
    }
  }

  const activeBarcodeValue = useMemo(() => {
    if (!product) return ''
    if (printBarcode !== 'ours') {
      const row = companyRows.find((r) => r.id === printBarcode)
      if (row?.barcode) return String(row.barcode)
    }
    if (product.own_barcode) {
      const mrp = ownBarcodeMrp(ownDraft.mrp, product.mrp)
      return mrp > 0 ? encodeOwnBarcode(product.code || product.barcode || '', mrp) : ''
    }
    return String(product.barcode || '')
  }, [product, printBarcode, companyRows, ownDraft.mrp])

  const ownRows = useMemo(
    () => companyRows.filter((r) => r.kind === 'own'),
    [companyRows],
  )
  const makerRows = useMemo(
    () => companyRows.filter((r) => r.kind !== 'own'),
    [companyRows],
  )
  const generatedOwn = useMemo(() => {
    if (!product) return ''
    const mrp = ownBarcodeMrp(ownDraft.mrp, product.mrp)
    if (!mrp) return ''
    return encodeOwnBarcode(product.code || product.barcode || '', mrp)
  }, [product, ownDraft.mrp])

  const labelProduct = useMemo(() => {
    if (!product) return null
    const row = printBarcode === 'ours' ? undefined : companyRows.find((r) => r.id === printBarcode)
    const mrp = ownBarcodeMrp(row?.mrp, ownDraft.mrp, product.mrp)
    return {
      ...product,
      barcode: activeBarcodeValue || product.barcode,
      mrp: mrp || product.mrp,
      sale_price: row?.sale_rate ?? product.sale_price,
      wholesale_price: row?.ws_rate ?? product.wholesale_price,
    }
  }, [product, printBarcode, companyRows, ownDraft.mrp, activeBarcodeValue])

  const visibleExtraFields = useMemo(
    () => settings.fields.filter((f) => f.enabled && (f.source === 'expiry' || f.source === 'custom')),
    [settings.fields],
  )

  const saveMapping = async () => {
    if (!labelConfigId) {
      alert('Barcode label settings not loaded. Restart backend once to seed BARCODE_LABEL.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.patch(`/print-configs/${labelConfigId}`, {
        layout_options: { ...settings, default_layout: layoutId },
      })
      alert('Label settings saved.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const addField = () => {
    const id = newFieldId()
    setSettings((s) => ({
      ...s,
      fields: [...s.fields, { id, label: 'Label', source: 'custom', enabled: true }],
    }))
    setExtras((e) => ({ ...e, [id]: '' }))
  }

  const updateField = (id: string, patch: Partial<BarcodeFieldMapping>) => {
    setSettings((s) => ({
      ...s,
      fields: s.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }))
  }

  const removeField = (id: string) => {
    setSettings((s) => ({ ...s, fields: s.fields.filter((f) => f.id !== id) }))
  }

  const onFieldDragStart = (e: DragEvent<HTMLTableRowElement>, id: string) => {
    setDragFieldId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const onFieldDragOver = (e: DragEvent<HTMLTableRowElement>, id: string) => {
    e.preventDefault()
    if (dragFieldId && dragFieldId !== id) setDropFieldId(id)
  }

  const onFieldDrop = (e: DragEvent<HTMLTableRowElement>, id: string) => {
    e.preventDefault()
    const from = dragFieldId || e.dataTransfer.getData('text/plain')
    if (from && from !== id) {
      setSettings((s) => ({ ...s, fields: reorderFields(s.fields, from, id) }))
    }
    setDragFieldId(null)
    setDropFieldId(null)
  }

  const onFieldDragEnd = () => {
    setDragFieldId(null)
    setDropFieldId(null)
  }

  const saveCompany = async () => {
    if (!product) {
      alert('Select a product first.')
      return
    }
    const barcode = draft.barcode.trim()
    if (!barcode) {
      alert('Enter company barcode.')
      return
    }
    const sale = draft.sale_rate.trim() === '' ? null : Number(draft.sale_rate)
    const ws = draft.ws_rate.trim() === '' ? null : Number(draft.ws_rate)
    const mrp = draft.mrp.trim() === '' ? null : Number(draft.mrp)
    setBusy(true)
    setError('')
    try {
      if (editingId) {
        await api.patch(`/products/barcodes/${editingId}`, {
          barcode,
          sale_rate: sale,
          ws_rate: ws,
          mrp,
        })
      } else {
        await api.post(`/products/${product.id}/barcodes`, {
          barcode,
          sale_rate: sale,
          ws_rate: ws,
          mrp,
        })
      }
      setDraft(EMPTY_DRAFT)
      setEditingId(null)
      await loadBarcodes(product.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const saveOwn = async () => {
    if (!product) {
      alert('Select a product first.')
      return
    }
    const mrp = ownBarcodeMrp(ownDraft.mrp)
    if (!mrp) {
      alert('Enter MRP to generate the barcode (product code + MRP).')
      return
    }
    const sale = ownDraft.sale_rate.trim() === '' ? null : Number(ownDraft.sale_rate)
    const ws = ownDraft.ws_rate.trim() === '' ? null : Number(ownDraft.ws_rate)
    setBusy(true)
    setError('')
    try {
      const created = await api.post<ProductBarcode>(`/products/${product.id}/own-barcodes`, {
        mrp,
        sale_rate: sale,
        ws_rate: ws,
      })
      await loadBarcodes(product.id)
      setPrintBarcode(created.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const editRow = (row: ProductBarcode) => {
    setEditingId(row.id)
    setDraft({
      barcode: row.barcode,
      sale_rate: row.sale_rate == null ? '' : String(row.sale_rate),
      ws_rate: row.ws_rate == null ? '' : String(row.ws_rate),
      mrp: row.mrp == null ? '' : String(row.mrp),
    })
  }

  const removeRow = async (row: ProductBarcode) => {
    if (!confirm(`Remove barcode ${row.barcode}?`)) return
    setBusy(true)
    try {
      await api.delete(`/products/barcodes/${row.id}`)
      if (editingId === row.id) {
        setEditingId(null)
        setDraft(EMPTY_DRAFT)
      }
      if (product) await loadBarcodes(product.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const preparePrintPayload = async (): Promise<LabelPrintInput | null> => {
    if (!product || !labelProduct) return null
    let value = activeBarcodeValue
    if (product.own_barcode) {
      const mrp = ownBarcodeMrp(ownDraft.mrp, product.mrp)
      if (!mrp) {
        alert('Set MRP on the product (or here) to print own barcode: 6-digit code + 6-digit MRP.')
        return null
      }
      value = encodeOwnBarcode(product.code || product.barcode || '', mrp)
      if (!companyRows.some((r) => r.barcode === value)) {
        try {
          const created = await api.post<ProductBarcode>(`/products/${product.id}/own-barcodes`, { mrp })
          await loadBarcodes(product.id)
          setPrintBarcode(created.id)
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Could not create own barcode')
          return null
        }
      }
    }
    if (!value) return null
    return {
      product: { ...labelProduct, barcode: value },
      barcodeValue: value,
      layout,
      settings,
      copies: Math.max(1, Math.min(500, copies)),
      extras,
      company: companyProfile,
    }
  }

  const openSheetPreview = async () => {
    const payload = await preparePrintPayload()
    if (!payload) return
    const count = payload.copies
    setSheetPreview({
      title: `Barcode ${layoutId} · ${count} label${count === 1 ? '' : 's'} Preview`,
      html: buildPrintHtml(payload, { autoPrint: false }),
    })
  }

  const printLabels = async () => {
    const payload = await preparePrintPayload()
    if (!payload) return
    const printer = (layoutPrinters[layoutId] || '').trim()
    setPrintOk('')
    setPrintError('')
    setBusy(true)
    try {
      if (printers.length > 0 || printer) {
        const result = await api.post<{ ok?: boolean; message?: string; pdf_path?: string; printer?: string }>(
          '/print-configs/print',
          {
            html: buildPrintHtml(payload, { autoPrint: false }),
            printer_name: printer || null,
            copies: 1,
          },
        )
        setPrintOk(
          result.message ||
            (result.pdf_path
              ? `Saved PDF to ${result.pdf_path}`
              : `Sent ${payload.copies} label${payload.copies === 1 ? '' : 's'} to ${result.printer || printer || 'Windows default printer'}`),
        )
      } else {
        openBarcodePrint(payload)
      }
    } catch (err) {
      setPrintError(err instanceof ApiError ? err.message : 'Print failed — opening browser print')
      openBarcodePrint(payload)
    } finally {
      setBusy(false)
    }
  }

  const barcodePager = useClientPager(makerRows, product?.id || makerRows.length, LIST_PAGE_SIZE)
  const ownPager = useClientPager(ownRows, product?.id || ownRows.length, LIST_PAGE_SIZE)

  const exportBarcodes = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel(product ? `barcodes-${product.code || product.name}` : 'barcodes', {
      name: 'Barcodes',
      headers: ['Kind', 'Barcode', 'MRP', 'Sale', 'WS'],
      rows: companyRows.map((row) => [
        row.kind || 'company',
        row.barcode,
        row.mrp ?? '',
        row.sale_rate ?? '',
        row.ws_rate ?? '',
      ]),
    }, format)
  }

  const batchPayloads = (): LabelPrintInput[] =>
    batchRows
      .filter((r) => r.barcodeValue)
      .map((r) => ({
        product: r.product,
        barcodeValue: r.barcodeValue,
        layout,
        settings,
        copies: r.copies,
        extras,
        company: companyProfile,
      }))

  const previewBatch = () => {
    const payloads = batchPayloads()
    if (!payloads.length) {
      alert('No barcodes ready to preview.')
      return
    }
    const count = payloads.reduce((s, p) => s + p.copies, 0)
    setSheetPreview({
      title: `Batch barcodes · ${count} label${count === 1 ? '' : 's'} Preview`,
      html: buildPrintHtmlMany(payloads, { autoPrint: false }),
    })
  }

  const printBatch = async () => {
    const payloads = batchPayloads()
    if (!payloads.length) {
      alert('No barcodes ready to print.')
      return
    }
    const printer = (layoutPrinters[layoutId] || '').trim()
    const count = payloads.reduce((s, p) => s + p.copies, 0)
    setPrintOk('')
    setPrintError('')
    setBusy(true)
    try {
      if (printers.length > 0 || printer) {
        const result = await api.post<{ ok?: boolean; message?: string; pdf_path?: string; printer?: string }>(
          '/print-configs/print',
          {
            html: buildPrintHtmlMany(payloads, { autoPrint: false }),
            printer_name: printer || null,
            copies: 1,
          },
        )
        setPrintOk(
          result.message ||
            `Sent ${count} label${count === 1 ? '' : 's'} to ${result.printer || printer || 'Windows default printer'}`,
        )
      } else {
        const html = buildPrintHtmlMany(payloads)
        const w = window.open('', '_blank', 'width=640,height=480')
        if (!w) {
          alert('Allow pop-ups to print labels.')
          return
        }
        w.document.write(html)
        w.document.close()
      }
    } catch (err) {
      setPrintError(err instanceof ApiError ? err.message : 'Print failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="master-page barcode-page">
      <div className="barcode-page-header">
        <div>
          <h2>Barcode Generation</h2>
          <p className="hint" style={{ margin: 0 }}>
            Search product → preview → print. Label fields are set by Super Admin in{' '}
            <strong>Print Template Designer</strong>
            {canEditLayout ? ' (or Settings below)' : ''}.
          </p>
        </div>
        {canEditLayout && (
        <button
          type="button"
          className={`btn${showSettings ? ' btn-primary' : ''}`}
          onClick={() => setShowSettings((v) => !v)}
        >
          {showSettings ? 'Close settings' : '⚙ Settings'}
        </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="pc-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={`pc-tab${workTab === 'single' ? ' active' : ''}`}
          onClick={() => setWorkTab('single')}
        >
          Single product
        </button>
        <button
          type="button"
          role="tab"
          className={`pc-tab${workTab === 'batch' ? ' active' : ''}`}
          onClick={() => {
            setWorkTab('batch')
            void loadBatch()
          }}
        >
          Batch from purchase
        </button>
      </div>

      {workTab === 'batch' ? (
        <div className="settings-box">
          <div className="settings-box-title">Batch barcodes</div>
          <p className="hint" style={{ margin: '0 0 8px' }}>
            Items sent from Purchase Bill. Preview is ready for every selected product. Copies
            default to the purchased quantity.
          </p>
          {batchRows.length === 0 ? (
            <p className="hint">No batch items. Save a purchase bill and click Generate barcode.</p>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Product</th>
                    <th>Barcode</th>
                    <th>Labels</th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.map((row, i) => (
                    <tr key={`${row.product.id}-${i}`}>
                      <td>{row.product.code}</td>
                      <td>{row.product.name}</td>
                      <td>{row.barcodeValue || '—'}</td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={500}
                          value={row.copies}
                          onChange={(e) => {
                            const n = Math.max(1, Math.min(500, Number(e.target.value) || 1))
                            setBatchRows((prev) =>
                              prev.map((r, idx) => (idx === i ? { ...r, copies: n } : r)),
                            )
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="barcode-preview-actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn" disabled={busy} onClick={previewBatch}>
                  Preview all
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void printBatch()}
                >
                  {busy ? 'Printing…' : 'Print all'}
                </button>
              </div>
              {printError ? <p className="error barcode-print-status">{printError}</p> : null}
              {printOk ? <p className="barcode-print-ok">{printOk}</p> : null}
            </>
          )}
        </div>
      ) : null}

      {canEditLayout && showSettings && (
        <div className="settings-box barcode-settings-panel">
          <div className="settings-box-title">Label setup</div>
          <p className="hint" style={{ margin: '0 0 10px' }}>
            Pick a sticker size, then drag name, MRP, barcode and border on the designer like Word.
            Set font and size for each variable. Data source includes product fields and company
            profile (name, mobile, address, GSTIN, …). Save, then print a test with Border on.
          </p>

          <div className="settings-box-title" style={{ fontSize: 12, marginTop: 4 }}>
            Default print layout
          </div>
          <LayoutGuide active={layoutId} onPick={setLayoutId} />
          {layoutId === 'CUSTOM' && (
          <BarcodeSheetSettings
            settings={settings}
            onChange={(next) => {
              setSettings(next)
              setLayoutId('CUSTOM')
            }}
          />
          )}
          <BarcodeCanvasEditor
            settings={settings}
            layoutId={layoutId}
            product={product}
            extras={extras}
            barcodeValue={activeBarcodeValue}
            company={companyProfile}
            onChange={setSettings}
          />
          <BarcodeGapSettings settings={settings} onChange={setSettings} />

          <table className="data-table mapping-table">
            <thead>
              <tr>
                <th className="col-drag" aria-label="Reorder" />
                <th>Show</th>
                <th>Line label</th>
                <th>Data source</th>
                <th>Bold</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {settings.fields.map((f) => (
                <tr
                  key={f.id}
                  draggable
                  onDragStart={(e) => onFieldDragStart(e, f.id)}
                  onDragOver={(e) => onFieldDragOver(e, f.id)}
                  onDrop={(e) => onFieldDrop(e, f.id)}
                  onDragEnd={onFieldDragEnd}
                  className={`mapping-row${dropFieldId === f.id ? ' drag-over' : ''}${dragFieldId === f.id ? ' dragging' : ''}`}
                >
                  <td className="col-drag" title="Drag to reorder">
                    <span className="drag-handle" aria-hidden>
                      ⋮⋮
                    </span>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={f.enabled}
                      onChange={(e) => updateField(f.id, { enabled: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      value={f.label}
                      placeholder={
                        f.source === 'name' || f.source === 'company_name' ? '(heading)' : 'e.g. MRP'
                      }
                      onChange={(e) => updateField(f.id, { label: e.target.value })}
                    />
                  </td>
                  <td>
                    <BarcodeFieldSourceSelect
                      value={f.source}
                      onChange={(source) => updateField(f.id, { source })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!f.bold}
                      onChange={(e) => updateField(f.id, { bold: e.target.checked })}
                    />
                  </td>
                  <td>
                    <button type="button" className="btn" onClick={() => removeField(f.id)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sb-row" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={addField}>
              + Add field
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveMapping()}>
              Save settings
            </button>
          </div>
        </div>
      )}

      {workTab === 'single' ? (
      <>
      <div className="settings-box">
        <label className="settings-field">
          <span>Product</span>
          <Typeahead
            value={query}
            onChange={setQuery}
            searchItems={searchProducts}
            getLabel={productLabel}
            getKey={(p) => p.id}
            placeholder="Search code, name or barcode…"
            onSelect={(p) => void selectProduct(p)}
            onEnter={() => {
              void (async () => {
                const q = query.trim()
                if (!q) return
                try {
                  const p = await api.get<Product>('/products/lookup', { q })
                  await selectProduct(p)
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Product not found')
                }
              })()
            }}
          />
        </label>
      </div>

      {product && (
        <>
          <div className="barcode-work">
          <div className="settings-box">
            <div className="settings-box-title">Print</div>
            <p className="hint" style={{ margin: '0 0 8px' }}>
              Pick a sticker size and its printer. The printer is remembered on this PC for that size.
            </p>
            <LayoutGuide
              active={layoutId}
              onPick={setLayoutId}
              printers={printers}
              layoutPrinters={layoutPrinters}
              onPrinterChange={(id, name) => void persistLayoutPrinter(id, name)}
            />
            {layoutId === 'CUSTOM' && canEditLayout && (
              <BarcodeSheetSettings
                settings={settings}
                onChange={(next) => {
                  setSettings(next)
                  setLayoutId('CUSTOM')
                }}
              />
            )}
            <div className="settings-field-row">
              <label className="settings-field">
                <span>Barcode to print</span>
                <select
                  className="input"
                  value={printBarcode}
                  onChange={(e) => setPrintBarcode(e.target.value)}
                >
                  <option value="ours">
                    {product.own_barcode
                      ? activeBarcodeValue
                        ? `Own (${activeBarcodeValue})`
                        : 'Own (set MRP first)'
                      : `Internal 6-digit (${product.barcode})`}
                  </option>
                  {ownRows.map((r) => (
                    <option key={r.id} value={r.id}>
                      Own: {r.barcode}
                      {r.mrp != null ? ` · MRP ${r.mrp}` : ''}
                    </option>
                  ))}
                  {makerRows.map((r) => (
                    <option key={r.id} value={r.id}>
                      Company: {r.barcode}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span>Number of labels</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={500}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            </div>

            {visibleExtraFields.length > 0 && (
              <details className="barcode-fold barcode-fold--nested">
                <summary>
                  <span className="settings-box-title">Label extras</span>
                  <span className="barcode-fold-meta">{visibleExtraFields.length} field{visibleExtraFields.length === 1 ? '' : 's'}</span>
                </summary>
                <div className="settings-field-row">
                  {visibleExtraFields.map((f) => (
                    <label key={f.id} className="settings-field">
                      <span>{f.label || (f.source === 'expiry' ? 'Expiry date' : 'Custom text')}</span>
                      <input
                        className="input"
                        value={extras[f.id] ?? extras.expiry ?? ''}
                        placeholder={f.source === 'expiry' ? 'DD-MM-YYYY' : 'Text on label'}
                        onChange={(e) =>
                          setExtras((x) => ({
                            ...x,
                            [f.id]: e.target.value,
                            ...(f.source === 'expiry' ? { expiry: e.target.value } : {}),
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
            )}

            <p className="hint" style={{ margin: '8px 0 0' }}>
              {sizeMmCm(layout.widthMm, layout.heightMm)}
              {` · ${layout.perRow} per row`}
              {layout.columnGapMm ? ` · column gap ${mmWithCm(layout.columnGapMm)}` : ''}
              {layout.rowGapMm ? ` · row gap ${mmWithCm(layout.rowGapMm)}` : ''}
              {layoutPrinters[layoutId]
                ? ` · ${layoutPrinters[layoutId]}`
                : ' · Windows default printer'}
            </p>
            <p className="hint" style={{ margin: '4px 0 0' }}>
              If print runs past the tear line, set Bottom gap to 0 in Settings (the printer
              usually skips the liner gap itself) and match Windows paper size to the sticker.
            </p>
          </div>

          <div className="settings-box barcode-ours">
            <div className="settings-box-title">Preview</div>
            <p className="hint" style={{ margin: 0 }}>
              Code <strong>{product.code}</strong> · {product.name}
              {activeBarcodeValue ? (
                <>
                  {' '}
                  · print <strong>{activeBarcodeValue}</strong>
                </>
              ) : null}
            </p>
            {!showSettings ? (
            <BarcodeLabelPreview
              layout={layout}
              canvas={canvas}
              settings={settings}
              product={labelProduct || product}
              extras={extras}
              company={companyProfile}
              barcodeValue={activeBarcodeValue}
            />
            ) : (
            <p className="hint" style={{ margin: '8px 0 0' }}>
              Live preview is next to the sticker designer in Settings.
            </p>
            )}
            <p className="hint" style={{ margin: '8px 0 0' }}>
              One label for editing. Preview shows the full sheet the printer will receive.
            </p>
            <div className="barcode-preview-actions">
              <button
                type="button"
                className="btn"
                disabled={busy || !activeBarcodeValue}
                onClick={() => void openSheetPreview()}
              >
                Preview
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !activeBarcodeValue}
                onClick={() => void printLabels()}
              >
                {busy ? 'Printing…' : `Print ${copies} label${copies === 1 ? '' : 's'}`}
              </button>
            </div>
            {printError ? <p className="error barcode-print-status">{printError}</p> : null}
            {printOk ? <p className="barcode-print-ok">{printOk}</p> : null}
          </div>
          </div>

          {product.own_barcode ? (
          <details className="settings-box barcode-fold">
            <summary>
              <span className="settings-box-title">Own barcodes</span>
              <span className="barcode-fold-meta">
                {ownRows.length ? `${ownRows.length} saved` : 'Create / manage'}
              </span>
            </summary>
            <p className="hint" style={{ marginTop: 8 }}>
              Format: first 6 digits = product code ({String(product.code || '').padStart(6, '0')}),
              last 6 = MRP in rupees (₹250 → 000250). Product 19 with MRP 250 prints{' '}
              <strong>000019000250</strong>. Saving the product with Own barcode + MRP creates this
              automatically.
            </p>
            <div className="settings-field-row">
              <label className="settings-field">
                <span>MRP *</span>
                <input
                  className="input"
                  type="number"
                  step={0.01}
                  value={ownDraft.mrp}
                  onChange={(e) => setOwnDraft((d) => ({ ...d, mrp: e.target.value }))}
                />
              </label>
              <label className="settings-field">
                <span>Sale rate (blank = MRP)</span>
                <input
                  className="input"
                  type="number"
                  step={0.01}
                  value={ownDraft.sale_rate}
                  onChange={(e) => setOwnDraft((d) => ({ ...d, sale_rate: e.target.value }))}
                />
              </label>
              <label className="settings-field">
                <span>WS rate (optional)</span>
                <input
                  className="input"
                  type="number"
                  step={0.01}
                  value={ownDraft.ws_rate}
                  onChange={(e) => setOwnDraft((d) => ({ ...d, ws_rate: e.target.value }))}
                />
              </label>
            </div>
            <p className="hint">
              Will generate: <strong>{generatedOwn || '—'}</strong>
            </p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void saveOwn()}
            >
              Create own barcode
            </button>

            <table className="data-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Barcode</th>
                  <th>MRP</th>
                  <th>Sale</th>
                  <th>WS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ownPager.pageRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.barcode}</td>
                    <td>{row.mrp ?? '—'}</td>
                    <td>{row.sale_rate ?? '—'}</td>
                    <td>{row.ws_rate ?? '—'}</td>
                    <td className="sb-row" style={{ justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setPrintBarcode(row.id)}
                      >
                        Print this
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => void removeRow(row)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {ownRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="hint">
                      No own barcodes yet. Enter MRP and create one for this consignment.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <ListPager
              page={ownPager.page}
              totalPages={ownPager.totalPages}
              total={ownPager.total}
              pageSize={ownPager.pageSize}
              onPage={ownPager.setPage}
              onExport={exportBarcodes}
            />
          </details>
          ) : (
          <details className="settings-box barcode-fold">
            <summary>
              <span className="settings-box-title">Company barcodes</span>
              <span className="barcode-fold-meta">
                {makerRows.length ? `${makerRows.length} saved` : 'Add / manage'}
              </span>
            </summary>
            <p className="hint" style={{ marginTop: 8 }}>
              Add every manufacturer barcode for this product. Optional MRP/sale on the barcode is
              used when that barcode is scanned.
            </p>
            <div className="settings-field-row">
              <label className="settings-field">
                <span>Barcode</span>
                <input
                  className="input"
                  value={draft.barcode}
                  placeholder="Manufacturer / EAN barcode"
                  onChange={(e) => setDraft((d) => ({ ...d, barcode: e.target.value }))}
                />
              </label>
              <label className="settings-field">
                <span>MRP (optional)</span>
                <input
                  className="input"
                  type="number"
                  step={0.01}
                  value={draft.mrp}
                  onChange={(e) => setDraft((d) => ({ ...d, mrp: e.target.value }))}
                />
              </label>
              <label className="settings-field">
                <span>Sale rate (optional)</span>
                <input
                  className="input"
                  type="number"
                  step={0.01}
                  value={draft.sale_rate}
                  onChange={(e) => setDraft((d) => ({ ...d, sale_rate: e.target.value }))}
                />
              </label>
              <label className="settings-field">
                <span>WS rate (optional)</span>
                <input
                  className="input"
                  type="number"
                  step={0.01}
                  value={draft.ws_rate}
                  onChange={(e) => setDraft((d) => ({ ...d, ws_rate: e.target.value }))}
                />
              </label>
            </div>
            <div className="sb-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void saveCompany()}
              >
                {editingId ? 'Update Company Barcode' : 'Add Company Barcode'}
              </button>
              {editingId && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setEditingId(null)
                    setDraft(EMPTY_DRAFT)
                  }}
                >
                  Cancel edit
                </button>
              )}
            </div>

            <table className="data-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Barcode</th>
                  <th>MRP</th>
                  <th>Sale</th>
                  <th>WS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {barcodePager.pageRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.barcode}</td>
                    <td>{row.mrp ?? '—'}</td>
                    <td>{row.sale_rate ?? '—'}</td>
                    <td>{row.ws_rate ?? '—'}</td>
                    <td className="sb-row" style={{ justifyContent: 'flex-end' }}>
                      <button type="button" className="btn" onClick={() => editRow(row)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => void removeRow(row)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {makerRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="hint">
                      No company barcodes yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <ListPager
              page={barcodePager.page}
              totalPages={barcodePager.totalPages}
              total={barcodePager.total}
              pageSize={barcodePager.pageSize}
              onPage={barcodePager.setPage}
              onExport={exportBarcodes}
            />
          </details>
          )}
        </>
      )}
      </>
      ) : null}
      {sheetPreview && (
        <PrintPreview
          title={sheetPreview.title}
          html={sheetPreview.html}
          initialPrinter={layoutPrinters[layoutId] || ''}
          showCopies={false}
          saveDefaultLabel="Save as default for this size"
          onSaveDefault={(printer) => persistLayoutPrinter(layoutId, printer)}
          onClose={() => setSheetPreview(null)}
        />
      )}
    </div>
  )
}
