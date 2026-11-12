import { useEffect, useState } from 'react'
import { api } from '../api/client'

type Row = { id: string; username: string; action: string; entity: string; entity_id: string; detail: string; created_at: string }
type Res = { items: Row[]; total: number; page: number }

export function AuditPage() {
  const [data, setData] = useState<Res | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<Res>('/audit', { page: 1, page_size: 80 })
      .then(setData)
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <div>
      <h1>Audit trail</h1>
      {error && <div className="error">{error}</div>}
      <p className="hint">{data?.total ?? 0} events</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Id</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.created_at ? r.created_at.replace('T', ' ').slice(0, 19) : ''}</td>
                <td>{r.username}</td>
                <td>{r.action}</td>
                <td>{r.entity}</td>
                <td>{r.entity_id}</td>
                <td>{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
