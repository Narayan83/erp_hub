import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import type { Patient, Doctor, PayMode } from '../billing/types'
import { errMsg, fmtMoney, PHARMACY_ITEM_TYPES, todayIso, unwrapList, useOptions } from '../shared/hmsShared'

export type PharmacyBillKind = 'sale' | 'sale-return' | 'purchase' | 'purchase-return' | 'indent'

type KindConfig = {
  title: string
  hint?: string
  postPath: string
  lastInfoPath?: string
  batchPath?: string
  party: 'patient' | 'supplier' | 'ward'
  saveLabel: string
}

const CONFIG: Record<PharmacyBillKind, KindConfig> = {
  sale: {
    title: 'Medicine Sale Bill',
    postPath: '/hospital/pharmacy/sale-bills',
    lastInfoPath: '/hospital/pharmacy/sale-bills/last-info',
    batchPath: '/hospital/pharmacy/stock-batches',
    party: 'patient',
    saveLabel: 'Save Bill',
  },
  'sale-return': {
    title: 'Medicine Sales Return',
    hint: 'Batches shown are those returnable from earlier sales.',
    postPath: '/hospital/pharmacy/sale-returns',
    lastInfoPath: '/hospital/pharmacy/sale-returns/last-info',
    batchPath: '/hospital/pharmacy/returnable-sale-batches',
    party: 'patient',
    saveLabel: 'Save Return',
  },
  purchase: {
    title: 'Medicine Purchase Bill',
    postPath: '/hospital/pharmacy/purchase-bills',
    lastInfoPath: '/hospital/pharmacy/purchase-bills/last-info',
    party: 'supplier',
    saveLabel: 'Save Bill',
  },
  'purchase-return': {
    title: 'Medicine Purchase Return',
    hint: 'Return quantity cannot exceed current stock.',
    postPath: '/hospital/pharmacy/purchase-returns',
    party: 'supplier',
    saveLabel: 'Save Return',
  },
  indent: {
    title: 'Medicine Indent',
    hint: 'Issue stock to a ward.',
    postPath: '/hospital/pharmacy/indents',
    batchPath: '/hospital/pharmacy/stock-batches',
    party: 'ward',
    saveLabel: 'Save Indent',
  },
}

type SearchHit = {
  id: string
  code: string
  name: string
  generic_name?: string | null
  unit?: string | null
  sale_rate?: number | string | null
  mrp?: number | string | null
  schedule?: string | null
  stock_qty: number
}

type Batch = { batch_no?: string | null; expiry_date?: string | null; stock_qty: number; rate?: number | string | null }

type Line = {
  key: string
  item_id: string
  code: string
  name: string
  unit?: string | null
  item_type: string
  stock_qty: number
  quantity: string
  rate: string
  batch_no: string
  expiry_date: string
  tax_percent: string
  disc_percent: string
  batches: Batch[]
}

type Saved = { bill_no: string; net_amount: number | string }

const n = (v: string) => Number(v) || 0

function lineAmounts(l: Line) {
  const amount = n(l.quantity) * n(l.rate)
  const tax = (amount * n(l.tax_percent)) / 100
  const disc = (amount * n(l.disc_percent)) / 100
  return { amount, tax, disc, net: amount + tax - disc }
}

let keySeq = 0

/**
 * Shared desktop-style bill entry for pharmacy sale / purchase / return / indent screens.
 * See CONFIG above for the endpoint used per kind.
 */
