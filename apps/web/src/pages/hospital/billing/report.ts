import { downloadAuthedPost } from '../../../lib/downloadFile'
import { openPrintPreview, type HospitalPrintJob } from '../../../print/printPreviewBus'

const TOKEN_KEY = 'erp_token'
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api/v1'

const PRINT_DOCS: { test: RegExp; code: string; title: string }[] = [
  { test: /\/opd-bill\//, code: 'OPD_BILL', title: 'OPD Bill' },
  { test: /\/ipd-bill\//, code: 'IPD_BILL', title: 'IPD Bill' },
  { test: /\/pathology-bill\//, code: 'PATHOLOGY_BILL', title: 'Pathology Bill' },
  { test: /\/pathology-report\//, code: 'PATHOLOGY_REPORT', title: 'Pathology Report' },
  { test: /\/pharmacy-sale-bill\//, code: 'PHARMACY_SALE_BILL', title: 'Medicine Sale Bill' },
  { test: /\/pharmacy-purchase-bill\//, code: 'PHARMACY_PURCHASE_BILL', title: 'Medicine Purchase Bill' },
  { test: /\/discharge-summary\//, code: 'DISCHARGE_SUMMARY', title: 'Discharge Summary' },
  { test: /\/opd-casesheet\//, code: 'OPD_CASESHEET', title: 'OPD Case Sheet' },
  { test: /\/patient-card\//, code: 'PATIENT_CARD', title: 'Patient Card' },
  { test: /\/advance\//, code: 'ADVANCE_RECEIPT', title: 'Advance Receipt' },
  { test: /\/short-bill\/html/, code: 'SHORT_BILL_REPORT', title: 'Short Bill Report' },
  { test: /\/short-bill\//, code: 'SHORT_BILL', title: 'Short Bill' },
  { test: /\/single-service-opd\/html/, code: 'SINGLE_SERVICE_OPD_REPORT', title: 'Single Service OPD Report' },
  { test: /\/single-service-opd\//, code: 'SINGLE_SERVICE_OPD', title: 'Single Service OPD Bill' },
  { test: /\/form-3c\/html/, code: 'FORM_3C_REPORT', title: 'Form 3C Report' },
  { test: /\/cancellation-bills\/html/, code: 'CANCELLATION_BILL_REPORT', title: 'Cancellation Bill Report' },
  { test: /\/modification-bills\/html/, code: 'MODIFICATION_BILL_REPORT', title: 'Modification Bill Report' },
  { test: /\/user-cash-transaction\/html/, code: 'USER_CASH_REPORT', title: 'User wise Cash Transaction Report' },
  { test: /\/doctor-collection\/html/, code: 'DOCTOR_COLLECTION', title: 'Doctor wise Collection Report' },
  { test: /\/pathology-collection\/html/, code: 'PATHOLOGY_DOCTOR_COLLECTION', title: 'Pathology Collection Report' },
]

export function describeHospitalPrint(path: string): HospitalPrintJob {
  const hit = PRINT_DOCS.find((row) => row.test.test(path))
  const title = hit?.title || 'Print preview'
  const file = title.replace(/\s+/g, '_')
  return {
    title,
    htmlPath: path,
    reportCode: hit?.code,
    pdfName: `${file}.pdf`,
    excelName: `${file}.xlsx`,
  }
}

/** Open the shared exact-size preview for any hospital print. */
export async function openHospitalReport(path: string): Promise<void> {
  openPrintPreview(describeHospitalPrint(path))
}

/** Load an authenticated HTML report without opening a new tab. */
export async function fetchHospitalHtml(path: string): Promise<string> {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    let detail: unknown = text
    try {
      detail = JSON.parse(text)?.detail ?? text
    } catch {
      /* keep text */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return text
}

/** Download an authenticated file (PDF, Excel) using the signed-in session. */
export async function downloadHospitalFile(path: string, fileName: string): Promise<void> {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const text = await res.text()
    let detail: unknown = text
    try {
      detail = JSON.parse(text)?.detail ?? text
    } catch {
      /* keep text */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  const blobUrl = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)
}

export async function downloadHospitalPost(path: string, body: unknown, fileName: string): Promise<void> {
  await downloadAuthedPost(path, body, fileName)
}
