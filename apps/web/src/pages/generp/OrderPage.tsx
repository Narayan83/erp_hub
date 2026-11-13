import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { Typeahead } from '../../components/generp/Typeahead'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { TABLE_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { fmt, parseNum, todayISO } from '../../lib/generp/saleBillMath'
import type { GstRate, Order, OrderListItem, Party, Product } from '../../generpTypes'

type OrderType = 'SALES_ORDER' | 'PURCHASE_ORDER'

type LineRow = {
  key: string
  product_id: string
  productText: string
  quantity: number
  rate: number
  discount_amount: number
  gst_id: string
}

type Props = {
  orderType: OrderType
}

function newLineKey() {
  return `ol_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function emptyLine(): LineRow {
  return {
    key: newLineKey(),
    product_id: '',
    productText: '',
    quantity: 1,
    rate: 0,
    discount_amount: 0,
    gst_id: '',
  }
}

function monthStartISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const ORDER_META: Record<
  OrderType,
  { heading: string; partyType: 'customer' | 'vendor'; convertRoute: string; convertVoucherType: string }
> = {
  SALES_ORDER: {
    heading: 'Sales Order',
    partyType: 'customer',
    convertRoute: '/sale_bill',
    convertVoucherType: 'SALE',
  },
  PURCHASE_ORDER: {
    heading: 'Purchase Order',
    partyType: 'vendor',
    convertRoute: '/purchase_bill',
    convertVoucherType: 'PURCHASE',
  },
}

export function OrderPage({ orderType }: Props) {
  const meta = ORDER_META[orderType]
  const navigate = useNavigate()

  const [parties, setParties] = useState<Party[]>([])
  const [gstRates, setGstRates] = useState<GstRate[]>([])
  const [party, setParty] = useState<Party | null>(null)
  const [partyText, setPartyText] = useState('')
  const [orderDate, setOrderDate] = useState(todayISO())
  const [nextNo, setNextNo] = useState('—')
  const [narration, setNarration] = useState('')
  const [billDiscount, setBillDiscount] = useState('0')
  const [lines, setLines] = useState<LineRow[]>([emptyLine()])
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [loadedStatus, setLoadedStatus] = useState('')

  const [listFrom, setListFrom] = useState(monthStartISO())
  const [listTo, setListTo] = useState(todayISO())
  const [orders, setOrders] = useState<OrderListItem[]>([])

  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const gstById = useMemo(() => {
    const m: Record<string, GstRate> = {}
    for (const g of gstRates) m[g.id] = g
    return m
  }, [gstRates])

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
      rows.find((p) => String(p.code || '').trim().toLowerCase() === low) ?? null
    )
  }, [])

  const resetPendingNo = useCallback(() => {
    setNextNo('—')
  }, [])

  const loadOrders = useCallback(async () => {
    const rows = await api.get<OrderListItem[]>('/orders', {
      order_type: orderType,
      date_from: listFrom,
      date_to: listTo,
    })
    setOrders(rows)
  }, [orderType, listFrom, listTo])

  useEffect(() => {
    void (async () => {
      try {
        const [p, g] = await Promise.all([
          api.get<Party[]>('/parties', { party_type: meta.partyType }),
          api.get<GstRate[]>('/gst'),
        ])
        setParties(p)
        setGstRates(g)
        await loadOrders()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load')
      }
    })()
  }, [meta.partyType, loadOrders])

  const resetForm = async () => {
    setLoadedId(null)
    setLoadedStatus('')
    setParty(null)
    setPartyText('')
    setNarration('')
    setBillDiscount('0')
    setOrderDate(todayISO())
    setLines([emptyLine()])
    setStatus('')
    setError('')
    resetPendingNo()
  }

  const populateOrder = (o: Order) => {
    setLoadedId(o.id)
    setLoadedStatus(o.status)
    setOrderDate(o.order_date)
    setNextNo(o.order_no)
    setNarration(o.narration || '')
    setBillDiscount(String(o.discount_amount || 0))
    setParty(
      o.party_id
        ? {
            id: o.party_id,
            name: o.party_name || '',
            code: '',
          }
        : null,
    )
    setPartyText(o.party_name ? o.party_name : '')
    setLines(
      (o.items || []).map((it) => ({
        key: it.id || newLineKey(),
        product_id: it.product_id,
        productText: `${it.product_code || ''} — ${it.product_name || ''}`.trim(),
        quantity: Number(it.quantity || 0),
        rate: Number(it.rate || 0),
        discount_amount: Number(it.discount_amount || 0),
        gst_id: it.gst_id || '',
      })),
    )
    if (!(o.items || []).length) setLines([emptyLine()])
    setStatus(`Loaded ${o.order_no} (${o.status})`)
  }

  const loadOrder = async (id: string) => {
    setBusy(true)
    setError('')
    try {
      const o = await api.get<Order>(`/orders/${id}`)
      populateOrder(o)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed')
    } finally {
      setBusy(false)
    }
  }

  const updateLine = (key: string, patch: Partial<LineRow>) => {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const selectProduct = (key: string, p: Product) => {
    const rate =
      orderType === 'PURCHASE_ORDER'
        ? Number(p.purchase_price || 0)
        : Number(p.sale_price || 0)
    updateLine(key, {
      product_id: p.id,
      productText: productLabel(p),
      rate,
      gst_id: p.gst_id || '',
    })
  }

  const save = async () => {
    if (loadedId && loadedStatus === 'FULFILLED') {
      setError('This order is already fulfilled.')
      return
    }
    const validLines = lines.filter((l) => l.product_id && l.quantity > 0)
    if (!validLines.length) {
      setError('Add at least one product line.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload = {
        order_type: orderType,
        order_date: orderDate,
        party_id: party?.id || null,
        narration: narration.trim() || null,
        discount_amount: parseNum(billDiscount),
        items: validLines.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          rate: l.rate,
          discount_amount: l.discount_amount,
          gst_id: l.gst_id || null,
        })),
      }
      const result = loadedId
        ? await api.put<Order>(`/orders/${loadedId}`, payload)
        : await api.post<Order>('/orders', payload)
      setStatus(`Saved ${result.order_no}`)
      await loadOrders()
      await resetForm()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const cancelOrder = async (id: string) => {
    if (!confirm('Cancel this order?')) return
    setBusy(true)
    setError('')
    try {
      await api.delete(`/orders/${id}`)
      setStatus('Order cancelled')
      if (loadedId === id) {
        setLoadedStatus('CANCELLED')
      }
      await loadOrders()
      if (loadedId === id) resetPendingNo()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cancel failed')
    } finally {
      setBusy(false)
    }
  }

  const convertOrder = async (id: string) => {
    if (!confirm('Convert this order to a voucher?')) return
    setBusy(true)
    setError('')
    try {
      const result = await api.post<{
        voucher_no?: string | null
        voucher_type: string
        voucher_id: string
      }>(`/orders/${id}/convert`, {
        voucher_type: meta.convertVoucherType,
        voucher_date: orderDate,
      })
      const msg = result.voucher_no
        ? `Converted to ${result.voucher_type} ${result.voucher_no}`
        : `Converted to ${result.voucher_type}`
      setStatus(msg)
      alert(msg)
      await loadOrders()
      if (
        window.confirm(
          `Open ${meta.convertRoute.replace('/', '')} page?`,
        )
      ) {
        navigate(meta.convertRoute)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Convert failed')
    } finally {
      setBusy(false)
    }
  }

  const lineTotal = (l: LineRow) => {
    const gross = l.quantity * l.rate
    return gross - l.discount_amount
  }

  const estimatedNet = lines.reduce((sum, l) => sum + lineTotal(l), 0) - parseNum(billDiscount)
  const ordersPager = useClientPager(orders, `${orderType}|${orders.length}`, TABLE_PAGE_SIZE)

  const exportOrders = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel(orderType.toLowerCase().replace(/_/g, '-'), {
      name: 'Orders',
      headers: ['Order No', 'Date', 'Party', 'Status', 'Net'],
      rows: orders.map((o) => [
        o.order_no,
        o.order_date,
        o.party_name || '',
        o.is_cancelled ? 'Cancelled' : o.status,
        Number(o.net_amount || 0),
      ]),
    }, format)
  }

  return (
    <div className="sale-bill">
      <h2>{meta.heading}</h2>
      <p className="hint">
        Order number is assigned when you save{nextNo !== '—' ? ` · ${nextNo}` : ''}
      </p>
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="hint">{status}</p>}

      <div className="settings-box" style={{ marginBottom: 16 }}>
        <div className="settings-field-row">
          <label className="settings-field">
            <span>{meta.partyType === 'customer' ? 'Customer' : 'Supplier/Vendor'}</span>
            <Typeahead
              value={partyText}
              onChange={(v) => {
                setPartyText(v)
                setParty(null)
              }}
              onSelect={(p) => {
                setParty(p)
                setPartyText(`${p.code || ''} — ${p.name}`)
              }}
              items={parties}
              getLabel={(p) => `${p.code || ''} — ${p.name}`}
              getKey={(p) => p.id}
              placeholder={`Search ${meta.partyType}`}
            />
          </label>
          <label className="settings-field">
            <span>Order Date</span>
            <input
              className="input"
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>Bill Discount</span>
            <input
              className="input"
              value={billDiscount}
              onChange={(e) => setBillDiscount(e.target.value)}
            />
          </label>
        </div>
        <label className="settings-field">
          <span>Narration</span>
          <input
            className="input"
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
          />
        </label>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Lines</h3>
          <button type="button" className="btn" onClick={() => setLines((r) => [...r, emptyLine()])}>
            + Add Line
          </button>
        </div>
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Product</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Disc Amt</th>
              <th>GST</th>
              <th>Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key}>
                <td style={{ minWidth: 200 }}>
                  <Typeahead
                    value={line.productText}
                    onChange={(v) => updateLine(line.key, { productText: v, product_id: '' })}
                    onSelect={(p) => selectProduct(line.key, p)}
                    searchItems={searchProducts}
                    getLabel={productLabel}
                    getKey={(p) => p.id}
                    pickExact={pickExactProduct}
                  />
                </td>
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
                    type="number"
                    step="0.01"
                    value={line.discount_amount}
                    onChange={(e) =>
                      updateLine(line.key, { discount_amount: parseNum(e.target.value) })
                    }
                  />
                </td>
                <td>
                  <select
                    className="input"
                    value={line.gst_id}
                    onChange={(e) => updateLine(line.key, { gst_id: e.target.value })}
                  >
                    <option value="">—</option>
                    {gstRates.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name || g.rate}%
                      </option>
                    ))}
                  </select>
                  {line.gst_id && gstById[line.gst_id]?.rate != null && (
                    <small className="hint">{Number(gstById[line.gst_id].rate)}%</small>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>{fmt(lineTotal(line))}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setLines((rows) =>
                        rows.length <= 1 ? rows : rows.filter((r) => r.key !== line.key),
                      )
                    }
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint" style={{ textAlign: 'right', marginTop: 8 }}>
          Est. net (excl. GST): {fmt(estimatedNet)}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          Save Order
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void resetForm()}>
          Clear
        </button>
      </div>

      <div className="card">
        <h3>Orders</h3>
        <div className="settings-field-row" style={{ marginBottom: 12 }}>
          <label className="settings-field">
            <span>From</span>
            <input
              className="input"
              type="date"
              value={listFrom}
              onChange={(e) => setListFrom(e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>To</span>
            <input
              className="input"
              type="date"
              value={listTo}
              onChange={(e) => setListTo(e.target.value)}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => void loadOrders()}>
              Refresh
            </button>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Order No</th>
              <th>Date</th>
              <th>Party</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Net</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ordersPager.pageRows.map((o) => (
              <tr key={o.id} style={o.is_cancelled ? { opacity: 0.6 } : undefined}>
                <td>{o.order_no}</td>
                <td>{o.order_date}</td>
                <td>{o.party_name || '—'}</td>
                <td>{o.is_cancelled ? 'Cancelled' : o.status}</td>
                <td style={{ textAlign: 'right' }}>{fmt(Number(o.net_amount))}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn" onClick={() => void loadOrder(o.id)}>
                    Load
                  </button>{' '}
                  {!o.is_cancelled && o.status !== 'FULFILLED' && (
                    <>
                      <button type="button" className="btn" onClick={() => void convertOrder(o.id)}>
                        Convert
                      </button>{' '}
                      <button type="button" className="btn" onClick={() => void cancelOrder(o.id)}>
                        Cancel
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ListPager
          page={ordersPager.page}
          totalPages={ordersPager.totalPages}
          total={ordersPager.total}
          pageSize={ordersPager.pageSize}
          onPage={ordersPager.setPage}
          onExport={exportOrders}
        />
      </div>
    </div>
  )
}

export function SalesOrderPage() {
  return <OrderPage orderType="SALES_ORDER" />
}

export function PurchaseOrderPage() {
  return <OrderPage orderType="PURCHASE_ORDER" />
}
