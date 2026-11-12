import { FormEvent, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'

type Company = {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  gstin?: string | null
  city?: string | null
  address_line1?: string | null
}

export function CompanyProfilePage() {
  const { labels } = useAuth()
  const [form, setForm] = useState<Partial<Company>>({})
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void api.get<Company>('/company-profile').then(setForm)
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const saved = await api.put<Company>('/company-profile', form)
    setForm(saved)
    setMsg('Saved')
  }

  return (
    <div className="erp-card" style={{ maxWidth: 640 }}>
      <h1 className="h4 mb-3">{labels.company} Profile</h1>
      {msg ? <div className="alert alert-success py-2">{msg}</div> : null}
      <form className="vstack gap-3" onSubmit={onSubmit}>
        <input className="form-control" placeholder="Name" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="form-control" placeholder="Address" value={form.address_line1 || ''} onChange={(e) => setForm({ ...form, address_line1: e.target.value })} />
        <input className="form-control" placeholder="City" value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <input className="form-control" placeholder="Phone" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input className="form-control" placeholder="Email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className="form-control" placeholder="GSTIN" value={form.gstin || ''} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
        <button className="btn btn-erp" type="submit">Save</button>
      </form>
    </div>
  )
}
