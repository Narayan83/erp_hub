import { FormEvent, useEffect, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'

type Group = { id: string; code: string; name: string }
type Item = { id: string; code: string; name: string }
type Mapping = { id: string; group_id: string; item_id: string }

export function AssignMedicineGroupPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [groupId, setGroupId] = useState('')
  const [itemId, setItemId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  async function load() {
    const [g, it, m] = await Promise.all([
      api.get<Group[]>('/hospital/pharmacy/code-masters', { master_type: 'MG' }),
      api.get<Item[]>('/hospital/pharmacy/items', { item_type: 'MD' }),
      api.get<Mapping[]>('/hospital/pharmacy/group-mappings'),
    ])
    setGroups(g)
    setItems(Array.isArray(it) ? it : [])
    setMappings(m)
    if (!groupId && g[0]) setGroupId(g[0].id)
    if (!itemId && (Array.isArray(it) ? it[0] : null)) setItemId((it as Item[])[0].id)
  }

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(null)
    try {
      await api.post('/hospital/pharmacy/group-mappings', { group_id: groupId, item_id: itemId })
      setOk('Assigned')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`/hospital/pharmacy/group-mappings/${id}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="hms-page">
      <h1>Assign Medicine To Group</h1>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}
      <form className="hms-box" onSubmit={onSubmit}>
        <div className="hms-box-title">Mapping</div>
        <div className="hms-grid hms-grid-2" style={{ marginTop: 4 }}>
          <div className="hms-field-wrap">
            <label>Group</label>
            <select className="hms-field" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code} — {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="hms-field-wrap">
            <label>Medicine</label>
            <select className="hms-field" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.code} — {it.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="hms-actions">
          <button className="hms-btn hms-btn-primary" type="submit">
            Assign
          </button>
        </div>
      </form>
      <div className="hms-table-wrap">
        <table className="hms-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Medicine</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.id}>
                <td>{groups.find((g) => g.id === m.group_id)?.name || m.group_id}</td>
                <td>{items.find((i) => i.id === m.item_id)?.name || m.item_id}</td>
                <td>
                  <button className="hms-btn hms-btn-danger" type="button" onClick={() => void remove(m.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
