import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, ApiError } from '../../api/client'
import { PrintPreview } from '../../components/generp/PrintPreview'
import { Typeahead } from '../../components/generp/Typeahead'
import {
  EMPTY_PARTY_FORM,
  PartyDetailsForm,
  emptyPartyForm,
  savePartyRecord,
  partyToForm,
  type PartyFormState,
} from '../../components/generp/PartyDetailsForm'
import { handleEnterAsTab } from '../../lib/generp/enterAsTab'
import { isScannedBarcode } from '../../lib/generp/ownBarcode'
import { loadBillFormat, normalizeBillFormat, readLocalBillFormat, saveBillFormat } from '../../lib/generp/billFormat'
import { BillFormatSelect } from '../../components/generp/BillFormatSelect'
import { checkSaleCeiling } from '../../lib/generp/saleDiscountCeiling'
import {
  discFromNetAmount,
  fmt,
  lineAmounts,
  parseNum,
  resolveGstFromProduct,
  round2,
  todayISO,
} from '../../lib/generp/saleBillMath'
import type {
  BillLine,
  CompanyProfile,
  GstRate,
  Party,
  PartyDepositBalance,
  PaymentMode,
  Product,
  SaleEntryConfig,
  Voucher,
} from '../../generpTypes'

function fallbackBillHtml(heading: string, voucher: Voucher): string {
  const lines = (voucher.items || [])
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${it.product_name || ''}</td><td align="right">${Number(it.quantity || 0)}</td><td align="right">${Number(it.rate || 0).toFixed(2)}</td><td align="right">${Number(it.gst_rate || 0)}</td></tr>`,
    )
    .join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${heading}</title>
  <style>body{font-family:Times New Roman,serif;font-weight:bold}table{width:100%;border-collapse:collapse}td{border:1px solid #000;padding:4px}</style></head>
  <body><h2>${heading} ${voucher.voucher_no || ''}</h2>
  <p>Date: ${String(voucher.voucher_date || '').slice(0, 10)} · Customer: ${voucher.party_name || 'Walk-in'}</p>
  <table><tr><td>#</td><td>Product</td><td>Qty</td><td>Rate</td><td>GST%</td></tr>${lines}</table>
  <p>Net: ${Number(voucher.net_amount || 0).toFixed(2)}</p></body></html>`
}

function phoneDigits(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '')
}

function findCustomerByPhone(customers: Party[], phone: string): Party | null {
  const digits = phoneDigits(phone)
  if (!digits) return null
  const exact = customers.find((c) => phoneDigits(c.phone) === digits)
  if (exact) return exact
  if (digits.length >= 10) {
    const tail = digits.slice(-10)
    return (
      customers.find((c) => {
        const p = phoneDigits(c.phone)
        return p.length >= 10 && p.slice(-10) === tail
      }) ?? null
    )
  }
  return null
}

function normalizePartyCode(code: string | null | undefined): string {
  const s = String(code || '').trim()
  if (/^\d+$/.test(s)) return String(Number(s))
  return s
}

function findCustomerByCode(customers: Party[], code: string): Party | null {
  const wanted = normalizePartyCode(code)
  if (!wanted) return null
  return customers.find((c) => normalizePartyCode(c.code) === wanted) ?? null
}

export type BillKind = 'SALE' | 'WHOLESALE'

export type SaleBillMode = {
  voucherType: BillKind
  /** Product field used as default line rate */
  priceField: 'sale_price' | 'wholesale_price'
  heading: string
}

export const SALE_BILL_MODE: SaleBillMode = {
  voucherType: 'SALE',
  priceField: 'sale_price',
  heading: 'Sale Bill',
}

export const WHOLESALE_BILL_MODE: SaleBillMode = {
  voucherType: 'WHOLESALE',
  priceField: 'wholesale_price',
  heading: 'Wholesale Bill',
}

const ITEM_COLS = ['#', 'Code', 'Product', 'Qty', 'Rate', 'Disc%', 'GST%', 'Taxable', 'GST', 'Amount'] as const

function focusAndSelect(el: HTMLInputElement | null | undefined) {
  if (!el || el.disabled) return false
  el.focus()
  el.select()
  return true
}

