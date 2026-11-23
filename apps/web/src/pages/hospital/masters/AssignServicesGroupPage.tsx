import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { Banner } from '../shared/hmsKit'
import { errMsg, fmtMoney, unwrapList } from '../shared/hmsShared'

type Group = { id: string; code: string; name: string }
type Service = {
  id: string
  code: string
  name: string
  rate: number | string
  group_id?: string | null
  group_name?: string | null
  sub_category_name?: string | null
}

/**
 * Assign Services To Group. Assignment sets `group_id` on the patient service.
 */
export function AssignServicesGroupPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [groupId, setGroupId] = useState('')
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function loadServices() {
    setServices(unwrapList<Service>(await api.get<unknown>('/hospital/patient-services')))
  }

  useEffect(() => {
    void (async () => {
      try {
        setGroups(unwrapList<Group>(await api.get<unknown>('/hospital/service-groups')))
        await loadServices()
      } catch (e) {
        setError(errMsg(e))
      }
    })()
  }, [])

  const inGroup = useMemo(() => services.filter((s) => s.group_id === groupId), [services, groupId])
  const candidates = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return services.filter(
      (s) =>
        s.group_id !== groupId &&
        (!q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)),
    )
  }, [services, groupId, filter])

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function assign(ids: string[], target: string | null) {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      for (const id of ids) {
        await api.patch(`/hospital/patient-services/${id}`, {
          group_id: target,
          sub_category_id: null,
        })
      }
      setOk(target ? `${ids.length} service(s) assigned` : `${ids.length} service(s) removed`)
      setPicked(new Set())
      await loadServices()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>Assign Services To Group</h1>
      <div className="hint">Moving a service to a group clears its sub-category.</div>
      <Banner error={error} ok={ok} />
      <div className="hms-toolbar">
        <label>Group</label>
        <select
          className="hms-field"
          style={{ minWidth: 300 }}
          value={groupId}
          onChange={(e) => {
            setGroupId(e.target.value)
            setPicked(new Set())
          }}
        >
          <option value="">—</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.code} — {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className="hms-grid hms-grid-2">
        <div>
          <div className="hms-toolbar">
            <strong>Available services</strong>
            <input
              className="hms-field"
              style={{ width: 200 }}
              placeholder="Search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button
              className="hms-btn hms-btn-primary"
              type="button"
              disabled={busy || !groupId || !picked.size}
              onClick={() => void assign([...picked], groupId)}
            >
              Assign selected →
            </button>
          </div>
          <div className="hms-table-wrap">
            <table className="hms-table">
              <thead>
                <tr>
                  <th />
                  <th>Code</th>
                  <th>Service</th>
                  <th>Current group</th>
                </tr>
              </thead>
              <tbody>
                {candidates.slice(0, 500).map((s) => (
                  <tr key={s.id} onClick={() => toggle(s.id)}>
                    <td>
                      <input type="checkbox" readOnly checked={picked.has(s.id)} />
                    </td>
                    <td>{s.code}</td>
                    <td>{s.name}</td>
                    <td>{s.group_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="hms-toolbar">
            <strong>Services in group ({inGroup.length})</strong>
          </div>
          <div className="hms-table-wrap">
            <table className="hms-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Service</th>
                  <th>Rate</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {inGroup.map((s) => (
                  <tr key={s.id}>
                    <td>{s.code}</td>
                    <td>{s.name}</td>
                    <td>{fmtMoney(s.rate)}</td>
                    <td>
                      <button
                        className="hms-btn hms-btn-danger"
                        type="button"
                        disabled={busy}
                        onClick={() => void assign([s.id], null)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {!inGroup.length && (
                  <tr>
                    <td colSpan={4}>{groupId ? 'No services in this group' : 'Select a group'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
