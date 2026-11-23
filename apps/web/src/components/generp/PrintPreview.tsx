import { CorePrintPreview } from '../../print/CorePrintPreview'
import { printHtmlOnThisPc } from '../../print/printOnThisPc'

type Props = {
  title: string
  html: string
  onClose: () => void
  reportCode?: string
  billFormat?: string
  onBillFormatChange?: (format: string) => void
  initialPrinter?: string
  showCopies?: boolean
  saveDefaultLabel?: string
  onSaveDefault?: (printer: string, copies: number) => void | Promise<void>
}

/** GenERP opens the one core preview. Print uses this computer's print dialog. */
export function PrintPreview({ title, html, onClose, reportCode, billFormat, onBillFormatChange }: Props) {
  return (
    <CorePrintPreview
      title={title}
      html={html}
      onClose={onClose}
      reportCode={reportCode}
      billFormat={billFormat}
      onBillFormatChange={onBillFormatChange}
      onPrint={printHtmlOnThisPc}
    />
  )
}
