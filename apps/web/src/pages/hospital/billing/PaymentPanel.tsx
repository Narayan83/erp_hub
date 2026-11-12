import type { PayMode, PaymentRow } from './types'
import { money, uid } from './types'

type Props = {
  payModes: PayMode[]
  payments: PaymentRow[]
  netAmount: number
  onChange: (rows: PaymentRow[]) => void
}

export function PaymentPanel({ payModes, payments, netAmount, onChange }: Props) {
  const total = payments.reduce((s, p) => s + money(p.amount), 0)
  const diff = Number((netAmount - total).toFixed(2))

  function addRow() {
    const cash = payModes.find((m) => m.is_cash || m.code === 'CASH') || payModes[0]
    onChange([
      ...payments,
      {
        key: uid('pay'),
        payment_mode_id: cash?.id || '',
        amount: Math.max(diff, 0) || netAmount || 0,
      },
    ])
  }

  function fillCash() {
    const cash = payModes.find((m) => m.is_cash || m.code === 'CASH') || payModes[0]
    if (!cash) return
    onChange([{ key: uid('pay'), payment_mode_id: cash.id, amount: Math.max(netAmount, 0) }])
  }

  return (
    <div className="border rounded p-2">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <strong>Payments</strong>
        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-outline-secondary" type="button" onClick={fillCash}>
            Fill Cash = Net
          </button>
          <button className="btn btn-sm btn-outline-primary" type="button" onClick={addRow}>
            + Mode
          </button>
        </div>
      </div>
      <table className="table table-sm mb-1">
        <thead>
          <tr>
            <th>Mode</th>
            <th style={{ width: 120 }}>Amount</th>
            <th>Doc No</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.key}>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={p.payment_mode_id}
                  onChange={(e) =>
                    onChange(
                      payments.map((row) =>
                        row.key === p.key ? { ...row, payment_mode_id: e.target.value } : row,
                      ),
                    )
                  }
                >
                  <option value="">Select</option>
                  {payModes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  type="number"
                  min={0}
                  step="0.01"
                  value={p.amount}
                  onChange={(e) =>
                    onChange(
                      payments.map((row) =>
                        row.key === p.key ? { ...row, amount: Number(e.target.value) || 0 } : row,
                      ),
                    )
                  }
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={p.document_no || ''}
                  onChange={(e) =>
                    onChange(
                      payments.map((row) =>
                        row.key === p.key ? { ...row, document_no: e.target.value } : row,
                      ),
                    )
                  }
                />
              </td>
              <td>
                <button
                  className="btn btn-sm btn-outline-danger"
                  type="button"
                  onClick={() => onChange(payments.filter((row) => row.key !== p.key))}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={`small ${Math.abs(diff) > 0.01 ? 'text-danger' : 'text-success'}`}>
        Paid {total.toFixed(2)} / Net {netAmount.toFixed(2)}
        {Math.abs(diff) > 0.01 ? ` (diff ${diff.toFixed(2)})` : ' ✓'}
      </div>
    </div>
  )
}
