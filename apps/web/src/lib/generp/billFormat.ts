export const BILL_FORMATS = [
  { code: 'A4', name: 'A4' },
  { code: 'A5', name: 'A5' },
  { code: 'A6', name: 'A6' },
  { code: 'THERMAL_80', name: 'Thermal 80mm' },
  { code: 'THERMAL_58', name: 'Thermal 58mm' },
] as const

export type BillFormatCode = string

const STORAGE_PREFIX = 'generp.billFormat.'

const ALLOWED = new Set<string>(BILL_FORMATS.map((f) => f.code))

export function normalizeBillFormat(value: string | null | undefined): string {
  const raw = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '')
  if (raw === 'THERMAL' || raw === '80MM' || raw === '3INCH' || raw === '4INCH') return 'THERMAL_80'
  if (raw === '58MM') return 'THERMAL_58'
  if (raw === 'STANDARD' || raw === 'NORMAL' || raw === 'LETTER') return 'A4'
  if (ALLOWED.has(raw)) return raw
  if (raw.startsWith('CUSTOM_') && raw.length > 7) return raw
  return 'A4'
}

export function isThermalFormat(value: string | null | undefined): boolean {
  const raw = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/-/g, '_')
  return raw.startsWith('THERMAL_') || raw === 'THERMAL' || raw === '80MM' || raw === '58MM'
}

export function billFormatStorageKey(reportCode: string): string {
  return `${STORAGE_PREFIX}${String(reportCode || '').toUpperCase()}`
}

export function readLocalBillFormat(reportCode: string): string {
  try {
    return normalizeBillFormat(localStorage.getItem(billFormatStorageKey(reportCode)))
  } catch {
    return 'A4'
  }
}

export function writeLocalBillFormat(reportCode: string, format: string): void {
  try {
    localStorage.setItem(billFormatStorageKey(reportCode), normalizeBillFormat(format))
  } catch {
    /* ignore quota / private mode */
  }
}

/** Paper format for this browser only. It is not written to the server. */
export async function loadBillFormat(reportCode: string): Promise<string> {
  return readLocalBillFormat(reportCode)
}

/** Paper format for this browser only. It is not written to the server. */
export async function saveBillFormat(reportCode: string, format: string): Promise<string> {
  const fmt = normalizeBillFormat(format)
  writeLocalBillFormat(reportCode, fmt)
  return fmt
}

export function voucherReportCode(voucherType: string): string {
  switch (voucherType) {
    case 'WHOLESALE':
      return 'WHOLESALE_BILL'
    case 'PURCHASE':
      return 'PURCHASE_BILL'
    case 'SALE_RETURN':
      return 'SALES_RETURN'
    case 'PURCHASE_RETURN':
      return 'PURCHASE_RETURN'
    default:
      return 'SALE_BILL'
  }
}
