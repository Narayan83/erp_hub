import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Company } from '../types'

const empty: Company = {
  name_en: 'Kramcop',
  name_kn: '',
  address_en: '',
  address_kn: '',
  village: '',
  taluk: '',
  district: '',
  state: 'Karnataka',
  pin: '',
  phone: '',
  mobile: '',
  email: '',
  website: '',
  reg_no: '',
  gstin: '',
  pan: '',
  financial_year: '',
}

export function SettingsPage() {
  const [form, setForm] = useState<Company>(empty)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<Company>('/company')
      .then((c) => setForm({ ...empty, ...c }))
      .catch((err: Error) => setError(err.message))
  }, [])

  const set = (key: keyof Company, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const save = async () => {
    setError('')
    setMsg('')
    try {
      const saved = await api.put<Company>('/company', form)
      setForm({ ...empty, ...saved })
      setMsg('Company master saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  return (
    <div>
      <h1>Company master</h1>
      <p className="hint">Society name and address used on reports. Label prefix comes from Share Type Master, not from here.</p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="ok">{msg}</div>}
      <div className="panel">
        <div className="grid2">
          <label>
            Company name (English)
            <input className="input" value={form.name_en} onChange={(e) => set('name_en', e.target.value)} />
          </label>
          <label>
            Company name (Kannada)
            <input className="input" value={form.name_kn} onChange={(e) => set('name_kn', e.target.value)} />
          </label>
          <label>
            Address (English)
            <input className="input" value={form.address_en} onChange={(e) => set('address_en', e.target.value)} />
          </label>
          <label>
            Address (Kannada)
            <input className="input" value={form.address_kn} onChange={(e) => set('address_kn', e.target.value)} />
          </label>
          <label>
            Village / place
            <input className="input" value={form.village} onChange={(e) => set('village', e.target.value)} />
          </label>
          <label>
            Taluk
            <input className="input" value={form.taluk} onChange={(e) => set('taluk', e.target.value)} />
          </label>
          <label>
            District
            <input className="input" value={form.district} onChange={(e) => set('district', e.target.value)} />
          </label>
          <label>
            State
            <input className="input" value={form.state} onChange={(e) => set('state', e.target.value)} />
          </label>
          <label>
            PIN
            <input className="input" value={form.pin} onChange={(e) => set('pin', e.target.value)} />
          </label>
          <label>
            Phone
            <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </label>
          <label>
            Mobile
            <input className="input" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
          </label>
          <label>
            Email
            <input className="input" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </label>
          <label>
            Website
            <input className="input" value={form.website} onChange={(e) => set('website', e.target.value)} />
          </label>
          <label>
            Registration no.
            <input className="input" value={form.reg_no} onChange={(e) => set('reg_no', e.target.value)} />
          </label>
          <label>
            GSTIN
            <input className="input" value={form.gstin} onChange={(e) => set('gstin', e.target.value)} />
          </label>
          <label>
            PAN
            <input className="input" value={form.pan} onChange={(e) => set('pan', e.target.value)} />
          </label>
          <label>
            Financial year
            <input className="input" value={form.financial_year} onChange={(e) => set('financial_year', e.target.value)} placeholder="2026-27" />
          </label>
        </div>
        <button className="btn primary" type="button" onClick={() => void save()}>
          Save company
        </button>
      </div>
    </div>
  )
}
