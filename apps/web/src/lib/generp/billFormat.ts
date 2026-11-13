import { api } from '../../api/client'

export const BILL_FORMATS = [
  { code: 'A4', name: 'A4 Standard' },
  { code: 'A5', name: 'A5' },
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

export async function loadBillFormat(reportCode: string): Promise<string> {
  const local = readLocalBillFormat(reportCode)
  try {
    const cfg = await api.get<{ bill_format?: string }>(`/print-configs/by-code/${reportCode}`)
    const fmt = normalizeBillFormat(cfg.bill_format || local)
    writeLocalBillFormat(reportCode, fmt)
    return fmt
  } catch {
    return local
  }
}

export async function saveBillFormat(reportCode: string, format: string): Promise<string> {
  const fmt = normalizeBillFormat(format)
  writeLocalBillFormat(reportCode, fmt)
  try {
    const rows = await api.get<Array<{ id: string; code: string }>>('/print-configs')
    const row = rows.find((r) => r.code === reportCode)
    if (row) await api.patch(`/print-configs/${row.id}`, { bill_format: fmt })
  } catch {
    /* local default still applies on this browser */
  }
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