function afterPaint(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

const DEFAULT_CFG: SaleEntryConfig = {
  enable_qty: true,
  enable_rate: true,
  enable_discount: true,
  default_qty: 1,
}

function billQtyForProduct(items: BillLine[], productId: string, exceptRow?: number) {
  return items.reduce((s, it, i) => {
    if (exceptRow !== undefined && i === exceptRow) return s
    return it.product_id === productId ? s + Number(it.qty || 0) : s
  }, 0)
}

function stockShortMsg(name: string, available: number, needed: number) {
  return `Insufficient stock for ${name}. Available ${available}, required ${needed}. Negative stock is not allowed.`
}

function EditableNum({
  value,
  decimals = 2,
  onCommit,
}: {
  value: number
  decimals?: number
  onCommit: (n: number) => void
}) {
  const [text, setText] = useState(fmt(value, decimals))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(fmt(value, decimals))
  }, [value, decimals, focused])

  return (
    <input
      value={text}
      onFocus={(e) => {
        setFocused(true)
        e.target.select()
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false)
        onCommit(parseNum(text))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

type Props = {
  mode?: SaleBillMode
  embeddedModify?: boolean
  onEditIdChange?: (id: string | null) => void
  loadVoucherRef?: React.MutableRefObject<((v: Voucher) => void) | null>
  printRef?: React.MutableRefObject<(() => void) | null>
}

export function SaleBillPage({
  mode = SALE_BILL_MODE,
  embeddedModify = false,
  onEditIdChange,
  loadVoucherRef,
  printRef,
}: Props) {
  const voucherType = mode.voucherType
  const reportCode = voucherType === 'WHOLESALE' ? 'WHOLESALE_BILL' : 'SALE_BILL'
  const priceField = mode.priceField
  const productRate = useCallback(
    (p: Product, allowMrp = false) => {
      const primary = Number(
        (priceField === 'wholesale_price' ? p.wholesale_price : p.sale_price) || 0,
      )
      if (primary > 0) return primary
      if (!allowMrp) return 0
      const sale = Number(p.sale_price || 0)
      if (sale > 0) return sale
      return Number(p.mrp || 0) || 0
    },
    [priceField],
  )
  const productListPrice = useCallback(
    (p: Product) => {
      if (priceField === 'wholesale_price') {
        return Number(p.wholesale_price || 0) || Number(p.sale_price || 0)
      }
      return Number(p.sale_price || 0)
    },
    [priceField],
  )
  const [gstById, setGstById] = useState<Record<string, GstRate>>({})
  const [customers, setCustomers] = useState<Party[]>([])
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([])
  const [cfg, setCfg] = useState<SaleEntryConfig>(DEFAULT_CFG)
  const [allowNegativeStock, setAllowNegativeStock] = useState(true)
  const [uniqueBarcodeStock, setUniqueBarcodeStock] = useState(false)

  const [billNo, setBillNo] = useState('—')
  const [lastNo, setLastNo] = useState('Assigned when you save')
  const [voucherDate, setVoucherDate] = useState(todayISO())
  const [billDiscPct, setBillDiscPct] = useState(0)
  const [customerText, setCustomerText] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<Party | null>(null)
  const [custId, setCustId] = useState('')
  const [mobile, setMobile] = useState('')
  const [narration, setNarration] = useState('')
  const [outstanding, setOutstanding] = useState('Outstanding: —')
  const [advanceLabel, setAdvanceLabel] = useState('Advance: —')
  const [advanceBalance, setAdvanceBalance] = useState(0)
  const [adjustAdvance, setAdjustAdvance] = useState(0)
  const [oldBalance, setOldBalance] = useState(0)

  const [entryText, setEntryText] = useState('')
  const [entryName, setEntryName] = useState('—')
  const [currentProduct, setCurrentProduct] = useState<Product | null>(null)
  const [qtyIn, setQtyIn] = useState(1)
  const [rateIn, setRateIn] = useState(0)
  const [discIn, setDiscIn] = useState(0)

  const [items, setItems] = useState<BillLine[]>([])
  const [selectedRow, setSelectedRow] = useState(-1)
  const [payAmounts, setPayAmounts] = useState<Record<string, number>>({})
  const [payDocs, setPayDocs] = useState<Record<string, string>>({})
  const [paymentsDirty, setPaymentsDirty] = useState(false)
  const [editVoucherId, setEditVoucherId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{
    title: string
    html: string
    reportCode?: string
    voucherId?: string
    billNo?: string
  } | null>(null)
  const [billFormat, setBillFormat] = useState(() => readLocalBillFormat(reportCode))
  const [taxInclusive, setTaxInclusive] = useState(mode.voucherType === 'SALE')
  const [showCustomerDlg, setShowCustomerDlg] = useState(false)
  const [partyEditId, setPartyEditId] = useState<string | null>(null)
  const [partyForm, setPartyForm] = useState<PartyFormState>(EMPTY_PARTY_FORM)

  const entryRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)
  const rateRef = useRef<HTMLInputElement>(null)
  const discRef = useRef<HTMLInputElement>(null)
  const mobileRef = useRef<HTMLInputElement>(null)
  const custIdRef = useRef<HTMLInputElement>(null)
  const customerRef = useRef<HTMLInputElement>(null)
  const narrationRef = useRef<HTMLInputElement>(null)

  const custByName = useMemo(() => {
    const m: Record<string, Party> = {}
    for (const c of customers) m[String(c.name || '').toLowerCase()] = c
    return m
  }, [customers])

  const searchProducts = useCallback(async (query: string) => {
    const q = query.trim()
    if (!q) return []
    return api.get<Product[]>('/products', { q, limit: 20 })
  }, [])

  const productLabel = useCallback(
    (p: Product) => `${p.code || ''} — ${p.name || ''}${p.barcode ? ` [${p.barcode}]` : ''}`,
    [],
  )

  const pickExactProduct = useCallback((query: string, rows: Product[]) => {
    const low = query.trim().toLowerCase()
    if (!low) return null
    return (
      rows.find((p) => {
        const code = String(p.code || '').trim().toLowerCase()
        const barcode = String(p.barcode || '').trim().toLowerCase()
        return (code && code === low) || (barcode && barcode === low)
      }) ?? null
    )
  }, [])

  const setEditId = useCallback(
    (id: string | null) => {
      setEditVoucherId(id)
      onEditIdChange?.(id)
    },
    [onEditIdChange],
  )

  const resetPendingBillNo = useCallback(() => {
    if (embeddedModify && editVoucherId) return
    setBillNo('—')
    setLastNo(embeddedModify ? 'Load a bill to modify' : 'Assigned when you save')
  }, [embeddedModify, editVoucherId])

  const refresh = useCallback(async () => {
    setError('')
    try {
      const [gst, custs, modes, saleCfg, profile] = await Promise.all([
        api.get<GstRate[]>('/gst'),
        api.get<Party[]>('/parties', { party_type: 'customer' }),
        api.get<PaymentMode[]>('/payment-modes'),
        api.get<SaleEntryConfig>('/sale-entry-config'),
        api.get<CompanyProfile>('/company-profile').catch(() => null),
      ])
      setGstById(Object.fromEntries(gst.map((g) => [g.id, g])))
      setCustomers(custs)
      setPaymentModes(modes)
      setCfg({ ...DEFAULT_CFG, ...saleCfg })
      setAllowNegativeStock(profile?.allow_negative_stock !== false)
      setUniqueBarcodeStock(profile?.unique_barcode_stock === true)
      const modeKey = voucherType === 'WHOLESALE' ? 'wholesale_tax_mode' : 'sale_tax_mode'
      const raw = String(profile?.[modeKey] || (voucherType === 'SALE' ? 'inclusive' : 'exclusive'))
      setTaxInclusive(raw.toLowerCase() === 'inclusive')
      if (!paymentsDirty) {
        setPayAmounts(Object.fromEntries(modes.map((m) => [m.id, 0])))
        setPayDocs(Object.fromEntries(modes.map((m) => [m.id, ''])))
      }
      resetPendingBillNo()
      entryRef.current?.focus()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    }
  }, [resetPendingBillNo, paymentsDirty, voucherType])

  useEffect(() => {
    void refresh()
    void loadBillFormat(reportCode).then(setBillFormat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (embeddedModify && editVoucherId) return
    resetPendingBillNo()
  }, [voucherDate, embeddedModify, editVoucherId, resetPendingBillNo])

  const onBillFormatChange = useCallback(
    (next: string) => {
      setBillFormat(normalizeBillFormat(next))
      void saveBillFormat(reportCode, next)
    },
    [reportCode],
  )

  const changePreviewFormat = useCallback(
    async (format: string) => {
      const fmt = normalizeBillFormat(format)
      setBillFormat(fmt)
      void saveBillFormat(reportCode, fmt)
      if (!preview?.voucherId && !preview?.billNo) return
      try {
        const html = preview.voucherId
          ? await api.getReportHtml(`/reports/sale-bill/${preview.voucherId}`, { format: fmt })
          : await api.getReportHtml(`/reports/sale-bill/by-no/${preview.billNo}`, {
              voucher_type: voucherType,
              format: fmt,
            })
        setPreview((prev) => (prev ? { ...prev, html } : prev))
      } catch (err) {
        alert(err instanceof ApiError ? err.message : 'Failed to load format')
      }
    },
    [preview, reportCode, voucherType],
  )

  const lineRows = useMemo(
    () =>
      items.map((it) => {
        const amts = lineAmounts(it, taxInclusive)
        return { it, ...amts }
      }),
    [items, taxInclusive],
  )

  const taxableTotal = useMemo(() => round2(lineRows.reduce((s, r) => s + r.taxable, 0)), [lineRows])
  const taxTotal = useMemo(() => round2(lineRows.reduce((s, r) => s + r.gstAmt, 0)), [lineRows])
  const grossTotal = useMemo(
    () => round2(lineRows.reduce((s, r) => s + r.amount, 0)),
    [lineRows],
  )
  const netTotal = useMemo(
    () => round2(Math.max(grossTotal - adjustAdvance, 0)),
    [grossTotal, adjustAdvance],
  )

  useEffect(() => {
    if (paymentsDirty || paymentModes.length === 0) return
    const cash = paymentModes.find((m) => m.is_cash) ?? paymentModes[0]
    setPayAmounts(
      Object.fromEntries(paymentModes.map((m) => [m.id, m.id === cash.id ? netTotal : 0])),
    )
  }, [netTotal, paymentsDirty, paymentModes])

  const paidTotal = useMemo(() => {
    let total = 0
    for (const mode of paymentModes) {
      if (mode.is_credit) continue
      total += payAmounts[mode.id] || 0
    }
    return round2(total)
  }, [paymentModes, payAmounts])

  const balance = round2(netTotal - paidTotal)
  const receivable = round2(netTotal + oldBalance)

  const resolveEntry = useCallback(
    async (text?: string, after: 'name' | 'qty' | 'add' = 'name') => {
      const raw = (text ?? entryText).trim()
      if (!raw) return
      const scanned = isScannedBarcode(raw) || after === 'add'
      let product: Product | null = null
      let stockBarcodeId: string | null = null
      let lotId: string | null = null
      let barcodeRemaining = 0
      let qty = Number(cfg.default_qty || 1)
      let rate = 0
      let mrpOverride: number | null = null
      if (uniqueBarcodeStock) {
        try {
          const bc = await api.get<{
            id: string
            barcode: string
            product_id: string
            product_name?: string
            qty_remaining: number
            ask_qty: boolean
            sale_rate: number
            mrp: number
            status: string
            lot_id?: string | null
          }>('/stock/barcodes/lookup', { q: raw })
          const remaining = Number(bc.qty_remaining || 0)
          if (remaining <= 0 || bc.status === 'sold' || bc.status === 'transferred' || bc.status === 'returned') {
            alert(
              bc.status === 'transferred'
                ? `Barcode ${bc.barcode} is transferred.`
                : `Barcode ${bc.barcode} is already sold.`,
            )
            return
          }
          qty = 1
          if (bc.ask_qty) {
            const entered = window.prompt(
              `Barcode ${bc.barcode} · ${bc.product_name || ''}\nAvailable ${remaining}. Enter quantity to sell:`,
              '1',
            )
            if (entered == null) return
            qty = Number(entered)
            if (!Number.isFinite(qty) || qty <= 0) {
              alert('Quantity must be greater than zero.')
              return
            }
            if (qty > remaining + 1e-9) {
              alert(`Only ${remaining} left on this barcode.`)
              return
            }
          }
          product = await api.get<Product>(`/products/${bc.product_id}`)
          rate = Number(bc.sale_rate || 0) > 0 ? Number(bc.sale_rate) : productRate(product, true)
          mrpOverride = Number(bc.mrp || 0)
          stockBarcodeId = bc.id
          lotId = bc.lot_id || null
          barcodeRemaining = remaining
        } catch (err) {
          if (err instanceof ApiError && err.statusCode !== 404) {
            alert(err.message)
            return
          }
        }
      }
      if (!product) {
        try {
          product = await api.get<Product>('/products/lookup', { q: raw })
        } catch {
          product = null
        }
      }
      if (!product) {
        setEntryName('Not found')
        setCurrentProduct(null)
        return
      }
      if (!stockBarcodeId) {
        rate = productRate(product, scanned)
        qty = Number(cfg.default_qty || 1)
      }
      const addLine = () => {
        const hit = checkSaleCeiling({
          rate,
          discPct: billDiscPct,
          salePrice: productListPrice(product),
          maxDiscountPct: Number(product.max_discount_pct || 0),
        })
        if (!hit.ok) {
          alert(hit.message)
          return
        }
        const gstHit = resolveGstFromProduct(
          product,
          rate,
          Number(product.gst_id ? gstById[product.gst_id]?.rate ?? 0 : 0),
          product.gst_id,
        )
        setItems((prev) => {
          if (stockBarcodeId) {
            const used = prev
              .filter((it) => it.stock_barcode_id === stockBarcodeId)
              .reduce((sum, it) => sum + Number(it.qty || 0), 0)
            if (used + qty > barcodeRemaining + 1e-9) {
              alert(`Only ${barcodeRemaining} left on this barcode.`)
              return prev
            }
          } else if (!allowNegativeStock && !editVoucherId) {
            const stock = Number(product.current_stock || 0)
            const needed = billQtyForProduct(prev, product.id) + qty
            if (needed > stock + 1e-9) {
              alert(stockShortMsg(String(product.name || product.code || 'item'), stock, needed))
              return prev
            }
          }
          return [
            ...prev,
            {
              product_id: product.id,
              code: product.code,
              name: product.name,
              qty,
              rate,
              mrp: mrpOverride != null && mrpOverride > 0 ? mrpOverride : Number(product.mrp || 0),
              stock_barcode_id: stockBarcodeId,
              lot_id: lotId,
              sale_price: productListPrice(product),
              max_discount_pct: Number(product.max_discount_pct || 0),
              disc_pct: billDiscPct,
              gst_id: gstHit.gst_id,
              gst_rate: gstHit.gst_rate,
              tax_slabs: product.tax_slabs || null,
              stock: Number(product.current_stock || 0),
            },
          ]
        })
        setCurrentProduct(null)
        setEntryText('')
        setEntryName('—')
        entryRef.current?.focus()
      }
      if (scanned || stockBarcodeId) {
        addLine()
        return
      }
      setCurrentProduct(product)
      setEntryText(String(product.code || ''))
      setEntryName(String(product.name || ''))
      setQtyIn(qty)
      setRateIn(rate)
      setDiscIn(billDiscPct)
      afterPaint(() => {
        if (after === 'name' && focusAndSelect(nameRef.current)) return
        if (cfg.enable_qty && focusAndSelect(qtyRef.current)) return
        if (cfg.enable_rate && focusAndSelect(rateRef.current)) return
        if (cfg.enable_discount && focusAndSelect(discRef.current)) return
        addLine()
      })
    },
    [entryText, cfg, billDiscPct, gstById, productRate, productListPrice, uniqueBarcodeStock],
  )

  const setEntryFieldsEnabled = currentProduct !== null && entryName !== '—'

  const resetEntry = useCallback(() => {
    setCurrentProduct(null)
    setEntryText('')
    setEntryName('—')
    setQtyIn(Number(cfg.default_qty || 1))
    setRateIn(0)
    setDiscIn(billDiscPct)
    entryRef.current?.focus()
  }, [cfg.default_qty, billDiscPct])

  const addCurrent = useCallback(() => {
    let product = currentProduct
    if (!product) {
      resolveEntry()
      return
    }
    const qty = cfg.enable_qty ? qtyIn : Number(cfg.default_qty || 1)
    if (qty <= 0) {
      alert('Quantity must be greater than zero.')
      return
    }
    const rate = cfg.enable_rate ? rateIn : productRate(product)
    const discPct = cfg.enable_discount ? discIn : billDiscPct
    const hit = checkSaleCeiling({
      rate,
      discPct,
      salePrice: productListPrice(product),
      maxDiscountPct: Number(product.max_discount_pct || 0),
    })
    if (!hit.ok) {
      alert(hit.message)
      return
    }
    const gstHit = resolveGstFromProduct(
      product,
      rate,
      Number(product.gst_id ? gstById[product.gst_id]?.rate ?? 0 : 0),
      product.gst_id,
    )
    setItems((prev) => {
      if (!allowNegativeStock && !editVoucherId) {
        const stock = Number(product.current_stock || 0)
        const needed = billQtyForProduct(prev, product.id) + qty
        if (needed > stock + 1e-9) {
          alert(stockShortMsg(String(product.name || product.code || 'item'), stock, needed))
          return prev
        }
      }
      return [
        ...prev,
        {
          product_id: product!.id,
          code: product!.code,
          name: entryName.trim() && entryName !== '—' ? entryName.trim() : product!.name,
          qty,
          rate,
          mrp: Number(product.mrp || 0),
          sale_price: productListPrice(product),
          max_discount_pct: Number(product.max_discount_pct || 0),
          disc_pct: discPct,
          gst_id: gstHit.gst_id,
          gst_rate: gstHit.gst_rate,
          tax_slabs: product.tax_slabs || null,
          stock: Number(product.current_stock || 0),
        },
      ]
    })
    resetEntry()
  }, [
    currentProduct,
    entryName,
    resolveEntry,
    cfg,
    qtyIn,
    rateIn,
    discIn,
    billDiscPct,
    gstById,
    productRate,
    productListPrice,
    resetEntry,
    allowNegativeStock,
    editVoucherId,
  ])

  const applyBillDiscount = (pct: number) => {
    const blocked = items.find((it) => {
      const hit = checkSaleCeiling({
        rate: it.rate,
        discPct: pct,
        salePrice: Number(it.sale_price || 0),
        maxDiscountPct: it.max_discount_pct,
      })
      return !hit.ok
    })
    if (blocked) {
      const hit = checkSaleCeiling({
        rate: blocked.rate,
        discPct: pct,
        salePrice: Number(blocked.sale_price || 0),
        maxDiscountPct: blocked.max_discount_pct,
      })
      alert(hit.message || 'Discount is outside the allowed range.')
      return
    }
    setBillDiscPct(pct)
    setItems((prev) => prev.map((it) => ({ ...it, disc_pct: pct })))
  }

  const selectCustomer = useCallback(async (cust: Party, opts?: { fillMobile?: boolean }) => {
    const fillMobile = opts?.fillMobile !== false
    setSelectedCustomer(cust)
    setCustomerText(cust.name || '')
    setCustId(cust.code || '')
    if (fillMobile) setMobile(cust.phone || '')
    try {
      const details = await api.get<{ closing_balance?: number | string }>(
        '/reports/debtor-details',
        { party_id: cust.id },
      )
      const bal = Number(details.closing_balance || 0)
      setOldBalance(bal)
      setOutstanding(`Outstanding: ${fmt(bal)} Dr`)
    } catch {
      setOldBalance(0)
      setOutstanding('Outstanding: —')
    }
    try {
      const dep = await api.get<PartyDepositBalance>('/cashbook/party-deposit', {
        party_id: cust.id,
      })
      const adv = Number(dep.balance || 0)
      setAdvanceBalance(adv)
      setAdvanceLabel(`Advance: ${fmt(adv)}`)
    } catch {
      setAdvanceBalance(0)
      setAdvanceLabel('Advance: 0.00')
    }
  }, [])

  const resolveCustId = useCallback(() => {
    const raw = custId.trim()
    if (!raw) return
    const match = findCustomerByCode(customers, raw)
    if (match) void selectCustomer(match)
  }, [custId, customers, selectCustomer])

  const resolveMobile = useCallback(() => {
    const digits = phoneDigits(mobile)
    if (!digits) {
      if (selectedCustomer && phoneDigits(selectedCustomer.phone)) {
        setSelectedCustomer(null)
        setOldBalance(0)
        setOutstanding('Outstanding: —')
        setAdvanceBalance(0)
        setAdvanceLabel('Advance: —')
      }
      return
    }
    const match = findCustomerByPhone(customers, mobile)
    if (match) {
      void selectCustomer(match, { fillMobile: false })
      return
    }
    const hadSelected = selectedCustomer != null
    setSelectedCustomer(null)
    setOldBalance(0)
    setOutstanding('Outstanding: New customer')
    setAdvanceBalance(0)
    setAdvanceLabel('Advance: —')
    if (hadSelected) setCustomerText('')
  }, [mobile, customers, selectedCustomer, selectCustomer])

  const resolveCustomer = useCallback(() => {
    if (phoneDigits(mobile)) {
      if (selectedCustomer) return
      if (customerText.trim()) setOutstanding('Outstanding: New customer')
      return
    }
    const text = customerText.trim()
    if (!text) {
      setSelectedCustomer(null)
      setOldBalance(0)
      setOutstanding('Outstanding: —')
      setAdvanceBalance(0)
      setAdvanceLabel('Advance: —')
      return
    }
    const match = custByName[text.toLowerCase()]
    if (match) void selectCustomer(match)
    else {
      setSelectedCustomer(null)
      setOldBalance(0)
      setOutstanding('Outstanding: New customer')
    }
  }, [customerText, custByName, selectCustomer, mobile, selectedCustomer])

  const ensureCustomerForCredit = useCallback(async (): Promise<Party | null> => {
    if (selectedCustomer) return selectedCustomer
    const byCode = findCustomerByCode(customers, custId)
    if (byCode) {
      setSelectedCustomer(byCode)
      return byCode
    }
    if (phoneDigits(mobile)) {
      const byPhone = findCustomerByPhone(customers, mobile)
      if (byPhone) {
        setSelectedCustomer(byPhone)
        return byPhone
      }
    }
    const text = customerText.trim()
    if (!text) return null
    const match = custByName[text.toLowerCase()]
    if (match) {
      setSelectedCustomer(match)
      return match
    }
    try {
      const cust = await api.post<Party>('/parties/quick', {
        party_type: 'customer',
        name: text,
        phone: mobile.trim() || null,
      })
      setCustomers((prev) => [...prev, cust])
      setSelectedCustomer(cust)
      return cust
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to create customer')
      return null
    }
  }, [selectedCustomer, customerText, custByName, mobile, customers, custId])

  const openPrintPreview = useCallback(async (
    voucherId: string,
    voucherNo?: string | null,
    fallback?: Voucher | null,
  ) => {
    try {
      const html = await api.getReportHtml(`/reports/sale-bill/${voucherId}`, { format: billFormat })
      setPreview({
        title: `${mode.heading} ${voucherNo || ''} Preview`.trim(),
        html,
        reportCode,
        voucherId,
      })
    } catch (err) {
      if (fallback) {
        setPreview({
          title: `${mode.heading} ${voucherNo || ''} Preview`.trim(),
          html: fallbackBillHtml(mode.heading, fallback),
          reportCode,
          voucherId,
        })
        return
      }
      alert(err instanceof ApiError ? err.message : 'Failed to load preview')
    }
  }, [mode.heading, reportCode, billFormat])

  const clearBill = useCallback(() => {
    setItems([])
    setPaymentsDirty(false)
    setSelectedCustomer(null)
    setOldBalance(0)
    setAdvanceBalance(0)
    setAdjustAdvance(0)
    setCurrentProduct(null)
    setEditId(null)
    setCustomerText('')
    setCustId('')
    setMobile('')
    setNarration('')
    setBillDiscPct(0)
    setOutstanding('Outstanding: —')
    setAdvanceLabel('Advance: —')
    setVoucherDate(todayISO())
    setPayAmounts(Object.fromEntries(paymentModes.map((m) => [m.id, 0])))
    setPayDocs(Object.fromEntries(paymentModes.map((m) => [m.id, ''])))
    setEntryText('')
    setEntryName('—')
    setQtyIn(Number(cfg.default_qty || 1))
    setRateIn(0)
    setDiscIn(0)
    resetPendingBillNo()
    entryRef.current?.focus()
  }, [paymentModes, cfg.default_qty, resetPendingBillNo, setEditId])

  const save = useCallback(async () => {
    if (!items.length) {
      alert('Add at least one item.')
      return
    }
    const paid = paidTotal
    const bal = round2(netTotal - paid)
    let customer: Party | null = null
    if (bal > 0.005) {
      customer = await ensureCustomerForCredit()
      if (!customer) {
        alert('This bill is not fully paid. Enter a customer name for the credit balance.')
        return
      }
    } else if (bal < -0.005) {
      alert('Paid amount is more than the bill total.')
      return
    } else {
      customer = await ensureCustomerForCredit()
    }
    if (adjustAdvance > 0.005 && !customer) {
      alert('Customer is required when adjusting advance.')
      return
    }
    if (adjustAdvance > advanceBalance + 0.01) {
      alert(`Adjust advance cannot exceed available balance (${fmt(advanceBalance)}).`)
      return
    }

    const payload = {
      voucher_type: voucherType,
      voucher_date: voucherDate,
      party_id: customer?.id ?? null,
      narration: narration.trim() || null,
      discount_amount: 0,
      adjust_advance: round2(adjustAdvance),
      items: items.map((it) => ({
        product_id: it.product_id,
        quantity: it.qty,
        rate: it.rate,
        mrp: Number(it.mrp || 0),
        sale_price: Number(it.sale_price || 0),
        discount_amount: round2((it.qty * it.rate * it.disc_pct) / 100),
        gst_id: it.gst_id,
        lot_id: it.lot_id || null,
        stock_barcode_id: it.stock_barcode_id || null,
      })),
      payments: paymentModes
        .map((m) => ({
          payment_mode_id: m.id,
          amount: payAmounts[m.id] || 0,
          reference: (payDocs[m.id] || '').trim() || null,
        }))
        .filter((p) => p.amount > 0),
    }

    setBusy(true)
    setError('')
    try {
      const result = editVoucherId
        ? await api.put<Voucher>(`/vouchers/${editVoucherId}`, payload)
        : await api.post<Voucher>('/vouchers', payload)
      const voucherId = result.id
      const voucherNo = result.voucher_no
      if (editVoucherId) {
        alert(`Bill ${voucherNo} updated.\nNet: ${fmt(Number(result.net_amount || 0))}`)
        if (voucherId) await openPrintPreview(voucherId, voucherNo, result)
        return
      }
      if (voucherId) await openPrintPreview(voucherId, voucherNo, result)
      alert(
        `Bill ${voucherNo} saved.\nNet: ${fmt(Number(result.net_amount || 0))}\nPreview opened — print from the preview window.`,
      )
      clearBill()
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }, [
    items,
    paidTotal,
    netTotal,
    ensureCustomerForCredit,
    voucherDate,
    narration,
    paymentModes,
    payAmounts,
    payDocs,
    editVoucherId,
    openPrintPreview,
    clearBill,
    adjustAdvance,
    advanceBalance,
  ])

  const loadVoucherForEdit = useCallback(
    (voucher: Voucher) => {
      if (voucher.is_cancelled) {
        alert('This bill is cancelled and cannot be modified.')
        return
      }
      setEditId(voucher.id)
      setBillNo(String(voucher.voucher_no || '—'))
      setLastNo('Modify mode')
      if (voucher.voucher_date) setVoucherDate(String(voucher.voucher_date).slice(0, 10))
      if (voucher.party_id) {
        const known = customers.find((c) => c.id === voucher.party_id)
        if (known) {
          void selectCustomer(known)
        } else {
          setSelectedCustomer({
            id: voucher.party_id,
            name: voucher.party_name || '',
          })
          setCustomerText(voucher.party_name || '')
          setCustId('')
          setMobile('')
        }
      } else {
        setSelectedCustomer(null)
        setCustomerText(voucher.party_name || '')
        setCustId('')
        setMobile('')
      }
      setNarration(voucher.narration || '')
      setAdjustAdvance(Number(voucher.adjust_advance || 0))
      const loaded: BillLine[] = []
      for (const it of voucher.items || []) {
        const qty = Number(it.quantity || 0)
        const rate = Number(it.rate || 0)
        const discAmt = Number(it.discount_amount || 0)
        const gross = qty * rate
        const discPct = gross > 0 ? round2((discAmt / gross) * 100) : 0
        // keep 4-decimal precision like desktop for modify
        const disc_pct = gross > 0 ? Math.round((discAmt / gross) * 1000000) / 10000 : 0
        loaded.push({
          product_id: it.product_id,
          code: '',
          name: it.product_name || '',
          qty,
          rate,
          mrp: Number(it.mrp || 0),
          sale_price: Number(it.sale_price || 0),
          max_discount_pct: Number(it.max_discount_pct || 0),
          disc_pct: disc_pct || discPct,
          gst_id: it.gst_id,
          gst_rate: Number(it.gst_rate || 0),
          lot_id: it.lot_id || null,
          stock_barcode_id: it.stock_barcode_id || null,
        })
      }
      setItems(loaded)
      if (loaded.length) setBillDiscPct(loaded[0].disc_pct)
      const payMap: Record<string, number> = {}
      const docMap: Record<string, string> = {}
      for (const p of voucher.payments || []) {
        payMap[p.payment_mode_id] = Number(p.amount || 0)
        docMap[p.payment_mode_id] = String(p.reference || '')
      }
      setPaymentsDirty(true)
      setPayAmounts(Object.fromEntries(paymentModes.map((m) => [m.id, payMap[m.id] || 0])))
      setPayDocs(Object.fromEntries(paymentModes.map((m) => [m.id, docMap[m.id] || ''])))
    },
    [paymentModes, setEditId, customers, selectCustomer],
  )

  const printCurrent = useCallback(async () => {
    if (editVoucherId) {
      await openPrintPreview(editVoucherId, billNo !== '—' ? billNo : null)
      return
    }
    if (billNo && billNo !== '—') {
      try {
        const html = await api.getReportHtml(`/reports/sale-bill/by-no/${billNo}`, {
          voucher_type: voucherType,
          format: billFormat,
        })
        setPreview({ title: `${mode.heading} Print`, html, reportCode, billNo })
      } catch (err) {
        alert(err instanceof ApiError ? err.message : 'Print failed')
      }
    }
  }, [editVoucherId, billNo, openPrintPreview, voucherType, mode.heading, billFormat, reportCode])

  useEffect(() => {
    if (loadVoucherRef) loadVoucherRef.current = loadVoucherForEdit
    if (printRef) printRef.current = () => void printCurrent()
  }, [loadVoucherRef, printRef, loadVoucherForEdit, printCurrent])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F9') {
        e.preventDefault()
        void save()
      } else if (e.key === 'F5') {
        e.preventDefault()
        clearBill()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, clearBill])

  const openCustomerDetails = useCallback(async () => {
    if (selectedCustomer?.id) {
      setPartyForm(partyToForm(selectedCustomer))
      setPartyEditId(selectedCustomer.id)
      setShowCustomerDlg(true)
      try {
        const full = await api.get<Party>(`/parties/${selectedCustomer.id}`)
        setPartyForm(partyToForm(full))
        setPartyEditId(full.id)
      } catch {
        /* keep the local customer copy already shown */
      }
      return
    }
    setPartyForm(
      emptyPartyForm({
        name: customerText.trim(),
        phone: mobile,
        is_customer: true,
        is_vendor: false,
      }),
    )
    setPartyEditId(null)
    setShowCustomerDlg(true)
  }, [selectedCustomer, customerText, mobile])

  const saveCustomerDetails = async () => {
    if (!partyForm.name.trim()) {
      alert('Customer name is required.')
      return
    }
    if (!partyForm.is_customer && !partyForm.is_vendor) {
      alert('Select Customer, Supplier, or both.')
      return
    }
    try {
      const cust = await savePartyRecord(partyForm, partyEditId)
      setCustomers((prev) => {
        const rest = prev.filter((c) => c.id !== cust.id)
        return [...rest, cust]
      })
      setShowCustomerDlg(false)
      await selectCustomer(cust)
    } catch (err) {
      alert(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to save customer')
    }
  }

  const updateLine = (row: number, field: 'qty' | 'rate' | 'disc_pct' | 'amount', raw: string) => {
    const val = parseNum(raw)
    setItems((prev) => {
      const next = [...prev]
      const it = { ...next[row] }
      if (field === 'qty') {
        if (val <= 0) {
          alert('Quantity must be greater than zero.')
          return prev
        }
        if (!allowNegativeStock && !editVoucherId) {
          const stock = Number(it.stock ?? 0)
          const needed = billQtyForProduct(prev, it.product_id, row) + val
          if (needed > stock + 1e-9) {
            alert(stockShortMsg(String(it.name || it.code || 'item'), stock, needed))
            return prev
          }
        }
        it.qty = val
      } else if (field === 'rate') {
        const hit = checkSaleCeiling({
          rate: val,
          discPct: it.disc_pct,
          salePrice: Number(it.sale_price || 0),
          maxDiscountPct: it.max_discount_pct,
        })
        if (!hit.ok) {
          alert(hit.message)
          return prev
        }
        it.rate = val
        const gstHit = resolveGstFromProduct(
          { tax_slabs: it.tax_slabs, gst_id: it.gst_id },
          val,
          it.gst_rate,
          it.gst_id,
        )
        it.gst_rate = gstHit.gst_rate
        it.gst_id = gstHit.gst_id
      } else if (field === 'disc_pct') {
        const nextDisc = Math.max(0, Math.min(val, 100))
        const hit = checkSaleCeiling({
          rate: it.rate,
          discPct: nextDisc,
          salePrice: Number(it.sale_price || 0),
          maxDiscountPct: it.max_discount_pct,
        })
        if (!hit.ok) {
          alert(hit.message)
          return prev
        }
        it.disc_pct = nextDisc
      } else {
        const nextDisc = discFromNetAmount(it, val, taxInclusive)
        const hit = checkSaleCeiling({
          rate: it.rate,
          discPct: nextDisc,
          salePrice: Number(it.sale_price || 0),
          maxDiscountPct: it.max_discount_pct,
        })
        if (!hit.ok) {
          alert(hit.message)
          return prev
        }
        it.disc_pct = nextDisc
      }
      next[row] = it
      return next
    })
  }

  return (
    <div className={embeddedModify ? 'sale-bill' : 'sale-bill sale-bill-screen'}>
      {error && <div className="error-banner">{error}</div>}

      <div className="sb-row">
        <span className="field-label">Bill No</span>
        <span className="sb-bill-no" title="The bill number is created only when you save, so unused drafts never skip a number.">
          {billNo}
        </span>
        <span className="field-label">Date</span>
        <input
          className="input"
          type="date"
          value={voucherDate}
          onChange={(e) => setVoucherDate(e.target.value)}
        />
        <div className="sb-title">
          {mode.heading}
          <span className="sb-tax-mode">{taxInclusive ? 'Inclusive' : 'Exclusive'}</span>
        </div>
        <span className="field-label">Disc %</span>
        <input
          className="input"
          type="number"
          min={0}
          max={100}
          step={0.01}
          value={billDiscPct}
          style={{ maxWidth: 100 }}
          onFocus={(e) => e.target.select()}
          onChange={(e) => applyBillDiscount(Number(e.target.value) || 0)}
        />
        <span className="sb-hint">{lastNo}</span>
        <BillFormatSelect value={billFormat} onChange={onBillFormatChange} documentCode={reportCode} />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {editVoucherId ? 'F9 — Update' : 'F9 — Save'}
        </button>
      </div>

      <div className="sb-row">
        <span className="field-label">Cust ID</span>
        <input
          ref={custIdRef}
          className="input"
          value={custId}
          placeholder="1, 2, 3…"
          style={{ maxWidth: 80 }}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setCustId(e.target.value)}
          onBlur={resolveCustId}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              resolveCustId()
              mobileRef.current?.focus()
            }
          }}
        />
        <span className="field-label">Mobile</span>
        <input
          ref={mobileRef}
          className="input"
          value={mobile}
          placeholder="Mobile"
          style={{ maxWidth: 140 }}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setMobile(e.target.value)}
          onBlur={resolveMobile}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              resolveMobile()
              customerRef.current?.focus()
            }
          }}
        />
        <span className="field-label">Customer</span>
        <div className="sb-cust-field">
          <button
            type="button"
            className="sb-plus-btn"
            title={selectedCustomer ? 'Customer details' : 'Add customer details'}
            aria-label={selectedCustomer ? 'Open customer details' : 'Add customer details'}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void openCustomerDetails()
            }}
          >
            +
          </button>
          {phoneDigits(mobile) ? (
            <input
              ref={customerRef}
              className="input"
              value={customerText}
              placeholder="Customer name"
              onFocus={(e) => e.target.select()}
              onChange={(e) => setCustomerText(e.target.value)}
              onBlur={resolveCustomer}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  resolveCustomer()
                  narrationRef.current?.focus()
                }
              }}
            />
          ) : (
            <Typeahead
              value={customerText}
              onChange={setCustomerText}
              items={customers}
              getLabel={(c) => c.name}
              placeholder="Walk-in / search name"
              onSelect={(c) => void selectCustomer(c)}
              inputRef={customerRef}
              onEnter={() => {
                resolveCustomer()
                narrationRef.current?.focus()
              }}
            />
          )}
        </div>
        <span className="field-label">Narration</span>
        <input
          ref={narrationRef}
          className="input"
          value={narration}
          style={{ flex: 1, minWidth: 120 }}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setNarration(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              entryRef.current?.focus()
            }
          }}
        />
      </div>

      <div className="sb-entry">
        <span className="field-label">Barcode / Item</span>
        <Typeahead
          inputRef={entryRef}
          value={entryText}
          onChange={setEntryText}
          searchItems={searchProducts}
          getLabel={productLabel}
          getKey={(p) => p.id}
          pickExact={pickExactProduct}
          placeholder="Code, name or barcode → Enter"
          onSelect={(p) => {
            const typed = entryText.trim()
            void resolveEntry(
              isScannedBarcode(typed) ? typed : String(p.code || p.barcode || ''),
              isScannedBarcode(typed) ? 'add' : 'name',
            )
          }}
          onEnter={() => {
            if (currentProduct && entryName !== '—') {
              if (focusAndSelect(nameRef.current)) return
              if (cfg.enable_qty && focusAndSelect(qtyRef.current)) return
              if (cfg.enable_rate && focusAndSelect(rateRef.current)) return
              addCurrent()
            } else void resolveEntry()
          }}
        />
        <span className="field-label">Product</span>
        <input
          ref={nameRef}
          className="input sb-entry-name"
          value={entryName === '—' ? '' : entryName}
          placeholder="Product name"
          disabled={!setEntryFieldsEnabled}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setEntryName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const typed = entryName.trim()
            const sameName =
              currentProduct &&
              typed.toLowerCase() === String(currentProduct.name || '').trim().toLowerCase()
            if (!sameName && typed) {
              void resolveEntry(typed, 'qty')
              return
            }
            if (cfg.enable_qty && focusAndSelect(qtyRef.current)) return
            if (cfg.enable_rate && focusAndSelect(rateRef.current)) return
            addCurrent()
          }}
        />
        <span className="field-label">Qty</span>
        <input
          ref={qtyRef}
          className="input"
          type="number"
          step={0.001}
          style={{ maxWidth: 96 }}
          value={qtyIn}
          disabled={!setEntryFieldsEnabled || !cfg.enable_qty}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setQtyIn(Number(e.target.value) || 0)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (cfg.enable_rate && focusAndSelect(rateRef.current)) return
              addCurrent()
            }
          }}
        />
        <span className="field-label">Rate</span>
        <input
          ref={rateRef}
          className="input"
          type="number"
          step={0.01}
          style={{ maxWidth: 96 }}
          value={rateIn}
          disabled={!setEntryFieldsEnabled || !cfg.enable_rate}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setRateIn(Number(e.target.value) || 0)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addCurrent()
            }
          }}
        />
        <span className="field-label">Disc%</span>
        <input
          ref={discRef}
          className="input"
          type="number"
          step={0.01}
          max={100}
          style={{ maxWidth: 96 }}
          value={discIn}
          disabled={!setEntryFieldsEnabled || !cfg.enable_discount}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDiscIn(Number(e.target.value) || 0)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addCurrent()
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!setEntryFieldsEnabled}
          onClick={addCurrent}
        >
          Add
        </button>
      </div>

      <div className="sb-body">
        <div className="sb-items">
          <div className="sb-table-wrap">
            <table className="sb-table">
              <thead>
                <tr>
                  {ITEM_COLS.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lineRows.map((row, r) => (
                  <tr
                    key={`${row.it.product_id}-${r}`}
                    className={selectedRow === r ? 'selected' : ''}
                    onClick={() => setSelectedRow(r)}
                  >
                    <td>{r + 1}</td>
                    <td>{row.it.code}</td>
                    <td>{row.it.name}</td>
                    <td>
                      <EditableNum
                        value={row.it.qty}
                        decimals={3}
                        onCommit={(n) => updateLine(r, 'qty', String(n))}
                      />
                    </td>
                    <td>
                      <EditableNum
                        value={row.it.rate}
                        onCommit={(n) => updateLine(r, 'rate', String(n))}
                      />
                    </td>
                    <td>
                      <EditableNum
                        value={row.it.disc_pct}
                        onCommit={(n) => updateLine(r, 'disc_pct', String(n))}
                      />
                    </td>
                    <td className="num">{fmt(row.it.gst_rate, 0)}</td>
                    <td className="num">{fmt(row.taxable)}</td>
                    <td className="num">{fmt(row.gstAmt)}</td>
                    <td>
                      <EditableNum
                        value={row.amount}
                        onCommit={(n) => updateLine(r, 'amount', String(n))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sb-item-totals">
            <div className="sb-actions">
              <button type="button" className="btn" onClick={() => {
                if (selectedRow >= 0 && selectedRow < items.length) {
                  setItems((prev) => prev.filter((_, i) => i !== selectedRow))
                  setSelectedRow(-1)
                }
              }}>
                Remove
              </button>
            </div>
            <div className="sb-totals-chips">
              <span className="sb-chip info">{advanceLabel}</span>
              <span className="sb-chip info">{outstanding}</span>
              <span className="field-label">Adjust Advance</span>
              <input
                className="input"
                type="number"
                min={0}
                step={0.01}
                style={{ maxWidth: 120 }}
                value={adjustAdvance}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0)
                  setAdjustAdvance(v)
                  setPaymentsDirty(false)
                }}
              />
              <span className="sb-chip">Gross: {fmt(taxableTotal)}</span>
              <span className="sb-chip">Tax: {fmt(taxTotal)}</span>
              <span className="sb-chip net">Net: {fmt(netTotal)}</span>
            </div>
          </div>
        </div>

        <div className="sb-pay">
          <h3>PAYMENT MODE</h3>
          <div className="sb-table-wrap" style={{ flex: 1, minHeight: 120 }}>
            <table className="sb-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Amount</th>
                  <th>Document</th>
                </tr>
              </thead>
              <tbody>
                {paymentModes.map((mode) => (
                  <tr key={mode.id}>
                    <td>{mode.name}</td>
                    <td>
                      <EditableNum
                        value={payAmounts[mode.id] || 0}
                        onCommit={(n) => {
                          setPaymentsDirty(true)
                          setPayAmounts((prev) => ({ ...prev, [mode.id]: n }))
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="sb-pay-doc"
                        value={payDocs[mode.id] || ''}
                        placeholder="Cheque / UPI"
                        onChange={(e) => {
                          setPaymentsDirty(true)
                          setPayDocs((prev) => ({ ...prev, [mode.id]: e.target.value }))
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sb-summary" style={{ borderColor: 'var(--info)' }}>
            <div className="sb-summary-cap" style={{ color: 'var(--info)' }}>
              Net sales amount
            </div>
            <div className="sb-summary-val">{fmt(netTotal)}</div>
          </div>
          <div className="sb-summary plain">
            <div className="sb-summary-cap">Old balance</div>
            <div className="sb-summary-val">{fmt(oldBalance)}</div>
          </div>
          <div className="sb-summary brand">
            <div className="sb-summary-cap" style={{ color: 'var(--brand)' }}>
              Net receivable
            </div>
            <div className="sb-summary-val">{fmt(receivable)}</div>
          </div>
          <div className="sb-paid">Paid: {fmt(paidTotal)}</div>
          <div className="sb-balance">Balance: {fmt(balance)}</div>
        </div>
      </div>

      {showCustomerDlg &&
        createPortal(
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={() => setShowCustomerDlg(false)}
          >
            <div
              className="modal party-modal party-enter-root"
              role="dialog"
              aria-modal="true"
              aria-label={partyEditId ? 'Customer details' : 'New customer'}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => handleEnterAsTab(e, e.currentTarget)}
            >
              <h2>{partyEditId ? 'Customer details' : 'New customer'}</h2>
              <PartyDetailsForm form={partyForm} onChange={setPartyForm} />
              <div className="modal-actions">
                <button type="button" className="btn" data-skip-enter="true" onClick={() => setShowCustomerDlg(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void saveCustomerDetails()}>
                  {partyEditId ? 'Update' : 'Save'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {preview && (
        <PrintPreview
          title={preview.title}
          html={preview.html}
          reportCode={preview.reportCode}
          billFormat={billFormat}
          onBillFormatChange={(fmt) => void changePreviewFormat(fmt)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}
