import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, ApiError } from '../../api/client'
import { PrintPreview } from '../../components/generp/PrintPreview'
import { Typeahead } from '../../components/generp/Typeahead'
import { useMenuOverlay } from '../../components/generp/MenuOverlay'
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
import { ExportFormatButtons } from '../../components/generp/ExportFormatButtons'
import { downloadExcel, SPREADSHEET_ACCEPT, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { saveBarcodeBatch } from '../../lib/generp/barcodeBatch'
import {
  profitPctFromLast,
  profitPctFromSale,
  salePriceFromProfit,
} from '../../lib/generp/purchasePricing'
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
  PaymentMode,
  Product,
  PurchaseImportPreview,
  Voucher,
} from '../../generpTypes'

type PendingPurchase = {
  id: string
  voucher_no: string
  voucher_date: string
  party_name?: string | null
  party_bill_no?: string | null
}

const ITEM_COLS_FULL = ['#', 'Code', 'Product', 'Qty', 'Rate', 'Profit %', 'Sale Price', 'MRP', 'Disc%', 'GST%', 'Taxable', 'GST', 'Amount'] as const
const ITEM_COLS_QTY = ['#', 'Code', 'Product', 'Qty'] as const
const TEMPLATE_HEADERS = ['Code', 'Product', 'Qty', 'Rate', 'Profit %', 'Sale Price', 'MRP', 'Disc%', 'GST%']
const REPORT_CODE = 'PURCHASE_BILL'

function fallbackBillHtml(voucher: Voucher): string {
  const lines = (voucher.items || [])
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${it.product_name || ''}</td><td align="right">${Number(it.quantity || 0)}</td><td align="right">${Number(it.rate || 0).toFixed(2)}</td><td align="right">${Number(it.gst_rate || 0)}</td></tr>`,
    )
    .join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill</title>
  <style>body{font-family:Times New Roman,serif;font-weight:bold}table{width:100%;border-collapse:collapse}td{border:1px solid #000;padding:4px}</style></head>
  <body><h2>Purchase Bill ${voucher.voucher_no || ''}</h2>
  <p>Date: ${String(voucher.voucher_date || '').slice(0, 10)} · Supplier: ${voucher.party_name || '—'}</p>
  <table><tr><td>#</td><td>Product</td><td>Qty</td><td>Rate</td><td>GST%</td></tr>${lines}</table>
  <p>Net: ${Number(voucher.net_amount || 0).toFixed(2)}</p></body></html>`
}

function phoneDigits(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '')
}

