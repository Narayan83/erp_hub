import { fmt, round2 } from './saleBillMath'

export type CeilingHit = {
  ok: boolean
  message?: string
  minAmt: number
  maxAmt: number
}

/** Max discount % on product master: net selling amount cannot go below sale price − ceiling. */
export function checkSaleCeiling(opts: {
  rate: number
  discPct: number
  salePrice: number
  maxDiscountPct?: number | null
}): CeilingHit {
  const salePrice = Number(opts.salePrice || 0)
  const ceiling = Number(opts.maxDiscountPct || 0)
  if (salePrice <= 0 || ceiling <= 0) {
    return { ok: true, minAmt: 0, maxAmt: salePrice }
  }
  const minAmt = round2(salePrice * (1 - Math.min(ceiling, 100) / 100))
  const disc = Math.min(Math.max(Number(opts.discPct || 0), 0), 100)
  const net = round2(Number(opts.rate || 0) * (1 - disc / 100))
  if (net + 0.005 < minAmt) {
    return {
      ok: false,
      minAmt,
      maxAmt: salePrice,
      message: `Minimum amount you can give is ${fmt(minAmt)} (${fmt(ceiling)}% off sale price ${fmt(salePrice)}).`,
    }
  }
  return { ok: true, minAmt, maxAmt: salePrice }
}
