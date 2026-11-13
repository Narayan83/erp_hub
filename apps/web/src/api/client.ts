const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api/v1'
const TOKEN_KEY = 'erp_token'

export class ApiError extends Error {
  statusCode: number | null
  constructor(message: string, statusCode: number | null = null) {
    super(message)
    this.statusCode = statusCode
  }
}

function formatDetail(detail: unknown): string {
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === 'object') {
          const loc = Array.isArray((item as { loc?: unknown }).loc)
            ? (item as { loc: unknown[] }).loc.join('.')
            : ''
          const msg = String((item as { msg?: unknown }).msg ?? '')
          return loc ? `${loc}: ${msg}` : msg
        }
        return String(item)
      })
      .join('; ')
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  return String(detail ?? 'Request failed')
}

type TokenGetter = () => string | null
let getToken: TokenGetter = () => localStorage.getItem(TOKEN_KEY)
let onUnauthorized: (() => void) | null = null

export function setTokenGetter(fn: TokenGetter) {
  getToken = fn
}

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

function apiUrl(path: string) {
  return new URL(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, window.location.origin)
}

function applyParams(
  url: URL,
  params?: Record<string, string | number | boolean | undefined | null>,
) {
  if (!params) return
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function fail(res: Response, data: unknown, path: string, token: string | null): never {
  let detail = res.statusText || 'Request failed'
  if (data && typeof data === 'object' && 'detail' in data) {
    detail = formatDetail((data as { detail: unknown }).detail)
  } else if (typeof data === 'string' && data) {
    detail = data
  }
  if (res.status === 401 && token && !path.endsWith('/auth/login')) onUnauthorized?.()
  throw new ApiError(detail, res.status)
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string | number | boolean | undefined | null>,
): Promise<T> {
  const url = apiUrl(path)
  applyParams(url, params)
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const menu = window.location.pathname.replace(/^\//, '').split('/')[0]
  if (menu) headers['X-Menu-Code'] = menu
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await readBody(res)
  if (!res.ok) fail(res, data, path, token)
  return data as T
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | undefined | null>) =>
    request<T>('GET', path, undefined, params),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),

  async upload<T>(path: string, formData: FormData): Promise<T> {
    const url = apiUrl(path)
    const headers: Record<string, string> = { Accept: 'application/json' }
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(url, { method: 'POST', headers, body: formData })
    const data = await readBody(res)
    if (!res.ok) fail(res, data, path, token)
    return data as T
  },

  async getReportHtml(
    path: string,
    params?: Record<string, string | number | boolean | undefined | null>,
  ): Promise<string> {
    const url = apiUrl(`${path.replace(/\/$/, '')}/html`)
    applyParams(url, params)
    const token = getToken()
    const res = await fetch(url, {
      headers: { Accept: 'text/html', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    const text = await res.text()
    if (!res.ok) {
      let data: unknown = text
      try {
        data = JSON.parse(text)
      } catch {
        /* html or plain text */
      }
      fail(res, data, path, token)
    }
    return text
  },
}
