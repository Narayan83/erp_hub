/** Shop-printed barcode: 6-digit product key + MRP in whole rupees. */

export function encodeOwnBarcode(code: string | number, mrp: number): string {
  const n = parseInt(String(code), 10)
  if (!Number.isFinite(n) || n < 1) return ''
  const prefix = String(n).padStart(6, '0')
  const rupees = Math.max(0, Math.round(Number(mrp) || 0))
  return prefix + String(rupees).padStart(6, '0')
}

export function parseOwnBarcode(raw: string): { code: string; mrp: number } | null {
  const digits = String(raw || '').trim()
  if (!/^\d{12,}$/.test(digits)) return null
  const n = parseInt(digits.slice(0, 6), 10)
  const mrp = parseInt(digits.slice(6), 10)
  if (!Number.isFinite(n) || n < 1 || !Number.isFinite(mrp) || mrp < 0) return null
  return { code: String(n), mrp }
}

export function ownBarcodeMrp(...values: unknown[]): number {
  for (const value of values) {
    const n = Math.round(Number(value))
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

/** Scanner input: own 12-digit sticker or manufacturer EAN — not a short product code. */
export function isScannedBarcode(raw: string): boolean {
  const q = String(raw || '').trim()
  if (parseOwnBarcode(q)) return true
  return /^\d{8,}$/.test(q)
}
