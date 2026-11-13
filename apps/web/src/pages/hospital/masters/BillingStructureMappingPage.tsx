import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { Banner, Box, FieldWrap } from '../shared/hmsKit'
import { errMsg, unwrapList } from '../shared/hmsShared'

type Named = { id: string; code: string; name: string }
type Mapping = {
  id: string
  billing_type_id: string
  department_id: string
  procedure_type_id: string
  billing_type_name?: string | null
  department_name?: string | null
  procedure_type_name?: string | null
  sort_order: number
  is_active: boolean
}

type Mode = 'Create' | 'Modify' | 'Delete'

/** Billing type → Department → Procedure type mapping (desktop: Billing Structure Mapping). */
export function BillingStructureMappingPage() {
  const [mode, setMode] = useState<Mode>('Create')
  const [types, setTypes] = useState<Named[]>([])
  const [depts, setDepts] = useState<Named[]>([])
  const [procs, setProcs] = useState<Named[]>([])
  const [rows, setRows] = useState<Mapping[]>([])
  const [filterType, setFilterType] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [deptId, setDeptId] = useState('')
  const [procId, setProcId] = useState('')
  const [sortOrder, setSortOrder] = useState(0)
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function loadRows() {
    setRows(unwrapList<Mapping>(await api.get<unknown>('/hospital/billing-structure')))
  }

  useEffect(() => {
    void (async () => {
      try {
        const [t, d, p] = await Promise.all([
          api.get<unknown>('/hospital/billing-types'),
          api.get<unknown>('/hospital/departments'),
          api.get<unknown>('/hospital/procedure-types'),
          loadRows(),
        ])
        setTypes(unwrapList<Named>(t))
        setDepts(unwrapList<Named>(d))
        setProcs(unwrapList<Named>(p))
      } catch (e) {
        setError(errMsg(e))
      }
    })()
  }, [])

  const shown = useMemo(
    () => rows.filter((r) => !filterType || r.billing_type_id === filterType),
    [rows, filterType],
  )

  function pick(r: Mapping) {
    setSelectedId(r.id)
    setTypeId(r.billing_type_id)
    setDeptId(r.department_id)
    setProcId(r.procedure_type_id)
    setSortOrder(r.sort_order)
    setActive(r.is_active)
    if (mode === 'Create') setMode('Modify')
  }

  function clear() {
    setMode('Create')
    setSelectedId('')
    setTypeId('')
    setDeptId('')
    setProcId('')
    setSortOrder(0)
    setActive(true)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      if (mode === 'Create') {
        await api.post('/hospital/billing-structure', {
          billing_type_id: typeId,
          department_id: deptId,
          procedure_type_id: procId,
          sort_order: sortOrder,
          is_active: active,
        })
        setOk('Mapping created')
      } else {
        if (!selectedId) throw new Error('Select a mapping from the grid')
        if (mode === 'Modify') {
          await api.patch(`/hospital/billing-structure/${selectedId}`, {
            sort_order: sortOrder,
            is_active: active,
          })
          setOk('Mapping updated')
        } else {
          await api.delete(`/hospital/billing-structure/${selectedId}`)
          setOk('Mapping deleted')
          clear()
        }
      }
      await loadRows()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const locked = mode !== 'Create'
  const readOnly = mode === 'Delete'

  return (
    <div className="hms-page">
      <h1>Billing Structure Mapping</h1>
      <div className="hint">Map each Billing Type to its Departments and Procedure Types.</div>
      <Banner error={error} ok={ok} />

      <div className="hms-toolbar">
        <label>Action</label>
        <select
          className="hms-field"
          style={{ width: 160 }}
          value={mode}
          onChange={(e) => {
            const m = e.target.value as Mode
            setMode(m)
            if (m === 'Create') clear()
          }}
        >
          <option>Create</option>
          <option>Modify</option>
          <option>Delete</option>
        </select>
        <label>Filter by Billing Type</label>
        <select
          className="hms-field"
          style={{ minWidth: 240 }}
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">All</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} — {t.name}
            </option>
          ))}
        </select>
      </div>

      <form className="hms-box" onSubmit={onSubmit}>
        <div className="hms-box-title">Mapping</div>
        <div className="hms-grid hms-grid-3" style={{ marginTop: 4 }}>
          <FieldWrap label="Billing Type" required>
            <select
              className="hms-field"
              required
              disabled={locked}
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
            >
              <option value="">—</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} — {t.name}
                </option>
              ))}
            </select>
          </FieldWrap>
          <FieldWrap label="Department" required>
            <select
              className="hms-field"
              required
              disabled={locked}
              value={deptId}
              onChange={(e) => setDeptId(e.target.value)}
            >
              <option value="">—</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
          </FieldWrap>
          <FieldWrap label="Procedure Type" required>
            <select
              className="hms-field"
              required
              disabled={locked}
              value={procId}
              onChange={(e) => setProcId(e.target.value)}
            >
              <option value="">—</option>
              {procs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </FieldWrap>
          <FieldWrap label="Sort Order">
            <input
              className="hms-field"
              type="number"
              readOnly={readOnly}
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
            />
          </FieldWrap>
          <FieldWrap label="Active">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
          </FieldWrap>
        </div>
        <div className="hms-actions">
          <button
            className={`hms-btn ${mode === 'Delete' ? 'hms-btn-danger' : 'hms-btn-primary'}`}
            type="submit"
            disabled={busy}
          >
            {busy ? '…' : mode === 'Create' ? 'Save' : mode === 'Modify' ? 'Update' : 'Delete'}
          </button>
          <button className="hms-btn" type="button" onClick={clear}>
            Clear
          </button>
        </div>
      </form>

      <Box title="Existing Mappings">
        <div className="hms-table-wrap">
          <table className="hms-table">
            <thead>
              <tr>
                <th>Billing Type</th>
                <th>Department</th>
                <th>Procedure Type</th>
                <th>Sort</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={r.id === selectedId ? 'active' : ''} onClick={() => pick(r)}>
                  <td>{r.billing_type_name}</td>
                  <td>{r.department_name}</td>
                  <td>{r.procedure_type_name}</td>
                  <td>{r.sort_order}</td>
                  <td>{r.is_active ? 'Yes' : 'No'}</td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={5}>No mappings</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Box>
    </div>
  )
}
