/** Last-purchase profit % and rounded (whole rupee) sale price. */

export function profitPctFromLast(purchasePrice: number, salePrice: number): number {
  const cost = Number(purchasePrice || 0)
  const sale = Number(salePrice || 0)
  if (cost <= 0 || sale <= 0) return 0
  return Math.round(((sale - cost) / cost) * 10000) / 100
}

export function salePriceFromProfit(rate: number, profitPct: number): number {
  const r = Number(rate || 0)
  const p = Number(profitPct || 0)
  if (r <= 0) return 0
  return Math.round(r * (1 + p / 100))
}

export function profitPctFromSale(rate: number, salePrice: number): number {
  const r = Number(rate || 0)
  const s = Number(salePrice || 0)
  if (r <= 0) return 0
  return Math.round(((s - r) / r) * 10000) / 100
}
