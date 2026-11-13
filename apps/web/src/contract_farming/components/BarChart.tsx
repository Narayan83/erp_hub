import type { ChartPoint } from '../types'

function num(v: number | string) {
  return Number(v || 0)
}

export function BarChart({
  title,
  points,
  altSeries,
}: {
  title: string
  points: ChartPoint[]
  altSeries?: string
}) {
  const max = Math.max(1, ...points.map((p) => num(p.value)))
  return (
    <div className="panel chart-card">
      <h3>{title}</h3>
      {!points.length && <p className="hint">No data yet.</p>}
      {points.map((p, i) => (
        <div className="bar-row" key={`${p.label}-${p.series}-${i}`}>
          <div title={p.label}>
            {p.label.length > 14 ? `${p.label.slice(0, 14)}…` : p.label}
            {p.series ? ` (${p.series[0]})` : ''}
          </div>
          <div className="bar-track">
            <div
              className={`bar-fill${altSeries && p.series === altSeries ? ' alt' : ''}`}
              style={{ width: `${(num(p.value) / max) * 100}%` }}
            />
          </div>
          <div className="money">
            {num(p.value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
        </div>
      ))}
    </div>
  )
}
