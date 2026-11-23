/** Display format used across Kramcop. API values stay yyyy-mm-dd. */
export const DATE_DISPLAY = 'dd/mm/yyyy'

function parts(year: string, month: string, day: string): string | null {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

/** yyyy-mm-dd (or a datetime prefix) → dd/mm/yyyy. Already-formatted values pass through. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return ''
  const raw = value.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw)
  if (dmy) {
    const isoValue = parts(dmy[3], dmy[2], dmy[1])
    return isoValue ? formatDate(isoValue) : raw
  }
  return raw
}

/** dd/mm/yyyy, dd-mm-yyyy, or yyyy-mm-dd → yyyy-mm-dd. Invalid input returns null. */
export function parseDate(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) return parts(iso[1], iso[2], iso[3])
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw)
  if (dmy) return parts(dmy[3], dmy[2], dmy[1])
  return null
}

/** ISO datetime → dd/mm/yyyy HH:mm:ss */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const [datePart, rest = ''] = value.trim().split(/[T ]/)
  const date = formatDate(datePart)
  const time = rest.replace(/Z$/, '').split('.')[0]
  return time ? `${date} ${time}` : date
}
