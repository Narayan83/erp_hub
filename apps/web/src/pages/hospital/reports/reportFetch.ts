const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api/v1'

export async function fetchReportHtml(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>,
): Promise<string> {
  const url = new URL(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, window.location.origin)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const token = localStorage.getItem('erp_token')
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    try {
      const j = JSON.parse(text)
      throw new Error(typeof j.detail === 'string' ? j.detail : text)
    } catch (e) {
      if (e instanceof Error && e.message !== text) throw e
      throw new Error(text || res.statusText)
    }
  }
  return text
}

export function openHtmlPreview(html: string, title = 'Report') {
  const w = window.open('', '_blank')
  if (!w) throw new Error('Popup blocked — allow popups to preview reports')
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.document.title = title
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
