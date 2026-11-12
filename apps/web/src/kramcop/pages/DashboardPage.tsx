import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

type Company = {
  name_en: string
  name_kn?: string
  village?: string
  district?: string
  member_count: number
}

export function DashboardPage() {
  const [s, setS] = useState<Company | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<Company>('/company')
      .then(setS)
      .catch((err: Error) => setError(err.message))
  }, [])

  const place = [s?.village, s?.district].filter(Boolean).join(', ')

  return (
    <div className="dash">
      <section className="dash-hero">
        <svg className="dash-art" viewBox="0 0 220 140" aria-hidden="true">
          <defs>
            <linearGradient id="leaf" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#99f6e4" />
              <stop offset="100%" stopColor="#0f766e" />
            </linearGradient>
          </defs>
          <circle cx="170" cy="36" r="46" fill="#ccfbf1" />
          <circle cx="28" cy="108" r="34" fill="#d1fae5" />
          <path d="M40 96c28-8 48-32 52-62 18 22 18 52-2 72-18 18-42 20-50-10z" fill="url(#leaf)" opacity="0.85" />
          <path d="M118 28c24 10 38 36 28 58-16 8-36 2-48-16 8-16 12-32 20-42z" fill="#5eead4" opacity="0.7" />
        </svg>
        <div>
          <p className="dash-kicker">Co-operative share desk</p>
          <h1>{s?.name_en || 'Kramcop'}</h1>
          {s?.name_kn && <p className="kn dash-kn">{s.name_kn}</p>}
          {place && <p className="hint">{place}</p>}
        </div>
      </section>
      {error && <div className="error">{error}</div>}
      <div className="cards">
        <div className="stat accent">
          <div className="stat-n">{s?.member_count ?? '—'}</div>
          <div className="stat-l">Members</div>
        </div>
        <div className="stat">
          <div className="stat-n">A–D</div>
          <div className="stat-l">Share classes</div>
        </div>
        <div className="stat">
          <div className="stat-n">Labels</div>
          <div className="stat-l">Prefix from share type</div>
        </div>
      </div>
      <div className="dash-links">
        <Link className="dash-tile" to="/customer_master">
          <strong>Customer Master</strong>
          <span>Add or edit members</span>
        </Link>
        <Link className="dash-tile" to="/share_entry">
          <strong>Share entry</strong>
          <span>Addition and deletion</span>
        </Link>
        <Link className="dash-tile" to="/share_schedule">
          <strong>Share schedule</strong>
          <span>Open any ledger</span>
        </Link>
        <Link className="dash-tile" to="/address_labels">
          <strong>Address labels</strong>
          <span>Print all filtered pages</span>
        </Link>
      </div>
    </div>
  )
}
