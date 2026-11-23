import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { DateField } from '../components/DateField'
import { LedgerModal } from '../components/LedgerModal'
import { formatDate } from '../lib/dates'
import type { ShareType, SummaryRow } from '../types'

type Res = { society_name: string; as_on: string; language: string; items: SummaryRow[]; total: number }

type ColKey =
  | 'acno'
  | 'name'
  | 'share_no'
  | 'village'
  | 'post'
  | 'taluk'
  | 'district'
  | 'category'
  | 'sex'
  | 'mobile'
  | 'phone'
  | 'share_type'
  | 'balance'

const COLUMNS: { key: ColKey; label: string }[] = [
  { key: 'acno', label: 'ACNO' },
  { key: 'name', label: 'Name' },
  { key: 'share_no', label: 'Share no' },
  { key: 'village', label: 'Village' },
  { key: 'post', label: 'Post' },
  { key: 'taluk', label: 'Taluk' },
  { key: 'district', label: 'District' },
  { key: 'category', label: 'Category' },
  { key: 'sex', label: 'Sex' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'phone', label: 'Phone' },
  { key: 'share_type', label: 'Share type' },
  { key: 'balance', label: 'Balance' },
]

const today = () => new Date().toISOString().slice(0, 10)

const DEFAULT_HEADER_1 = 'ಕರ್ನಾಟಕ ರಾಜ್ಯ ಅತಿಥಿ ಮಾರಾಟ ಸಹಕಾರ ಮಂಡಳ ನಿಯಮಿತ, ತೀರ್ಥಹಳ್ಳಿ'
const DEFAULT_HEADER_NOTE = 'ರಂದು ಮುಂದಿನ ಐದು ವರ್ಷದ ಅವಧಿಗೆ ನಡೆಯುವ ಚುನಾವಣೆಯ "ಬ" ಪಟ್ಟಿಯ ಆಧಾರದ ಮೇರೆಗೆ'

function headerLine2(asOn: string) {
  return `${formatDate(asOn)} ${DEFAULT_HEADER_NOTE}`
}

function replaceLeadingDate(line: string, previous: string, next: string) {
  if (previous && line.startsWith(previous)) return next + line.slice(previous.length)
  if (/^\d{2}\/\d{2}\/\d{4}/.test(line)) return next + line.slice(10)
  return `${next} ${line}`.trim()
}

const emptyFilters = (): Record<ColKey, string> => ({
  acno: '',
  name: '',
  share_no: '',
  village: '',
  post: '',
  taluk: '',
  district: '',
  category: '',
  sex: '',
  mobile: '',
  phone: '',
  share_type: '',
  balance: '',
})

function langText(language: string, en: string, kn: string) {
  return (language === 'kn' ? kn || en : en || kn) || ''
}

function filterText(row: SummaryRow, key: ColKey, language: string) {
  if (key === 'acno') return String(row.acno)
  if (key === 'name') return langText(language, row.name_en, row.name_kn)
  if (key === 'share_no') return row.share_no || ''
  if (key === 'village') return langText(language, row.village_en, row.village_kn)
  if (key === 'post') return langText(language, row.post_en, row.post_kn)
  if (key === 'taluk') return langText(language, row.taluk_en, row.taluk_kn)
  if (key === 'district') return langText(language, row.district_en, row.district_kn)
  if (key === 'category') return row.category || ''
  if (key === 'sex') return row.sex || ''
  if (key === 'mobile') return row.mobile || ''
  if (key === 'phone') return row.phone || ''
  if (key === 'share_type') {
    const code = row.share_type_code ? String(row.share_type_code) : ''
    return [row.share_type_label, code].filter(Boolean).join(' ')
  }
  return row.balance.toFixed(2)
}

function displayText(row: SummaryRow, key: ColKey, language: string) {
  if (key === 'share_type') return row.share_type_label || (row.share_type_code ? String(row.share_type_code) : '')
  if (key === 'balance') return row.balance.toFixed(2)
  return filterText(row, key, language)
}

const KN_COLS = new Set<ColKey>(['name', 'village', 'post', 'taluk', 'district'])

function TalukFilterSelect({
  value,
  options,
  onChange,
  className,
  ariaLabel,
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
}) {
  return (
    <select
      className={className ?? 'input'}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All</option>
      {options.map((taluk) => (
        <option key={taluk} value={taluk}>
          {taluk}
        </option>
      ))}
    </select>
  )
}

type MemberOption = {
  acno: number
  name_en: string
  name_kn: string
  mobile: string
}

