import { useEffect, useState } from 'react'
import { api } from '../../api/client'

type Ledger = {
  id: string
  code: string
  name: string
  group_name: string
  ledger_type: string
  system_key?: string | null
}

export function LedgerMasterPage() {
  const [rows, setRows] = useState<Ledger[]>([])
  useEffect(() => {
    void api.get<Ledger[]>('/accounts/ledgers').then(setRows)
  }, [])
  return (
    <div className="erp-card">
      <h1 className="h4 mb-3">Ledger Master</h1>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Group</th>
            <th>Type</th>
            <th>System</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.code}</td>
              <td>{r.name}</td>
              <td>{r.group_name}</td>
              <td>{r.ledger_type}</td>
              <td>{r.system_key}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
