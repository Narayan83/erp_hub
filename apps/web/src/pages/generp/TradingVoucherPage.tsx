import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { Typeahead } from '../../components/generp/Typeahead'
import { BillFormatSelect } from '../../components/generp/BillFormatSelect'
import { loadBillFormat, normalizeBillFormat, readLocalBillFormat, saveBillFormat, voucherReportCode } from '../../lib/generp/billFormat'
import { fmt, parseNum, todayISO } from '../../lib/generp/saleBillMath'
import type { CompanyProfile, GstRate, Party, Product, Voucher } from '../../generpTypes'
import { lineAmounts } from '../../lib/generp/saleBillMath'

type VoucherKind = 'SALE_RETURN' | 'PURCHASE' | 'PURCHASE_RETURN'

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
  voucherType: VoucherKind
  heading: string
  partyType: 'customer' | 'vendor'
}

function newLineKey() {
  return `tv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function phoneDigits(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '')
}

function normalizePartyCode(code: string | null | undefined): string {
  const s = String(code || '').trim()
  if (/^\d+$/.test(s)) return String(Number(s))
  return s
}

function findPartyByCode(parties: Party[], code: string): Party | null {
  const wanted = normalizePartyCode(code)
  if (!wanted) return null
  return parties.find((p) => normalizePartyCode(p.code) === wanted) ?? null
}

function findPartyByPhone(parties: Party[], phone: string): Party | null {
  const digits = phoneDigits(phone)
  if (!digits) return null
  const exact = parties.find((p) => phoneDigits(p.phone) === digits)
  if (exact) return exact
  if (digits.length >= 10) {
    const tail = digits.slice(-10)
    return (
      parties.find((p) => {
        const v = phoneDigits(p.phone)
        return v.length >= 10 && v.slice(-10) === tail
      }) ?? null
    )
  }
  return null
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

export function TradingVoucherPage({ voucherType, heading, partyType }: Props) {
  const [parties, setParties] = useState<Party[]>([])
  const [gstRates, setGstRates] = useState<GstRate[]>([])
  const [party, setParty] = useState<Party | null>(null)
  const [partyText, setPartyText] = useState('')
  const [partyCode, setPartyCode] = useState('')
  const [partyPhone, setPartyPhone] = useState('')
  const [voucherDate, setVoucherDate] = useState(todayISO())
  const [nextNo, setNextNo] = useState('—')
  const [narration, setNarration] = useState('')
  const [billDiscount, setBillDiscount] = useState('0')
  const [lines, setLines] = useState<LineRow[]>([emptyLine()])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [taxInclusive, setTaxInclusive] = useState(false)
  const reportCode = voucherReportCode(voucherType)
  const [billFormat, setBillFormat] = useState(() => readLocalBillFormat(reportCode))

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

  useEffect(() => {
    void (async () => {
      try {
        const [p, g, profile] = await Promise.all([
          api.get<Party[]>('/parties', { party_type: partyType }),
          api.get<GstRate[]>('/gst'),
          api.get<CompanyProfile>('/company-profile').catch(() => null),
        ])
        setParties(p)
        setGstRates(g)
        const key =
          voucherType === 'PURCHASE' || voucherType === 'PURCHASE_RETURN'
            ? 'purchase_tax_mode'
            : 'sale_tax_mode'
        const raw = String(profile?.[key] || 'exclusive')
        setTaxInclusive(raw.toLowerCase() === 'inclusive')
        const fmtCode = await loadBillFormat(reportCode)
        setBillFormat(fmtCode)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load')
      }
    })()
  }, [partyType, reportCode, voucherType])

  const resetForm = async () => {
    setParty(null)
    setPartyText('')
    setPartyCode('')
    setPartyPhone('')
    setNarration('')
    setBillDiscount('0')
    setVoucherDate(todayISO())
    setLines([emptyLine()])
    setStatus('')
    setError('')
    resetPendingNo()
  }

  const updateLine = (key: string, patch: Partial<LineRow>) => {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const selectProduct = (key: string, p: Product) => {
    const rate =
      voucherType === 'PURCHASE'
        ? Number(p.purchase_price || 0)
        : Number(p.sale_price || 0)
    updateLine(key, {
      product_id: p.id,
      productText: productLabel(p),
      rate,
      gst_id: p.gst_id || '',
    })
  }

  const selectParty = (p: Party) => {
    setParty(p)
    setPartyText(p.name || '')
    setPartyCode(p.code || '')
    setPartyPhone(p.phone || '')
  }

  const resolvePartyCode = () => {
    const raw = partyCode.trim()
    if (!raw) return
    const match = findPartyByCode(parties, raw)
    if (match) selectParty(match)
  }

  const resolvePartyPhone = () => {
    const digits = phoneDigits(partyPhone)
    if (!digits) return
    const match = findPartyByPhone(parties, partyPhone)
    if (match) selectParty(match)
  }

  const resolvePartyName = () => {
    const text = partyText.trim()
    if (!text) return
    const match = parties.find((p) => (p.name || '').toLowerCase() === text.toLowerCase())
    if (match) selectParty(match)
  }

  const save = async () => {
    const validLines = lines.filter((l) => l.product_id && l.quantity > 0)
    if (!validLines.length) {
      setError('Add at least one product line.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await api.post<Voucher>('/vouchers', {
        voucher_type: voucherType,
        voucher_date: voucherDate,
        party_id: party?.id || null,
        narration: narration.trim() || null,
        discount_amount: parseNum(billDiscount),
        is_credit: voucherType === 'PURCHASE' || voucherType === 'SALE_RETURN',
        items: validLines.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          rate: l.rate,
          discount_amount: l.discount_amount,
          gst_id: l.gst_id || null,
        })),
        payments: [],
      })
      setStatus(`Saved ${result.voucher_no}`)
      await resetForm()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const lineGross = (l: LineRow) => {
    const gstRate = l.gst_id ? Number(gstById[l.gst_id]?.rate || 0) : 0
    const discPct =
      l.quantity * l.rate > 0 ? (l.discount_amount / (l.quantity * l.rate)) * 100 : 0
    return lineAmounts(
      {
        product_id: l.product_id,
        qty: l.quantity,
        rate: l.rate,
        disc_pct: discPct,
        gst_rate: gstRate,
      },
      taxInclusive,
    ).amount
  }

  return (
    <div className="sale-bill">
      <h2>{heading}</h2>
      <p className="hint">
        Voucher type: {voucherType} · Number assigned on save{nextNo !== '—' ? ` · ${nextNo}` : ''}
      </p>
      <div className="sb-row" style={{ marginBottom: 8 }}>
        <BillFormatSelect
          value={billFormat}
          documentCode={reportCode}
          onChange={(next) => {
            setBillFormat(normalizeBillFormat(next))
            void saveBillFormat(reportCode, next)
          }}
        />
      </div>
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="hint">{status}</p>}

      <div className="settings-box" style={{ marginBottom: 16 }}>
        <div className="settings-field-row">
          <label className="settings-field">
            <span>{partyType === 'customer' ? 'Cust ID' : 'Supp ID'}</span>
            <input
              className="input"
              value={partyCode}
              placeholder="1, 2, 3…"
              onChange={(e) => setPartyCode(e.target.value)}
              onBlur={resolvePartyCode}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  resolvePartyCode()
                }
              }}
            />
          </label>
          <label className="settings-field">
            <span>Mobile</span>
            <input
              className="input"
              value={partyPhone}
              placeholder="Mobile"
              onChange={(e) => setPartyPhone(e.target.value)}
              onBlur={resolvePartyPhone}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  resolvePartyPhone()
                }
              }}
            />
          </label>
          <label className="settings-field">
            <span>{partyType === 'customer' ? 'Customer' : 'Supplier/Vendor'}</span>
            <Typeahead
              value={partyText}
              onChange={(v) => {
                setPartyText(v)
                setParty(null)
              }}
              onSelect={selectParty}
              onEnter={resolvePartyName}
              items={parties}
              getLabel={(p) => p.name}
              getKey={(p) => p.id}
              placeholder={partyType === 'customer' ? 'Search name' : 'Search name'}
            />
          </label>
          <label className="settings-field">
            <span>Date</span>
            <input
              className="input"
              type="date"
              value={voucherDate}
              onChange={(e) => setVoucherDate(e.target.value)}
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
          <h3 style={{ margin: 0 }}>Line Items</h3>
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
              <th>Disc</th>
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
                        {g.name || `${g.rate}%`}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: 'right' }}>{fmt(lineGross(line))}</td>
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
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          Save Voucher
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void resetForm()}>
          Clear
        </button>
      </div>
    </div>
  )
}

export function SalesReturnPage() {
  return (
    <TradingVoucherPage
      voucherType="SALE_RETURN"
      heading="Sales Return"
      partyType="customer"
    />
  )
}

export function PurchaseReturnPage() {
  return (
    <TradingVoucherPage
      voucherType="PURCHASE_RETURN"
      heading="Purchase Return"
      partyType="vendor"
    />
  )
}
