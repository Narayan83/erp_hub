import { useEffect, useState } from 'react'
import { api } from '../../api/client'

type Mode = {
  id: string
  code: string
  name: string
  is_cash: boolean
  is_credit: boolean
  is_active: boolean
}

export function PaymentModesPage() {
  const [rows, setRows] = useState<Mode[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<Mode[]>('/accounts/payment-modes')
      .then(setRows)
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <div className="erp-card">
      <h1 className="h4 mb-3">Payment Modes</h1>
      {error && <div className="error">{error}</div>}
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Cash</th>
            <th>Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.code}</td>
              <td>{r.name}</td>
              <td>{r.is_cash ? 'Yes' : ''}</td>
              <td>{r.is_credit ? 'Yes' : ''}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4}>No payment modes</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
