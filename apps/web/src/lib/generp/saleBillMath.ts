import type { BillLine, Product, TaxSlab } from '../../generpTypes'

export function lineAmounts(
  it: BillLine,
  inclusive = false,
): { taxable: number; gstAmt: number; amount: number } {
  const gross = it.qty * it.rate
  const lineDisc = round2(gross * it.disc_pct / 100)
  const net = Math.max(0, gross - lineDisc)
  if (inclusive && it.gst_rate > 0) {
    const taxable = round2(net / (1 + it.gst_rate / 100))
    const gstAmt = round2(net - taxable)
    return { taxable, gstAmt, amount: round2(net) }
  }
  const taxable = net
  const gstAmt = round2(taxable * it.gst_rate / 100)
  return { taxable, gstAmt, amount: round2(taxable + gstAmt) }
}

export function resolveGstFromProduct(
  product: Pick<Product, 'tax_slabs' | 'gst_id'> | null | undefined,
  unitRate: number,
  fallbackRate: number,
  fallbackGstId?: string | null,
): { gst_rate: number; gst_id?: string | null } {
  const slabs = normalizeSlabs(product?.tax_slabs)
  if (slabs.length) {
    let chosen: TaxSlab | null = null
    for (const slab of slabs) {
      if (unitRate + 1e-9 >= slab.min_amount) chosen = slab
    }
    if (chosen) {
      return { gst_rate: chosen.rate, gst_id: chosen.gst_id || fallbackGstId || product?.gst_id }
    }
  }
  return {
    gst_rate: fallbackRate,
    gst_id: fallbackGstId ?? product?.gst_id ?? null,
  }
}

export function normalizeSlabs(raw: TaxSlab[] | null | undefined): TaxSlab[] {
  if (!raw?.length) return []
  return [...raw]
    .map((s) => ({
      min_amount: Number(s.min_amount) || 0,
      rate: Number(s.rate) || 0,
      gst_id: s.gst_id || null,
    }))
    .sort((a, b) => a.min_amount - b.min_amount)
}

export function discFromNetAmount(it: BillLine, targetAmount: number, inclusive = false): number {
  const gross = it.qty * it.rate
  if (gross <= 0) return 0
  if (inclusive) {
    const capped = Math.max(0, Math.min(targetAmount, gross))
    const lineDisc = gross - capped
    return round4((lineDisc / gross) * 100)
  }
  const gstFactor = 1 + it.gst_rate / 100
  let taxable = gstFactor ? targetAmount / gstFactor : targetAmount
  taxable = Math.max(0, Math.min(taxable, gross))
  const lineDisc = gross - taxable
  return round4((lineDisc / gross) * 100)
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000
}

export function parseNum(text: string): number {
  const n = Number(String(text).replace(/,/g, '').trim() || 0)
  return Number.isFinite(n) ? n : 0
}

export function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
