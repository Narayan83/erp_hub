import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { LIST_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import type { Ledger } from '../../generpTypes'

type FormState = {
  code: string
  name: string
  group_name: string
  ledger_type: string
  opening_balance: number
  is_cash: boolean
  is_bank: boolean
  is_party_deposit: boolean
  sort_order: number
}

const EMPTY: FormState = {
  code: '',
  name: '',
  group_name: 'General',
  ledger_type: 'ASSET',
  opening_balance: 0,
  is_cash: false,
  is_bank: false,
  is_party_deposit: false,
  sort_order: 0,
}

const LEDGER_TYPES = ['ASSET', 'LIABILITY', 'INCOME', 'EXPENSE'] as const

function ledgerSortKey(code: string): [number, number, string] {
  const raw = (code || '').trim()
  if (/^\d+$/.test(raw)) return [0, Number(raw), code]
  const m = /^L(\d+)$/i.exec(raw)
  if (m) return [0, Number(m[1]), code]
  return [1, 0, code]
}

function ledgerToForm(l: Ledger): FormState {
  return {
    code: l.code || '',
    name: l.name || '',
    group_name: l.group_name || 'General',
    ledger_type: (l.ledger_type || 'ASSET').toUpperCase(),
    opening_balance: Number(l.opening_balance || 0),
    is_cash: Boolean(l.is_cash),
    is_bank: Boolean(l.is_bank),
    is_party_deposit: Boolean(l.is_party_deposit),
    sort_order: Number(l.sort_order || 0),
  }
}

export function LedgerMasterPage() {
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [query, setQuery] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [nextCode, setNextCode] = useState('1')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [rows, peek] = await Promise.all([
      api.get<Ledger[]>('/ledgers'),
      api.get<{ next_code: string }>('/ledgers/next-code').catch(() => ({ next_code: '1' })),
    ])
    setLedgers(rows)
    setNextCode(peek.next_code || '1')
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await load()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load ledgers')
      }
    })()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = q
      ? ledgers.filter(
          (l) =>
            l.code.toLowerCase().includes(q) ||
            l.name.toLowerCase().includes(q) ||
            (l.group_name || '').toLowerCase().includes(q),
        )
      : ledgers
    return [...rows].sort((a, b) => {
      const ka = ledgerSortKey(a.code)
      const kb = ledgerSortKey(b.code)
      if (ka[0] !== kb[0]) return ka[0] - kb[0]
      if (ka[0] === 0) return ka[1] - kb[1]
      return a.code.localeCompare(b.code, undefined, { numeric: true })
    })
  }, [ledgers, query])

  const pager = useClientPager(filtered, query, LIST_PAGE_SIZE)

  const exportRows = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel('ledgers', {
      name: 'Ledgers',
      headers: ['Code', 'Name', 'Group', 'Type', 'Opening', 'Cash', 'Bank', 'Deposit'],
      rows: filtered.map((l) => [
        l.code,
        l.name,
        l.group_name || '',
        l.ledger_type || '',
        Number(l.opening_balance || 0),
        l.is_cash ? 'Yes' : 'No',
        l.is_bank ? 'Yes' : 'No',
        l.is_party_deposit ? 'Yes' : 'No',
      ]),
    }, format)
  }

  const select = (l: Ledger) => {
    setEditId(l.id)
    setForm(ledgerToForm(l))
    setError('')
  }

  const reset = () => {
    setEditId(null)
    setForm(EMPTY)
    setError('')
  }

  const save = async () => {
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    if (form.is_cash && form.is_bank) {
      setError('Ledger cannot be both Cash and Bank.')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (editId) {
        await api.patch(`/ledgers/${editId}`, {
          name: form.name.trim(),
          group_name: form.group_name.trim() || 'General',
          ledger_type: form.ledger_type,
          opening_balance: Math.abs(form.opening_balance),
          is_cash: form.is_cash,
          is_bank: form.is_bank,
          is_party_deposit: form.is_party_deposit,
          sort_order: form.sort_order,
          is_active: true,
        })
      } else {
        await api.post('/ledgers', {
          name: form.name.trim(),
          group_name: form.group_name.trim() || 'General',
          ledger_type: form.ledger_type,
          opening_balance: Math.abs(form.opening_balance),
          is_cash: form.is_cash,
          is_bank: form.is_bank,
          is_party_deposit: form.is_party_deposit,
          sort_order: form.sort_order,
          is_active: true,
        })
      }
      await load()
      reset()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!editId) return
    if (!confirm('Deactivate this ledger?')) return
    setBusy(true)
    try {
      await api.delete(`/ledgers/${editId}`)
      await load()
      reset()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="master-page">
      <h2>Ledger Master</h2>
      <p className="hint">
        Chart of accounts. Cash is 1. Sales, purchase, GST (CGST / SGST / IGST) and
        deposit accounts are seeded. Add Bank and other ledgers yourself when needed.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="master-grid">
        <aside className="master-list">
          <input
            className="input"
            placeholder="Search ledgers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="master-list-toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={reset}>
              + New Ledger
            </button>
            <ListPager
              compact
              page={pager.page}
              totalPages={pager.totalPages}
              total={pager.total}
              pageSize={pager.pageSize}
              onPage={pager.setPage}
              onExport={exportRows}
            />
          </div>
          <div className="master-list-scroll">
            {pager.pageRows.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`master-list-item${editId === l.id ? ' active' : ''}`}
                onClick={() => select(l)}
              >
                <strong>{l.code}</strong>
                <span>{l.name}</span>
                <small>
                  {l.ledger_type}
                  {l.is_cash ? ' · Cash' : ''}
                  {l.is_bank ? ' · Bank' : ''}
                  {l.is_party_deposit ? ' · Deposit' : ''}
                </small>
              </button>
            ))}
          </div>
        </aside>

        <div className="master-form">
          <div className="settings-box">
            <div className="settings-field-row">
              <label className="settings-field">
                <span>Code</span>
                <input
                  className="input"
                  value={editId ? form.code : nextCode}
                  readOnly
                  disabled
                  title="Auto-generated on save"
                />
                {!editId && <small className="hint">Assigned automatically on save</small>}
              </label>
              <label className="settings-field">
                <span>Name *</span>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
            </div>
            <div className="settings-field-row">
              <label className="settings-field">
                <span>Group</span>
                <input
                  className="input"
                  value={form.group_name}
                  onChange={(e) => setForm((f) => ({ ...f, group_name: e.target.value }))}
                />
              </label>
              <label className="settings-field">
                <span>Ledger Type *</span>
                <select
                  className="input"
                  value={form.ledger_type}
                  onChange={(e) => setForm((f) => ({ ...f, ledger_type: e.target.value }))}
                >
                  {LEDGER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="settings-field-row">
              <label className="settings-field">
                <span>Opening Balance</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={form.opening_balance}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, opening_balance: Number(e.target.value) || 0 }))
                  }
                />
              </label>
              <label className="settings-field">
                <span>Sort Order</span>
                <input
                  className="input"
                  type="number"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sort_order: Number(e.target.value) || 0 }))
                  }
                />
              </label>
            </div>
            <div className="settings-field-row" style={{ gap: 24 }}>
              <label>
                <input
                  type="checkbox"
                  checked={form.is_cash}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      is_cash: e.target.checked,
                      is_bank: e.target.checked ? false : f.is_bank,
                    }))
                  }
                />{' '}
                Cash Ledger
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.is_bank}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      is_bank: e.target.checked,
                      is_cash: e.target.checked ? false : f.is_cash,
                    }))
                  }
                />{' '}
                Bank Ledger
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.is_party_deposit}
                  onChange={(e) => setForm((f) => ({ ...f, is_party_deposit: e.target.checked }))}
                />{' '}
                Customer Deposit
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
                {editId ? 'Update' : 'Create'}
              </button>
              {editId && (
                <button type="button" className="btn" disabled={busy} onClick={() => void remove()}>
                  Deactivate
                </button>
              )}
              <button type="button" className="btn" onClick={reset}>
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
