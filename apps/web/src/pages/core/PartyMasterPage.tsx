import { FormEvent, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'

type Party = {
  id: string
  code: string
  name: string
  party_type: string
  mobile?: string | null
  city?: string | null
}

export function PartyMasterPage() {
  const { labels } = useAuth()
  const [rows, setRows] = useState<Party[]>([])
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [error, setError] = useState('')

  async function load() {
    setRows(await api.get<Party[]>('/parties'))
  }

  useEffect(() => {
    void load().catch((e) => setError(String(e.message || e)))
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    await api.post('/parties', { name, mobile, party_type: 'customer' })
    setName('')
    setMobile('')
    await load()
  }

  return (
    <div className="erp-card">
      <h1 className="h4 mb-3">{labels.party} Master</h1>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <form className="row g-2 mb-4" onSubmit={onSubmit}>
        <div className="col-md-4">
          <input className="form-control" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="col-md-3">
          <input className="form-control" placeholder="Mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </div>
        <div className="col-md-2">
          <button className="btn btn-erp w-100" type="submit">Add</button>
        </div>
      </form>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>{labels.party_code}</th>
            <th>Name</th>
            <th>Mobile</th>
            <th>City</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.code}</td>
              <td>{r.name}</td>
              <td>{r.mobile}</td>
              <td>{r.city}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
