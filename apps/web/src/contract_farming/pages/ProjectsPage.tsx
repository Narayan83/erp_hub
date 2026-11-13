import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { Location, Partner, Project } from '../types'

const empty = {
  name: '',
  address: '',
  location_id: '' as string,
  description: '',
  start_date: '',
  end_date: '',
  is_active: true,
  partner_ids: [] as string[],
}

export function ProjectsPage() {
  const [rows, setRows] = useState<Project[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [form, setForm] = useState({ ...empty })
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    const [p, loc, pr] = await Promise.all([
      api.get<Partner[]>('/partners'),
      api.get<Location[]>('/locations'),
      api.get<Project[]>('/projects'),
    ])
    setPartners(p)
    setLocations(loc)
    setRows(pr)
  }

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message))
  }, [])

  const togglePartner = (id: string) => {
    setForm((f) => ({
      ...f,
      partner_ids: f.partner_ids.includes(id)
        ? f.partner_ids.filter((x) => x !== id)
        : [...f.partner_ids, id],
    }))
  }

  const save = async () => {
    setError('')
    try {
      const body = {
        ...form,
        location_id: form.location_id || null,
      }
      if (editId) await api.put(`/projects/${editId}`, body)
      else await api.post('/projects', body)
      setEditId(null)
      setForm({ ...empty })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    }
  }

  return (
    <div>
      <h1>Projects</h1>
      <p className="hint">
        Create contract farming projects, pick a location, and select multiple partners from the partner master.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <div className="grid2">
          <label>
            Project name
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Location
            <select
              className="input"
              value={form.location_id}
              onChange={(e) => setForm({ ...form, location_id: e.target.value })}
            >
              <option value="">— select —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start
            <input
              className="input"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            />
          </label>
          <label>
            End
            <input
              className="input"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Address
            <textarea
              className="input"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Description
            <textarea
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div className="hint" style={{ marginBottom: 8 }}>
            Partners on this project
          </div>
          <div className="partner-checks">
            {partners.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={form.partner_ids.includes(p.id)}
                  onChange={() => togglePartner(p.id)}
                />
                {p.name}
              </label>
            ))}
          </div>
        </div>
        <div className="row">
          <button className="btn primary" type="button" onClick={() => void save()}>
            {editId ? 'Update project' : 'Create project'}
          </button>
          {editId && (
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setEditId(null)
                setForm({ ...empty })
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Location</th>
              <th>Address</th>
              <th>Partners</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.location_name || '—'}</td>
                <td>{r.address}</td>
                <td>{(r.partners || []).map((p) => p.name).join(', ') || '—'}</td>
                <td className="row-actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      setEditId(r.id)
                      setForm({
                        name: r.name,
                        address: r.address || '',
                        location_id: r.location_id || '',
                        description: r.description || '',
                        start_date: r.start_date || '',
                        end_date: r.end_date || '',
                        is_active: r.is_active,
                        partner_ids: [...(r.partner_ids || [])],
                      })
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn danger"
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Delete ${r.name}?`)) return
                      try {
                        await api.del(`/projects/${r.id}`)
                        await load()
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Delete failed')
                      }
                    }}
                  >
                    Delete
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
