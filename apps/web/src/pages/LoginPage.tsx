import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function LoginPage() {
  const { token, login, displayName } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState(displayName)

  useEffect(() => {
    let cancelled = false
    void api
      .get<{ product: string; display_name: string }>('/auth/product')
      .then((info) => {
        if (cancelled) return
        setTitle(info.display_name || 'ERP')
        document.title = info.display_name || 'ERP'
        document.documentElement.dataset.product = info.product || ''
        setEmail((current) => current || `admin@${info.product}.example.com`)
      })
      .catch(() => {
        if (!cancelled) setEmail((current) => current || 'admin@generp.example.com')
      })
    return () => {
      cancelled = true
    }
  }, [])

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
          <label className="form-label">Email</label>
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
