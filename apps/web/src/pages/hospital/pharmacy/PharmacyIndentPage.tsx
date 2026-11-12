import { FormEvent, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'

type Item = { id: string; code: string; name: string }
type Line = { item_id: string; item_name: string; quantity: number }

export function PharmacyIndentPage() {
  const [wardName, setWardName] = useState('')
  const [itemQ, setItemQ] = useState('')
  const [itemHits, setItemHits] = useState<Item[]>([])
  const [qty, setQty] = useState('1')
  const [lines, setLines] = useState<Line[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function searchItems() {
    setItemHits(await api.get<Item[]>('/hospital/pharmacy/items/search', { q: itemQ, item_type: 'MD', limit: 20 }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const created = await api.post<{ bill_no?: string }>('/hospital/pharmacy/indents', {
        ward_name: wardName,
        lines: lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
      })
      setOk(`Saved ${created.bill_no || ''}`)
      setLines([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>Medicine Indent</h1>
      {error && <div className="hms-error">{error}</div>}
      {ok && <div className="hms-ok">{ok}</div>}
      <form onSubmit={onSubmit}>
        <div className="hms-toolbar">
          <label>Ward</label>
          <input className="hms-field" style={{ width: 200 }} required value={wardName} onChange={(e) => setWardName(e.target.value)} />
          <input className="hms-field" style={{ width: 200 }} placeholder="Item search" value={itemQ} onChange={(e) => setItemQ(e.target.value)} />
          <button className="hms-btn" type="button" onClick={() => void searchItems().catch((e) => setError(String(e)))}>
            Search
          </button>
          <input className="hms-field" style={{ width: 70 }} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        {itemHits.length > 0 && (
          <div className="hms-table-wrap" style={{ maxHeight: 140 }}>
            <table className="hms-table">
              <tbody>
                {itemHits.map((it) => (
                  <tr
                    key={it.id}
                    onClick={() => {
                      setLines((prev) => [
                        ...prev,
                        { item_id: it.id, item_name: `${it.code} — ${it.name}`, quantity: Number(qty) || 1 },
                      ])
                      setItemHits([])
                    }}
                  >
                    <td>{it.code}</td>
                    <td>{it.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="hms-table-wrap">
          <table className="hms-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.item_name}</td>
                  <td>{l.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hms-actions">
          <button className="hms-btn hms-btn-primary" type="submit" disabled={busy || !lines.length}>
            Save Indent
          </button>
        </div>
      </form>
    </div>
  )
}
