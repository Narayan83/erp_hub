import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../../api/client'
import {
  PartyDetailsForm,
  emptyPartyForm,
  partyToForm,
  savePartyRecord,
  type PartyFormState,
} from '../../components/generp/PartyDetailsForm'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { handleEnterAsTab } from '../../lib/generp/enterAsTab'
import { LIST_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import type { Party } from '../../generpTypes'

type Props = {
  partyType: 'customer' | 'vendor'
}

function blankForm(partyType: 'customer' | 'vendor'): PartyFormState {
  return emptyPartyForm({
    is_customer: partyType === 'customer',
    is_vendor: partyType === 'vendor',
  })
}

export function PartyMasterPage({ partyType }: Props) {
  const noun = partyType === 'customer' ? 'Customer' : 'Supplier/Vendor'
  const searchNoun = partyType === 'customer' ? 'customers' : 'suppliers/vendors'
  const [rows, setRows] = useState<Party[]>([])
  const [query, setQuery] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<PartyFormState>(() => blankForm(partyType))
  const [nextCode, setNextCode] = useState('1')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const [list, peek] = await Promise.all([
      api.get<Party[]>('/parties', { party_type: partyType }),
      api.get<{ next_code: string }>('/parties/next-code', { party_type: partyType }).catch(() => ({
        next_code: '1',
      })),
    ])
    setRows(list)
    setNextCode(peek.next_code || '1')
  }, [partyType])

  useEffect(() => {
    void (async () => {
      try {
        await load()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : `Failed to load ${searchNoun}`)
      }
    })()
  }, [load, searchNoun])

  useEffect(() => {
    setEditId(null)
    setForm(blankForm(partyType))
    setQuery('')
    setError('')
  }, [partyType])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const hay = [r.code, r.name, r.phone, r.gstin, r.city, r.email].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [rows, query])

  const pager = useClientPager(filtered, query, LIST_PAGE_SIZE)

  const exportRows = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel(partyType === 'customer' ? 'customers' : 'suppliers-vendors', {
      name: partyType === 'customer' ? 'Customers' : 'Suppliers/Vendors',
      headers: [
        'ID',
        'Name',
        'Phone',
        'Email',
        'GSTIN',
        'City',
        'State',
        'PIN',
        'Contact',
        'Address',
        'Opening',
      ],
      rows: filtered.map((p) => [
        p.code || '',
        p.name,
        p.phone || '',
        p.email || '',
        p.gstin || '',
        p.city || '',
        p.state || '',
        p.pin_code || '',
        p.contact_person || '',
        [p.address_line1, p.address_line2, p.address_line3, p.address_line4].filter(Boolean).join(', '),
        Number(p.opening_balance || 0),
      ]),
    }, format)
  }

  const select = (p: Party) => {
    setEditId(p.id)
    setForm(partyToForm(p))
    setError('')
  }

  const reset = () => {
    setEditId(null)
    setForm(blankForm(partyType))
    setError('')
  }

  const save = async () => {
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    if (!form.is_customer && !form.is_vendor) {
      setError('Select Customer, Supplier, or both.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await savePartyRecord(form, editId)
      await load()
      reset()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!editId) return
    if (!confirm(`Deactivate this ${noun.toLowerCase()}?`)) return
    setBusy(true)
    try {
      await api.delete(`/parties/${editId}`)
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
      <h2>{noun} {editId ? 'Details' : 'Creation'}</h2>
      <p className="hint">
        Complete {noun.toLowerCase()} information — contact, billing/shipping address, GSTIN, and photo.
        ID is 1, 2, 3… assigned automatically on save.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="master-grid">
        <aside className="master-list">
          <input
            className="input"
            placeholder={`Search ${searchNoun}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="master-list-toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={reset}>
              + New {noun}
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
            {pager.pageRows.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`master-list-item${editId === p.id ? ' active' : ''}`}
                onClick={() => select(p)}
              >
                <strong>
                  {p.code} · {p.name}
                </strong>
                <span>{p.phone || p.city || p.gstin || '—'}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="hint">No {searchNoun} found.</p>}
          </div>
        </aside>

        <div
          className="master-form party-enter-root"
          ref={formRef}
          onKeyDown={(e) => handleEnterAsTab(e, formRef.current)}
        >
          <div className="settings-box">
            <label className="settings-field">
              <span>{noun} ID</span>
              <input
                className="input"
                value={editId ? rows.find((r) => r.id === editId)?.code || '' : nextCode}
                readOnly
                disabled
                title="Auto-generated on save"
              />
            </label>
            <PartyDetailsForm form={form} onChange={setForm} />
          </div>
          <div className="sb-row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {editId ? 'Update' : 'Save'}
            </button>
            {editId ? (
              <button type="button" className="btn" data-skip-enter="true" disabled={busy} onClick={() => void remove()}>
                Deactivate
              </button>
            ) : null}
            <button type="button" className="btn" data-skip-enter="true" onClick={reset}>
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CustomerMasterPage() {
  return <PartyMasterPage partyType="customer" />
}

export function VendorMasterPage() {
  return <PartyMasterPage partyType="vendor" />
}
