/** Shared print-preview job for any product (hospital, GenERP callers, future modules). */
export type HospitalPrintJob = {
  title: string
  htmlPath?: string
  html?: string
  reportCode?: string
  pdfName?: string
  excelName?: string
}

export type ProductPrintJob = HospitalPrintJob

type Listener = (job: HospitalPrintJob) => void

let listener: Listener | null = null

export function subscribePrintPreview(fn: Listener) {
  listener = fn
  return () => {
    if (listener === fn) listener = null
  }
}

/** Open the shared exact-size print preview (platform host in AppLayout). */
export function openPrintPreview(job: HospitalPrintJob) {
  listener?.(job)
}
