import { ExportFormatButtons } from './ExportFormatButtons'
import type { SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { pageLabel } from '../../lib/generp/paginate'

type Props = {
  page: number
  totalPages: number
  total: number
  pageSize: number
  onPage: (page: number) => void
  onExport?: (format: SpreadsheetFormat) => void
  exportBusy?: boolean
  compact?: boolean
  topRight?: boolean
}

export function ListPager({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  onExport,
  exportBusy,
  compact,
  topRight,
}: Props) {
  if (total <= 0 && !onExport) return null
  return (
    <div
      className={`list-pager${compact ? ' list-pager--compact' : ''}${topRight ? ' list-pager--top-right' : ''}`}
    >
      <span className="list-pager-meta">{pageLabel(page, pageSize, total)}</span>
      <div className="list-pager-actions">
        <button
          type="button"
          className="btn"
          data-skip-enter="true"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Prev
        </button>
        <button
          type="button"
          className="btn"
          data-skip-enter="true"
          disabled={page >= totalPages || total <= 0}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
        {onExport ? (
          <ExportFormatButtons
            compact={compact}
            busy={exportBusy}
            disabled={total <= 0}
            onExport={onExport}
          />
        ) : null}
      </div>
    </div>
  )
}
