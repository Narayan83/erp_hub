import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import type {
  Balance,
  Labour,
  Ledger,
  Partner,
  PaymentMode,
  Phase,
  Project,
  Transaction,
  Vendor,
  WorkType,
} from '../types'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function money(v: number | string | null | undefined) {
  const n = Number(v || 0)
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const empty = {
  project_id: '',
  phase_id: '',
  work_type_id: '',
  ledger_id: '',
  payment_mode_id: '',
  party_type: 'none',
  labour_id: '',
  partner_id: '',
  vendor_id: '',
  txn_date: today(),
  amount: '',
  narration: '',
  reference: '',
}

export function TransactionsPage() {
  const [rows, setRows] = useState<Transaction[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [phases, setPhases] = useState<Phase[]>([])
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [modes, setModes] = useState<PaymentMode[]>([])
  const [labours, setLabours] = useState<Labour[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [form, setForm] = useState({ ...empty })
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [ledgerBal, setLedgerBal] = useState<Balance | null>(null)
  const [partyBal, setPartyBal] = useState<Balance | null>(null)

  const selectedMode = useMemo(
    () => modes.find((m) => m.id === form.payment_mode_id),
    [modes, form.payment_mode_id],
  )

  const projectPartners = useMemo(() => {
    const project = projects.find((p) => p.id === form.project_id)
    if (!project?.partner_ids?.length) return partners
    const ids = new Set(project.partner_ids)
    return partners.filter((p) => ids.has(p.id))
  }, [projects, partners, form.project_id])

  const loadMasters = async () => {
    const [pr, ph, wt, ld, pm, lb, pt, vd] = await Promise.all([
      api.get<Project[]>('/projects'),
      api.get<Phase[]>('/phases'),
      api.get<WorkType[]>('/work-types'),
      api.get<Ledger[]>('/ledgers'),
      api.get<PaymentMode[]>('/payment-modes'),
      api.get<Labour[]>('/labours'),
      api.get<Partner[]>('/partners'),
      api.get<Vendor[]>('/vendors'),
    ])
    setProjects(pr)
    setPhases(ph)
    setWorkTypes(wt)
    setLedgers(ld)
    setModes(pm)
    setLabours(lb)
    setPartners(pt)
    setVendors(vd)
  }

  const loadTxns = async (projectId?: string) => {
    setRows(
      await api.get<Transaction[]>(
        '/transactions',
        projectId ? { project_id: projectId } : undefined,
      ),
    )
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadMasters()
        await loadTxns()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Load failed')
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      setLedgerBal(null)
      if (!form.ledger_id) return
      try {
        setLedgerBal(await api.get<Balance>(`/balances/ledger/${form.ledger_id}`))
      } catch {
        /* ignore */
      }
    })()
  }, [form.ledger_id])

  useEffect(() => {
    void (async () => {
      setPartyBal(null)
      try {
        if (form.party_type === 'partner' && form.partner_id) {
          setPartyBal(await api.get<Balance>(`/balances/partner/${form.partner_id}`))
        } else if (form.party_type === 'labour' && form.labour_id) {
          setPartyBal(await api.get<Balance>(`/balances/labour/${form.labour_id}`))
        } else if (form.party_type === 'vendor' && form.vendor_id) {
          setPartyBal(await api.get<Balance>(`/balances/vendor/${form.vendor_id}`))
        }
      } catch {
        /* ignore */
      }
    })()
  }, [form.party_type, form.partner_id, form.labour_id, form.vendor_id])

  const save = async () => {
    setError('')
    try {
      const body = {
        project_id: form.project_id,
        phase_id: form.phase_id,
        work_type_id: form.work_type_id,
        ledger_id: form.ledger_id,
        payment_mode_id: form.payment_mode_id,
        party_type: form.party_type,
        labour_id: form.party_type === 'labour' ? form.labour_id || null : null,
        partner_id: form.party_type === 'partner' ? form.partner_id || null : null,
        vendor_id: form.party_type === 'vendor' ? form.vendor_id || null : null,
        txn_date: form.txn_date,
        amount: Number(form.amount),
        narration: form.narration,
        reference: form.reference,
      }
      if (editId) await api.put(`/transactions/${editId}`, body)
      else await api.post('/transactions', body)
      setEditId(null)
      setForm({ ...empty, project_id: form.project_id, phase_id: form.phase_id })
      await loadTxns(form.project_id || undefined)
      await loadMasters()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    }
  }

  return (
    <div>
      <h1>Transactions</h1>
      <p className="hint">
        Project → Phase → Work type → Ledger → Labour / Partner / Vendor. Payment mode sets Credit or Debit
        automatically.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <div className="grid3">
          <label>
            Project
            <select
              className="input"
              value={form.project_id}
              onChange={(e) => {
                setForm({ ...form, project_id: e.target.value, partner_id: '' })
                void loadTxns(e.target.value || undefined)
              }}
            >
              <option value="">— select —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Phase
            <select
              className="input"
              value={form.phase_id}
              onChange={(e) => setForm({ ...form, phase_id: e.target.value })}
            >
              <option value="">— select —</option>
              {phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Work type
            <select
              className="input"
              value={form.work_type_id}
              onChange={(e) => setForm({ ...form, work_type_id: e.target.value })}
            >
              <option value="">— select —</option>
              {workTypes.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ledger
            <select
              className="input"
              value={form.ledger_id}
              onChange={(e) => setForm({ ...form, ledger_id: e.target.value })}
            >
              <option value="">— select —</option>
              {ledgers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Party type
            <select
              className="input"
              value={form.party_type}
              onChange={(e) =>
                setForm({
                  ...form,
                  party_type: e.target.value,
                  labour_id: '',
                  partner_id: '',
                  vendor_id: '',
                })
              }
            >
              <option value="none">None</option>
              <option value="partner">Partner</option>
              <option value="labour">Labour</option>
              <option value="vendor">Vendor</option>
            </select>
          </label>
          {form.party_type === 'partner' && (
            <label>
              Partner
              <select
                className="input"
                value={form.partner_id}
                onChange={(e) => setForm({ ...form, partner_id: e.target.value })}
              >
                <option value="">— select —</option>
                {projectPartners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {form.party_type === 'labour' && (
            <label>
              Labour
              <select
                className="input"
                value={form.labour_id}
                onChange={(e) => setForm({ ...form, labour_id: e.target.value })}
              >
                <option value="">— select —</option>
                {labours.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {form.party_type === 'vendor' && (
            <label>
              Vendor
              <select
                className="input"
                value={form.vendor_id}
                onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
              >
                <option value="">— select —</option>
                {vendors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Date
            <input
              className="input"
              type="date"
              value={form.txn_date}
              onChange={(e) => setForm({ ...form, txn_date: e.target.value })}
            />
          </label>
          <label>
            Amount
            <input
              className="input"
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </label>
          <label>
            Mode of payment
            <select
              className="input"
              value={form.payment_mode_id}
              onChange={(e) => setForm({ ...form, payment_mode_id: e.target.value })}
            >
              <option value="">— select —</option>
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.entry_type})
                </option>
              ))}
            </select>
          </label>
          <label>
            Auto entry type
            <div style={{ paddingTop: 8 }}>
              {selectedMode ? (
                <span className={`badge ${selectedMode.entry_type}`}>{selectedMode.entry_type}</span>
              ) : (
                <span className="hint">Select a payment mode</span>
              )}
            </div>
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Narration
            <textarea
              className="input"
              value={form.narration}
              onChange={(e) => setForm({ ...form, narration: e.target.value })}
            />
          </label>
        </div>
        <div className="row">
          {ledgerBal && (
            <div className="balance-chip">
              Ledger <strong>{ledgerBal.name}</strong>: ₹ {money(ledgerBal.balance)}
            </div>
          )}
          {partyBal && (
            <div className="balance-chip">
              {partyBal.entity} <strong>{partyBal.name}</strong>: ₹ {money(partyBal.balance)}
            </div>
          )}
        </div>
        <div className="row">
          <button className="btn primary" type="button" onClick={() => void save()}>
            {editId ? 'Update' : 'Save transaction'}
          </button>
          {editId && (
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setEditId(null)
                setForm({ ...empty })
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Project</th>
              <th>Phase</th>
              <th>Work</th>
              <th>Ledger</th>
              <th>Party</th>
              <th>Mode</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Narration</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.txn_date}</td>
                <td>{r.project_name}</td>
                <td>{r.phase_name}</td>
                <td>{r.work_type_name}</td>
                <td>{r.ledger_name}</td>
                <td>{r.party_name || '—'}</td>
                <td>{r.payment_mode_name}</td>
                <td>
                  <span className={`badge ${r.entry_type}`}>{r.entry_type}</span>
                </td>
                <td className="money">₹ {money(r.amount)}</td>
                <td>{r.narration}</td>
                <td className="row-actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      setEditId(r.id)
                      setForm({
                        project_id: r.project_id,
                        phase_id: r.phase_id,
                        work_type_id: r.work_type_id,
                        ledger_id: r.ledger_id,
                        payment_mode_id: r.payment_mode_id,
                        party_type: r.party_type || 'none',
                        labour_id: r.labour_id || '',
                        partner_id: r.partner_id || '',
                        vendor_id: r.vendor_id || '',
                        txn_date: r.txn_date,
                        amount: String(r.amount),
                        narration: r.narration || '',
                        reference: r.reference || '',
                      })
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn danger"
                    type="button"
                    onClick={async () => {
                      if (!confirm('Delete this transaction?')) return
                      try {
                        await api.del(`/transactions/${r.id}`)
                        await loadTxns(form.project_id || undefined)
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