function findPartyByPhone(parties: Party[], phone: string): Party | null {
  const digits = phoneDigits(phone)
  if (!digits) return null
  const exact = parties.find((c) => phoneDigits(c.phone) === digits)
  if (exact) return exact
  if (digits.length >= 10) {
    const tail = digits.slice(-10)
    return (
      parties.find((c) => {
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

function findPartyByCode(parties: Party[], code: string): Party | null {
  const wanted = normalizePartyCode(code)
  if (!wanted) return null
  return parties.find((c) => normalizePartyCode(c.code) === wanted) ?? null
}

function focusAndSelect(el: HTMLInputElement | null | undefined) {
  if (!el || el.disabled) return false
  el.focus()
  el.select()
  return true
}

function afterPaint(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn))
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
  embeddedModify?: boolean
  onEditIdChange?: (id: string | null) => void
  loadVoucherRef?: React.MutableRefObject<((v: Voucher) => void) | null>
}

export function PurchaseBillPage({
  embeddedModify = false,
  onEditIdChange,
  loadVoucherRef,
}: Props = {}) {
  const { openOverlay } = useMenuOverlay()
  const [gstById, setGstById] = useState<Record<string, GstRate>>({})
  const [vendors, setVendors] = useState<Party[]>([])
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([])

  const [billNo, setBillNo] = useState('—')
  const [lastNo, setLastNo] = useState('Assigned when you save')
  const [voucherDate, setVoucherDate] = useState(todayISO())
  const [billDiscPct, setBillDiscPct] = useState(0)
  const [vendorText, setVendorText] = useState('')
  const [selectedVendor, setSelectedVendor] = useState<Party | null>(null)
  const [suppId, setSuppId] = useState('')
  const [mobile, setMobile] = useState('')
  const [narration, setNarration] = useState('')
  const [partyBillNo, setPartyBillNo] = useState('')
  const [outstanding, setOutstanding] = useState('Outstanding: —')
  const [oldBalance, setOldBalance] = useState(0)
  const [editVoucherId, setEditVoucherId] = useState<string | null>(null)

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<{ title: string; html: string; reportCode?: string; voucherId?: string } | null>(
    null,
  )
  const [billFormat, setBillFormat] = useState(() => readLocalBillFormat(REPORT_CODE))
  const [taxInclusive, setTaxInclusive] = useState(false)
  const [parkingEnabled, setParkingEnabled] = useState(false)
  const [loadedParked, setLoadedParked] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [checkedRows, setCheckedRows] = useState<Record<number, boolean>>({})
  const [pendingRows, setPendingRows] = useState<PendingPurchase[]>([])
  const [showVendorDlg, setShowVendorDlg] = useState(false)
  const [partyEditId, setPartyEditId] = useState<string | null>(null)
  const [partyForm, setPartyForm] = useState<PartyFormState>(EMPTY_PARTY_FORM)

  const entryRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)
  const rateRef = useRef<HTMLInputElement>(null)
  const discRef = useRef<HTMLInputElement>(null)
  const mobileRef = useRef<HTMLInputElement>(null)
  const suppIdRef = useRef<HTMLInputElement>(null)
  const vendorRef = useRef<HTMLInputElement>(null)
  const narrationRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const vendorByName = useMemo(() => {
    const m: Record<string, Party> = {}
    for (const c of vendors) m[String(c.name || '').toLowerCase()] = c
    return m
  }, [vendors])

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

  const qtyOnlyMode = parkingEnabled && !editVoucherId
  const showBarcodeBar = justSaved && items.length > 0 && !qtyOnlyMode

  const productRate = useCallback((p: Product) => Number(p.purchase_price || 0) || 0, [])

  const pricesFromProduct = useCallback((p: Product, rate: number) => {
    const profit = profitPctFromLast(Number(p.purchase_price || 0), Number(p.sale_price || 0))
    const sale = rate > 0 ? salePriceFromProfit(rate, profit) : 0
    return {
      mrp: Number(p.mrp || 0),
      profit_pct: profit,
      sale_price: sale,
    }
  }, [])

  const setEditId = useCallback(
    (id: string | null) => {
      setEditVoucherId(id)
      onEditIdChange?.(id)
    },
    [onEditIdChange],
  )

  const refresh = useCallback(async () => {
    setError('')
    try {
      const [gst, parties, modes, profile] = await Promise.all([
        api.get<GstRate[]>('/gst'),
        api.get<Party[]>('/parties', { party_type: 'vendor' }),
        api.get<PaymentMode[]>('/payment-modes'),
        api.get<CompanyProfile>('/company-profile').catch(() => null),
      ])
      setGstById(Object.fromEntries(gst.map((g) => [g.id, g])))
      setVendors(parties)
      setPaymentModes(modes)
      const parking = profile?.purchase_bill_parking === true
      setParkingEnabled(parking)
      const raw = String(profile?.purchase_tax_mode || 'exclusive')
      setTaxInclusive(raw.toLowerCase() === 'inclusive')
      if (parking) {
        try {
          const pending = await api.get<{ rows: PendingPurchase[] }>(
            '/vouchers/paged',
            {
              voucher_type: 'PURCHASE',
              parked_only: 'true',
              include_cancelled: 'false',
              page: 1,
              page_size: 30,
            },
          )
          setPendingRows(pending.rows || [])
        } catch {
          setPendingRows([])
        }
      } else {
        setPendingRows([])
      }
      if (!paymentsDirty) {
        setPayAmounts(Object.fromEntries(modes.map((m) => [m.id, 0])))
        setPayDocs(Object.fromEntries(modes.map((m) => [m.id, ''])))
      }
      if (!editVoucherId) {
        setBillNo('—')
        setLastNo(embeddedModify ? 'Load a bill to edit' : 'Assigned when you save')
      }
      entryRef.current?.focus()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    }
  }, [paymentsDirty, editVoucherId, embeddedModify])

  useEffect(() => {
    void refresh()
    void loadBillFormat(REPORT_CODE).then(setBillFormat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onBillFormatChange = useCallback((next: string) => {
    setBillFormat(normalizeBillFormat(next))
    void saveBillFormat(REPORT_CODE, next)
  }, [])

  const changePreviewFormat = useCallback(
    async (format: string) => {
      const fmt = normalizeBillFormat(format)
      setBillFormat(fmt)
      void saveBillFormat(REPORT_CODE, fmt)
      if (!preview?.voucherId) return
      try {
        const html = await api.getReportHtml(`/reports/sale-bill/${preview.voucherId}`, { format: fmt })
        setPreview((prev) => (prev ? { ...prev, html } : prev))
      } catch (err) {
        alert(err instanceof ApiError ? err.message : 'Failed to load format')
      }
    },
    [preview],
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
  const netTotal = useMemo(() => round2(lineRows.reduce((s, r) => s + r.amount, 0)), [lineRows])

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
  const payable = round2(netTotal + oldBalance)

  const resolveEntry = useCallback(
    async (text?: string, after: 'name' | 'qty' | 'add' = 'name') => {
      const raw = (text ?? entryText).trim()
      if (!raw) return
      const scanned = isScannedBarcode(raw) || after === 'add'
      let product: Product | null = null
      try {
        product = await api.get<Product>('/products/lookup', { q: raw })
      } catch {
        product = null
      }
      if (!product) {
        setEntryName('Not found')
        setCurrentProduct(null)
        return
      }
      const rate = productRate(product)
      const qty = 1
      const addLine = () => {
        const gstHit = resolveGstFromProduct(
          product,
          rate,
          Number(product.gst_id ? gstById[product.gst_id]?.rate ?? 0 : 0),
          product.gst_id,
        )
        setItems((prev) => [
          ...prev,
          {
            product_id: product.id,
            code: product.code,
            name: product.name,
            qty,
            rate: qtyOnlyMode ? 0 : rate,
            ...pricesFromProduct(product, qtyOnlyMode ? 0 : rate),
            disc_pct: billDiscPct,
            gst_id: gstHit.gst_id,
            gst_rate: gstHit.gst_rate,
            tax_slabs: product.tax_slabs || null,
          },
        ])
        setCurrentProduct(null)
        setEntryText('')
        setEntryName('—')
        entryRef.current?.focus()
      }
      if (scanned) {
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
        if (focusAndSelect(qtyRef.current)) return
        if (!qtyOnlyMode && focusAndSelect(rateRef.current)) return
        addLine()
      })
    },
    [entryText, billDiscPct, gstById, productRate, qtyOnlyMode, pricesFromProduct],
  )

  const setEntryFieldsEnabled = currentProduct !== null && entryName !== '—'

  const resetEntry = useCallback(() => {
    setCurrentProduct(null)
    setEntryText('')
    setEntryName('—')
    setQtyIn(1)
    setRateIn(0)
    setDiscIn(billDiscPct)
    entryRef.current?.focus()
  }, [billDiscPct])

  const addCurrent = useCallback(() => {
    if (!currentProduct) {
      void resolveEntry(undefined, 'add')
      return
    }
    const product = currentProduct
    const qty = Number(qtyIn || 0)
    const rate = Number(rateIn || 0)
    const discPct = Number(discIn || 0)
    if (qty <= 0) {
      alert('Quantity must be greater than zero.')
      return
    }
    const gstHit = resolveGstFromProduct(
      product,
      rate,
      Number(product.gst_id ? gstById[product.gst_id]?.rate ?? 0 : 0),
      product.gst_id,
    )
    setItems((prev) => [
      ...prev,
      {
        product_id: product.id,
        code: product.code,
        name: entryName.trim() && entryName !== '—' ? entryName.trim() : product.name,
        qty,
        rate: qtyOnlyMode ? 0 : rate,
        ...pricesFromProduct(product, qtyOnlyMode ? 0 : rate),
        disc_pct: discPct,
        gst_id: gstHit.gst_id,
        gst_rate: gstHit.gst_rate,
        tax_slabs: product.tax_slabs || null,
      },
    ])
    resetEntry()
  }, [currentProduct, entryName, resolveEntry, qtyIn, rateIn, discIn, gstById, resetEntry, qtyOnlyMode, pricesFromProduct])

  const applyBillDiscount = (pct: number) => {
    setBillDiscPct(pct)
    setItems((prev) => prev.map((it) => ({ ...it, disc_pct: pct })))
  }

  const selectVendor = useCallback(async (party: Party, opts?: { fillMobile?: boolean }) => {
    const fillMobile = opts?.fillMobile !== false
    setSelectedVendor(party)
    setVendorText(party.name || '')
    setSuppId(party.code || '')
    if (fillMobile) setMobile(party.phone || '')
    try {
      const details = await api.get<{ closing_balance?: number | string }>(
        '/reports/debtor-details',
        { party_id: party.id },
      )
      const bal = Number(details.closing_balance || 0)
      if (bal < -0.005) {
        setOldBalance(Math.abs(bal))
        setOutstanding(`Outstanding: ${fmt(Math.abs(bal))} Cr`)
      } else if (bal > 0.005) {
        setOldBalance(0)
        setOutstanding(`Outstanding: ${fmt(bal)} Dr`)
      } else {
        setOldBalance(0)
        setOutstanding('Outstanding: 0.00')
      }
    } catch {
      setOldBalance(0)
      setOutstanding('Outstanding: —')
    }
  }, [])

  const resolveSuppId = useCallback(() => {
    const raw = suppId.trim()
    if (!raw) return
    const match = findPartyByCode(vendors, raw)
    if (match) void selectVendor(match)
  }, [suppId, vendors, selectVendor])

  const resolveMobile = useCallback(() => {
    const digits = phoneDigits(mobile)
    if (!digits) {
      if (selectedVendor && phoneDigits(selectedVendor.phone)) {
        setSelectedVendor(null)
        setOldBalance(0)
        setOutstanding('Outstanding: —')
      }
      return
    }
    const match = findPartyByPhone(vendors, mobile)
    if (match) {
      void selectVendor(match, { fillMobile: false })
      return
    }
    const hadSelected = selectedVendor != null
    setSelectedVendor(null)
    setOldBalance(0)
    setOutstanding('Outstanding: New supplier')
    if (hadSelected) setVendorText('')
  }, [mobile, vendors, selectedVendor, selectVendor])

  const resolveVendor = useCallback(() => {
    if (phoneDigits(mobile)) {
      if (selectedVendor) return
      if (vendorText.trim()) setOutstanding('Outstanding: New supplier')
      return
    }
    const text = vendorText.trim()
    if (!text) {
      setSelectedVendor(null)
      setOldBalance(0)
      setOutstanding('Outstanding: —')
      return
    }
    const match = vendorByName[text.toLowerCase()] || findPartyByCode(vendors, text)
    if (match) void selectVendor(match)
  }, [vendorText, vendorByName, selectVendor, mobile, selectedVendor, vendors])

  const ensureVendorForCredit = useCallback(async () => {
    if (selectedVendor) return selectedVendor
    const text = vendorText.trim()
    if (!text) return null
    const match = vendorByName[text.toLowerCase()] || findPartyByCode(vendors, suppId)
    if (match) {
      await selectVendor(match)
      return match
    }
    try {
      const party = await api.post<Party>('/parties/quick', {
        party_type: 'vendor',
        name: text,
        phone: mobile.trim() || null,
      })
      setVendors((prev) => [...prev, party])
      setSelectedVendor(party)
      return party
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to create supplier')
      return null
    }
  }, [selectedVendor, vendorText, vendorByName, mobile, vendors, suppId, selectVendor])

  const openPrintPreview = useCallback(
    async (voucherId: string, voucherNo?: string | null, fallback?: Voucher | null) => {
      try {
        const html = await api.getReportHtml(`/reports/sale-bill/${voucherId}`, { format: billFormat })
        setPreview({
          title: `Purchase Bill ${voucherNo || ''} Preview`.trim(),
          html,
          reportCode: REPORT_CODE,
          voucherId,
        })
      } catch (err) {
        if (fallback) {
          setPreview({
            title: `Purchase Bill ${voucherNo || ''} Preview`.trim(),
            html: fallbackBillHtml(fallback),
            reportCode: REPORT_CODE,
            voucherId,
          })
          return
        }
        alert(err instanceof ApiError ? err.message : 'Failed to load preview')
      }
    },
    [billFormat],
  )

  const clearBill = useCallback(() => {
    setItems([])
    setPaymentsDirty(false)
    setSelectedVendor(null)
    setOldBalance(0)
    setCurrentProduct(null)
    setVendorText('')
    setSuppId('')
    setMobile('')
    setNarration('')
    setPartyBillNo('')
    setBillDiscPct(0)
    setOutstanding('Outstanding: —')
    setStatus('')
    setVoucherDate(todayISO())
    setPayAmounts(Object.fromEntries(paymentModes.map((m) => [m.id, 0])))
    setPayDocs(Object.fromEntries(paymentModes.map((m) => [m.id, ''])))
    setEntryText('')
    setEntryName('—')
    setQtyIn(1)
    setRateIn(0)
    setDiscIn(0)
    setBillNo('—')
    setLastNo(embeddedModify ? 'Load a bill to edit' : 'Assigned when you save')
    setEditId(null)
    setLoadedParked(false)
    setJustSaved(false)
    setCheckedRows({})
    entryRef.current?.focus()
  }, [paymentModes, embeddedModify, setEditId])

  const save = useCallback(async () => {
    if (!items.length) {
      alert('Add at least one item.')
      return
    }
    const isParked = parkingEnabled && items.some((it) => Number(it.rate || 0) <= 0)
    const paid = paidTotal
    const bal = round2(netTotal - paid)
    let vendor: Party | null = null
    if (isParked) {
      vendor = await ensureVendorForCredit()
      if (!vendor) {
        alert('Enter a supplier for this parked purchase.')
        return
      }
    } else if (bal > 0.005) {
      vendor = await ensureVendorForCredit()
      if (!vendor) {
        alert('This bill is not fully paid. Enter a supplier for the credit balance.')
        return
      }
    } else if (bal < -0.005) {
      alert('Paid amount is more than the bill total.')
      return
    } else {
      vendor = await ensureVendorForCredit()
    }

    const payload = {
      voucher_type: 'PURCHASE',
      voucher_date: voucherDate,
      party_id: vendor?.id ?? null,
      narration: narration.trim() || null,
      party_bill_no: partyBillNo.trim() || null,
      discount_amount: 0,
      is_parked: isParked,
      items: items.map((it) => ({
        product_id: it.product_id,
        quantity: it.qty,
        rate: it.rate,
        discount_amount: round2((it.qty * it.rate * it.disc_pct) / 100),
        gst_id: it.gst_id,
        mrp: Number(it.mrp || 0) || null,
        sale_price: Number(it.sale_price || 0) || null,
        profit_pct: Number(it.profit_pct || 0) || null,
      })),
      payments: isParked
        ? []
        : paymentModes
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
      if (isParked) {
        alert(`Purchase ${voucherNo} parked for pricing.\nOpen it from Pending to price.`)
        clearBill()
        void refresh()
        return
      }
      setEditId(voucherId)
      setBillNo(String(voucherNo || '—'))
      setLastNo('Saved')
      setJustSaved(true)
      setLoadedParked(false)
      setCheckedRows(Object.fromEntries(items.map((_, i) => [i, true])))
      if (voucherId) await openPrintPreview(voucherId, voucherNo, result)
      alert(
        `Bill ${voucherNo} saved.\nNet: ${fmt(Number(result.net_amount || 0))}\nSelect items and Generate barcode, or print from the preview.`,
      )
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }, [
    items,
    parkingEnabled,
    paidTotal,
    netTotal,
    ensureVendorForCredit,
    voucherDate,
    narration,
    partyBillNo,
    paymentModes,
    payAmounts,
    payDocs,
    openPrintPreview,
    clearBill,
    editVoucherId,
    refresh,
    setEditId,
  ])

  const exportTemplate = (format: SpreadsheetFormat = 'xlsx') => {
    const rows =
      items.length > 0
        ? items.map((it) => [
            it.code || '',
            it.name || '',
            it.qty,
            it.rate,
            Number(it.profit_pct || 0),
            Number(it.sale_price || 0),
            Number(it.mrp || 0),
            it.disc_pct,
            it.gst_rate,
          ])
        : [['', '', 1, 0, 0, 0, 0, 0, 0]]
    downloadExcel('purchase-bill-template', {
      name: 'Purchase Bill',
      headers: TEMPLATE_HEADERS,
      rows,
    }, format)
  }

  const importExcel = async (file: File) => {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const previewRows = await api.upload<PurchaseImportPreview>(
        '/vouchers/purchase-import-preview',
        fd,
      )
      if (!previewRows.lines.length) {
        setError(previewRows.errors.join('\n') || 'No matching products in the file.')
        return
      }
      if (items.length && !confirm('Replace the current bill lines with the imported rows?')) {
        return
      }
      setItems(
        previewRows.lines.map((l) => ({
          product_id: l.product_id,
          code: l.code,
          name: l.name,
          qty: Number(l.qty || 0),
          rate: Number(l.rate || 0),
          mrp: Number(l.mrp || 0),
          sale_price: Number(l.sale_price || 0),
          profit_pct: Number(l.profit_pct || 0),
          disc_pct: Number(l.disc_pct || 0),
          gst_id: l.gst_id,
          gst_rate: Number(l.gst_rate || 0),
        })),
      )
      setPaymentsDirty(false)
      setStatus(previewRows.message)
      if (previewRows.errors.length) {
        setError(previewRows.errors.slice(0, 8).join('\n'))
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const loadVoucherForEdit = useCallback(
    (voucher: Voucher) => {
      if (voucher.is_cancelled) {
        alert('This bill is deleted. Restore it from Audit Trail first.')
        return
      }
      setEditId(voucher.id)
      setJustSaved(false)
      setLoadedParked(Boolean(voucher.is_parked))
      setCheckedRows({})
      setBillNo(String(voucher.voucher_no || '—'))
      setLastNo('Edit mode')
      if (voucher.voucher_date) setVoucherDate(String(voucher.voucher_date).slice(0, 10))
      setPartyBillNo(String(voucher.party_bill_no || ''))
      if (voucher.party_id) {
        const known = vendors.find((c) => c.id === voucher.party_id)
        if (known) {
          void selectVendor(known)
        } else {
          setSelectedVendor({
            id: voucher.party_id,
            name: voucher.party_name || '',
          })
          setVendorText(voucher.party_name || '')
          setSuppId('')
          setMobile('')
        }
      } else {
        setSelectedVendor(null)
        setVendorText(voucher.party_name || '')
        setSuppId('')
        setMobile('')
      }
      setNarration(voucher.narration || '')
      const loaded: BillLine[] = []
      for (const it of voucher.items || []) {
        const qty = Number(it.quantity || 0)
        const rate = Number(it.rate || 0)
        const discAmt = Number(it.discount_amount || 0)
        const gross = qty * rate
        const discPct = gross > 0 ? round2((discAmt / gross) * 100) : 0
        const sale = Number(it.sale_price || 0)
        const profit =
          Number(it.profit_pct || 0) || (rate > 0 && sale > 0 ? profitPctFromSale(rate, sale) : 0)
        loaded.push({
          product_id: it.product_id,
          code: it.product_code || '',
          name: it.product_name || '',
          qty,
          rate,
          mrp: Number(it.mrp || 0),
          sale_price: sale,
          profit_pct: profit,
          disc_pct: discPct,
          gst_id: it.gst_id,
          gst_rate: Number(it.gst_rate || 0),
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
    [paymentModes, setEditId, vendors, selectVendor],
  )

  useEffect(() => {
    if (loadVoucherRef) loadVoucherRef.current = loadVoucherForEdit
  }, [loadVoucherRef, loadVoucherForEdit])

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

  const openVendorDetails = useCallback(async () => {
    if (selectedVendor?.id) {
      setPartyForm(partyToForm(selectedVendor))
      setPartyEditId(selectedVendor.id)
      setShowVendorDlg(true)
      try {
        const full = await api.get<Party>(`/parties/${selectedVendor.id}`)
        setPartyForm(partyToForm(full))
        setPartyEditId(full.id)
      } catch {
        /* keep the local copy */
      }
      return
    }
    setPartyForm(
      emptyPartyForm({
        name: vendorText.trim(),
        phone: mobile,
        is_customer: false,
        is_vendor: true,
      }),
    )
    setPartyEditId(null)
    setShowVendorDlg(true)
  }, [selectedVendor, vendorText, mobile])

  const saveVendorDetails = async () => {
    if (!partyForm.name.trim()) {
      alert('Supplier/Vendor name is required.')
      return
    }
    if (!partyForm.is_customer && !partyForm.is_vendor) {
      alert('Select Customer, Supplier, or both.')
      return
    }
    try {
      const party = await savePartyRecord(partyForm, partyEditId)
      setVendors((prev) => {
        const rest = prev.filter((c) => c.id !== party.id)
        return [...rest, party]
      })
      setShowVendorDlg(false)
      await selectVendor(party)
    } catch (err) {
      alert(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to save supplier')
    }
  }

  const updateLine = (
    row: number,
    field: 'qty' | 'rate' | 'disc_pct' | 'amount' | 'profit_pct' | 'sale_price' | 'mrp',
    raw: string,
  ) => {
    const val = parseNum(raw)
    setItems((prev) => {
      const next = [...prev]
      const it = { ...next[row] }
      if (field === 'qty') {
        if (val <= 0) {
          alert('Quantity must be greater than zero.')
          return prev
        }
        it.qty = val
      } else if (field === 'rate') {
        it.rate = val
        it.sale_price = salePriceFromProfit(val, Number(it.profit_pct || 0))
        const gstHit = resolveGstFromProduct(
          { tax_slabs: it.tax_slabs, gst_id: it.gst_id },
          val,
          it.gst_rate,
          it.gst_id,
        )
        it.gst_rate = gstHit.gst_rate
        it.gst_id = gstHit.gst_id
      } else if (field === 'profit_pct') {
        it.profit_pct = val
        it.sale_price = salePriceFromProfit(it.rate, val)
      } else if (field === 'sale_price') {
        it.sale_price = Math.round(val)
        it.profit_pct = profitPctFromSale(it.rate, it.sale_price)
      } else if (field === 'mrp') {
        it.mrp = val
      } else if (field === 'disc_pct') {
        it.disc_pct = Math.max(0, Math.min(val, 100))
      } else {
        it.disc_pct = discFromNetAmount(it, val, taxInclusive)
      }
      next[row] = it
      return next
    })
  }

  const generateBarcodes = () => {
    const selected = items.filter((_, i) => checkedRows[i])
    const rows = selected.length ? selected : items
    if (!rows.length) {
      alert('Select at least one item.')
      return
    }
    saveBarcodeBatch({
      items: rows.map((it) => ({
        product_id: it.product_id,
        qty: Math.max(1, Math.round(Number(it.qty || 1))),
        name: it.name,
        code: it.code,
      })),
    })
    openOverlay('barcode_generation', 'Barcode Generation', '?tab=batch')
  }

  const openPending = async (row: PendingPurchase) => {
    try {
      const voucher = await api.get<Voucher>(`/vouchers/${row.id}`)
      loadVoucherForEdit(voucher)
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to load parked purchase')
    }
  }

  return (
    <div className={embeddedModify ? 'sale-bill' : 'sale-bill sale-bill-screen'}>
      {error && <div className="error-banner" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
      {status && <p className="hint">{status}</p>}
      {parkingEnabled && pendingRows.length > 0 ? (
        <div className="settings-box" style={{ marginBottom: 8 }}>
          <div className="settings-box-title">Pending to price ({pendingRows.length})</div>
          <p className="hint" style={{ margin: '0 0 6px' }}>
            Open a parked purchase to enter rate, profit % and sale price.
          </p>
          <div className="table-wrap">
            <table className="table data-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Bill No</th>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th>Party Bill No</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button type="button" className="btn btn-primary" onClick={() => void openPending(row)}>
                        Open
                      </button>
                    </td>
                    <td>{row.voucher_no}</td>
                    <td>{String(row.voucher_date).slice(0, 10)}</td>
                    <td>{row.party_name || '—'}</td>
                    <td>{row.party_bill_no || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

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
          Purchase Bill
          <span className="sb-tax-mode">{taxInclusive ? 'Inclusive' : 'Exclusive'}</span>
          {qtyOnlyMode ? <span className="sb-tax-mode">Receive / park</span> : null}
          {loadedParked ? <span className="sb-tax-mode">Pending price</span> : null}
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
        <BillFormatSelect value={billFormat} onChange={onBillFormatChange} documentCode={REPORT_CODE} />
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
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {editVoucherId && !justSaved ? 'F9 — Update' : qtyOnlyMode ? 'F9 — Park' : 'F9 — Save'}
        </button>
        {showBarcodeBar ? (
          <button type="button" className="btn btn-primary" onClick={generateBarcodes}>
            Generate barcode
          </button>
        ) : null}
      </div>

      <div className="sb-row">
        <span className="field-label">Supp ID</span>
        <input
          ref={suppIdRef}
          className="input"
          value={suppId}
          placeholder="1, 2, 3…"
          style={{ maxWidth: 80 }}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setSuppId(e.target.value)}
          onBlur={resolveSuppId}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              resolveSuppId()
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
              vendorRef.current?.focus()
            }
          }}
        />
        <span className="field-label">Supplier/Vendor</span>
        <div className="sb-cust-field">
          <button
            type="button"
            className="sb-plus-btn"
            title={selectedVendor ? 'Supplier/Vendor details' : 'Add supplier/vendor details'}
            aria-label={selectedVendor ? 'Open supplier/vendor details' : 'Add supplier/vendor details'}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void openVendorDetails()
            }}
          >
            +
          </button>
          {phoneDigits(mobile) ? (
            <input
              ref={vendorRef}
              className="input"
              value={vendorText}
              placeholder="Supplier/Vendor name"
              onFocus={(e) => e.target.select()}
              onChange={(e) => setVendorText(e.target.value)}
              onBlur={resolveVendor}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  resolveVendor()
                  narrationRef.current?.focus()
                }
              }}
            />
          ) : (
            <Typeahead
              value={vendorText}
              onChange={setVendorText}
              items={vendors}
              getLabel={(c) => c.name}
              placeholder="Search supplier/vendor"
              onSelect={(c) => void selectVendor(c)}
              inputRef={vendorRef}
              onEnter={() => {
                resolveVendor()
                narrationRef.current?.focus()
              }}
            />
          )}
        </div>
        <span className="field-label">Party Bill No</span>
        <input
          className="input"
          value={partyBillNo}
          placeholder="Supplier bill no"
          style={{ maxWidth: 140 }}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setPartyBillNo(e.target.value)}
        />
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
              if (focusAndSelect(qtyRef.current)) return
              if (!qtyOnlyMode && focusAndSelect(rateRef.current)) return
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
            if (focusAndSelect(qtyRef.current)) return
            if (!qtyOnlyMode && focusAndSelect(rateRef.current)) return
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
          disabled={!setEntryFieldsEnabled}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setQtyIn(Number(e.target.value) || 0)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (!qtyOnlyMode && focusAndSelect(rateRef.current)) return
              addCurrent()
            }
          }}
        />
        {!qtyOnlyMode ? (
          <>
        <span className="field-label">Rate</span>
        <input
          ref={rateRef}
          className="input"
          type="number"
          step={0.01}
          style={{ maxWidth: 96 }}
          value={rateIn}
          disabled={!setEntryFieldsEnabled}
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
          disabled={!setEntryFieldsEnabled}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDiscIn(Number(e.target.value) || 0)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addCurrent()
            }
          }}
        />
          </>
        ) : null}
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
                  {showBarcodeBar ? (
                    <th className="sb-col-check">
                      <input
                        type="checkbox"
                        checked={items.length > 0 && items.every((_, i) => checkedRows[i])}
                        onChange={(e) => {
                          const on = e.target.checked
                          setCheckedRows(Object.fromEntries(items.map((_, i) => [i, on])))
                        }}
                        title="Select all"
                      />
                    </th>
                  ) : null}
                  {(qtyOnlyMode ? ITEM_COLS_QTY : ITEM_COLS_FULL).map((c) => (
                    <th key={c} className={c === 'Code' ? 'sb-col-code' : c === 'Product' ? 'sb-col-name' : undefined}>
                      {c}
                    </th>
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
                    {showBarcodeBar ? (
                      <td className="sb-col-check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={Boolean(checkedRows[r])}
                          onChange={(e) =>
                            setCheckedRows((prev) => ({ ...prev, [r]: e.target.checked }))
                          }
                        />
                      </td>
                    ) : null}
                    <td>{r + 1}</td>
                    <td className="sb-col-code">{row.it.code}</td>
                    <td className="sb-col-name">{row.it.name}</td>
                    <td>
                      <EditableNum
                        value={row.it.qty}
                        decimals={3}
                        onCommit={(n) => updateLine(r, 'qty', String(n))}
                      />
                    </td>
                    {!qtyOnlyMode ? (
                      <>
                    <td>
                      <EditableNum
                        value={row.it.rate}
                        onCommit={(n) => updateLine(r, 'rate', String(n))}
                      />
                    </td>
                    <td>
                      <EditableNum
                        value={Number(row.it.profit_pct || 0)}
                        onCommit={(n) => updateLine(r, 'profit_pct', String(n))}
                      />
                    </td>
                    <td>
                      <EditableNum
                        value={Number(row.it.sale_price || 0)}
                        decimals={0}
                        onCommit={(n) => updateLine(r, 'sale_price', String(n))}
                      />
                    </td>
                    <td>
                      <EditableNum
                        value={Number(row.it.mrp || 0)}
                        onCommit={(n) => updateLine(r, 'mrp', String(n))}
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
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sb-item-totals">
            <div className="sb-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (selectedRow >= 0 && selectedRow < items.length) {
                    setItems((prev) => prev.filter((_, i) => i !== selectedRow))
                    setSelectedRow(-1)
                  }
                }}
              >
                Remove
              </button>
              {showBarcodeBar ? (
                <button type="button" className="btn btn-primary" onClick={generateBarcodes}>
                  Generate barcode
                </button>
              ) : null}
            </div>
            <div className="sb-totals-chips">
              <span className="sb-chip info">{outstanding}</span>
              <span className="sb-chip">Gross: {fmt(taxableTotal)}</span>
              <span className="sb-chip">Tax: {fmt(taxTotal)}</span>
              <span className="sb-chip net">Net: {fmt(netTotal)}</span>
            </div>
          </div>
        </div>

        {!qtyOnlyMode ? (
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
              Net purchase amount
            </div>
            <div className="sb-summary-val">{fmt(netTotal)}</div>
          </div>
          <div className="sb-summary plain">
            <div className="sb-summary-cap">Old balance</div>
            <div className="sb-summary-val">{fmt(oldBalance)}</div>
          </div>
          <div className="sb-summary brand">
            <div className="sb-summary-cap" style={{ color: 'var(--brand)' }}>
              Net payable
            </div>
            <div className="sb-summary-val">{fmt(payable)}</div>
          </div>
          <div className="sb-paid">Paid: {fmt(paidTotal)}</div>
          <div className="sb-balance">Balance: {fmt(balance)}</div>
        </div>
        ) : null}
      </div>

      {showVendorDlg &&
        createPortal(
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={() => setShowVendorDlg(false)}
          >
            <div
              className="modal party-modal party-enter-root"
              role="dialog"
              aria-modal="true"
              aria-label={partyEditId ? 'Supplier details' : 'New supplier'}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => handleEnterAsTab(e, e.currentTarget)}
            >
              <h2>{partyEditId ? 'Supplier details' : 'New supplier'}</h2>
              <PartyDetailsForm form={partyForm} onChange={setPartyForm} />
              <div className="modal-actions">
                <button type="button" className="btn" data-skip-enter="true" onClick={() => setShowVendorDlg(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void saveVendorDetails()}>
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
