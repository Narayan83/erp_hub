import { useEffect, useMemo, useState } from 'react'

export const LIST_PAGE_SIZE = 10
export const TABLE_PAGE_SIZE = 10

export function pageCount(total: number, pageSize = LIST_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize) || 1)
}

export function pageLabel(page: number, pageSize: number, total: number): string {
  if (total <= 0) return 'No records'
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return `${from}–${to} of ${total}`
}

export function useClientPager<T>(
  rows: T[],
  resetKey: string | number = '',
  pageSize = LIST_PAGE_SIZE,
) {
  const [page, setPage] = useState(1)
  useEffect(() => {
    setPage(1)
  }, [resetKey, pageSize])

  const total = rows.length
  const totalPages = pageCount(total, pageSize)
  const safePage = Math.min(Math.max(1, page), totalPages)
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize],
  )

  return {
    page: safePage,
    setPage,
    totalPages,
    pageRows,
    total,
    pageSize,
    label: pageLabel(safePage, pageSize, total),
  }
}
