import { useNavigate, useParams } from 'react-router-dom'

export function PlaceholderPage({ code: codeProp, label }: { code?: string; label?: string }) {
  const params = useParams()
  const navigate = useNavigate()
  const code = codeProp || params['*'] || 'module'
  return (
    <div className="placeholder-page">
      <h2>{label || String(code).replace(/_/g, ' ')}</h2>
      <p>
        This module is available next. Sale Bill is ready first — open Transactions → Sale Bill, or{' '}
        <button type="button" className="btn btn-primary" onClick={() => navigate('/sale_bill')}>
          go to Sale Bill
        </button>
      </p>
    </div>
  )
}
