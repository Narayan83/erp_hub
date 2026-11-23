import { useMemo, useState } from 'react'
import type { BillLine, CatalogService } from './types'
import { money, uid } from './types'

type Props = {
  catalog: CatalogService[]
  lines: BillLine[]
  onChange: (lines: BillLine[]) => void
}

export function ServiceCatalogPanel({ catalog, lines, onChange }: Props) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.group_name || '').toLowerCase().includes(q),
    )
  }, [catalog, search])

  function addSelected() {
    const next = [...lines]
    for (const s of filtered) {
      if (!selected[s.id]) continue
      const existing = next.find((l) => l.service_id === s.id)
      if (existing) {
        existing.quantity += 1
      } else {
        next.push({
          key: uid('line'),
          service_id: s.id,
          service_code: s.code,
          service_name: s.name,
          category_name: s.group_name,
          quantity: 1,
          rate: money(s.rate),
        })
      }
    }
    onChange(next)
    setSelected({})
  }

  function updateLine(key: string, patch: Partial<BillLine>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function removeLine(key: string) {
    onChange(lines.filter((l) => l.key !== key))
  }

  const gross = lines.reduce((sum, l) => sum + l.quantity * l.rate, 0)

  return (
    <div className="row g-3">
      <div className="col-lg-6">
        <div className="border rounded p-2 h-100">
          <div className="d-flex gap-2 mb-2">
            <input
              className="form-control form-control-sm"
              placeholder="Search services"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn btn-sm btn-erp" type="button" onClick={addSelected}>
              Add Selected
            </button>
          </div>
          <div style={{ maxHeight: 280, overflow: 'auto' }}>
            <table className="table table-sm table-hover mb-0">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Service</th>
                  <th>Code</th>
                  <th className="text-end">Rate</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!selected[s.id]}
                        onChange={(e) =>
                          setSelected((prev) => ({ ...prev, [s.id]: e.target.checked }))
                        }
                      />
                    </td>
                    <td>
                      {s.name}
                      {s.group_name ? (
                        <div className="small text-muted">{s.group_name}</div>
                      ) : null}
                    </td>
                    <td>{s.code}</td>
                    <td className="text-end">{money(s.rate).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="col-lg-6">
        <div className="border rounded p-2 h-100">
          <div className="d-flex justify-content-between mb-2">
            <strong>Bill Lines</strong>
            <span>Gross: {gross.toFixed(2)}</span>
          </div>
          <div style={{ maxHeight: 280, overflow: 'auto' }}>
            <table className="table table-sm mb-0">
              <thead>
                <tr>
                  <th>Service</th>
                  <th style={{ width: 70 }}>Qty</th>
                  <th style={{ width: 90 }}>Rate</th>
                  <th className="text-end">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      {l.service_name}
                      <div className="small text-muted">{l.service_code}</div>
                    </td>
                    <td>
                      <input
                        className="form-control form-control-sm"
                        type="number"
                        min={1}
                        value={l.quantity}
                        onChange={(e) =>
                          updateLine(l.key, { quantity: Math.max(1, Number(e.target.value) || 1) })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="form-control form-control-sm"
                        type="number"
                        min={0}
                        step="0.01"
                        value={l.rate}
                        onChange={(e) => updateLine(l.key, { rate: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="text-end">{(l.quantity * l.rate).toFixed(2)}</td>
                    <td>
                      <button
                        className="btn btn-sm btn-outline-danger"
                        type="button"
                        onClick={() => removeLine(l.key)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
                {!lines.length && (
                  <tr>
                    <td colSpan={5} className="text-muted">
                      Select services from catalog
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
