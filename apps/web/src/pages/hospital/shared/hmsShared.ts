import { useEffect, useState } from 'react'
import { api } from '../../../api/client'

export type Opt = { value: string; label: string }

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api/v1'

/** The shared api client has no DELETE helper; this mirrors its auth + error handling. */
export async function apiDelete<T = unknown>(path: string): Promise<T | null> {
  const res = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${localStorage.getItem('erp_token') || ''}`,
    },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const detail = data?.detail ?? res.statusText
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return data as T | null
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function fmtMoney(v: unknown): string {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : ''
}

export function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  const items = (data as { items?: T[] } | null)?.items
  return items || []
}

/** Load a list endpoint and map it into <option>s. */
export function useOptions<T = Record<string, unknown>>(
  path: string,
  map: (row: T) => Opt,
  params?: Record<string, string | number | boolean | undefined | null>,
  filter?: (row: T) => boolean,
): { options: Opt[]; rows: T[]; reload: () => Promise<void> } {
  const [rows, setRows] = useState<T[]>([])
  async function reload() {
    try {
      const data = await api.get<unknown>(path, params)
      setRows(unwrapList<T>(data))
    } catch {
      setRows([])
    }
  }
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, JSON.stringify(params || {})])
  const shown = filter ? rows.filter(filter) : rows
  return { options: shown.map(map), rows: shown, reload }
}

export const GENDER_OPTIONS: Opt[] = [
  { value: 'A', label: 'All' },
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
]

export const PHARMACY_ITEM_TYPES: Opt[] = [
  { value: 'MD', label: 'Medicine' },
  { value: 'SG', label: 'Surgicals' },
  { value: 'DS', label: 'Disposables' },
  { value: 'CS', label: 'Consumables' },
  { value: 'IM', label: 'Implants' },
]
