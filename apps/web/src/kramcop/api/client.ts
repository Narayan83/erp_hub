const API_BASE =
  ((import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api/v1') + '/kramcop'
const TOKEN_KEY = 'erp_token'

export class ApiError extends Error {
  statusCode: number | null
  constructor(message: string, statusCode: number | null = null) {
    super(message)
    this.statusCode = statusCode
  }
}

function token() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function apiUrl(path: string, params?: Record<string, string | number | undefined>) {
  const url = new URL(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    }
  }
  return url
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = apiUrl(path, params)
  const auth = token()
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail ?? data)
    } catch {
      /* ignore */
    }
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      if (!window.location.pathname.startsWith('/login')) window.location.assign('/login')
    }
    throw new ApiError(detail, res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | undefined>) =>
    request<T>('GET', path, undefined, params),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: async <T>(path: string, file: File): Promise<T> => {
    const url = apiUrl(path)
    const auth = token()
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: auth ? { Authorization: `Bearer ${auth}` } : {},
      body,
    })
    if (!res.ok) {
      let detail = res.statusText
      try {
        const data = await res.json()
        detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail ?? data)
      } catch {
        /* ignore */
      }
      throw new ApiError(detail, res.status)
    }
    return (await res.json()) as T
  },
  blob: async (path: string, params?: Record<string, string | number | undefined>) => {
    const url = apiUrl(path, params)
    const auth = token()
    const res = await fetch(url.toString(), {
      headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    })
    if (!res.ok) throw new ApiError(res.statusText, res.status)
    return res.blob()
  },
  download: async (path: string, filename: string, params?: Record<string, string | number | undefined>) => {
    const blob = await api.blob(path, params)
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = filename
    a.click()
    URL.revokeObjectURL(href)
  },
}