function memberLabel(member: MemberOption, language: string) {
  const name = langText(language, member.name_en, member.name_kn)
  return `${member.acno} · ${name}`
}

function NameSearchSelect({
  language,
  members,
  selectedAcno,
  onSelect,
}: {
  language: string
  members: MemberOption[]
  selectedAcno: number | null
  onSelect: (acno: number | null) => void
}) {
  const wrapRef = useRef<HTMLLabelElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const selected = members.find((m) => m.acno === selectedAcno) ?? null

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: MemberOption[] = []
    for (const member of members) {
      const nameEn = member.name_en.toLowerCase()
      const nameKn = member.name_kn.toLowerCase()
      if (
        String(member.acno).includes(q) ||
        nameEn.includes(q) ||
        nameKn.includes(q) ||
        member.mobile.toLowerCase().includes(q)
      ) {
        out.push(member)
        if (out.length >= 40) break
      }
    }
    return out
  }, [members, query])

  const display = open || !selected ? query : memberLabel(selected, language)

  const pick = (member: MemberOption) => {
    onSelect(member.acno)
    setQuery('')
    setOpen(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      const member = matches[active]
      if (member) {
        event.preventDefault()
        pick(member)
      }
      return
    }
    if (event.key === 'Escape') setOpen(false)
  }

  return (
    <label className="grow name-search" ref={wrapRef}>
      Member name
      <input
        className={`input search${language === 'kn' ? ' kn' : ''}`}
        value={display}
        placeholder="Search name…"
        aria-label="Search member name"
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        autoComplete="off"
        onFocus={(e) => {
          e.target.select()
          if (query.trim()) setOpen(true)
        }}
        onChange={(e) => {
          const next = e.target.value
          setQuery(next)
          setActive(0)
          setOpen(true)
          if (selectedAcno != null) onSelect(null)
        }}
        onKeyDown={onKeyDown}
      />
      {selected && (
        <button
          className="name-search-clear"
          type="button"
          aria-label="Clear selected member"
          onClick={() => {
            onSelect(null)
            setQuery('')
            setOpen(false)
          }}
        >
          ×
        </button>
      )}
      {open && query.trim() && matches.length === 0 && (
        <div className="name-search-list">
          <p className="muted name-search-empty">No matching members</p>
        </div>
      )}
      {open && matches.length > 0 && (
        <ul className="name-search-list" role="listbox">
          {matches.map((member, index) => (
            <li key={member.acno}>
              <button
                type="button"
                role="option"
                className={index === active ? 'active' : undefined}
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(member)}
              >
                <span className={language === 'kn' ? 'kn' : undefined}>{memberLabel(member, language)}</span>
                {member.mobile ? <span className="muted"> · {member.mobile}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  )
}

export function ShareSummaryPage() {
  const [asOn, setAsOn] = useState(today())
  const [balance, setBalance] = useState('positive')
  const [lang, setLang] = useState('kn')
  const [shareType, setShareType] = useState('')
  const [types, setTypes] = useState<ShareType[]>([])
  const [data, setData] = useState<Res | null>(null)
  const [filters, setFilters] = useState(emptyFilters)
  const [selectedAcno, setSelectedAcno] = useState<number | null>(null)
  const [nameSearchKey, setNameSearchKey] = useState(0)
  const [sortKey, setSortKey] = useState<ColKey>('acno')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [header1, setHeader1] = useState(DEFAULT_HEADER_1)
  const [header2, setHeader2] = useState(() => headerLine2(today()))
  const [columnOrder, setColumnOrder] = useState<ColKey[]>(COLUMNS.map((col) => col.key))
  const [hiddenCols, setHiddenCols] = useState<Set<ColKey>>(() => new Set())
  const [colsOpen, setColsOpen] = useState(false)
  const [dragKey, setDragKey] = useState<ColKey | null>(null)
  const [dropKey, setDropKey] = useState<ColKey | null>(null)
  const langRef = useRef(lang)
  const asOnRef = useRef(asOn)

  const taluks = useMemo(() => {
    const seen = new Map<string, string>()
    for (const row of data?.items ?? []) {
      const label = langText(lang, row.taluk_en, row.taluk_kn).trim()
      if (!label) continue
      const key = label.toLowerCase()
      if (!seen.has(key)) seen.set(key, label)
    }
    return [...seen.values()].sort((a, b) =>
      a.localeCompare(b, lang === 'kn' ? 'kn' : 'en', { sensitivity: 'base' }),
    )
  }, [data, lang])

  const members = useMemo(() => {
    const seen = new Map<number, MemberOption>()
    for (const row of data?.items ?? []) {
      if (seen.has(row.acno)) continue
      seen.set(row.acno, {
        acno: row.acno,
        name_en: row.name_en,
        name_kn: row.name_kn,
        mobile: row.mobile,
      })
    }
    const locale = lang === 'kn' ? 'kn' : 'en'
    return [...seen.values()].sort(
      (a, b) =>
        langText(lang, a.name_en, a.name_kn).localeCompare(langText(lang, b.name_en, b.name_kn), locale, {
          sensitivity: 'base',
        }) || a.acno - b.acno,
    )
  }, [data, lang])

  const load = async () => {
    setError('')
    try {
      setData(await api.get<Res>('/reports/share-summary', { as_on: asOn, balance, language: lang }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
  }

  useEffect(() => {
    void load()
    api.get<ShareType[]>('/share-types').then(setTypes).catch(() => undefined)
  }, [])

  useEffect(() => {
    const previous = formatDate(asOnRef.current)
    const next = formatDate(asOn)
    asOnRef.current = asOn
    if (previous === next) return
    setHeader2((line) => replaceLeadingDate(line, previous, next))
  }, [asOn])

  useEffect(() => {
    if (langRef.current === lang) return
    const prevLang = langRef.current
    langRef.current = lang
    setFilters((prev) => {
      const selected = prev.taluk.trim().toLowerCase()
      if (!selected) return prev
      const row = (data?.items ?? []).find(
        (item) => langText(prevLang, item.taluk_en, item.taluk_kn).trim().toLowerCase() === selected,
      )
      const next = row ? langText(lang, row.taluk_en, row.taluk_kn).trim() : ''
      if (next === prev.taluk) return prev
      return { ...prev, taluk: next }
    })
  }, [lang, data])

  const rows = useMemo(() => {
    const items = data?.items ?? []
    const typeCode = shareType ? Number(shareType) : null
    const filtered = items.filter((row) => {
      if (selectedAcno != null && row.acno !== selectedAcno) return false
      if (typeCode != null && row.share_type_code !== typeCode) return false
      return COLUMNS.every((col) => {
        const query = filters[col.key].trim().toLowerCase()
        if (!query) return true
        const text = filterText(row, col.key, lang).trim().toLowerCase()
        if (col.key === 'taluk') return text === query
        return text.includes(query)
      })
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortKey === 'acno') return (a.acno - b.acno) * dir
      if (sortKey === 'balance') return (a.balance - b.balance) * dir
      if (sortKey === 'share_type') return (a.share_type_code - b.share_type_code) * dir || (a.acno - b.acno)
      const locale = lang === 'kn' ? 'kn' : 'en'
      const cmp = filterText(a, sortKey, lang).localeCompare(filterText(b, sortKey, lang), locale, {
        sensitivity: 'base',
        numeric: true,
      })
      return cmp * dir || (a.acno - b.acno)
    })
  }, [data, filters, lang, selectedAcno, shareType, sortDir, sortKey])

  const orderedColumns = useMemo(
    () => columnOrder.map((key) => COLUMNS.find((col) => col.key === key)).filter((col): col is (typeof COLUMNS)[number] => !!col),
    [columnOrder],
  )
  const visibleColumns = useMemo(
    () => orderedColumns.filter((col) => !hiddenCols.has(col.key)),
    [hiddenCols, orderedColumns],
  )

  const moveColumn = (from: ColKey, to: ColKey) => {
    if (from === to) return
    setColumnOrder((prev) => {
      const next = [...prev]
      const fromIdx = next.indexOf(from)
      const toIdx = next.indexOf(to)
      if (fromIdx < 0 || toIdx < 0) return prev
      next.splice(fromIdx, 1)
      next.splice(toIdx, 0, from)
      return next
    })
  }

  const onGripDragStart = (key: ColKey, event: DragEvent) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', key)
    setDragKey(key)
  }

  const onColumnDragOver = (key: ColKey, event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropKey !== key) setDropKey(key)
  }

  const onColumnDrop = (key: ColKey, event: DragEvent) => {
    event.preventDefault()
    const from = (event.dataTransfer.getData('text/plain') as ColKey) || dragKey
    if (from) moveColumn(from, key)
    setDragKey(null)
    setDropKey(null)
  }

  const toggleColumn = (key: ColKey) => {
    setHiddenCols((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const printReport = () => {
    const style = document.createElement('style')
    style.setAttribute('data-share-summary-print', '')
    style.textContent = '@media print { @page { size: A4 landscape; margin: 8mm; } }'
    document.head.appendChild(style)
    const cleanup = () => {
      style.remove()
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
  }

  const onSort = (key: ColKey, dir?: 'asc' | 'desc') => {
    if (dir) {
      setSortKey(key)
      setSortDir(dir)
      return
    }
    if (sortKey === key) setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const exportParams = () => ({
    as_on: asOn,
    balance,
    language: lang,
    share_type: shareType || undefined,
    sort: sortKey,
    sort_dir: sortDir,
    f_acno: filters.acno,
    f_name: filters.name,
    f_share_no: filters.share_no,
    f_village: filters.village,
    f_post: filters.post,
    f_taluk: filters.taluk,
    f_district: filters.district,
    f_category: filters.category,
    f_sex: filters.sex,
    f_mobile: filters.mobile,
    f_phone: filters.phone,
    f_share_type: filters.share_type,
    f_balance: filters.balance,
    columns: visibleColumns.map((col) => col.key).join(',') || '-',
    header1,
    header2,
    member_acno: selectedAcno ?? undefined,
  })

  return (
    <div className="share-summary-page">
      <div className="report-head kn">
        <input
          className="input report-title no-print"
          value={header1}
          aria-label="Report heading"
          onChange={(e) => setHeader1(e.target.value)}
        />
        <input
          className="input report-sub no-print"
          value={header2}
          aria-label="Report subheading"
          onChange={(e) => setHeader2(e.target.value)}
        />
        <div className="print-only report-title">{header1}</div>
        <div className="print-only report-sub">{header2}</div>
        <p className="hint no-print report-note">
          These lines print at the top of the PDF. Changing As on updates the date at the start of the second line.
          Print / PDF uses the rows on this page, the columns you leave checked, and the order you drag them into.
        </p>
      </div>
      <div className="no-print">
        <h1>Share summary</h1>
        {error && <div className="error">{error}</div>}
        <div className="toolbar">
          <NameSearchSelect
            key={nameSearchKey}
            language={lang}
            members={members}
            selectedAcno={selectedAcno}
            onSelect={setSelectedAcno}
          />
          <label>
            As on
            <DateField value={asOn} onChange={setAsOn} />
          </label>
          <label>
            Language
            <select className="input" value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="kn">Kannada</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            Balance
            <select className="input" value={balance} onChange={(e) => setBalance(e.target.value)}>
              <option value="positive">Positive</option>
              <option value="zero">Zero</option>
              <option value="negative">Negative</option>
              <option value="all">All</option>
            </select>
          </label>
          <label>
            Taluk
            <TalukFilterSelect
              value={filters.taluk}
              options={taluks}
              ariaLabel="Filter by taluk"
              onChange={(value) => setFilters((prev) => ({ ...prev, taluk: value }))}
            />
          </label>
          <label>
            Share type
            <select className="input" value={shareType} onChange={(e) => setShareType(e.target.value)}>
              <option value="">All</option>
              {types.map((t) => (
                <option key={t.id} value={String(t.code)}>
                  {t.prefix ? `${t.prefix} · ` : ''}
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort by
            <select className="input" value={sortKey} onChange={(e) => setSortKey(e.target.value as ColKey)}>
              {orderedColumns.map((col) => (
                <option key={col.key} value={col.key}>
                  {col.label}
                </option>
              ))}
            </select>
          </label>
          <label className="short">
            Order
            <select className="input" value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
          <button className="btn" type="button" onClick={() => void load()}>
            Load
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setFilters(emptyFilters())
              setShareType('')
              setSelectedAcno(null)
              setNameSearchKey((key) => key + 1)
            }}
          >
            Clear filters
          </button>
          <div className="col-tools">
            <button className="btn" type="button" onClick={() => setColsOpen((openPanel) => !openPanel)}>
              Columns ({visibleColumns.length}/{orderedColumns.length})
            </button>
            {colsOpen && (
              <div className="col-picker-panel">
                <div className="col-picker-actions">
                  <button className="btn" type="button" onClick={() => setHiddenCols(new Set())}>
                    All
                  </button>
                  <button className="btn" type="button" onClick={() => setHiddenCols(new Set(columnOrder))}>
                    None
                  </button>
                </div>
                <p className="muted">Uncheck a column to leave it off the report. Drag ⋮⋮ to move it.</p>
                {orderedColumns.map((col) => (
                  <div
                    key={col.key}
                    className={dropKey === col.key ? 'col-picker-row drag-over' : 'col-picker-row'}
                    onDragOver={(e) => onColumnDragOver(col.key, e)}
                    onDrop={(e) => onColumnDrop(col.key, e)}
                  >
                    <button
                      className="col-grip"
                      type="button"
                      draggable
                      aria-label={`Move ${col.label}`}
                      title="Drag to move this column"
                      onDragStart={(e) => onGripDragStart(col.key, e)}
                      onDragEnd={() => {
                        setDragKey(null)
                        setDropKey(null)
                      }}
                    >
                      ⋮⋮
                    </button>
                    <label className="check">
                      <input type="checkbox" checked={!hiddenCols.has(col.key)} onChange={() => toggleColumn(col.key)} />
                      {col.label}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="btn primary" type="button" onClick={printReport}>
            Print / PDF
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void api.download('/reports/share-summary/export', 'share-summary.xlsx', { ...exportParams(), fmt: 'xlsx' })}
          >
            Excel
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void api.download('/reports/share-summary/export', 'share-summary.csv', { ...exportParams(), fmt: 'csv' })}
          >
            CSV
          </button>
          <Link className="btn" to="/address_labels">
            Address report
          </Link>
        </div>
      </div>
      <p className="hint summary-meta">
        Share summary as on {formatDate(data?.as_on ?? asOn)} · {rows.length} shown
        {data ? ` of ${data.total}` : ''} members
      </p>
      <div className="table-wrap summary-wrap">
        <table className="summary-table">
          <thead>
            <tr>
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className={dropKey === col.key ? 'drag-over' : undefined}
                  aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  onDragOver={(e) => onColumnDragOver(col.key, e)}
                  onDrop={(e) => onColumnDrop(col.key, e)}
                >
                  <div className="sort-head">
                    <button
                      className="col-grip"
                      type="button"
                      draggable
                      aria-label={`Move ${col.label}`}
                      title="Drag to move this column"
                      onDragStart={(e) => onGripDragStart(col.key, e)}
                      onDragEnd={() => {
                        setDragKey(null)
                        setDropKey(null)
                      }}
                    >
                      ⋮⋮
                    </button>
                    <button className="sort-btn" type="button" onClick={() => onSort(col.key)}>
                      {col.label}
                    </button>
                    <span className="sort-pair">
                      <button
                        className={sortKey === col.key && sortDir === 'asc' ? 'on' : undefined}
                        type="button"
                        aria-label={`Sort ${col.label} ascending`}
                        onClick={() => onSort(col.key, 'asc')}
                      >
                        ▲
                      </button>
                      <button
                        className={sortKey === col.key && sortDir === 'desc' ? 'on' : undefined}
                        type="button"
                        aria-label={`Sort ${col.label} descending`}
                        onClick={() => onSort(col.key, 'desc')}
                      >
                        ▼
                      </button>
                    </span>
                  </div>
                </th>
              ))}
            </tr>
            <tr className="no-print">
              {visibleColumns.map((col) => (
                <th key={col.key}>
                  {col.key === 'taluk' ? (
                    <TalukFilterSelect
                      className="input col-filter"
                      value={filters.taluk}
                      options={taluks}
                      ariaLabel="Filter Taluk"
                      onChange={(value) => setFilters((prev) => ({ ...prev, taluk: value }))}
                    />
                  ) : col.key === 'share_type' ? (
                    <select
                      className="input col-filter"
                      value={shareType}
                      aria-label="Filter Share type"
                      onChange={(e) => setShareType(e.target.value)}
                    >
                      <option value="">All</option>
                      {types.map((t) => (
                        <option key={t.id} value={String(t.code)}>
                          {t.prefix ? `${t.prefix} · ` : ''}
                          {t.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input col-filter"
                      value={filters[col.key]}
                      placeholder="Filter"
                      aria-label={`Filter ${col.label}`}
                      onChange={(e) => setFilters((prev) => ({ ...prev, [col.key]: e.target.value }))}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleColumns.length === 0 && (
              <tr>
                <td className="muted">Select at least one column.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.acno}-${r.share_type_code}`}>
                {visibleColumns.map((col) => {
                  if (col.key === 'acno') {
                    return (
                      <td key={col.key}>
                        <button className="linkish" type="button" onClick={() => setOpen(r.acno)}>
                          {r.acno}
                        </button>
                      </td>
                    )
                  }
                  const text = displayText(r, col.key, lang)
                  return (
                    <td key={col.key} className={lang === 'kn' && KN_COLS.has(col.key) ? 'kn' : undefined}>
                      {text}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open != null && <LedgerModal acno={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
