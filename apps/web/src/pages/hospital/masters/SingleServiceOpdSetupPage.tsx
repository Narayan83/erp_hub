import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client'
import { useAuth } from '../../../auth/AuthContext'
import '../billing/hms-master.css'
import { Banner, Box, FieldWrap } from '../shared/hmsKit'
import { errMsg, fmtMoney, unwrapList } from '../shared/hmsShared'

type Mode = 'Create' | 'Modify' | 'Delete'
type Doctor = { id: string; doctor_code?: string; full_name?: string }
type Service = { id: string; code: string; name: string; rate: number | string }
type Unlinked = { menu_code: string; name: string; sort_order: number }
type Option = {
  id: string
  name: string
  menu_code: string
  service_id: string
  service_name: string
  services: Array<{ service_id: string; service_name: string }>
  doctor_id: string | null
  doctor_name: string | null
  use_patient_id: boolean
  services_start_unselected?: boolean
  default_rate: number | string
  bill_prefix: string
  sort_order: number
  is_active: boolean
}

/** Single Service OPD Setup — /hospital/single-service-opd/options */
export function SingleServiceOpdSetupPage() {
  const { refreshMenus } = useAuth()
  const [mode, setMode] = useState<Mode>('Create')
  const [rows, setRows] = useState<Option[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [serviceIds, setServiceIds] = useState<string[]>([])
  const [svcFilter, setSvcFilter] = useState('')
  const [usePatientId, setUsePatientId] = useState(false)
  const [servicesStartUnselected, setServicesStartUnselected] = useState(false)
  const [rate, setRate] = useState('0')
  const [prefix, setPrefix] = useState('')
  const [active, setActive] = useState(true)
  const [menuCode, setMenuCode] = useState('')
  const [unlinked, setUnlinked] = useState<Unlinked[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const [options, waiting] = await Promise.all([
      api.get<unknown>('/hospital/single-service-opd/options'),
      api.get<unknown>('/hospital/single-service-opd/options/unlinked-menus'),
    ])
    setRows(unwrapList<Option>(options))
    setUnlinked(unwrapList<Unlinked>(waiting))
  }

  useEffect(() => {
    void (async () => {
      try {
        const [d, s] = await Promise.all([
          api.get<unknown>('/hospital/doctors', { page: 1, page_size: 100 }),
          api.get<unknown>('/hospital/patient-services'),
          load(),
        ])
        setDoctors(unwrapList<Doctor>(d))
        setServices(unwrapList<Service>(s))
        await refreshMenus()
      } catch (e) {
        setError(errMsg(e))
      }
    })()
  }, [refreshMenus])

  function reset() {
    setSelectedId('')
    setName('')
    setDoctorId('')
    setServiceIds([])
    setUsePatientId(false)
    setServicesStartUnselected(false)
    setRate('0')
    setPrefix('')
    setActive(true)
    setMenuCode('')
  }

  function activateMenu(menu: Unlinked) {
    reset()
    setMode('Create')
    setName(menu.name)
    setMenuCode(menu.menu_code)
    setActive(true)
  }

  function pick(o: Option) {
    setSelectedId(o.id)
    setName(o.name)
    setDoctorId(o.doctor_id || '')
    setServiceIds((o.services?.length ? o.services.map((s) => s.service_id) : [o.service_id]).filter(Boolean))
    setUsePatientId(o.use_patient_id)
    setServicesStartUnselected(Boolean(o.services_start_unselected))
    setRate(String(o.default_rate ?? 0))
    setPrefix(o.bill_prefix || '')
    setActive(o.is_active)
    if (mode === 'Create') setMode('Modify')
  }

  function serviceMatches(s: Service, q: string) {
    return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
  }

  const visibleServices = useMemo(() => {
    const q = svcFilter.trim().toLowerCase()
    if (!q) return services
    return services.filter((s) => serviceMatches(s, q))
  }, [services, svcFilter])

  const allListed =
    visibleServices.length > 0 && visibleServices.every((s) => serviceIds.includes(s.id))

  function selectMatchingServices(q: string) {
    if (mode === 'Delete') return
    const found = services.filter((s) => serviceMatches(s, q))
    if (!found.length) return
    setServiceIds((prev) => {
      const next = [...prev]
      for (const s of found) if (!next.includes(s.id)) next.push(s.id)
      return next
    })
  }

  function onSvcFilter(value: string) {
    setSvcFilter(value)
    const q = value.trim().toLowerCase()
    if (!q || mode === 'Delete') return
    const found = services.filter((s) => serviceMatches(s, q))
    if (found.length !== 1) return
    setServiceIds((prev) => (prev.includes(found[0].id) ? prev : [...prev, found[0].id]))
  }

  function toggleListed(on: boolean) {
    if (mode === 'Delete') return
    const ids = visibleServices.map((s) => s.id)
    setServiceIds((prev) => {
      if (on) {
        const next = [...prev]
        for (const id of ids) if (!next.includes(id)) next.push(id)
        return next
      }
      const drop = new Set(ids)
      return prev.filter((id) => !drop.has(id))
    })
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      if (mode === 'Delete') {
        if (!selectedId) throw new Error('Select an option')
        await api.delete(`/hospital/single-service-opd/options/${selectedId}`)
        setOk('Option deleted')
        reset()
        setMode('Create')
      } else {
        if (!serviceIds.length) throw new Error('Select at least one service')
        if (!doctorId) throw new Error('Doctor is required')
        const body = {
          name: name.trim(),
          service_ids: serviceIds,
          doctor_id: doctorId,
          use_patient_id: usePatientId,
          services_start_unselected: servicesStartUnselected,
          default_rate: Number(rate) || 0,
          bill_prefix: prefix.trim() || null,
          is_active: active,
          ...(mode === 'Create' && menuCode ? { menu_code: menuCode } : {}),
        }
        if (mode === 'Create') {
          await api.post('/hospital/single-service-opd/options', body)
          setOk('Option created — its bill menu code is generated automatically')
          reset()
        } else {
          if (!selectedId) throw new Error('Select an option')
          await api.patch(`/hospital/single-service-opd/options/${selectedId}`, body)
          setOk('Option updated')
        }
      }
      await load()
      await refreshMenus()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  async function move(idx: number, dir: -1 | 1) {
    const j = idx + dir
    if (j < 0 || j >= rows.length) return
    const ids = rows.map((r) => r.id)
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    try {
      await api.put('/hospital/single-service-opd/options/reorder', { option_ids: ids })
      await load()
      await refreshMenus()
    } catch (err) {
      setError(errMsg(err))
    }
  }

  const readOnly = mode === 'Delete'
  const selected = rows.find((r) => r.id === selectedId)

  return (
    <div className="hms-page">
      <h1>Single Service OPD Setup</h1>
      <div className="hint">
        Each option is a bill screen under Billing, next to OPD Bill and IPD Bill. The name you save is the menu label.
      </div>
      <Banner error={error} ok={ok} />

      {unlinked.length > 0 && (
        <div className="hms-box" style={{ marginBottom: 12 }}>
          <div className="hms-box-title">Menus waiting to be activated</div>
          <p className="hint">
            These billing menus are already on the sidebar, but this software has no setup for them.
            Choose one, set the doctor and services, then Save.
          </p>
          <div className="hms-actions">
            {unlinked.map((menu) => (
              <button
                key={menu.menu_code}
                className="hms-btn"
                type="button"
                onClick={() => activateMenu(menu)}
              >
                Activate {menu.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="hms-toolbar">
        <label>Action</label>
        <select
          className="hms-field"
          style={{ width: 160 }}
          value={mode}
          onChange={(e) => {
            const m = e.target.value as Mode
            setMode(m)
            if (m === 'Create') reset()
          }}
        >
          <option>Create</option>
          <option>Modify</option>
          <option>Delete</option>
        </select>
        <label>Select</label>
        <select
          className="hms-field"
          style={{ minWidth: 300 }}
          disabled={mode === 'Create'}
          value={selectedId}
          onChange={(e) => {
            const o = rows.find((r) => r.id === e.target.value)
            if (o) pick(o)
            else reset()
          }}
        >
          <option value="">—</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.menu_code} — {r.name}
            </option>
          ))}
        </select>
      </div>

      <form className="hms-box" onSubmit={onSubmit}>
        <div className="hms-box-title">Option</div>
        <div className="hms-grid hms-grid-3" style={{ marginTop: 4 }}>
          <FieldWrap label="Option Name" required>
            <input
              className="hms-field"
              required={!readOnly}
              readOnly={readOnly}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FieldWrap>
          <FieldWrap label="Doctor" required>
            <select
              className="hms-field"
              disabled={readOnly}
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
            >
              <option value="">—</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.doctor_code} — {d.full_name}
                </option>
              ))}
            </select>
          </FieldWrap>
          <FieldWrap label="Default Rate">
            <input
              className="hms-field"
              type="number"
              min={0}
              step="0.01"
              readOnly={readOnly}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </FieldWrap>
          <FieldWrap label="Bill Prefix (max 10)">
            <input
              className="hms-field"
              maxLength={10}
              readOnly={readOnly}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
          </FieldWrap>
          <FieldWrap label="Use Patient Id on bill">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={usePatientId}
              onChange={(e) => setUsePatientId(e.target.checked)}
            />
          </FieldWrap>
          <FieldWrap label="Services start unselected">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={servicesStartUnselected}
              onChange={(e) => setServicesStartUnselected(e.target.checked)}
            />
          </FieldWrap>
          <FieldWrap label="Active">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
          </FieldWrap>
        </div>

        <div className="hms-box" style={{ marginTop: 12 }}>
          <div className="hms-box-title">Services ({serviceIds.length} selected)</div>
          <div className="hms-table-wrap" style={{ maxHeight: 200 }}>
            <table className="hms-table">
              <thead>
                <tr>
                  <th style={{ width: 22 }}>
                    <input
                      type="checkbox"
                      title="Select all"
                      disabled={readOnly || visibleServices.length === 0}
                      checked={allListed}
                      onChange={(e) => toggleListed(e.target.checked)}
                    />
                  </th>
                  <th style={{ padding: '2px 4px' }}>
                    <input
                      className="hms-field"
                      style={{ width: 180, height: 22 }}
                      placeholder="Search service"
                      value={svcFilter}
                      onChange={(e) => onSvcFilter(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        const q = svcFilter.trim().toLowerCase()
                        if (q) selectMatchingServices(q)
                      }}
                    />
                  </th>
                  <th>Service</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {visibleServices.slice(0, 400).map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => {
                      if (readOnly) return
                      setServiceIds((prev) =>
                        prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                      )
                    }}
                  >
                    <td>
                      <input type="checkbox" readOnly checked={serviceIds.includes(s.id)} />
                    </td>
                    <td>{s.code}</td>
                    <td>{s.name}</td>
                    <td>{fmtMoney(s.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="hms-actions">
          <button
            className={`hms-btn ${mode === 'Delete' ? 'hms-btn-danger' : 'hms-btn-primary'}`}
            type="submit"
            disabled={busy}
          >
            {busy ? '…' : mode === 'Create' ? 'Save' : mode === 'Modify' ? 'Update' : 'Delete'}
          </button>
          <button
            className="hms-btn"
            type="button"
            onClick={() => {
              setMode('Create')
              reset()
            }}
          >
            Clear
          </button>
          {selected && <span>Menu code: {selected.menu_code}</span>}
          {!selected && menuCode && <span>Will activate menu {menuCode}</span>}
        </div>
      </form>

      <div className="hms-table-wrap">
        <table className="hms-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Menu Code</th>
              <th>Name</th>
              <th>Services</th>
              <th>Doctor</th>
              <th>Rate</th>
              <th>Prefix</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.id} className={r.id === selectedId ? 'active' : ''} onClick={() => pick(r)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="hms-btn" type="button" onClick={() => void move(idx, -1)}>
                    ↑
                  </button>{' '}
                  <button className="hms-btn" type="button" onClick={() => void move(idx, 1)}>
                    ↓
                  </button>
                </td>
                <td>{r.menu_code}</td>
                <td>{r.name}</td>
                <td>{(r.services || []).map((s) => s.service_name).join(', ') || r.service_name}</td>
                <td>{r.doctor_name}</td>
                <td>{fmtMoney(r.default_rate)}</td>
                <td>{r.bill_prefix}</td>
                <td>{r.is_active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Box title="Note">
        New options appear as bill menus after the menu list is refreshed (re-login or reload).
      </Box>
    </div>
  )
}
