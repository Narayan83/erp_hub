import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from '../../api/client'
import { ListPager } from './ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { fmt } from '../../lib/generp/saleBillMath'

export type BillFinderRow = {
  id: string
  voucher_no: string
  voucher_date: string
  party_name?: string | null
  party_code?: string | null
  party_phone?: string | null
  net_amount?: number | string | null
}

type Props = {
  voucherType: string
  actionLabel: string
  onPick: (row: BillFinderRow) => void
  extraActions?: (row: BillFinderRow) => ReactNode
}

export function BillFinder({ voucherType, actionLabel, onPick, extraActions }: Props) {
  const [billNo, setBillNo] = useState('')
  const [partyName, setPartyName] = useState('')
  const [partyPhone, setPartyPhone] = useState('')
  const [partyCode, setPartyCode] = useState('')
  const [rows, setRows] = useState<BillFinderRow[]>([])
  const [listingLast, setListingLast] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const loadLast = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const list = await api.get<BillFinderRow[]>('/vouchers', {
        voucher_type: voucherType,
        include_cancelled: '0',
        limit: 5,
      })
      setRows(list)
      setListingLast(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load bills')
    } finally {
      setBusy(false)
    }
  }, [voucherType])

  useEffect(() => {
    void loadLast()
  }, [loadLast])

  const search = async () => {
    const no = billNo.trim()
    const name = partyName.trim()
    const phone = partyPhone.trim()
    const code = partyCode.trim()
    if (!no && !name && !phone && !code) {
      await loadLast()
      return
    }
    setBusy(true)
    setError('')
    try {
      const list = await api.get<BillFinderRow[]>('/vouchers', {
        voucher_type: voucherType,
        include_cancelled: '0',
        voucher_no: no || undefined,
        party_name: name || undefined,
        party_phone: phone || undefined,
        party_code: code || undefined,
        limit: 50,
      })
      setRows(list)
      setListingLast(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed')
    } finally {
      setBusy(false)
    }
  }

  const pager = useClientPager(rows, `${listingLast}|${rows.length}|${billNo}`, TABLE_PAGE_SIZE)

  const exportRows = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel(listingLast ? 'recent-bills' : 'bills-search', {
      name: 'Bills',
      headers: ['Bill No', 'Date', 'Cust ID', 'Customer', 'Mobile', 'Net'],
      rows: rows.map((b) => [
        b.voucher_no,
        String(b.voucher_date || '').slice(0, 10),
        b.party_code || '',
        b.party_name || 'Walk-in',
        b.party_phone || '',
        Number(b.net_amount || 0),
      ]),
    }, format)
  }

  return (
    <div className="bill-finder">
      <p className="modify-hint">
        Last 5 bills are listed below. Search older bills by bill number, customer name, mobile, or
        customer ID.
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="sb-row" style={{ flexWrap: 'wrap' }}>
        <span className="field-label">Bill No</span>
        <input
          className="input"
          value={billNo}
          placeholder="Bill number"
          style={{ minWidth: 140, flex: 1 }}
          onChange={(e) => setBillNo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search()
          }}
        />
        <span className="field-label">Customer</span>
        <input
          className="input"
          value={partyName}
          placeholder="Name"
          style={{ minWidth: 140, flex: 1 }}
          onChange={(e) => setPartyName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search()
          }}
        />
        <span className="field-label">Mobile</span>
        <input
          className="input"
          value={partyPhone}
          placeholder="Mobile"
          style={{ minWidth: 120 }}
          onChange={(e) => setPartyPhone(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search()
          }}
        />
        <span className="field-label">Cust ID</span>
        <input
          className="input"
          value={partyCode}
          placeholder="1, 2, 3…"
          style={{ width: 80 }}
          onChange={(e) => setPartyCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search()
          }}
        />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void search()}>
          Search
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void loadLast()}>
          Last 5
        </button>
      </div>

      <table className="table" style={{ marginTop: 12, marginBottom: 12 }}>
        <thead>
          <tr>
            <th>Bill No</th>
            <th>Date</th>
            <th>Cust ID</th>
            <th>Customer</th>
            <th>Mobile</th>
            <th className="num">Net</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {pager.pageRows.map((b) => (
            <tr key={b.id}>
              <td>{b.voucher_no}</td>
              <td>{String(b.voucher_date || '').slice(0, 10)}</td>
              <td>{b.party_code || '—'}</td>
              <td>{b.party_name || 'Walk-in'}</td>
              <td>{b.party_phone || '—'}</td>
              <td className="num">{fmt(Number(b.net_amount || 0))}</td>
              <td>
                <button type="button" className="btn" onClick={() => onPick(b)}>
                  {actionLabel}
                </button>
                {extraActions?.(b)}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={7} style={{ textAlign: 'center', opacity: 0.7 }}>
                {listingLast ? 'No recent bills' : 'No matching bills'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <ListPager
        page={pager.page}
        totalPages={pager.totalPages}
        total={pager.total}
        pageSize={pager.pageSize}
        onPage={pager.setPage}
        onExport={exportRows}
      />
    </div>
  )
}
