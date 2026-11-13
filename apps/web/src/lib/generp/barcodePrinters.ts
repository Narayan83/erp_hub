import { api } from '../../api/client'
import type { BarcodeLayoutId } from './barcodeLabels'

export const BARCODE_LAYOUT_IDS: BarcodeLayoutId[] = ['DOUBLE', 'SINGLE', 'MINI', 'CUSTOM']

export type PrinterInfo = { name: string; is_default?: boolean }

const STORAGE_PREFIX = 'generp.barcodePrinter.'

export type LayoutPrinters = Record<BarcodeLayoutId, string>

export function emptyLayoutPrinters(): LayoutPrinters {
  return { DOUBLE: '', SINGLE: '', MINI: '', CUSTOM: '' }
}

export function readLocalLayoutPrinter(layout: BarcodeLayoutId): string {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${layout}`) || ''
  } catch {
    return ''
  }
}

export function writeLocalLayoutPrinter(layout: BarcodeLayoutId, name: string): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${layout}`, name)
  } catch {
    /* ignore quota / private mode */
  }
}

export async function loadInstalledPrinters(): Promise<PrinterInfo[]> {
  try {
    const data = await api.get<{ printers?: PrinterInfo[] }>('/print-configs/printers')
    return data.printers || []
  } catch {
    return []
  }
}

export async function loadLayoutPrinters(): Promise<LayoutPrinters> {
  const merged = emptyLayoutPrinters()
  for (const id of BARCODE_LAYOUT_IDS) {
    merged[id] = readLocalLayoutPrinter(id)
  }
  try {
    const remote = await api.get<Record<string, string | null>>('/print-configs/barcode-printers')
    for (const id of BARCODE_LAYOUT_IDS) {
      const value = String(remote[id] || '').trim()
      merged[id] = value
      writeLocalLayoutPrinter(id, value)
    }
  } catch {
    /* local values still apply on this browser */
  }
  return merged
}

export async function saveLayoutPrinter(layout: BarcodeLayoutId, printerName: string): Promise<void> {
  writeLocalLayoutPrinter(layout, printerName)
  await api.put(`/print-configs/barcode-printers/${layout}`, {
    printer_name: printerName.trim() || null,
  })
}