export function PharmacyBillForm({ kind }: { kind: PharmacyBillKind }) {
  const cfg = CONFIG[kind]
  const isReturn = kind === 'sale-return' || kind === 'purchase-return'

  const [billDate, setBillDate] = useState(todayIso())
  const [lines, setLines] = useState<Line[]>([])
  const [billDiscount, setBillDiscount] = useState('0')
  const [remarks, setRemarks] = useState('')
  const [lastInfo, setLastInfo] = useState<{ last_bill_no: string | null; next_preview: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [busy, setBusy] = useState(false)

  // party: patient
  const [patientNo, setPatientNo] = useState('')
  const [patientId, setPatientId] = useState('')
  const [patientName, setPatientName] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [scheme, setScheme] = useState('')
  const [payModeId, setPayModeId] = useState('')
  const [isCash, setIsCash] = useState(true)
  const [address1, setAddress1] = useState('')
  const [address2, setAddress2] = useState('')
  // party: supplier / ward
  const [supplierId, setSupplierId] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [wardName, setWardName] = useState('')

  // item search
  const [itemType, setItemType] = useState('MD')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])

  const doctors = useOptions<Doctor>(
    '/hospital/doctors',
    (d) => ({ value: d.id, label: d.full_name }),
    { page: 1, page_size: 100 },
  )
  const payModes = useOptions<PayMode>('/hospital/payment-modes', (p) => ({ value: p.id, label: p.name }))
  const suppliers = useOptions<{ id: string; code: string; name: string }>(
    '/hospital/pharmacy/suppliers',
    (s) => ({ value: s.id, label: `${s.code} — ${s.name}` }),
  )
  const wards = useOptions<{ id: string; name: string }>('/hospital/wards', (w) => ({ value: w.name, label: w.name }))

  async function loadLastInfo() {
    if (!cfg.lastInfoPath) return
    try {
      setLastInfo(await api.get(cfg.lastInfoPath))
    } catch {
      setLastInfo(null)
    }
  }

  useEffect(() => {
    void loadLastInfo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits([])
      return
    }
    const t = window.setTimeout(() => {
      api
        .get<SearchHit[]>('/hospital/pharmacy/items/search', { q, item_type: itemType, limit: 20 })
        .then((d) => setHits(unwrapList<SearchHit>(d)))
        .catch(() => setHits([]))
    }, 250)
    return () => window.clearTimeout(t)
  }, [query, itemType])

  async function findPatient() {
    const q = patientNo.trim()
    if (!q) return
    setError(null)
    try {
      const res = await api.get<{ items: Patient[] }>('/hospital/patients/search', {
        patient_no: q,
        page: 1,
        page_size: 5,
        active_only: true,
      })
      const hit = res.items?.find((p) => p.patient_no.toLowerCase() === q.toLowerCase()) || res.items?.[0]
      if (!hit) {
        setError('Patient not found')
        return
      }
      setPatientId(hit.id)
      setPatientNo(hit.patient_no)
      setPatientName(hit.full_name)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function addItem(hit: SearchHit) {
    const base: Line = {
      key: `l${++keySeq}`,
      item_id: hit.id,
      code: hit.code,
      name: hit.name,
      unit: hit.unit,
      item_type: itemType,
      stock_qty: hit.stock_qty,
      quantity: '1',
      rate: String(kind === 'purchase' || kind === 'purchase-return' ? 0 : hit.sale_rate ?? hit.mrp ?? 0),
      batch_no: '',
      expiry_date: '',
      tax_percent: '0',
      disc_percent: '0',
      batches: [],
    }
    setQuery('')
    setHits([])
    if (cfg.batchPath) {
      try {
        const batches = await api.get<Batch[]>(cfg.batchPath, { code: hit.code, item_type: itemType })
        base.batches = batches || []
        const b = base.batches.find((x) => x.stock_qty > 0 || kind === 'sale-return') || null
        if (b) {
          base.batch_no = b.batch_no || ''
          base.expiry_date = b.expiry_date || ''
          if (b.rate != null) base.rate = String(b.rate)
        }
      } catch {
        /* batches are optional; user can still key the line */
      }
    }
    setLines((p) => [...p, base])
  }

  function patchLine(key: string, patch: Partial<Line>) {
    setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function pickBatch(l: Line, batchNo: string) {
    const b = l.batches.find((x) => (x.batch_no || '') === batchNo)
    patchLine(l.key, {
      batch_no: batchNo,
      expiry_date: b?.expiry_date || '',
      ...(b?.rate != null ? { rate: String(b.rate) } : {}),
    })
  }

  const totals = useMemo(() => {
    const gross = lines.reduce((s, l) => s + lineAmounts(l).net, 0)
    const discount = Math.min(n(billDiscount), gross)
    const sub = gross - discount
    const rounded = Math.round(sub)
    return { gross, discount, roundOff: rounded - sub, net: rounded }
  }, [lines, billDiscount])

  function reset() {
    setLines([])
    setBillDiscount('0')
    setRemarks('')
    setPatientNo('')
    setPatientId('')
    setPatientName('')
    setDoctorId('')
    setScheme('')
    setAddress1('')
    setAddress2('')
    setSupplierId('')
    setInvoiceNo('')
    setWardName('')
    setQuery('')
    setHits([])
  }

  function linePayload(l: Line) {
    return {
      item_id: l.item_id,
      quantity: Math.max(1, Math.floor(n(l.quantity))),
      rate: n(l.rate),
      batch_no: l.batch_no.trim() || null,
      expiry_date: l.expiry_date || null,
      tax_percent: n(l.tax_percent),
      line_discount_percent: n(l.disc_percent),
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(null)
    if (!lines.length) {
      setError('Add at least one item')
      return
    }
    if (kind === 'indent' && !wardName.trim()) {
      setError('Ward is required')
      return
    }
    const common = { bill_date: billDate, remarks: remarks.trim() || null }
    const pricing = { discount_amount: totals.discount, round_off: Number(totals.roundOff.toFixed(2)) }
    let body: unknown
    if (cfg.party === 'patient') {
      const doc = doctors.rows.find((d) => d.id === doctorId)
      body = {
        ...common,
        ...pricing,
        patient_id: patientId || null,
        patient_name: patientName.trim() || null,
        doctor_id: doctorId || null,
        doctor_name: doc?.full_name || null,
        scheme: scheme.trim() || null,
        payment_mode_id: payModeId || null,
        is_cash: isCash,
        address1: address1.trim() || null,
        address2: address2.trim() || null,
        bill_kind: kind === 'sale-return' ? 'return' : 'sale',
        lines: lines.map(linePayload),
      }
    } else if (cfg.party === 'supplier') {
      body = {
        ...common,
        ...pricing,
        supplier_id: supplierId || null,
        invoice_no: invoiceNo.trim() || null,
        bill_kind: kind === 'purchase-return' ? 'return' : 'purchase',
        lines: lines.map(linePayload),
      }
    } else {
      body = { ...common, ward_name: wardName.trim(), lines: lines.map(linePayload) }
    }
    setBusy(true)
    try {
      const res = await api.post<Saved>(cfg.postPath, body)
      setSaved(res)
      reset()
      await loadLastInfo()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const showBatchPicker = !!cfg.batchPath
  const freeBatch = !cfg.batchPath // purchase screens: key batch/expiry manually

  return (
    <div className="hms-page">
      <h1>{cfg.title}</h1>
      {cfg.hint && <div className="hint">{cfg.hint}</div>}
      {error && <div className="hms-error">{error}</div>}
      {saved && (
        <div className="hms-ok">
          Saved <strong>{saved.bill_no}</strong> — net {fmtMoney(saved.net_amount)}
        </div>
      )}

      <form onSubmit={onSubmit}>
        <div className="hms-box">
          <div className="hms-box-title">Bill</div>
          <div className="hms-grid hms-grid-4" style={{ marginTop: 4 }}>
            {lastInfo && (
              <div className="hms-field-wrap">
                <label>Bill No (next)</label>
                <input className="hms-field" readOnly value={lastInfo.next_preview} title={`Last: ${lastInfo.last_bill_no || '—'}`} />
              </div>
            )}
            <div className="hms-field-wrap">
              <label>Bill Date</label>
              <input className="hms-field" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </div>

            {cfg.party === 'patient' && (
              <>
                <div className="hms-field-wrap">
                  <label>Patient No</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      className="hms-field"
                      value={patientNo}
                      placeholder="Optional"
                      onChange={(e) => {
                        setPatientNo(e.target.value)
                        setPatientId('')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void findPatient()
                        }
                      }}
                    />
                    <button className="hms-btn" type="button" onClick={() => void findPatient()}>Find</button>
                  </div>
                </div>
                <div className="hms-field-wrap">
                  <label>Patient Name</label>
                  <input className="hms-field" value={patientName} onChange={(e) => setPatientName(e.target.value)} />
                </div>
                <div className="hms-field-wrap">
                  <label>Doctor</label>
                  <select className="hms-field" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                    <option value="">—</option>
                    {doctors.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="hms-field-wrap">
                  <label>Scheme</label>
                  <input className="hms-field" value={scheme} onChange={(e) => setScheme(e.target.value)} />
                </div>
                <div className="hms-field-wrap">
                  <label>Payment Mode</label>
                  <select
                    className="hms-field"
                    value={payModeId}
                    onChange={(e) => {
                      setPayModeId(e.target.value)
                      const pm = payModes.rows.find((p) => p.id === e.target.value)
                      if (pm?.is_cash != null) setIsCash(Boolean(pm.is_cash))
                    }}
                  >
                    <option value="">—</option>
                    {payModes.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="hms-field-wrap">
                  <label>Cash Bill</label>
                  <input type="checkbox" checked={isCash} onChange={(e) => setIsCash(e.target.checked)} />
                </div>
                <div className="hms-field-wrap">
                  <label>Address 1</label>
                  <input className="hms-field" value={address1} onChange={(e) => setAddress1(e.target.value)} />
                </div>
                <div className="hms-field-wrap">
                  <label>Address 2</label>
                  <input className="hms-field" value={address2} onChange={(e) => setAddress2(e.target.value)} />
                </div>
              </>
            )}

            {cfg.party === 'supplier' && (
              <>
                <div className="hms-field-wrap">
                  <label>Supplier</label>
                  <select className="hms-field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">—</option>
                    {suppliers.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="hms-field-wrap">
                  <label>Invoice No</label>
                  <input className="hms-field" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
                </div>
              </>
            )}

            {cfg.party === 'ward' && (
              <div className="hms-field-wrap">
                <label>Ward *</label>
                <input className="hms-field" list="hms-ward-list" value={wardName} onChange={(e) => setWardName(e.target.value)} required />
                <datalist id="hms-ward-list">
                  {wards.options.map((o) => (
                    <option key={o.value} value={o.value} />
                  ))}
                </datalist>
              </div>
            )}

            <div className="hms-field-wrap">
              <label>Remarks</label>
              <input className="hms-field" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="hms-box">
          <div className="hms-box-title">Items</div>
          <div className="hms-toolbar" style={{ marginTop: 4, position: 'relative' }}>
            <label>Type</label>
            <select className="hms-field" style={{ width: 130 }} value={itemType} onChange={(e) => setItemType(e.target.value)}>
              {PHARMACY_ITEM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <label>Search item</label>
            <input
              className="hms-field"
              style={{ width: 320 }}
              placeholder="Code / name / generic…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {hits.length > 0 && (
              <div
                className="hms-table-wrap"
                style={{ position: 'absolute', top: 34, left: 200, zIndex: 20, width: 620, maxHeight: 260, boxShadow: '0 4px 12px rgba(0,0,0,.2)' }}
              >
                <table className="hms-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Generic</th>
                      <th>Sch</th>
                      <th style={{ textAlign: 'right' }}>Stock</th>
                      <th style={{ textAlign: 'right' }}>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hits.map((h) => (
                      <tr key={h.id} onClick={() => void addItem(h)}>
                        <td>{h.code}</td>
                        <td>{h.name}</td>
                        <td>{h.generic_name}</td>
                        <td>{h.schedule}</td>
                        <td style={{ textAlign: 'right' }}>{h.stock_qty}</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(h.sale_rate ?? h.mrp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="hms-table-wrap" style={{ maxHeight: 340 }}>
            <table className="hms-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th>Code</th>
                  <th>Item</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th style={{ width: 60, textAlign: 'right' }}>Stock</th>
                  <th style={{ width: 70 }}>Qty</th>
                  <th style={{ width: 90 }}>Rate</th>
                  {cfg.party !== 'ward' && <th style={{ width: 70 }}>Tax %</th>}
                  {cfg.party !== 'ward' && <th style={{ width: 70 }}>Disc %</th>}
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key} style={{ cursor: 'default' }}>
                    <td>{i + 1}</td>
                    <td>{l.code}</td>
                    <td>{l.name}</td>
                    <td>
                      {showBatchPicker && l.batches.length > 0 ? (
                        <select className="hms-field" value={l.batch_no} onChange={(e) => pickBatch(l, e.target.value)}>
                          {l.batches.map((b, bi) => (
                            <option key={bi} value={b.batch_no || ''}>
                              {(b.batch_no || 'No batch') + ` (${b.stock_qty})`}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input className="hms-field" value={l.batch_no} onChange={(e) => patchLine(l.key, { batch_no: e.target.value })} />
                      )}
                    </td>
                    <td>
                      <input
                        className="hms-field"
                        type="date"
                        readOnly={showBatchPicker && !freeBatch && l.batches.length > 0}
                        value={l.expiry_date}
                        onChange={(e) => patchLine(l.key, { expiry_date: e.target.value })}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>{l.stock_qty}</td>
                    <td><input className="hms-field" type="number" min={1} value={l.quantity} onChange={(e) => patchLine(l.key, { quantity: e.target.value })} /></td>
                    <td><input className="hms-field" type="number" min={0} step="0.01" value={l.rate} onChange={(e) => patchLine(l.key, { rate: e.target.value })} /></td>
                    {cfg.party !== 'ward' && (
                      <td><input className="hms-field" type="number" min={0} step="0.01" value={l.tax_percent} onChange={(e) => patchLine(l.key, { tax_percent: e.target.value })} /></td>
                    )}
                    {cfg.party !== 'ward' && (
                      <td><input className="hms-field" type="number" min={0} step="0.01" value={l.disc_percent} onChange={(e) => patchLine(l.key, { disc_percent: e.target.value })} /></td>
                    )}
                    <td style={{ textAlign: 'right' }}>{fmtMoney(lineAmounts(l).net)}</td>
                    <td>
                      <button className="hms-btn" type="button" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}>×</button>
                    </td>
                  </tr>
                ))}
                {!lines.length && (
                  <tr style={{ cursor: 'default' }}>
                    <td colSpan={12} style={{ color: '#64748b' }}>Search and click an item to add it</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="hms-box">
          <div className="hms-box-title">Totals</div>
          <div className="hms-grid hms-grid-4" style={{ marginTop: 4 }}>
            <div className="hms-field-wrap">
              <label>Gross</label>
              <input className="hms-field" readOnly value={fmtMoney(totals.gross)} />
            </div>
            {cfg.party !== 'ward' && (
              <div className="hms-field-wrap">
                <label>Bill Discount</label>
                <input className="hms-field" type="number" min={0} step="0.01" value={billDiscount} onChange={(e) => setBillDiscount(e.target.value)} />
              </div>
            )}
            {cfg.party !== 'ward' && (
              <div className="hms-field-wrap">
                <label>Round Off</label>
                <input className="hms-field" readOnly value={fmtMoney(totals.roundOff)} />
              </div>
            )}
            <div className="hms-field-wrap">
              <label>{isReturn ? 'Return Amount' : 'Net Amount'}</label>
              <input className="hms-field" readOnly style={{ fontWeight: 700 }} value={fmtMoney(totals.net)} />
            </div>
          </div>
          <div className="hms-actions">
            <button className="hms-btn hms-btn-primary" type="submit" disabled={busy}>
              {busy ? '…' : cfg.saveLabel}
            </button>
            <button className="hms-btn" type="button" onClick={() => { reset(); setError(null); setSaved(null) }}>
              Clear
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
