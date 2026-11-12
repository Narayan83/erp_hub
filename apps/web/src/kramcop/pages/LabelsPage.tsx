import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { LabelItem } from '../types'

type Sheet = { prefix: string; items: LabelItem[] }

export function LabelsPage() {
  const [items, setItems] = useState<LabelItem[]>([])
  const [fromAcno, setFromAcno] = useState('')
  const [toAcno, setToAcno] = useState('')
  const [q, setQuery] = useState('')
  const [error, setError] = useState('')
  const [sheet, setSheet] = useState(0)
  const [lang, setLang] = useState<'kn' | 'en'>('kn')
  const [cols, setCols] = useState(3)

  const rowsPerPage = 7
  const perPage = cols * rowsPerPage

  const load = async () => {
    setError('')
    try {
      const res = await api.get<Sheet>('/members/labels', {
        q,
        acno_from: fromAcno ? Number(fromAcno) : undefined,
        acno_to: toAcno ? Number(toAcno) : undefined,
      })
      setItems(res.items)
      setSheet(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const pages = useMemo(() => {
    const out: LabelItem[][] = []
    for (let i = 0; i < items.length; i += perPage) out.push(items.slice(i, i + perPage))
    return out.length ? out : [[]]
  }, [items, perPage])

  const current = pages[Math.min(sheet, pages.length - 1)] ?? []

  const printAll = () => {
    window.print()
  }

  return (
    <div>
      <div className="no-print">
        <h1>Address labels</h1>
        <p className="hint">
          Prints every filtered label, not only the page on screen. Default is 3 columns on A4. Use the browser print
          dialog to pick the printer.
        </p>
        {error && <div className="error">{error}</div>}
        <div className="toolbar">
          <input className="input" placeholder="ACNO from" value={fromAcno} onChange={(e) => setFromAcno(e.target.value)} />
          <input className="input" placeholder="ACNO to" value={toAcno} onChange={(e) => setToAcno(e.target.value)} />
          <input className="input search" placeholder="Search" value={q} onChange={(e) => setQuery(e.target.value)} />
          <label>
            Language
            <select className="input" value={lang} onChange={(e) => setLang(e.target.value as 'kn' | 'en')}>
              <option value="kn">Kannada</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            Columns
            <select className="input" value={cols} onChange={(e) => setCols(Number(e.target.value))}>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
          <button className="btn" type="button" onClick={() => void load()}>
            Load
          </button>
          <button className="btn primary" type="button" onClick={printAll}>
            Print all pages
          </button>
          <span>
            {items.length} labels · preview page {sheet + 1}/{pages.length}
          </span>
          <button className="btn" type="button" disabled={sheet <= 0} onClick={() => setSheet((s) => s - 1)}>
            Prev page
          </button>
          <button className="btn" type="button" disabled={sheet >= pages.length - 1} onClick={() => setSheet((s) => s + 1)}>
            Next page
          </button>
        </div>
      </div>

      <div className={`label-sheet cols-${cols} label-screen`}>
        {current.map((it) => (
          <LabelCard key={it.acno} it={it} lang={lang} />
        ))}
      </div>

      <div className="label-print-all">
        {pages.map((page, idx) => (
          <div key={idx} className={`label-sheet cols-${cols} label-print-page`}>
            {page.map((it) => (
              <LabelCard key={it.acno} it={it} lang={lang} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function LabelCard({ it, lang }: { it: LabelItem; lang: 'kn' | 'en' }) {
  const kn = lang === 'kn'
  return (
    <article className="label-card">
      <div className="label-top">
        <span>ACNO : {it.acno_display}</span>
        <span>SHR NO. {it.share_no}</span>
      </div>
      <div className={`label-name ${kn ? 'kn' : ''}`}>{kn ? it.name_kn || it.name_en : it.name_en || it.name_kn}</div>
      <div className={kn ? 'kn' : undefined}>
        <strong>AT:</strong> {kn ? it.village_kn || it.village_en : it.village_en || it.village_kn}
      </div>
      <div className={kn ? 'kn' : undefined}>
        <strong>PO:</strong> {kn ? it.post_kn || it.post_en : it.post_en || it.post_kn}
      </div>
      <div className="label-top">
        <span className={kn ? 'kn' : undefined}>
          <strong>TQ:</strong> {kn ? it.taluk_kn || it.taluk_en : it.taluk_en || it.taluk_kn}
        </span>
        <span className={kn ? 'kn' : undefined}>
          <strong>DIST:</strong> {kn ? it.dist_kn || it.dist_en : it.dist_en || it.dist_kn}
        </span>
      </div>
      {it.pin ? <div>PIN: {it.pin}</div> : null}
    </article>
  )
}
