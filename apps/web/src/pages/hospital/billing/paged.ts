import { api } from '../../../api/client'

type Page<T> = { items?: T[]; pages?: number }

/** Hospital list endpoints reject page_size above 100. Walk pages instead. */
export async function listAll<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined | null>,
): Promise<T[]> {
  const out: T[] = []
  let page = 1
  let pages = 1
  do {
    const res = await api.get<Page<T>>(path, { ...params, page, page_size: 100 })
    out.push(...(res.items || []))
    pages = Number(res.pages || 1)
    page += 1
  } while (page <= pages && page <= 30)
  return out
}
