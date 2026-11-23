/**
 * Shared printer selection for every product (hospital, GenERP, lodge, …).
 * Printer choice is stored per PC via Print Master /print-configs (print.ini).
 * Empty string = Windows default printer.
 */
import { api } from '../api/client'

export type PrinterInfo = { name: string; is_default?: boolean }

export async function loadInstalledPrinters(): Promise<PrinterInfo[]> {
  try {
    const data = await api.get<{ printers?: PrinterInfo[] }>('/print-configs/printers')
    return data.printers || []
  } catch {
    return []
  }
}

/** Prefer the local Print Master printer for this report; otherwise leave empty (Windows default). */
export async function loadSavedPrinter(reportCode: string | undefined | null): Promise<string> {
  const code = (reportCode || '').trim()
  if (!code) return ''
  try {
    const cfg = await api.get<{ printer_name?: string | null }>(`/print-configs/by-code/${code}`)
    return (cfg.printer_name || '').trim()
  } catch {
    return ''
  }
}

export function matchInstalledPrinter(chosen: string, list: PrinterInfo[]): string {
  const wanted = chosen.trim()
  if (!wanted) return ''
  const exact = list.find((item) => item.name === wanted)
  if (exact) return exact.name
  const folded = list.find((item) => item.name.toLowerCase() === wanted.toLowerCase())
  return folded?.name || wanted
}

/** Persist printer for this report on THIS PC only (empty = Windows default). */
export async function rememberReportPrinter(reportCode: string | undefined | null, printerName: string): Promise<void> {
  const code = (reportCode || '').trim()
  if (!code) return
  try {
    const rows = await api.get<Array<{ id: string; code: string }>>('/print-configs')
    const wanted = code.toUpperCase()
    const row =
      rows.find((item) => item.code.toUpperCase() === wanted) ||
      rows.find((item) => item.code.toUpperCase().startsWith(wanted)) ||
      null
    if (row) {
      await api.patch(`/print-configs/${row.id}`, { printer_name: printerName.trim() || null })
    }
  } catch {
    /* printing still continues */
  }
}
