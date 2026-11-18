import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ImageCropModal } from '../../components/generp/ImageCropModal'
import { ListPager } from '../../components/generp/ListPager'
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { downloadExcel, SPREADSHEET_ACCEPT, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { handleEnterAsTab } from '../../lib/generp/enterAsTab'
import { LIST_PAGE_SIZE, pageCount } from '../../lib/generp/paginate'
import type { Category, CompanyProfile, GstRate, Product, ProductImage, ProductImportResult, SubCategory, TaxSlab } from '../../generpTypes'

type ItemType = 'goods' | 'service'

type FormState = {
  code: string
  name: string
  category_id: string
  sub_category_id: string
  gst_id: string
  unit: string
  hsn_code: string
  item_type: ItemType
  purchase_price: number
  sale_price: number
  wholesale_price: number
  mrp: number
  max_discount_pct: number
  moq: number
  opening_stock: number
  is_in_shop: boolean
  own_barcode: boolean
  multi_barcode: boolean
  barcode_piece_qty: number
}

type TabId = 'product' | 'classify' | 'pricing' | 'tax' | 'stock' | 'shop' | 'images' | 'variants'

const PAGE_SIZE = LIST_PAGE_SIZE
const TABS: { id: TabId; label: string }[] = [
  { id: 'product', label: 'Product' },
  { id: 'classify', label: 'Classification' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'tax', label: 'Tax Setup' },
  { id: 'stock', label: 'Stock' },
  { id: 'shop', label: 'Shopping Cart' },
  { id: 'images', label: 'Images' },
  { id: 'variants', label: 'Variants' },
]

const TEMPLATE_HEADERS = [
  'Code',
  'Name',
  'Item type',
  'Category',
  'Sub category',
  'GST',
  'HSN',
  'Unit',
  'Purchase',
  'Sale',
  'Wholesale',
  'MRP',
  'Max disc %',
  'Opening stock',
  'Shop',
  'Own barcode',
  'MOQ',
]

const EMPTY: FormState = {
  code: '',
  name: '',
  category_id: '',
  sub_category_id: '',
  gst_id: '',
  unit: 'NOS',
  hsn_code: '',
  item_type: 'goods',
  purchase_price: 0,
  sale_price: 0,
  wholesale_price: 0,
  mrp: 0,
  max_discount_pct: 0,
  moq: 0,
  opening_stock: 0,
  is_in_shop: false,
  own_barcode: false,
  multi_barcode: false,
  barcode_piece_qty: 1,
}

function num(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function productToForm(p: Product): FormState {
  return {
    code: String(p.code || ''),
    name: String(p.name || ''),
    category_id: p.category_id || '',
    sub_category_id: p.sub_category_id || '',
    gst_id: p.gst_id || '',
    unit: String(p.unit || 'NOS'),
    hsn_code: String(p.hsn_code || ''),
    item_type: String(p.item_type || 'goods').toLowerCase() === 'service' ? 'service' : 'goods',
    purchase_price: num(p.purchase_price),
    sale_price: num(p.sale_price),
    wholesale_price: num(p.wholesale_price),
    mrp: num(p.mrp),
    max_discount_pct: num(p.max_discount_pct),
    moq: num(p.moq),
    opening_stock: num(p.opening_stock),
    is_in_shop: !!p.is_in_shop,
    own_barcode: !!p.own_barcode,
    multi_barcode: !!p.multi_barcode,
    barcode_piece_qty: num(p.barcode_piece_qty) || 1,
  }
}

function uniqueGstRates(rows: GstRate[]): GstRate[] {
  const seen = new Set<string>()
  const out: GstRate[] = []
  for (const g of rows) {
    const key = `${Number(g.rate)}|${String(g.name || '').trim().toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(g)
  }
  return out
}

function isCodeInvalid(code: string) {
  const t = code.trim()
  if (!t) return false
  if (!/^\d+$/.test(t)) return true
  const n = Number(t)
  return n < 1 || n > 999999
}

function previewInternalBarcode(code: string) {
  const t = code.trim()
  if (isCodeInvalid(t) || !t) return ''
  return String(Number(t)).padStart(6, '0')
}

function isColorAxis(name: string) {
  return /^(colou?r)$/i.test(name.trim())
}

function splitValues(raw: string): string[] {
  return raw.split(/[,|/]/).map((v) => v.trim()).filter(Boolean)
}

function toPickerHex(raw: string): string {
  const last = splitValues(raw).at(-1) || ''
  const six = last.match(/^#([0-9a-f]{6})$/i)
  if (six) return `#${six[1].toLowerCase()}`
  const three = last.match(/^#([0-9a-f]{3})$/i)
  if (three) {
    const [a, b, c] = three[1]
    return `#${a}${a}${b}${b}${c}${c}`.toLowerCase()
  }
  return '#dc2626'
}

function ColorValuesEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className="pc-color-custom">
      <input
        type="color"
        className="pc-color-picker"
        value={toPickerHex(value)}
        aria-label="Pick a color"
        onChange={(e) => {
          const code = e.target.value.toUpperCase()
          const items = splitValues(value)
          if (items.some((x) => x.toUpperCase() === code)) {
            onChange(items.join(', '))
            return
          }
          onChange([...items, code].join(', '))
        }}
      />
      <input
        className="input"
        placeholder="#DC2626"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function payloadFromForm(form: FormState, forCreate: boolean, taxSlabs: TaxSlab[]) {
  const base = {
    name: form.name.trim(),
    category_id: form.category_id || null,
    sub_category_id: form.sub_category_id || null,
    gst_id: form.gst_id || null,
    tax_slabs: taxSlabs.filter((s) => Number(s.rate) > 0 || Number(s.min_amount) > 0),
    unit: form.unit.trim() || 'NOS',
    hsn_code: form.hsn_code.trim() || null,
    item_type: form.item_type,
    purchase_price: form.purchase_price,
    sale_price: form.sale_price,
    wholesale_price: form.wholesale_price,
    mrp: form.mrp,
    max_discount_pct: form.max_discount_pct,
    moq: form.moq,
    opening_stock: form.opening_stock,
    is_in_shop: form.is_in_shop,
    own_barcode: form.own_barcode,
    multi_barcode: form.multi_barcode,
    barcode_piece_qty: form.barcode_piece_qty > 0 ? form.barcode_piece_qty : 1,
  }
  if (forCreate) {
    return { ...base, code: form.code.trim() || null }
  }
  return base
}

export function ProductCreationPage() {
  const formRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [listOpen, setListOpen] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [tab, setTab] = useState<TabId>('product')
  const [categories, setCategories] = useState<Category[]>([])
  const [subCategories, setSubCategories] = useState<SubCategory[]>([])
  const [gst, setGst] = useState<GstRate[]>([])
  const [query, setQuery] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const formStateRef = useRef(form)
  formStateRef.current = form
  const [taxSlabs, setTaxSlabs] = useState<TaxSlab[]>([{ min_amount: 0, rate: 5 }])
  const taxSlabsRef = useRef(taxSlabs)
  taxSlabsRef.current = taxSlabs
  const [images, setImages] = useState<ProductImage[]>([])
  const [cropQueue, setCropQueue] = useState<File[]>([])
  const [cropIndex, setCropIndex] = useState(0)
  const [cropTotal, setCropTotal] = useState(0)
  const [axis1Name, setAxis1Name] = useState('Color')
  const [axis1Values, setAxis1Values] = useState('')
  const [axis2Name, setAxis2Name] = useState('Size')
  const [axis2Values, setAxis2Values] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [uniqueBarcodeStock, setUniqueBarcodeStock] = useState(false)

  const loadLookups = useCallback(async () => {
    const [cats, g, profile] = await Promise.all([
      api.get<Category[]>('/categories'),
      api.get<GstRate[]>('/gst'),
      api.get<CompanyProfile>('/company-profile').catch(() => null),
    ])
    setCategories(cats)
    setGst(uniqueGstRates(g))
    setUniqueBarcodeStock(profile?.unique_barcode_stock === true)
  }, [])

  const loadProducts = useCallback(async (q = '', pageNo = 1) => {
    const skip = (pageNo - 1) * PAGE_SIZE
    const result = await api.get<{ items: Product[]; total: number }>('/products/paged', {
      q: q.trim() || undefined,
      skip,
      limit: PAGE_SIZE,
    })
    setProducts(result.items)
    setTotal(result.total)
    setPage(pageNo)
  }, [])

  const loadSubs = useCallback(async (categoryId: string) => {
    if (!categoryId) {
      setSubCategories([])
      return
    }
    const rows = await api.get<SubCategory[]>('/sub-categories', { category_id: categoryId })
    setSubCategories(rows)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([loadLookups(), loadProducts()])
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load')
      }
    })()
  }, [loadLookups, loadProducts])

  useEffect(() => {
    void loadSubs(form.category_id)
  }, [form.category_id, loadSubs])

  const sortImages = (rows: ProductImage[]) =>
    [...rows].sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
      return a.sort_order - b.sort_order
    })

  const reset = () => {
    setEditId(null)
    setForm(EMPTY)
    setTaxSlabs([{ min_amount: 0, rate: 5 }])
    setImages([])
    setAxis1Values('')
    setAxis2Values('')
    setTab('product')
    setError('')
    setStatus('')
  }

  const selectProduct = (p: Product) => {
    setEditId(p.id)
    setForm(productToForm(p))
    setTaxSlabs(
      p.tax_slabs && p.tax_slabs.length
        ? p.tax_slabs.map((s) => ({
            min_amount: Number(s.min_amount) || 0,
            rate: Number(s.rate) || 0,
            gst_id: s.gst_id || null,
          }))
        : [{ min_amount: 0, rate: Number(p.gst_rate || 0) || 5 }],
    )
    setImages(sortImages(p.images || []))
    setTab('product')
    setError('')
    setStatus('')
  }

  const refreshImages = useCallback(async (productId: string) => {
    const rows = await api.get<ProductImage[]>(`/products/${productId}/images`)
    setImages(sortImages(rows))
  }, [])

  const save = useCallback(async () => {
    const latest = formStateRef.current
    const latestSlabs = taxSlabsRef.current
    const creating = !editId
    if (!latest.name.trim()) {
      setTab('product')
      alert('Product name is required.')
      return
    }
    if (creating && isCodeInvalid(latest.code)) {
      setTab('product')
      alert('Product code must be a positive whole number, or leave it blank to auto-create.')
      return
    }
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const payload = payloadFromForm(latest, creating, latestSlabs)
      let saved: Product
      if (editId) {
        saved = await api.patch<Product>(`/products/${editId}`, payload)
      } else {
        saved = await api.post<Product>('/products', payload)
      }
      setEditId(saved.id)
      if (Boolean(payload.own_barcode) && saved.own_barcode !== true) {
        throw new ApiError(
          'Own barcode did not save. Stop the old backend on port 8020 and use the one on 8030, then save again.',
        )
      }
      setForm(productToForm(saved))
      setTaxSlabs(
        saved.tax_slabs && saved.tax_slabs.length
          ? saved.tax_slabs.map((s) => ({
              min_amount: Number(s.min_amount) || 0,
              rate: Number(s.rate) || 0,
              gst_id: s.gst_id || null,
            }))
          : latestSlabs,
      )
      setImages(sortImages(saved.images || []))
      await loadProducts(query, creating ? 1 : page)
      alert(creating ? `Product created. Internal barcode: ${saved.barcode}` : 'Product updated.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }, [editId, loadProducts, page, query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F9') return
      e.preventDefault()
      if (!busy) void save()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, save])

  const remove = async () => {
    if (!editId) return
    if (!confirm('Deactivate this product?')) return
    setBusy(true)
    try {
      await api.delete(`/products/${editId}`)
      reset()
      await loadProducts(query, page)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const onAddImages = (files: FileList | null) => {
    if (!editId) {
      alert('Save the product first, then upload images.')
      return
    }
    if (!files || !files.length) return
    const list = Array.from(files)
    setCropQueue(list)
    setCropIndex(0)
    setCropTotal(list.length)
  }

  const uploadCroppedImage = async (blob: Blob) => {
    if (!editId) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', new File([blob], 'product.jpg', { type: 'image/jpeg' }))
      await api.upload<Product>(`/products/${editId}/images`, fd)
      await refreshImages(editId)
      await loadProducts(query, page)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Image upload failed')
    } finally {
      setBusy(false)
    }
  }

  const onCropConfirm = async (blob: Blob) => {
    await uploadCroppedImage(blob)
    advanceCropQueue()
  }

  const advanceCropQueue = () => {
    setCropQueue((q) => {
      const rest = q.slice(1)
      if (rest.length) {
        setCropIndex((i) => i + 1)
      } else {
        setCropIndex(0)
        setCropTotal(0)
      }
      return rest
    })
  }

  const onCropCancel = () => {
    advanceCropQueue()
  }

  const setMainImage = async (imageId: string) => {
    if (!editId) return
    setBusy(true)
    try {
      await api.patch<Product>(`/products/${editId}/images/${imageId}`, { is_primary: true })
      await refreshImages(editId)
      await loadProducts(query, page)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to set main image')
    } finally {
      setBusy(false)
    }
  }

  const removeImage = async (imageId: string) => {
    if (!editId) return
    if (!confirm('Remove this image?')) return
    setBusy(true)
    try {
      await api.delete<Product>(`/products/${editId}/images/${imageId}`)
      await refreshImages(editId)
      await loadProducts(query, page)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove image')
    } finally {
      setBusy(false)
    }
  }

  const generateVariants = async () => {
    if (!editId) {
      alert('Save the base product first, then generate variants.')
      return
    }
    const axes = [
      {
        name: axis1Name.trim(),
        values: axis1Values.split(/[,|/]/).map((v) => v.trim()).filter(Boolean),
      },
      {
        name: axis2Name.trim(),
        values: axis2Values.split(/[,|/]/).map((v) => v.trim()).filter(Boolean),
      },
    ].filter((a) => a.name && a.values.length)

    if (!axes.length) {
      alert('Add at least one attribute with values (pick colours, or type Size values).')
      return
    }

    setBusy(true)
    setError('')
    try {
      const created = await api.post<Product[]>('/products/generate-variants', {
        product_id: editId,
        axes,
      })
      await loadProducts(query, page)
      alert(`Created ${created.length} variant(s).`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Variant generation failed')
    } finally {
      setBusy(false)
    }
  }

  const setField =
    (key: keyof FormState) =>
    (value: string) => {
      setForm((f) => ({
        ...f,
        [key]:
          key === 'purchase_price' ||
          key === 'sale_price' ||
          key === 'wholesale_price' ||
          key === 'mrp' ||
          key === 'max_discount_pct' ||
          key === 'moq' ||
          key === 'opening_stock'
            ? num(value)
            : value,
      }))
    }

  const search = () => {
    void loadProducts(query, 1)
  }

  const exportProducts = async (format: SpreadsheetFormat = 'xlsx') => {
    setExportBusy(true)
    try {
      const all: Product[] = []
      let skip = 0
      const limit = 100
      const q = query.trim() || undefined
      while (true) {
        const result = await api.get<{ items: Product[]; total: number }>('/products/paged', {
          q,
          skip,
          limit,
        })
        all.push(...result.items)
        skip += result.items.length
        if (skip >= result.total || result.items.length === 0) break
      }
      downloadExcel(q ? `products-${q}` : 'products', {
        name: 'Products',
        headers: [
          'Code',
          'Name',
          'Category',
          'Sub category',
          'HSN',
          'Unit',
          'GST',
          'Purchase',
          'Sale',
          'Wholesale',
          'MRP',
          'Max disc %',
          'Opening stock',
          'Current stock',
          'Shop',
        ],
        rows: all.map((p) => [
          p.code || '',
          p.name || '',
          p.category_name || '',
          p.sub_category_name || '',
          p.hsn_code || '',
          p.unit || '',
          p.gst_name || p.gst_rate || '',
          Number(p.purchase_price || 0),
          Number(p.sale_price || 0),
          Number(p.wholesale_price || 0),
          Number(p.mrp || 0),
          Number(p.max_discount_pct || 0),
          Number(p.opening_stock || 0),
          Number(p.current_stock || 0),
          p.is_in_shop ? 'Yes' : 'No',
        ]),
      }, format)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export failed')
    } finally {
      setExportBusy(false)
    }
  }

  const exportTemplate = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel('product-master-template', [
      {
        name: 'Products',
        headers: TEMPLATE_HEADERS,
        rows: [
          ['', '', 'goods', '', '', '', '', 'NOS', 0, 0, 0, 0, 0, 0, 'No', 'No', 0],
        ],
      },
      {
        name: 'Instructions',
        headers: ['Field', 'Required', 'Notes'],
        rows: [
          ['Code', 'No', 'Leave blank to auto-number from the highest existing code (2001, 2002, 2003 → next is 2004). Must be unique.'],
          ['Name', 'Yes', 'Product name'],
          ['Item type', 'No', 'goods or service. Default goods.'],
          ['Category', 'No', 'Created if missing. Blank uses General.'],
          ['Sub category', 'No', 'Created under the category if missing. Blank uses General.'],
          ['GST', 'No', 'GST name or rate: 18, 18%, or Excel 0.18 (all mean 18%)'],
          ['HSN', 'No', 'HSN for goods, SAC for services'],
          ['Unit', 'No', 'Default NOS'],
          ['Purchase / Sale / Wholesale / MRP', 'No', 'Prices'],
          ['Max disc %', 'No', 'Maximum discount percent on sale price'],
          ['Opening stock', 'No', 'Opening quantity'],
          ['Shop', 'No', 'Yes to show in shopping cart'],
          ['Own barcode', 'No', 'Yes if the shop prints code + MRP barcodes'],
          ['MOQ', 'No', 'Minimum order quantity. Last column. Empty = 0.'],
          ['Example', '', '2001, Rice 1kg, goods, , , 5, 1006, NOS, 40, 50, 45, 55, 0, 0, No, No, 0 — next blank row becomes 2002'],
        ],
      },
    ], format)
  }

  const importExcel = async (file: File) => {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const result = await api.upload<ProductImportResult>('/products/import', fd)
      setStatus(result.message)
      const issues = Array.isArray(result.errors) ? result.errors : []
      if (issues.length) {
        const extra = issues.length > 80 ? `\n… ${issues.length - 80} more` : ''
        setError([result.message, ...issues.slice(0, 80)].filter(Boolean).join('\n') + extra)
      }
      if (result.created > 0) {
        await loadLookups()
        await loadProducts(query, 1)
      }
      if (result.created && !issues.length) {
        alert(result.message)
      } else if (!result.created && !issues.length) {
        alert(result.message || 'Nothing imported.')
      }
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : 'Import failed'
      setError(msg)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const savedBarcode = editId ? products.find((p) => p.id === editId)?.barcode || form.code : ''
  const currentBarcode = editId
    ? savedBarcode || '(saved)'
    : previewInternalBarcode(form.code) || '(auto after save)'

  return (
    <div className="master-page">
      <div className="pc-head">
        <div>
          <h2>Product Master</h2>
          <p className="hint">
            Enter moves to the next field. F9 saves. Download the Excel template, fill products, then import.
            Code is optional — blank codes continue from the highest existing number.
          </p>
        </div>
        <div className="pc-head-actions">
          <ExportFormatButtons
            className="btn sb-excel-btn"
            disabled={busy}
            xlsxLabel="Template"
            csvLabel="CSV"
            onExport={exportTemplate}
          />
          <button
            type="button"
            className="btn sb-excel-btn"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Import Excel / CSV
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={SPREADSHEET_ACCEPT}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void importExcel(file)
            }}
          />
        </div>
      </div>
      {error && <div className="error-banner import-log">{error}</div>}
      {status && <p className="hint">{status}</p>}

      <div className={`master-grid${listOpen ? '' : ' is-list-collapsed'}`}>
        {listOpen ? (
          <aside className="master-list">
            <div className="master-list-head">
              <strong>Products</strong>
              <button
                type="button"
                className="btn"
                data-skip-enter="true"
                title="Collapse product list"
                onClick={() => setListOpen(false)}
              >
                «
              </button>
            </div>
            <div className="sb-row" style={{ marginBottom: 8 }}>
              <input
                className="input"
                placeholder="Search products…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    search()
                  }
                }}
              />
              <button type="button" className="btn" data-skip-enter="true" onClick={search}>
                Search
              </button>
            </div>
            <div className="master-list-toolbar">
              <button type="button" className="btn" data-skip-enter="true" onClick={reset}>
                New
              </button>
              <ListPager
                compact
                page={page}
                totalPages={pageCount(total, PAGE_SIZE)}
                total={total}
                pageSize={PAGE_SIZE}
                onPage={(p) => void loadProducts(query, p)}
                onExport={(format) => void exportProducts(format)}
                exportBusy={exportBusy}
              />
            </div>
            <div className="master-list-scroll">
              {products.map((p) => {
                const open = !!expanded[p.id]
                return (
                  <div
                    key={p.id}
                    className={`master-list-row${editId === p.id ? ' active' : ''}${open ? ' is-open' : ''}`}
                  >
                    <div className="master-list-row-main">
                      <button
                        type="button"
                        className="master-list-toggle"
                        aria-label={open ? 'Collapse' : 'Expand'}
                        onClick={() => setExpanded((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                      >
                        {open ? '▾' : '▸'}
                      </button>
                      <button type="button" className="master-list-item" onClick={() => selectProduct(p)}>
                        <strong>
                          {p.code} · {p.barcode}
                        </strong>
                        <span>{p.name}</span>
                      </button>
                    </div>
                    {open ? (
                      <div className="master-list-detail">
                        <span>{String(p.item_type || 'goods').toLowerCase() === 'service' ? 'Service' : 'Goods'}</span>
                        <span>GST: {p.gst_name || p.gst_rate || '—'}</span>
                        <span>{String(p.item_type || '').toLowerCase() === 'service' ? 'SAC' : 'HSN'}: {p.hsn_code || '—'}</span>
                        <span>Sale: {num(p.sale_price)}</span>
                        <span>Stock: {num(p.current_stock)}</span>
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {products.length === 0 && <p className="hint">No products found.</p>}
            </div>
          </aside>
        ) : (
          <button
            type="button"
            className="master-list-rail"
            data-skip-enter="true"
            title="Show product list"
            onClick={() => setListOpen(true)}
          >
            Products
          </button>
        )}

        <div
          className="master-form"
          ref={formRef}
          onKeyDown={(e) => handleEnterAsTab(e, formRef.current)}
        >
          <div className="pc-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`pc-tab${tab === t.id ? ' active' : ''}`}
                data-skip-enter="true"
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'product' ? (
            <div className="settings-box">
              <label className="settings-field">
                <span>Name *</span>
                <input
                  className="input"
                  autoFocus
                  value={form.name}
                  onChange={(e) => setField('name')(e.target.value)}
                />
              </label>
              <div className="settings-field-row">
                <label className="settings-field">
                  <span>Code (optional)</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="Blank = auto"
                    value={form.code}
                    disabled={!!editId}
                    onChange={(e) => setField('code')(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
                <label className="settings-field">
                  <span>Internal barcode</span>
                  <input className="input" value={currentBarcode} disabled />
                </label>
              </div>
              <p className="hint" style={{ marginTop: 0 }}>
                {editId
                  ? 'Code is set when the product is created and cannot be changed.'
                  : 'Leave code blank to auto-create the next number (highest existing + 1). If you enter a code it must be unique.'}
              </p>
              <div className="settings-field">
                <span>Is this service or goods?</span>
                <div className="pc-kind" role="radiogroup" aria-label="Item type">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.item_type === 'goods'}
                    className={`pc-kind-opt${form.item_type === 'goods' ? ' active' : ''}`}
                    data-skip-enter="true"
                    onClick={() => setForm((f) => ({ ...f, item_type: 'goods' }))}
                  >
                    Goods
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.item_type === 'service'}
                    className={`pc-kind-opt${form.item_type === 'service' ? ' active' : ''}`}
                    data-skip-enter="true"
                    onClick={() => setForm((f) => ({ ...f, item_type: 'service' }))}
                  >
                    Service
                  </button>
                </div>
              </div>
              <div className="settings-field-row">
                <label className="settings-field">
                  <span>GST</span>
                  <select
                    className="input"
                    value={form.gst_id}
                    onChange={(e) => setField('gst_id')(e.target.value)}
                  >
                    <option value="">—</option>
                    {gst.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name || g.rate}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span>{form.item_type === 'service' ? 'SAC' : 'HSN'}</span>
                  <input
                    className="input"
                    value={form.hsn_code}
                    onChange={(e) => setField('hsn_code')(e.target.value)}
                  />
                </label>
              </div>
              <div className="settings-field" style={{ marginTop: 8 }}>
                <span>Own barcode</span>
                <div className="pc-kind" role="radiogroup" aria-label="Own barcode">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.own_barcode}
                    className={`pc-kind-opt${form.own_barcode ? ' active' : ''}`}
                    data-skip-enter="true"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setForm((f) => ({ ...f, own_barcode: true }))}
                  >
                    Yes — shop prints code + MRP
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!form.own_barcode}
                    className={`pc-kind-opt${!form.own_barcode ? ' active' : ''}`}
                    data-skip-enter="true"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setForm((f) => ({ ...f, own_barcode: false }))}
                  >
                    No — manufacturer barcodes
                  </button>
                </div>
                {form.own_barcode ? (
                  <p className="hint" style={{ margin: 0 }}>
                    Selected. Save (F9), then print from Barcode Generation. Example with MRP{' '}
                    {Math.round(form.mrp || 0)}:{' '}
                    <strong>
                      {String(form.code || '0').padStart(6, '0')}
                      {String(Math.max(0, Math.round(form.mrp || 0))).padStart(6, '0')}
                    </strong>
                  </p>
                ) : (
                  <p className="hint" style={{ margin: 0 }}>
                    Use Barcode Generation to attach one or more company / EAN barcodes.
                  </p>
                )}
              </div>
              {uniqueBarcodeStock ? (
                <div className="settings-field" style={{ marginTop: 8 }}>
                  <span>Multiple barcode</span>
                  <div className="pc-kind" role="radiogroup" aria-label="Multiple barcode">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={form.multi_barcode}
                      className={`pc-kind-opt${form.multi_barcode ? ' active' : ''}`}
                      data-skip-enter="true"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setForm((f) => ({ ...f, multi_barcode: true }))}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!form.multi_barcode}
                      className={`pc-kind-opt${!form.multi_barcode ? ' active' : ''}`}
                      data-skip-enter="true"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setForm((f) => ({ ...f, multi_barcode: false }))}
                    >
                      No — one barcode per piece
                    </button>
                  </div>
                  {form.multi_barcode ? (
                    <label className="settings-field" style={{ marginTop: 8 }}>
                      <span>Pieces per barcode</span>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        step={1}
                        value={form.barcode_piece_qty || ''}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            barcode_piece_qty: Number(e.target.value) || 0,
                          }))
                        }
                      />
                      <p className="hint" style={{ margin: '4px 0 0' }}>
                        How many pieces share one barcode. Purchase 70 with 10 here and this row
                        prints 7 labels of the same barcode. Other items still print one barcode per
                        piece. Sale of this barcode asks for the quantity to reduce.
                      </p>
                    </label>
                  ) : (
                    <p className="hint" style={{ margin: 0 }}>
                      Each purchased piece gets its own barcode. Sale of that barcode reduces 1.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'classify' ? (
            <div className="settings-box">
              <div className="settings-field-row">
                <label className="settings-field">
                  <span>Category</span>
                  <select
                    className="input"
                    value={form.category_id}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, category_id: e.target.value, sub_category_id: '' }))
                    }
                  >
                    <option value="">—</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span>Sub Category</span>
                  <select
                    className="input"
                    value={form.sub_category_id}
                    onChange={(e) => setField('sub_category_id')(e.target.value)}
                  >
                    <option value="">—</option>
                    {subCategories.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="settings-field">
                <span>Unit</span>
                <input
                  className="input"
                  value={form.unit}
                  onChange={(e) => setField('unit')(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          {tab === 'pricing' ? (
            <div className="settings-box">
              <div className="settings-field-row">
                <label className="settings-field">
                  <span>Purchase</span>
                  <input
                    className="input"
                    type="number"
                    step={0.01}
                    value={form.purchase_price}
                    onChange={(e) => setField('purchase_price')(e.target.value)}
                  />
                </label>
                <label className="settings-field">
                  <span>Sale rate</span>
                  <input
                    className="input"
                    type="number"
                    step={0.01}
                    value={form.sale_price}
                    onChange={(e) => setField('sale_price')(e.target.value)}
                  />
                </label>
              </div>
              <div className="settings-field-row">
                <label className="settings-field">
                  <span>Wholesale</span>
                  <input
                    className="input"
                    type="number"
                    step={0.01}
                    value={form.wholesale_price}
                    onChange={(e) => setField('wholesale_price')(e.target.value)}
                  />
                </label>
                <label className="settings-field">
                  <span>MRP</span>
                  <input
                    className="input"
                    type="number"
                    step={0.01}
                    value={form.mrp}
                    onChange={(e) => setField('mrp')(e.target.value)}
                  />
                </label>
              </div>
              <div className="settings-field-row">
                <label className="settings-field">
                  <span>Sale bill max discount %</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={form.max_discount_pct}
                    onChange={(e) => setField('max_discount_pct')(e.target.value)}
                  />
                </label>
                <label className="settings-field">
                  <span>MOQ</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.001}
                    value={form.moq}
                    onChange={(e) => setField('moq')(e.target.value)}
                  />
                </label>
              </div>
              <p className="hint" style={{ margin: 0 }}>
                Example: sale price 100 and max discount 10 means the net rate after discount cannot
                go below 90. MRP is not used for this ceiling. MOQ is stored on the product (import
                last column); it is not enforced on the sale bill yet.
              </p>
            </div>
          ) : null}

          {tab === 'tax' ? (
            <div className="settings-box">
              <p className="hint" style={{ marginTop: 0 }}>
                Set GST by sale amount. Example: Chudidar 5% up to ₹2,499, then 18% from ₹2,500.
                The highest matching “from amount” is used on the sale bill.
              </p>
              <table className="table data-table">
                <thead>
                  <tr>
                    <th>From amount (₹)</th>
                    <th>GST %</th>
                    <th>GST master (optional)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {taxSlabs.map((slab, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step={0.01}
                          value={slab.min_amount}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0
                            setTaxSlabs((rows) =>
                              rows.map((r, idx) => (idx === i ? { ...r, min_amount: v } : r)),
                            )
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step={0.01}
                          value={slab.rate}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0
                            setTaxSlabs((rows) =>
                              rows.map((r, idx) => (idx === i ? { ...r, rate: v } : r)),
                            )
                          }}
                        />
                      </td>
                      <td>
                        <select
                          className="input"
                          value={slab.gst_id || ''}
                          onChange={(e) => {
                            const id = e.target.value || null
                            const match = gst.find((g) => g.id === id)
                            setTaxSlabs((rows) =>
                              rows.map((r, idx) =>
                                idx === i
                                  ? {
                                      ...r,
                                      gst_id: id,
                                      rate: match ? Number(match.rate || r.rate) : r.rate,
                                    }
                                  : r,
                              ),
                            )
                          }}
                        >
                          <option value="">Use % only</option>
                          {gst.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name || g.rate}%
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setTaxSlabs((rows) => rows.filter((_, idx) => idx !== i))}
                          disabled={taxSlabs.length <= 1}
                        >
                          Remove
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
                  setTaxSlabs((rows) => [...rows, { min_amount: 2500, rate: 18, gst_id: null }])
                }
              >
                Add slab
              </button>
            </div>
          ) : null}

          {tab === 'stock' ? (
            <div className="settings-box">
              <label className="settings-field">
                <span>Opening stock</span>
                <input
                  className="input"
                  type="number"
                  step={0.001}
                  style={{ maxWidth: 200 }}
                  value={form.opening_stock}
                  disabled={!!editId}
                  onChange={(e) => setField('opening_stock')(e.target.value)}
                />
              </label>
              {editId ? (
                <p className="hint" style={{ margin: 0 }}>
                  Opening stock is set only when creating. Use stock vouchers to adjust later.
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === 'shop' ? (
            <div className="settings-box">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.is_in_shop}
                  onChange={(e) => setForm((f) => ({ ...f, is_in_shop: e.target.checked }))}
                />
                <span>Available in Shopping Cart</span>
              </label>
              <p className="hint" style={{ margin: 0 }}>
                When checked, this product appears in Transactions → Shopping Cart.
              </p>
            </div>
          ) : null}

          {tab === 'images' ? (
            <div className="settings-box">
              <div className="settings-box-title">Images (optional, up to 12)</div>
              <div className="product-gallery">
                {images.length > 0 ? (
                  <div className="product-gallery-main">
                    <span className="product-gallery-badge">Main</span>
                    <img src={images[0].image_url} alt="Product" />
                    <div className="product-gallery-item-actions product-gallery-main-actions">
                      <button
                        type="button"
                        className="danger"
                        data-skip-enter="true"
                        disabled={busy}
                        onClick={() => void removeImage(images[0].id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="product-gallery-main placeholder">
                    <span>No image</span>
                  </div>
                )}
                <div className="product-gallery-side">
                  {images.slice(1).map((img) => (
                    <div key={img.id} className="product-gallery-item">
                      <img src={img.image_url} alt="Product variant" />
                      <div className="product-gallery-item-actions">
                        <button
                          type="button"
                          title="Set as main"
                          data-skip-enter="true"
                          disabled={busy}
                          onClick={() => void setMainImage(img.id)}
                        >
                          ★
                        </button>
                        <button
                          type="button"
                          title="Remove"
                          className="danger"
                          data-skip-enter="true"
                          disabled={busy}
                          onClick={() => void removeImage(img.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                  <label className={`product-gallery-add${!editId || busy ? ' disabled' : ''}`}>
                    +
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      data-skip-enter="true"
                      disabled={!editId || busy}
                      onChange={(e) => {
                        onAddImages(e.target.files)
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>
              </div>
              {!editId && (
                <p className="hint" style={{ margin: 0 }}>
                  Save the product first (F9), then add images.
                </p>
              )}
            </div>
          ) : null}

          {tab === 'variants' ? (
            <div className="settings-box">
              <div className="settings-box-title">Variant generation (optional)</div>
              <p className="hint" style={{ margin: 0 }}>
                After saving the base product, add attributes. If the name is Color, pick a colour and
                the colour code is filled in. Creates separate SKUs with auto codes/barcodes.
              </p>
              <div className="settings-field-row">
                <label className="settings-field">
                  <span>Attribute 1 name</span>
                  <input className="input" value={axis1Name} onChange={(e) => setAxis1Name(e.target.value)} />
                </label>
                <div className="settings-field">
                  <span>Values</span>
                  {isColorAxis(axis1Name) ? (
                    <ColorValuesEditor value={axis1Values} onChange={setAxis1Values} />
                  ) : (
                    <input
                      className="input"
                      placeholder="Red, Blue, Green"
                      value={axis1Values}
                      onChange={(e) => setAxis1Values(e.target.value)}
                    />
                  )}
                </div>
              </div>
              <div className="settings-field-row">
                <label className="settings-field">
                  <span>Attribute 2 name</span>
                  <input className="input" value={axis2Name} onChange={(e) => setAxis2Name(e.target.value)} />
                </label>
                <div className="settings-field">
                  <span>Values</span>
                  {isColorAxis(axis2Name) ? (
                    <ColorValuesEditor value={axis2Values} onChange={setAxis2Values} />
                  ) : (
                    <input
                      className="input"
                      placeholder="S, M, L"
                      value={axis2Values}
                      onChange={(e) => setAxis2Values(e.target.value)}
                    />
                  )}
                </div>
              </div>
              <button
                type="button"
                className="btn"
                data-skip-enter="true"
                disabled={busy || !editId}
                onClick={() => void generateVariants()}
              >
                Generate Variants
              </button>
            </div>
          ) : null}

          <div className="sb-row">
            <button
              type="button"
              className="btn btn-primary"
              data-skip-enter="true"
              disabled={busy}
              onClick={() => void save()}
            >
              {editId ? 'F9 — Update' : 'F9 — Save'}
            </button>
            {editId ? (
              <button type="button" className="btn" data-skip-enter="true" disabled={busy} onClick={() => void remove()}>
                Deactivate
              </button>
            ) : null}
            <button type="button" className="btn" data-skip-enter="true" onClick={reset}>
              Clear
            </button>
          </div>
        </div>
      </div>

      {cropQueue.length > 0 && (
        <ImageCropModal
          file={cropQueue[0]}
          title={cropTotal > 1 ? `${cropIndex + 1} of ${cropTotal}` : undefined}
          onConfirm={(blob) => void onCropConfirm(blob)}
          onCancel={onCropCancel}
        />
      )}
    </div>
  )
}
