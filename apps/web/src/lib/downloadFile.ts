const TOKEN_KEY = 'erp_token'
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api/v1'

function detailFrom(text: string): string {
  try {
    const parsed = JSON.parse(text)?.detail ?? text
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
  } catch {
    return text
  }
}

/** Download a file returned by an authenticated POST. */
export async function downloadAuthedPost(path: string, body: unknown, fileName: string): Promise<void> {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(detailFrom(await res.text()) || 'Download failed')
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
