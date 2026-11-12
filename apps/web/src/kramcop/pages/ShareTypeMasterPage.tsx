import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { ShareType } from '../types'

export function ShareTypeMasterPage() {
  const [rows, setRows] = useState<ShareType[]>([])
  const [code, setCode] = useState('5')
  const [prefix, setPrefix] = useState('')
  const [name, setName] = useState('')
  const [legacy, setLegacy] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = async () => setRows(await api.get<ShareType[]>('/share-types'))

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message))
  }, [])

  const save = async () => {
    setError('')
    try {
      const body = {
        code: Number(code),
        prefix: prefix.trim().toUpperCase(),
        name,
        legacy_code: legacy ? Number(legacy) : null,
        is_active: true,
      }
      if (editId) await api.put(`/share-types/${editId}`, body)
      else await api.post('/share-types', body)
      setEditId(null)
      setName('')
      setPrefix('')
      setLegacy('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    }
  }

  return (
    <div>
      <h1>Share type master</h1>
      <p className="hint">
        Prefix is the letter printed on labels (A, B, C, D…). Members mapped to this type get that prefix before ACNO,
        for example D-101.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <div className="row">
          <label>
            Code
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label>
            Prefix
            <input className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="A / B / C / D" />
          </label>
          <label>
            Name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Legacy code
            <input className="input" value={legacy} onChange={(e) => setLegacy(e.target.value)} placeholder="optional" />
          </label>
        </div>
        <button className="btn primary" type="button" onClick={() => void save()}>
          {editId ? 'Update' : 'Save'}
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Prefix</th>
              <th>Name</th>
              <th>Legacy</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.prefix}</td>
                <td>{r.name}</td>
                <td>{r.legacy_code ?? ''}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditId(r.id)
                      setCode(String(r.code))
                      setPrefix(r.prefix || '')
                      setName(r.name)
                      setLegacy(r.legacy_code ? String(r.legacy_code) : '')
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Delete ${r.name}?`)) return
                      try {
                        await api.del(`/share-types/${r.id}`)
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
