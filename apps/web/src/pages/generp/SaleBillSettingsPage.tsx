import { useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { SaleEntryConfig } from '../../generpTypes'

const DEFAULT: SaleEntryConfig = {
  enable_qty: true,
  enable_rate: true,
  enable_discount: true,
  default_qty: 1,
}

export function SaleBillSettingsPage() {
  const [cfg, setCfg] = useState<SaleEntryConfig>(DEFAULT)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<SaleEntryConfig>('/sale-entry-config')
        setCfg({ ...DEFAULT, ...data })
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load')
      }
    })()
  }, [])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await api.put('/sale-entry-config', cfg)
      alert('Sale Bill settings updated.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-page">
      <h2>Sale Bill Settings</h2>
      <p className="hint">
        Choose which fields the counter staff can edit while entering items on a Sale Bill.
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="settings-box settings-box--form">
        <label>
          <input
            type="checkbox"
            checked={cfg.enable_qty}
            onChange={(e) => setCfg((c) => ({ ...c, enable_qty: e.target.checked }))}
          />
          Allow editing Quantity
        </label>
        <label>
          <input
            type="checkbox"
            checked={cfg.enable_rate}
            onChange={(e) => setCfg((c) => ({ ...c, enable_rate: e.target.checked }))}
          />
          Allow editing Rate
        </label>
        <label>
          <input
            type="checkbox"
            checked={cfg.enable_discount}
            onChange={(e) => setCfg((c) => ({ ...c, enable_discount: e.target.checked }))}
          />
          Allow editing Discount %
        </label>
        <label>
          Default quantity
          <input
            className="input"
            type="number"
            step={0.001}
            style={{ maxWidth: 140, marginLeft: 8 }}
            value={cfg.default_qty}
            onChange={(e) => setCfg((c) => ({ ...c, default_qty: Number(e.target.value) || 0 }))}
          />
        </label>
      </div>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
        Save Settings
      </button>
    </div>
  )
}
