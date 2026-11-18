import { useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { isSuperAdmin } from '../../auth/roles'
import { PackageMenusDialog } from '../../components/generp/PackageMenusDialog'
import { useMenuOverlay } from '../../components/generp/MenuOverlay'
import type { CompanyProfile, TaxMode } from '../../generpTypes'

const EMPTY: CompanyProfile = {
  name: '',
  sale_tax_mode: 'inclusive',
  wholesale_tax_mode: 'exclusive',
  purchase_tax_mode: 'exclusive',
  sale_rate_source: 'product_master',
  allow_negative_stock: true,
  purchase_bill_parking: false,
  unique_barcode_stock: false,
  lot_enabled: false,
}

function withFlags(data: CompanyProfile): CompanyProfile {
  return {
    ...EMPTY,
    ...data,
    sale_tax_mode: data.sale_tax_mode || 'inclusive',
    wholesale_tax_mode: data.wholesale_tax_mode || 'exclusive',
    purchase_tax_mode: data.purchase_tax_mode || 'exclusive',
    sale_rate_source: data.sale_rate_source === 'fifo' ? 'fifo' : 'product_master',
    allow_negative_stock: data.allow_negative_stock !== false,
    purchase_bill_parking: data.purchase_bill_parking === true,
    unique_barcode_stock: data.unique_barcode_stock === true,
    lot_enabled: data.lot_enabled === true,
  }
}

const TAX_OPTIONS: { value: TaxMode; label: string }[] = [
  { value: 'inclusive', label: 'Inclusive (rate includes GST)' },
  { value: 'exclusive', label: 'Exclusive (GST added on rate)' },
]

export function CompanyProfilePage() {
  const { user, refreshMenus } = useAuth()
  const { closeTab } = useMenuOverlay()
  const [form, setForm] = useState<CompanyProfile>(EMPTY)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetCode, setResetCode] = useState('')
  const [assignOpen, setAssignOpen] = useState(false)
  const canReset = isSuperAdmin(user)

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<CompanyProfile>('/company-profile')
        setForm(withFlags(data))
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load settings')
      }
    })()
  }, [])

  const set =
    (key: keyof CompanyProfile) =>
    (value: string) =>
      setForm((f) => ({ ...f, [key]: value }))

  const save = async () => {
    if (!form.name.trim()) {
      alert('Company name is required.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const saved = await api.put<CompanyProfile>('/company-profile', {
        name: form.name.trim(),
        address_line1: form.address_line1 || null,
        address_line2: form.address_line2 || null,
        address_line3: form.address_line3 || null,
        address_line4: form.address_line4 || null,
        city: form.city || null,
        state: form.state || null,
        pin_code: form.pin_code || null,
        phone: form.phone || null,
        mobile: form.mobile || null,
        email: form.email || null,
        website: form.website || null,
        gstin: form.gstin || null,
        software_id: form.software_id || null,
        sale_tax_mode: form.sale_tax_mode,
        wholesale_tax_mode: form.wholesale_tax_mode,
        purchase_tax_mode: form.purchase_tax_mode,
        sale_rate_source: form.sale_rate_source === 'fifo' ? 'fifo' : 'product_master',
        allow_negative_stock: form.allow_negative_stock !== false,
        purchase_bill_parking: form.purchase_bill_parking === true,
        unique_barcode_stock: form.unique_barcode_stock === true,
        lot_enabled: form.lot_enabled === true,
      })
      setForm(withFlags(saved))
      alert('Settings saved.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const applyProfile = (data: CompanyProfile) => {
    setForm(withFlags(data))
  }

  const uploadLogo = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const saved = await api.upload<CompanyProfile>('/company-profile/logo', fd)
      applyProfile(saved)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Logo upload failed')
    } finally {
      setBusy(false)
    }
  }

  const removeLogo = async () => {
    setBusy(true)
    setError('')
    try {
      const saved = await api.delete<CompanyProfile>('/company-profile/logo')
      applyProfile(saved)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove logo')
    } finally {
      setBusy(false)
    }
  }

  const prepareNewCompany = () => {
    const ok = window.confirm(
      'This clears bills, stock, products and parties for a new company. Users, ledgers and payment modes stay. Continue?',
    )
    if (!ok) return
    setResetCode('')
    setResetOpen(true)
  }

  const submitReset = async () => {
    const password = resetCode.trim()
    if (!password) {
      alert('Service code is required.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await api.post<{ message?: string }>('/company-profile/reset-company', { password })
      const data = await api.get<CompanyProfile>('/company-profile')
      applyProfile(data)
      setResetOpen(false)
      setResetCode('')
      alert(res.message || 'Company data cleared.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-title-row">
        <h2>Software Setup</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => closeTab('company_profile')}>
            Close
          </button>
          <button type="button" className="btn" onClick={() => setAssignOpen(true)}>
            Assign menus
          </button>
        </div>
      </div>
      <p className="hint">Company details, the software package, and menu-wise GST inclusive / exclusive billing.</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="settings-box">
        <div className="settings-box-title">Company Profile</div>
        <label className="settings-field">
          <span>Company Name *</span>
          <input className="input" value={form.name} onChange={(e) => set('name')(e.target.value)} />
        </label>
        <div className="settings-field company-logo-field">
          <span>Company logo</span>
          <div className="company-logo-row">
            <div className={`party-photo-frame${form.logo_url ? '' : ' is-empty'}`}>
              {form.logo_url ? <img src={form.logo_url} alt="Company logo" /> : 'No logo'}
            </div>
            <div className="party-photo-actions">
              <label className="btn">
                Upload
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) void uploadLogo(file)
                  }}
                />
              </label>
              {form.logo_url ? (
                <button type="button" className="btn" onClick={() => void removeLogo()} disabled={busy}>
                  Remove
                </button>
              ) : null}
            </div>
          </div>
          <p className="hint" style={{ margin: '4px 0 0' }}>
            JPEG, PNG or WebP, max 5 MB. Turn it on in Print Template Designer for bills, reports and barcode
            labels.
          </p>
        </div>
        <label className="settings-field">
          <span>Address Line 1</span>
          <input className="input" value={form.address_line1 || ''} onChange={(e) => set('address_line1')(e.target.value)} />
        </label>
        <label className="settings-field">
          <span>Address Line 2</span>
          <input className="input" value={form.address_line2 || ''} onChange={(e) => set('address_line2')(e.target.value)} />
        </label>
        <div className="settings-field-row">
          <label className="settings-field">
            <span>City</span>
            <input className="input" value={form.city || ''} onChange={(e) => set('city')(e.target.value)} />
          </label>
          <label className="settings-field">
            <span>State</span>
            <input className="input" value={form.state || ''} onChange={(e) => set('state')(e.target.value)} />
          </label>
        </div>
        <div className="settings-field-row">
          <label className="settings-field">
            <span>PIN</span>
            <input className="input" value={form.pin_code || ''} onChange={(e) => set('pin_code')(e.target.value)} />
          </label>
          <label className="settings-field">
            <span>GSTIN</span>
            <input className="input" value={form.gstin || ''} onChange={(e) => set('gstin')(e.target.value)} />
          </label>
        </div>
        <div className="settings-field-row">
          <label className="settings-field">
            <span>Phone</span>
            <input className="input" value={form.phone || ''} onChange={(e) => set('phone')(e.target.value)} />
          </label>
          <label className="settings-field">
            <span>Mobile</span>
            <input className="input" value={form.mobile || ''} onChange={(e) => set('mobile')(e.target.value)} />
          </label>
        </div>
        <div className="settings-field-row">
          <label className="settings-field">
            <span>Email</span>
            <input className="input" value={form.email || ''} onChange={(e) => set('email')(e.target.value)} />
          </label>
          <label className="settings-field">
            <span>Website</span>
            <input className="input" value={form.website || ''} onChange={(e) => set('website')(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="settings-box">
        <div className="settings-box-title">GST — Inclusive / Exclusive</div>
        <p className="hint" style={{ margin: 0 }}>
          Inclusive: the rate already contains GST. Exclusive: GST is added on the rate. Each billing
          menu can be set independently.
        </p>
        <label className="settings-field">
          <span>Sale bill (default Inclusive)</span>
          <select
            className="input"
            value={form.sale_tax_mode || 'inclusive'}
            onChange={(e) => set('sale_tax_mode')(e.target.value)}
          >
            {TAX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          <span>Wholesale bill (default Exclusive)</span>
          <select
            className="input"
            value={form.wholesale_tax_mode || 'exclusive'}
            onChange={(e) => set('wholesale_tax_mode')(e.target.value)}
          >
            {TAX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          <span>Purchase bill (default Exclusive)</span>
          <select
            className="input"
            value={form.purchase_tax_mode || 'exclusive'}
            onChange={(e) => set('purchase_tax_mode')(e.target.value)}
          >
            {TAX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="settings-box">
        <div className="settings-box-title">Sale rate / MRP</div>
        <p className="hint" style={{ margin: 0 }}>
          A scanned barcode always wins (own barcode encodes MRP; company barcode uses its saved
          MRP/rate). If the scan has no price, use this setting.
        </p>
        <label className="settings-field">
          <span>When barcode has no price</span>
          <select
            className="input"
            value={form.sale_rate_source === 'fifo' ? 'fifo' : 'product_master'}
            onChange={(e) => set('sale_rate_source')(e.target.value)}
          >
            <option value="product_master">Product master (current SKU rates)</option>
            <option value="fifo">FIFO (oldest unsold consignment)</option>
          </select>
        </label>
        <p className="hint" style={{ margin: 0 }}>
          FIFO keeps old stock at the MRP/sale rate from when it was purchased. Change product
          master rates only for the next consignment.
        </p>
      </div>

      <div className="settings-box">
        <div className="settings-box-title">Purchase bill parking</div>
        <p className="hint" style={{ margin: 0 }}>
          When Yes, receiving staff save supplier, party bill number and item quantities only. A
          second person opens pending bills and enters rate, profit %, sale price and the rest.
        </p>
        <label className="settings-field">
          <span>Park purchases until priced</span>
          <select
            className="input"
            value={form.purchase_bill_parking ? 'yes' : 'no'}
            onChange={(e) =>
              setForm((f) => ({ ...f, purchase_bill_parking: e.target.value === 'yes' }))
            }
          >
            <option value="no">No — enter full bill in one step</option>
            <option value="yes">Yes — receive now, price later</option>
          </select>
        </label>
      </div>

      <div className="settings-box">
        <div className="settings-box-title">Unique barcode stock</div>
        <p className="hint" style={{ margin: 0 }}>
          When Yes, each purchase piece gets its own barcode. A product marked Multiple barcode
          shares one barcode across many pieces: 70 pieces at 10 per barcode prints that barcode 7
          times. Sale of that barcode asks how many pieces to reduce.
        </p>
        <label className="settings-field">
          <span>Unique barcode stock</span>
          <select
            className="input"
            value={form.unique_barcode_stock ? 'yes' : 'no'}
            onChange={(e) =>
              setForm((f) => ({ ...f, unique_barcode_stock: e.target.value === 'yes' }))
            }
          >
            <option value="no">No — one product barcode</option>
            <option value="yes">Yes — a barcode for each inward piece</option>
          </select>
        </label>
      </div>

      <div className="settings-box">
        <div className="settings-box-title">Lots</div>
        <p className="hint" style={{ margin: 0 }}>
          When Yes, Lot Master is used and purchase bills can pick a lot. Stock report groups by lot.
        </p>
        <label className="settings-field">
          <span>Lot enabled</span>
          <select
            className="input"
            value={form.lot_enabled ? 'yes' : 'no'}
            onChange={(e) => setForm((f) => ({ ...f, lot_enabled: e.target.value === 'yes' }))}
          >
            <option value="no">No</option>
            <option value="yes">Yes — show Lot Master and lot on purchase</option>
          </select>
        </label>
      </div>

      <div className="settings-box">
        <div className="settings-box-title">Stock</div>
        <label>
          <input
            type="checkbox"
            checked={form.allow_negative_stock !== false}
            onChange={(e) => setForm((f) => ({ ...f, allow_negative_stock: e.target.checked }))}
          />
          Allow negative stock (billing / issue below available qty)
        </label>
        <p className="hint" style={{ margin: 0 }}>
          Uncheck to block sale, wholesale, shop sale, purchase return, shortage, wastage, outward
          DC and transfers when qty is more than on-hand stock.
        </p>
      </div>

      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
        Save Settings
      </button>

      {canReset && (
        <div className="settings-service-tools">
          <button
            type="button"
            className="settings-service-link"
            disabled={busy}
            onClick={() => prepareNewCompany()}
          >
            Prepare for new company
          </button>
        </div>
      )}

      {assignOpen && (
        <PackageMenusDialog
          onClose={() => setAssignOpen(false)}
          onSaved={() => {
            void refreshMenus()
          }}
        />
      )}

      {resetOpen && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!busy) {
              setResetOpen(false)
              setResetCode('')
            }
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Service code"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Service code</h2>
            <label className="settings-field">
              <span>Enter service code</span>
              <input
                className="input"
                type="password"
                autoComplete="off"
                autoFocus
                value={resetCode}
                disabled={busy}
                onChange={(e) => setResetCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void submitReset()
                  }
                }}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setResetOpen(false)
                  setResetCode('')
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void submitReset()}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
