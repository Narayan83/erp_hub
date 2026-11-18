import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { Typeahead } from '../../components/generp/Typeahead'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { parseNum, todayISO } from '../../lib/generp/saleBillMath'
import type {
  Branch,
  CompanyProfile,
  Lot,
  Product,
  StockVoucher,
  StockVoucherListItem,
} from '../../generpTypes'

type LineRole = 'NORMAL' | 'DEBIT' | 'CREDIT' | 'WASTAGE'

type LineRow = {
  key: string
  product_id: string
  productText: string
  line_role: LineRole
  quantity: number
  rate: number
  narration: string
  lot_id: string
}

type Props = {
  voucherType: string
  heading: string
}

const TRANSFER_TYPES = new Set(['TRANSFER_OUT', 'TRANSFER_IN'])
const ROLE_LINE_TYPES = new Set(['CONVERSION', 'EXCHANGE'])

function newLineKey() {
  return `ln_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function emptyLine(lineRole: LineRole = 'NORMAL'): LineRow {
  return {
    key: newLineKey(),
    product_id: '',
    productText: '',
    line_role: lineRole,
    quantity: 1,
    rate: 0,
    narration: '',
    lot_id: '',
  }
}

function monthStartISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function StockVoucherPage({ voucherType, heading }: Props) {
  const needsCounterparty = TRANSFER_TYPES.has(voucherType)
  const needsLineRole = ROLE_LINE_TYPES.has(voucherType)
  const isConversion = voucherType === 'CONVERSION'

  const [branches, setBranches] = useState<Branch[]>([])
  const [lotEnabled, setLotEnabled] = useState(false)
  const [lots, setLots] = useState<Lot[]>([])
  const [branchId, setBranchId] = useState('')
  const [counterpartyBranchId, setCounterpartyBranchId] = useState('')
  const [voucherDate, setVoucherDate] = useState(todayISO())
  const [nextNo, setNextNo] = useState('—')
  const [narration, setNarration] = useState('')
  const [referenceNo, setReferenceNo] = useState('')
  const [wastageQty, setWastageQty] = useState('0')
  const [lines, setLines] = useState<LineRow[]>([emptyLine(needsLineRole ? 'DEBIT' : 'NORMAL')])
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [loadedCancelled, setLoadedCancelled] = useState(false)

  const [listFrom, setListFrom] = useState(monthStartISO())
  const [listTo, setListTo] = useState(todayISO())
  const [recent, setRecent] = useState<StockVoucherListItem[]>([])

  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const searchProducts = useCallback(async (query: string) => {
    const q = query.trim()
    if (!q) return []
    return api.get<Product[]>('/products', { q, limit: 20 })
  }, [])

  const productLabel = useCallback(
    (p: Product) => `${p.code || ''} — ${p.name || ''}`,
    [],
  )

  const pickExactProduct = useCallback((query: string, rows: Product[]) => {
    const low = query.trim().toLowerCase()
    if (!low) return null
    return (
      rows.find((p) => {
        const code = String(p.code || '').trim().toLowerCase()
        const barcode = String(p.barcode || '').trim().toLowerCase()
        return (code && code === low) || (barcode && barcode === low)
      }) ?? null
    )
  }, [])

  const resetPendingNo = useCallback(() => {
    setNextNo('—')
  }, [])

  const loadBranches = useCallback(async () => {
    const [rows, profile] = await Promise.all([
      api.get<Branch[]>('/stock/branches'),
      api.get<CompanyProfile>('/company-profile').catch(() => null),
    ])
    setBranches(rows)
    const lotsOn = profile?.lot_enabled === true
    setLotEnabled(lotsOn)
    if (lotsOn) {
      const lotRows = await api.get<Lot[]>('/stock/lots').catch(() => [] as Lot[])
      setLots(lotRows.filter((l) => l.is_active !== false))
    } else {
      setLots([])
    }
    if (!branchId && rows.length) setBranchId(rows[0].id)
  }, [branchId])

  const loadRecent = useCallback(async () => {
    const rows = await api.get<StockVoucherListItem[]>('/stock/stock-vouchers', {
      voucher_type: voucherType,
      date_from: listFrom,
      date_to: listTo,
    })
    setRecent(rows)
  }, [voucherType, listFrom, listTo])

  useEffect(() => {
    void loadBranches().catch((err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to load')
    })
  }, [loadBranches])

  useEffect(() => {
    void (async () => {
      try {
        await loadRecent()
      } catch {
        /* list errors shown on refresh */
      }
    })()
  }, [loadRecent])

  const counterpartyOptions = useMemo(
    () => branches.filter((b) => b.id !== branchId),
    [branches, branchId],
  )

  const resetForm = useCallback(async () => {
    setLoadedId(null)
    setLoadedCancelled(false)
    setNarration('')
    setReferenceNo('')
    setWastageQty('0')
    setVoucherDate(todayISO())
    setLines([emptyLine(needsLineRole ? 'DEBIT' : 'NORMAL')])
    setStatus('')
    setError('')
    resetPendingNo()
  }, [needsLineRole, resetPendingNo])

  const populateFromVoucher = (v: StockVoucher) => {
    setLoadedId(v.id)
    setLoadedCancelled(Boolean(v.is_cancelled))
    setVoucherDate(v.voucher_date)
    setBranchId(v.branch_id || branchId)
    setCounterpartyBranchId(v.counterparty_branch_id || '')
    setNarration(v.narration || '')
    setReferenceNo(v.reference_no || '')
    setWastageQty(String(v.wastage_qty ?? 0))
    setNextNo(v.voucher_no)
    setLines(
      (v.items || []).map((it) => ({
        key: it.id || newLineKey(),
        product_id: it.product_id,
        productText: `${it.product_code || ''} — ${it.product_name || ''}`.trim(),
        line_role: (it.line_role || 'NORMAL') as LineRole,
        quantity: Number(it.quantity || 0),
        rate: Number(it.rate || 0),
        narration: it.narration || '',
        lot_id: '',
      })),
    )
    if (!(v.items || []).length) {
      setLines([emptyLine(needsLineRole ? 'DEBIT' : 'NORMAL')])
    }
    setStatus(`Loaded ${v.voucher_no}${v.is_cancelled ? ' (cancelled)' : ''}`)
    setError('')
  }

  const loadVoucher = async (id: string) => {
    setBusy(true)
    setError('')
    try {
      const v = await api.get<StockVoucher>(`/stock/stock-vouchers/${id}`)
      populateFromVoucher(v)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed')
    } finally {
      setBusy(false)
    }
  }

  const cancelVoucher = async (id: string) => {
    if (!confirm('Cancel this stock voucher? Stock will be reversed.')) return
    setBusy(true)
    setError('')
    try {
      await api.delete(`/stock/stock-vouchers/${id}`)
      setStatus('Voucher cancelled')
      if (loadedId === id) {
        setLoadedCancelled(true)
      }
      await loadRecent()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cancel failed')
    } finally {
      setBusy(false)
    }
  }

  const updateLine = (key: string, patch: Partial<LineRow>) => {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const selectProduct = (key: string, p: Product) => {
    updateLine(key, {
      product_id: p.id,
      productText: productLabel(p),
      rate: Number(p.purchase_price || p.sale_price || 0),
    })
  }

  const addLine = () => {
    setLines((rows) => [...rows, emptyLine(needsLineRole ? 'CREDIT' : 'NORMAL')])
  }

  const removeLine = (key: string) => {
    setLines((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.key !== key)))
  }

  const save = async () => {
    if (loadedId && loadedCancelled) {
      setError('This voucher is cancelled.')
      return
    }
    if (!branchId) {
      setError('Select a branch.')
      return
    }
    if (needsCounterparty && !counterpartyBranchId) {
      setError('Select counterparty branch for transfer.')
      return
    }
    const validLines = lines.filter((l) => l.product_id && l.quantity > 0)
    if (!validLines.length) {
      setError('Add at least one product line with quantity.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await api.post<StockVoucher>('/stock/stock-vouchers', {
        voucher_type: voucherType,
        voucher_date: voucherDate,
        branch_id: branchId,
        counterparty_branch_id: needsCounterparty ? counterpartyBranchId : null,
        reference_no: referenceNo.trim() || null,
        narration: narration.trim() || null,
        wastage_qty: isConversion ? parseNum(wastageQty) : 0,
        items: validLines.map((l) => ({
          product_id: l.product_id,
          line_role: needsLineRole ? l.line_role : 'NORMAL',
          quantity: l.quantity,
          rate: l.rate,
          narration: l.narration.trim() || null,
          lot_id: l.lot_id || null,
        })),
      })
      setStatus(`Saved ${result.voucher_no}`)
      await loadRecent()
      await resetForm()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const recentPager = useClientPager(
    recent,
    `${voucherType}|${listFrom}|${listTo}|${recent.length}`,
    TABLE_PAGE_SIZE,
  )

  const exportRecent = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel(`${voucherType.toLowerCase().replace(/_/g, '-')}-vouchers`, {
      name: 'Vouchers',
      headers: ['Voucher No', 'Date', 'Items', 'Narration', 'Status'],
      rows: recent.map((v) => [
        v.voucher_no,
        v.voucher_date,
        v.item_count ?? 0,
        v.narration || '',
        v.is_cancelled ? 'Cancelled' : 'Active',
      ]),
    }, format)
  }

  return (
    <div className="stock-voucher-page">
      <div className="sv-head">
        <div>
          <h2>{heading}</h2>
          <p className="hint mb-0">
            <strong>{voucherType}</strong>
            {status ? ` · ${status}` : ''}
          </p>
        </div>
        <div className="sv-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            Save
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void resetForm()}>
            Clear
          </button>
          {loadedId && !loadedCancelled && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void cancelVoucher(loadedId)}
            >
              Cancel voucher
            </button>
          )}
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}

      <div className="sv-form">
        <div className="sv-field">
          <span className="field-label">Date</span>
          <input
            className="input"
            type="date"
            value={voucherDate}
            onChange={(e) => setVoucherDate(e.target.value)}
          />
        </div>
        <div className="sv-field">
          <span className="field-label">Voucher No</span>
          <input className="input" readOnly value={nextNo} tabIndex={-1} title="Assigned when you save" />
        </div>
        <div className="sv-field">
          <span className="field-label">Reference</span>
          <input
            className="input"
            value={referenceNo}
            onChange={(e) => setReferenceNo(e.target.value)}
          />
        </div>
        <div className="sv-field">
          <span className="field-label">Branch *</span>
          <select
            className="input"
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value)
              if (e.target.value === counterpartyBranchId) setCounterpartyBranchId('')
            }}
          >
            <option value="">— Select —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </select>
        </div>
        {needsCounterparty && (
          <div className="sv-field">
            <span className="field-label">To / From Branch *</span>
            <select
              className="input"
              value={counterpartyBranchId}
              onChange={(e) => setCounterpartyBranchId(e.target.value)}
            >
              <option value="">— Select —</option>
              {counterpartyOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {isConversion && (
          <div className="sv-field sv-field-sm">
            <span className="field-label">Wastage Qty</span>
            <input
              className="input"
              type="number"
              step="0.001"
              value={wastageQty}
              onChange={(e) => setWastageQty(e.target.value)}
            />
          </div>
        )}
        <div className="sv-field sv-field-wide">
          <span className="field-label">Narration</span>
          <input
            className="input"
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder={
              isConversion
                ? 'DEBIT = source (bags), CREDIT = packs; wastage = process loss'
                : undefined
            }
          />
        </div>
      </div>

      <div className="sv-lines card">
        <div className="sv-lines-head">
          <h3>Line Items</h3>
          <button type="button" className="btn" onClick={addLine}>
            + Add Line
          </button>
        </div>
        <div className="table-responsive">
          <table className="table sv-table">
            <thead>
              <tr>
                <th style={{ width: needsLineRole ? '34%' : '42%' }}>Product</th>
                {needsLineRole && <th style={{ width: '12%' }}>Role</th>}
                {lotEnabled ? <th style={{ width: '14%' }}>Lot</th> : null}
                <th style={{ width: '10%' }}>Qty</th>
                <th style={{ width: '10%' }}>Rate</th>
                <th>Line Narration</th>
                <th style={{ width: '44px' }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key}>
                  <td>
                    <Typeahead
                      value={line.productText}
                      onChange={(v) => updateLine(line.key, { productText: v, product_id: '' })}
                      onSelect={(p) => selectProduct(line.key, p)}
                      searchItems={searchProducts}
                      getLabel={productLabel}
                      getKey={(p) => p.id}
                      placeholder="Search product"
                      pickExact={pickExactProduct}
                    />
                  </td>
                  {needsLineRole && (
                    <td>
                      <select
                        className="input"
                        value={line.line_role}
                        onChange={(e) =>
                          updateLine(line.key, { line_role: e.target.value as LineRole })
                        }
                      >
                        <option value="DEBIT">DEBIT</option>
                        <option value="CREDIT">CREDIT</option>
                        <option value="WASTAGE">WASTAGE</option>
                      </select>
                    </td>
                  )}
                  {lotEnabled ? (
                    <td>
                      <select
                        className="input"
                        value={line.lot_id}
                        onChange={(e) => updateLine(line.key, { lot_id: e.target.value })}
                      >
                        <option value="">—</option>
                        {lots.map((lot) => (
                          <option key={lot.id} value={lot.id}>
                            {lot.code} {lot.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  ) : null}
                  <td>
                    <input
                      className="input"
                      type="number"
                      step="0.001"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(line.key, { quantity: parseNum(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      value={line.rate}
                      onChange={(e) => updateLine(line.key, { rate: parseNum(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      value={line.narration}
                      onChange={(e) => updateLine(line.key, { narration: e.target.value })}
                    />
                  </td>
                  <td>
                    <button type="button" className="btn" onClick={() => removeLine(line.key)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sv-recent card">
        <div className="sv-lines-head">
          <h3>Recent Vouchers</h3>
          <div className="sv-recent-filters">
            <input
              className="input"
              type="date"
              value={listFrom}
              onChange={(e) => setListFrom(e.target.value)}
              aria-label="From"
            />
            <input
              className="input"
              type="date"
              value={listTo}
              onChange={(e) => setListTo(e.target.value)}
              aria-label="To"
            />
            <button type="button" className="btn" disabled={busy} onClick={() => void loadRecent()}>
              Refresh
            </button>
          </div>
        </div>
        <div className="table-responsive">
          <table className="table sv-table">
            <thead>
              <tr>
                <th>Voucher No</th>
                <th>Date</th>
                <th>Items</th>
                <th>Narration</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="hint">
                    No vouchers in this period.
                  </td>
                </tr>
              )}
              {recentPager.pageRows.map((v) => (
                <tr key={v.id} style={v.is_cancelled ? { opacity: 0.6 } : undefined}>
                  <td>{v.voucher_no}</td>
                  <td>{v.voucher_date}</td>
                  <td>{v.item_count ?? 0}</td>
                  <td>{v.narration || '—'}</td>
                  <td>{v.is_cancelled ? 'Cancelled' : 'Active'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn" onClick={() => void loadVoucher(v.id)}>
                      Load
                    </button>{' '}
                    {!v.is_cancelled && (
                      <button type="button" className="btn" onClick={() => void cancelVoucher(v.id)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ListPager
          page={recentPager.page}
          totalPages={recentPager.totalPages}
          total={recentPager.total}
          pageSize={recentPager.pageSize}
          onPage={recentPager.setPage}
          onExport={exportRecent}
        />
      </div>
    </div>
  )
}

export function InwardDcPage() {
  return <StockVoucherPage voucherType="INWARD_DC" heading="Inward Delivery Challan" />
}
export function OutwardDcPage() {
  return <StockVoucherPage voucherType="OUTWARD_DC" heading="Outward Delivery Challan" />
}
export function InwardDcReturnPage() {
  return <StockVoucherPage voucherType="INWARD_DC_RETURN" heading="Inward DC Return" />
}
export function OutwardDcReturnPage() {
  return <StockVoucherPage voucherType="OUTWARD_DC_RETURN" heading="Outward DC Return" />
}
export function ShortageEntryPage() {
  return <StockVoucherPage voucherType="SHORTAGE" heading="Shortage Entry" />
}
export function ExcessEntryPage() {
  return <StockVoucherPage voucherType="EXCESS" heading="Excess Entry" />
}
export function WastageEntryPage() {
  return <StockVoucherPage voucherType="WASTAGE" heading="Wastage Entry" />
}
export function ExchangeEntryPage() {
  return <StockVoucherPage voucherType="EXCHANGE" heading="Exchange Entry" />
}
export function StockTransferOutPage() {
  return <StockVoucherPage voucherType="TRANSFER_OUT" heading="Stock Transfer to Branch" />
}
export function StockTransferInPage() {
  return <StockVoucherPage voucherType="TRANSFER_IN" heading="Stock Receive from Branch" />
}
export function StockConversionPage() {
  return <StockVoucherPage voucherType="CONVERSION" heading="Stock Conversion" />
}
