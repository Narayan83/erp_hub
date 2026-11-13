import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'

type User = { id: string; full_name: string; email: string }
type Recipient = { user_id: string; is_enabled: boolean }

const EVENTS = [
  { code: 'BILL_CANCEL', label: 'Bill Cancel' },
  { code: 'BILL_MODIFY', label: 'Bill Modify' },
  { code: 'DISCOUNT_AUTH', label: 'Discount Authorise' },
  { code: 'LOW_STOCK', label: 'Low Stock' },
]

export function NotificationSetupPage() {
  const [eventCode, setEventCode] = useState(EVENTS[0].code)
  const [users, setUsers] = useState<User[]>([])
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api
      .get<User[]>('/hospital/users', { active_only: true })
      .then(setUsers)
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    void api
      .get<{ recipients?: Recipient[] } | Recipient[]>('/hospital/notifications/setup', { event_code: eventCode })
      .then((data) => {
        const list = Array.isArray(data) ? data : data.recipients || []
        const map: Record<string, boolean> = {}
        for (const u of users) map[u.id] = false
        for (const r of list) map[r.user_id] = Boolean(r.is_enabled)
        setEnabled(map)
      })
      .catch(() => {
        const map: Record<string, boolean> = {}
        for (const u of users) map[u.id] = false
        setEnabled(map)
      })
  }, [eventCode, users])

  async function save() {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      await api.put('/hospital/notifications/setup', {
        event_code: eventCode,
        recipients: Object.entries(enabled).map(([user_id, is_enabled]) => ({ user_id, is_enabled })),
      })
      setOk('Saved')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>Notification Setup</h1>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}
      <div className="hms-toolbar">
        <label>Event</label>
        <select className="hms-field" style={{ minWidth: 200 }} value={eventCode} onChange={(e) => setEventCode(e.target.value)}>
          {EVENTS.map((e) => (
            <option key={e.code} value={e.code}>
              {e.label}
            </option>
          ))}
        </select>
        <button className="hms-btn hms-btn-primary" type="button" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>
      <div className="hms-table-wrap">
        <table className="hms-table">
          <thead>
            <tr>
              <th>Enabled</th>
              <th>User</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={Boolean(enabled[u.id])}
                    onChange={(e) => setEnabled((prev) => ({ ...prev, [u.id]: e.target.checked }))}
                  />
                </td>
                <td>{u.full_name}</td>
                <td>{u.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
