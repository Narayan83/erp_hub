import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

function storedProduct() {
  try {
    return (localStorage.getItem('erp_product') || '').trim()
  } catch {
    return ''
  }
}

const PRODUCT_IDS = new Set(['hospital', 'generp', 'lodge', 'kramcop', 'contract_farming', 'erp'])

function defaultAdminUser(product: string) {
  const p = (product || 'erp').trim() || 'erp'
  return p
}

function isReplaceableLogin(value: string) {
  return !value || PRODUCT_IDS.has(value) || /^admin@.+\.example\.com$/i.test(value)
}

export function LoginPage() {
  const { token, login, displayName, product } = useAuth()
  const initialProduct = product || storedProduct()
  const [email, setEmail] = useState(() => (initialProduct ? defaultAdminUser(initialProduct) : ''))
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState(displayName)

  useEffect(() => {
    let cancelled = false
    void api
      .get<{
        product: string
        display_name: string
        default_admin_username?: string
        default_admin_email?: string
      }>('/auth/product')
      .then((info) => {
        if (cancelled) return
        const p = info.product || storedProduct() || 'erp'
        setTitle(info.display_name || 'ERP')
        document.title = info.display_name || 'ERP'
        document.documentElement.dataset.product = p
        try {
          localStorage.setItem('erp_product', p)
        } catch {
          /* ignore */
        }
        const nextUser = (info.default_admin_username || defaultAdminUser(p)).trim()
        setEmail((current) => (isReplaceableLogin(current) ? nextUser : current))
      })
      .catch(() => {
        if (cancelled) return
        const p = storedProduct() || product
        if (p) setEmail((current) => (isReplaceableLogin(current) ? defaultAdminUser(p) : current))
      })
    return () => {
      cancelled = true
    }
  }, [product])

  if (token) return <Navigate to="/dashboard" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="erp-card login-card" onSubmit={onSubmit}>
        <h1 className="h4 mb-1">{title || displayName || 'ERP'}</h1>
        <p className="text-secondary small mb-3">Local web login — product from server config</p>
        {error ? <div className="alert alert-danger py-2">{error}</div> : null}
        <div className="mb-3">
          <label className="form-label">Username</label>
          <input className="form-control" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="mb-3">
          <label className="form-label">Password</label>
          <input
            className="form-control"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-erp w-100" disabled={busy} type="submit">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
