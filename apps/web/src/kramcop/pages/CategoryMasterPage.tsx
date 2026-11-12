import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { Category } from '../types'

export function CategoryMasterPage() {
  const [rows, setRows] = useState<Category[]>([])
  const [code, setCode] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [nameKn, setNameKn] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = async () => setRows(await api.get<Category[]>('/categories'))

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message))
  }, [])

  const save = async () => {
    setError('')
    try {
      const body = { code, name_en: nameEn, name_kn: nameKn, is_default: code.toUpperCase() === 'G' }
      if (editId) await api.put(`/categories/${editId}`, body)
      else await api.post('/categories', body)
      setEditId(null)
      setCode('')
      setNameEn('')
      setNameKn('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    }
  }

  return (
    <div>
      <h1>Category master</h1>
      <p className="hint">Used as a dropdown on Customer Master. Default is General (G). Create more codes and map members later.</p>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <div className="row">
          <label>
            Code
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label>
            Name (English)
            <input className="input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </label>
          <label>
            Name (Kannada)
            <input className="input" value={nameKn} onChange={(e) => setNameKn(e.target.value)} />
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
              <th>English</th>
              <th>Kannada</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.name_en}</td>
                <td className="kn">{r.name_kn}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditId(r.id)
                      setCode(r.code)
                      setNameEn(r.name_en)
                      setNameKn(r.name_kn)
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Delete ${r.code}?`)) return
                      try {
                        await api.del(`/categories/${r.id}`)
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
