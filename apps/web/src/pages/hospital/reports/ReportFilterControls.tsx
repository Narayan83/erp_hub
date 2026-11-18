import { useMemo, useState } from 'react'
import './report-filters.css'

export type CheckItem = { id: string; label: string }

/**
 * Value semantics: `null` means "all" (no filter, also covers items loaded later);
 * otherwise the explicit list of selected ids.
 */
export type CheckSelection = string[] | null

/** Query value for a selection: undefined = no filter. */
export function selectionParam(items: CheckItem[], sel: CheckSelection): string[] | undefined {
  if (sel === null) return undefined
  if (items.length && items.every((i) => sel.includes(i.id))) return undefined
  return sel
}

export function selectionIsEmpty(sel: CheckSelection): boolean {
  return sel !== null && sel.length === 0
}

type CheckListProps = {
  title: string
  items: CheckItem[]
  value: CheckSelection
  onChange: (v: CheckSelection) => void
  placeholder?: string
  disabled?: boolean
  note?: string
}

export function CheckListFilter({ title, items, value, onChange, placeholder, disabled, note }: CheckListProps) {
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const visible = useMemo(
    () => (needle ? items.filter((i) => i.label.toLowerCase().includes(needle)) : items),
    [items, needle],
  )
  const isChecked = (id: string) => value === null || value.includes(id)
  const selectedCount = value === null ? items.length : items.filter((i) => value.includes(i.id)).length
  const allVisibleChecked = visible.length > 0 && visible.every((i) => isChecked(i.id))

  function current(): string[] {
    return value === null ? items.map((i) => i.id) : value
  }

  function commit(next: string[]) {
    const set = new Set(next)
    onChange(items.length && items.every((i) => set.has(i.id)) ? null : items.filter((i) => set.has(i.id)).map((i) => i.id))
  }

  function toggle(id: string) {
    const cur = current()
    commit(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
  }

  function setVisible(checked: boolean) {
    if (!needle) {
      onChange(checked ? null : [])
      return
    }
    const ids = new Set(visible.map((i) => i.id))
    const cur = current()
    commit(checked ? [...cur, ...ids] : cur.filter((x) => !ids.has(x)))
  }

  return (
    <div className={`hms-checklist${disabled ? ' is-disabled' : ''}`}>
      <div className="hms-checklist-head">
        <span>{title}</span>
        <span className="hms-checklist-count">
          {value === null ? `All (${items.length})` : `${selectedCount} / ${items.length} selected`}
        </span>
      </div>
      <input
        className="hms-field hms-checklist-search"
        placeholder={placeholder ?? `Search ${title.toLowerCase()}…`}
        value={search}
        disabled={disabled}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="hms-checklist-items" title="Drag the bottom edge to resize">
        {visible.length === 0 ? (
          <div className="hms-checklist-empty">{items.length ? 'No match' : 'Nothing to select'}</div>
        ) : (
          visible.map((i) => (
            <label key={i.id} title={i.label}>
              <input type="checkbox" checked={isChecked(i.id)} disabled={disabled} onChange={() => toggle(i.id)} />
              {i.label}
            </label>
          ))
        )}
      </div>
      <div className="hms-checklist-foot">
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
          <input
            type="checkbox"
            checked={allVisibleChecked}
            disabled={disabled || visible.length === 0}
            onChange={(e) => setVisible(e.target.checked)}
          />
          {needle ? 'All shown' : `All ${title}`}
        </label>
        <button type="button" className="hms-btn" disabled={disabled} onClick={() => setVisible(true)}>
          Select All
        </button>
        <button type="button" className="hms-btn" disabled={disabled} onClick={() => setVisible(false)}>
          Clear
        </button>
      </div>
      {note ? <div className="hms-checklist-note">{note}</div> : null}
    </div>
  )
}

type SegmentedProps = {
  options: { value: string; label: string; title?: string }[]
  value: string
  onChange: (v: string) => void
}

export function SegmentedPicker({ options, value, onChange }: SegmentedProps) {
  return (
    <div className="hms-segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          className={o.value === value ? 'is-active' : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SummaryCards({ cards }: { cards: { label: string; value: string; tone?: 'debit' | 'net' }[] }) {
  return (
    <div className="hms-summary-cards">
      {cards.map((c) => (
        <div key={c.label} className={`hms-summary-card${c.tone ? ` is-${c.tone}` : ''}`}>
          <div className="k">{c.label}</div>
          <div className="v">{c.value}</div>
        </div>
      ))}
    </div>
  )
}
