import type { SpreadsheetFormat } from '../../lib/generp/exportExcel'

type Props = {
  onExport: (format: SpreadsheetFormat) => void
  busy?: boolean
  disabled?: boolean
  compact?: boolean
  xlsxLabel?: string
  csvLabel?: string
  className?: string
}

export function ExportFormatButtons({
  onExport,
  busy,
  disabled,
  compact,
  xlsxLabel,
  csvLabel,
  className = 'btn',
}: Props) {
  const excel = xlsxLabel || (compact ? 'Excel' : 'Excel')
  const csv = csvLabel || 'CSV'
  return (
    <>
      <button
        type="button"
        className={className}
        data-skip-enter="true"
        disabled={busy || disabled}
        onClick={() => onExport('xlsx')}
      >
        {busy ? 'Exporting…' : excel}
      </button>
      <button
        type="button"
        className={className}
        data-skip-enter="true"
        disabled={busy || disabled}
        onClick={() => onExport('csv')}
      >
        {csv}
      </button>
    </>
  )
}
