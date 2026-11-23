import { printHtmlOnThisPc } from '../../../print/printOnThisPc'
import { PrintJobPreview, CorePrintPreviewHost } from '../../../print/CorePrintPreview'
import { type HospitalPrintJob } from '../../../print/printPreviewBus'

export type { HospitalPrintJob }

export function opdBillPrintJob(id: string, billNo?: string | null): HospitalPrintJob {
  const no = (billNo || '').trim() || id
  return {
    title: `OPD Bill ${billNo || ''}`.trim(),
    htmlPath: `/hospital/reports/opd-bill/${id}/html`,
    reportCode: 'OPD_BILL',
    pdfName: `OPD_Bill_${no}.pdf`,
    excelName: `OPD_Bill_${no}.xlsx`,
  }
}

/** Hospital opens the one core preview. Print uses this computer's print dialog. */
export function HospitalPrintPreview({ job, onClose }: { job: HospitalPrintJob; onClose: () => void }) {
  return <PrintJobPreview job={job} onClose={onClose} onPrint={printHtmlOnThisPc} />
}

/** @deprecated Use CorePrintPreviewHost. Kept so older imports still open the core preview. */
export const HospitalPrintPreviewHost = CorePrintPreviewHost
