import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Category, Member, MemberList } from '../types'

export function CategoryMembersPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [code, setCode] = useState('G')
  const [rows, setRows] = useState<Member[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  const load = async (cat = code) => {
    const res = await api.get<MemberList>('/members', { category: cat, page: 1, page_size: 200 })
    setRows(res.items)
    setTotal(res.total)
  }

  useEffect(() => {
    api
      .get<Category[]>('/categories')
      .then((list) => {
        setCategories(list)
        const def = list.find((c) => c.is_default) ?? list[0]
        if (def) setCode(def.code)
        return load(def?.code ?? 'G')
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <div>
      <h1>Category-wise members</h1>
      {error && <div className="error">{error}</div>}
      <div className="toolbar">
        <label>
          Category
          <select
            className="input"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              void load(e.target.value)
            }}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} · {c.name_en}
              </option>
            ))}
          </select>
        </label>
        <span>{total} members</span>
        <button className="btn" type="button" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ACNO</th>
              <th>Name</th>
              <th>Kannada</th>
              <th>Village</th>
              <th>Mobile</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>{m.acno}</td>
                <td>{m.name_en}</td>
                <td className="kn">{m.name_kn}</td>
                <td className="kn">{m.village_kn || m.village_en}</td>
                <td>{m.mobile}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
