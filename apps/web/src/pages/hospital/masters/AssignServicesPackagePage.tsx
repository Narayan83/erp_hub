import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { Banner, Box } from '../shared/hmsKit'
import { errMsg, fmtMoney, unwrapList } from '../shared/hmsShared'

type Pkg = { id: string; code: string; name: string; package_total?: number | string | null }
type Item = {
  id: string
  service_id: string
  service_code?: string | null
  service_name?: string | null
  service_rate?: number | string | null
  quantity: number
  rate_override?: number | string | null
}
type PkgDetail = Pkg & { items: Item[] }
type Service = { id: string; code: string; name: string; rate: number | string; category_name?: string | null }

/** Assign Services To Package — /hospital/billing-packages/{id}/items */
export function AssignServicesPackagePage() {
  const [packages, setPackages] = useState<Pkg[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [packageId, setPackageId] = useState('')
  const [detail, setDetail] = useState<PkgDetail | null>(null)
  const [filter, setFilter] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [qty, setQty] = useState(1)
  const [rateOverride, setRateOverride] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const [p, s] = await Promise.all([
          api.get<unknown>('/hospital/billing-packages'),
          api.get<unknown>('/hospital/patient-services'),
        ])
        setPackages(unwrapList<Pkg>(p))
        setServices(unwrapList<Service>(s))
      } catch (e) {
        setError(errMsg(e))
      }
    })()
  }, [])

  async function loadDetail(id: string) {
    if (!id) {
      setDetail(null)
      return
    }
    try {
      setDetail(await api.get<PkgDetail>(`/hospital/billing-packages/${id}`))
    } catch (e) {
      setError(errMsg(e))
    }
  }

  useEffect(() => {
    setOk(null)
    void loadDetail(packageId)
  }, [packageId])

  const available = useMemo(() => {
    const used = new Set((detail?.items || []).map((i) => i.service_id))
    const q = filter.trim().toLowerCase()
    return services.filter(
      (s) =>
        !used.has(s.id) &&
        (!q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)),
    )
  }, [services, detail, filter])

  async function add() {
    if (!packageId || !serviceId) return
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const d = await api.post<PkgDetail>(`/hospital/billing-packages/${packageId}/items`, {
        service_id: serviceId,
        quantity: Math.max(1, Number(qty) || 1),
        rate_override: rateOverride === '' ? null : Number(rateOverride),
        sort_order: (detail?.items.length || 0) + 1,
      })
      setDetail(d)
      setServiceId('')
      setQty(1)
      setRateOverride('')
      setOk('Service added')
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(itemId: string) {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      setDetail(await api.delete<PkgDetail>(`/hospital/billing-packages/${packageId}/items/${itemId}`))
      setOk('Service removed')
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const total = (detail?.items || []).reduce(
    (sum, i) => sum + Number(i.rate_override ?? i.service_rate ?? 0) * i.quantity,
    0,
  )

  return (
    <div className="hms-page">
      <h1>Assign Services To Package</h1>
      <Banner error={error} ok={ok} />
      <div className="hms-toolbar">
        <label>Package</label>
        <select
          className="hms-field"
          style={{ minWidth: 320 }}
          value={packageId}
          onChange={(e) => setPackageId(e.target.value)}
        >
          <option value="">—</option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
        {detail && (
          <span>
            Package total: <strong>{fmtMoney(detail.package_total) || '—'}</strong> &nbsp; Items sum:{' '}
            <strong>{fmtMoney(total)}</strong>
          </span>
        )}
      </div>

      <Box title="Add Service">
        <div className="hms-grid hms-grid-4">
          <div className="hms-field-wrap">
            <label>Search service</label>
            <input
              className="hms-field"
              value={filter}
              placeholder="Code or name"
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="hms-field-wrap">
            <label>Service</label>
            <select
              className="hms-field"
              disabled={!packageId}
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
            >
              <option value="">—</option>
              {available.slice(0, 300).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name} ({fmtMoney(s.rate)})
                </option>
              ))}
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Quantity</label>
            <input
              className="hms-field"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
            />
          </div>
          <div className="hms-field-wrap">
            <label>Rate override (optional)</label>
            <input
              className="hms-field"
              type="number"
              min={0}
              step="0.01"
              value={rateOverride}
              onChange={(e) => setRateOverride(e.target.value)}
            />
          </div>
        </div>
        <div className="hms-actions">
          <button
            className="hms-btn hms-btn-primary"
            type="button"
            disabled={busy || !packageId || !serviceId}
            onClick={() => void add()}
          >
            Add
          </button>
        </div>
      </Box>

      <div className="hms-table-wrap">
        <table className="hms-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Code</th>
              <th>Service</th>
              <th>Rate</th>
              <th>Override</th>
              <th>Qty</th>
              <th>Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(detail?.items || []).map((i, idx) => (
              <tr key={i.id}>
                <td>{idx + 1}</td>
                <td>{i.service_code}</td>
                <td>{i.service_name}</td>
                <td>{fmtMoney(i.service_rate)}</td>
                <td>{fmtMoney(i.rate_override)}</td>
                <td>{i.quantity}</td>
                <td>{fmtMoney(Number(i.rate_override ?? i.service_rate ?? 0) * i.quantity)}</td>
                <td>
                  <button
                    className="hms-btn hms-btn-danger"
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(i.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {!detail?.items.length && (
              <tr>
                <td colSpan={8}>{packageId ? 'No services assigned' : 'Select a package'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
