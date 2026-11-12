const TOKEN_KEY = 'erp_token'
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api/v1'

/** Open authenticated HTML report in a new tab. */
export async function openHospitalReport(path: string): Promise<void> {
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
    let detail = text
    try {
      detail = JSON.parse(text)?.detail ?? text
    } catch {
      /* keep text */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  const blob = new Blob([text], { type: 'text/html' })
  const blobUrl = URL.createObjectURL(blob)
  window.open(blobUrl, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
}
