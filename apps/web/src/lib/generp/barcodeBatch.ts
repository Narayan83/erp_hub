const KEY = 'generp.barcode.batch'

export type BarcodeBatchSeedItem = {
  product_id: string
  qty: number
  name?: string | null
  code?: string | null
}

export type BarcodeBatchSeed = {
  items: BarcodeBatchSeedItem[]
}

export function saveBarcodeBatch(seed: BarcodeBatchSeed) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(seed))
  } catch {
    /* ignore quota / private mode */
  }
}

export function readBarcodeBatch(): BarcodeBatchSeed | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BarcodeBatchSeed
    if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) return null
    return parsed
  } catch {
    return null
  }
}
