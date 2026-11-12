import { useAuth } from '../auth/AuthContext'

export function DashboardPage() {
  const { displayName, product, labels, user } = useAuth()
  return (
    <div className="erp-card">
      <h1 className="h4 mb-2">{displayName}</h1>
      <p className="mb-3 text-secondary">
        Signed in as <strong>{user?.full_name}</strong>. Product mode: <code>{product}</code>.
      </p>
      <div className="row g-3">
        <div className="col-md-4">
          <div className="p-3 rounded" style={{ background: 'var(--erp-accent-soft)' }}>
            <div className="small text-secondary">Party label</div>
            <div className="fs-5 fw-semibold">{labels.party}</div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="p-3 rounded border">
            <div className="small text-secondary">Company label</div>
            <div className="fs-5 fw-semibold">{labels.company}</div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="p-3 rounded border">
            <div className="small text-secondary">Deposit label</div>
            <div className="fs-5 fw-semibold">{labels.deposit}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
