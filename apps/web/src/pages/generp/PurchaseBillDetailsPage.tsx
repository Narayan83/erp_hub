import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { pageCount, TABLE_PAGE_SIZE } from '../../lib/generp/paginate'
import { fmt, todayISO } from '../../lib/generp/saleBillMath'
import type { Voucher } from '../../generpTypes'
import { PurchaseBillPage } from './PurchaseBillPage'

type PurchaseRow = {
  id: string
  voucher_no: string
  voucher_date: string
  party_name?: string | null
  party_bill_no?: string | null
  net_amount: number
  is_cancelled: boolean
  is_credit: boolean
  is_parked?: boolean
}

type PurchasePage = {
  rows: PurchaseRow[]
  total: number
  page: number
  page_size: number
}

function monthStartISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function PurchaseBillDetailsPage() {
  const [dateFrom, setDateFrom] = useState(monthStartISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [supplierName, setSupplierName] = useState('')
  const [billNo, setBillNo] = useState('')
  const [partyBillNo, setPartyBillNo] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending'>('all')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<PurchaseRow[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const loadRef = useRef<((v: Voucher) => void) | null>(null)

  const load = useCallback(async (nextPage = page) => {
    setBusy(true)
    setError('')
    try {
      const data = await api.get<PurchasePage>('/vouchers/paged', {
        voucher_type: 'PURCHASE',
        date_from: statusFilter === 'pending' ? undefined : dateFrom || undefined,
        date_to: statusFilter === 'pending' ? undefined : dateTo || undefined,
        party_name: supplierName.trim() || undefined,
        voucher_no: billNo.trim() || undefined,
        party_bill_no: partyBillNo.trim() || undefined,
        parked_only: statusFilter === 'pending' ? 'true' : undefined,
        page: nextPage,
        page_size: TABLE_PAGE_SIZE,
        include_cancelled: 'true',
      })
      setRows(data.rows)
      setTotal(data.total)
      setPage(data.page)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load purchase bills')
      setRows([])
      setTotal(0)
    } finally {
      setBusy(false)
    }
  }, [dateFrom, dateTo, supplierName, billNo, partyBillNo, page, statusFilter])

  useEffect(() => {
    void load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, statusFilter])

  const search = () => {
    setPage(1)
    void load(1)
  }

  const openEdit = async (row: PurchaseRow) => {
    if (row.is_cancelled) {
      alert('This bill is deleted. Restore it from Audit Trail.')
      return
    }
    try {
      const voucher = await api.get<Voucher>(`/vouchers/${row.id}`)
      setEditId(row.id)
      loadRef.current?.(voucher)
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to load purchase bill')
    }
  }

  const remove = async (row: PurchaseRow) => {
    if (row.is_cancelled) return
    if (
      !confirm(
        `Delete purchase bill ${row.voucher_no}? You can restore it later from Audit Trail.`,
      )
    ) {
      return
    }
    try {
      await api.delete(`/vouchers/${row.id}`)
      if (editId === row.id) {
        setEditId(null)
      }
      await load(page)
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Delete failed')
    }
  }

  const exportRows = async (format: SpreadsheetFormat = 'xlsx') => {
    try {
      const data = await api.get<PurchasePage>('/vouchers/paged', {
        voucher_type: 'PURCHASE',
        date_from: statusFilter === 'pending' ? undefined : dateFrom || undefined,
        date_to: statusFilter === 'pending' ? undefined : dateTo || undefined,
        party_name: supplierName.trim() || undefined,
        voucher_no: billNo.trim() || undefined,
        party_bill_no: partyBillNo.trim() || undefined,
        parked_only: statusFilter === 'pending' ? 'true' : undefined,
        page: 1,
        page_size: 100,
        include_cancelled: 'true',
      })
      downloadExcel('purchase-bill-details', {
        name: 'Purchase Bills',
        headers: ['Bill No', 'Date', 'Supplier/Vendor', 'Party Bill No', 'Amount', 'Status'],
        rows: data.rows.map((r) => [
          r.voucher_no,
          String(r.voucher_date).slice(0, 10),
          r.party_name || '',
          r.party_bill_no || '',
          Number(r.net_amount || 0),
          r.is_cancelled ? 'Deleted' : r.is_parked ? 'Pending price' : r.is_credit ? 'Credit' : 'Paid',
        ]),
      }, format)
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Export failed')
    }
  }

  const totalPages = pageCount(total, TABLE_PAGE_SIZE)

  return (
    <div className="modify-page">
      <h2>Purchase Bill Details</h2>
      <p className="hint">
        Search purchase bills, then edit the full bill or delete it. Deleted bills can be restored
        from Audit Trail. Use Pending to price for parked purchases that still need rates.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="settings-box settings-box--form">
        <div className="settings-field-row">
          <label className="settings-field">
            <span>From</span>
            <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="settings-field">
            <span>To</span>
            <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label className="settings-field">
            <span>Supplier/Vendor</span>
            <input
              className="input"
              value={supplierName}
              placeholder="Name"
              onChange={(e) => setSupplierName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  search()
                }
              }}
            />
          </label>
          <label className="settings-field">
            <span>Bill No</span>
            <input
              className="input"
              value={billNo}
              placeholder="Bill no"
              onChange={(e) => setBillNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  search()
                }
              }}
            />
          </label>
          <label className="settings-field">
            <span>Party Bill No</span>
            <input
              className="input"
              value={partyBillNo}
              placeholder="Supplier bill no"
              onChange={(e) => setPartyBillNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  search()
                }
              }}
            />
          </label>
          <label className="settings-field">
            <span>Show</span>
            <select
              className="input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value === 'pending' ? 'pending' : 'all')}
            >
              <option value="all">All bills</option>
              <option value="pending">Pending to price</option>
            </select>
          </label>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={search}>
          {busy ? 'Loading…' : 'Search'}
        </button>
      </div>

      <ListPager
        topRight
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={TABLE_PAGE_SIZE}
        onPage={(p) => {
          setPage(p)
          void load(p)
        }}
        onExport={(format) => void exportRows(format)}
      />

      <div className="table-wrap">
        <table className="table data-table">
          <thead>
            <tr>
              <th></th>
              <th>Bill No</th>
              <th>Date</th>
              <th>Supplier/Vendor</th>
              <th>Party Bill No</th>
              <th className="num">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7}>{busy ? 'Loading…' : 'No purchase bills in this filter.'}</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className={r.is_cancelled ? 'is-cancelled' : ''}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={r.is_cancelled}
                      onClick={() => void openEdit(r)}
                    >
                      Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="btn"
                      disabled={r.is_cancelled}
                      onClick={() => void remove(r)}
                    >
                      Delete
                    </button>
                  </td>
                  <td>{r.voucher_no}</td>
                  <td>{String(r.voucher_date).slice(0, 10)}</td>
                  <td>{r.party_name || '—'}</td>
                  <td>{r.party_bill_no || '—'}</td>
                  <td className="num">{fmt(Number(r.net_amount || 0))}</td>
                  <td>{r.is_cancelled ? 'Deleted' : r.is_parked ? 'Pending price' : r.is_credit ? 'Credit' : 'Paid'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PurchaseBillPage embeddedModify onEditIdChange={setEditId} loadVoucherRef={loadRef} />
    </div>
  )
}
