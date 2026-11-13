import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'

type Props<T> = {
  value: string
  onChange: (value: string) => void
  onSelect: (item: T) => void
  /** Local items (filtered client-side). Ignored when `searchItems` is set. */
  items?: T[]
  /** Remote search — debounce + show up to results from server. */
  searchItems?: (query: string) => Promise<T[]>
  getLabel: (item: T) => string
  getKey?: (item: T) => string
  placeholder?: string
  className?: string
  onEnter?: () => void
  inputRef?: RefObject<HTMLInputElement | null>
  debounceMs?: number
  /**
   * When set, if the typed query exactly matches an item (e.g. code/barcode),
   * that item is selected immediately and the dropdown closes.
   */
  pickExact?: (query: string, items: T[]) => T | undefined | null
}

export function Typeahead<T>({
  value,
  onChange,
  onSelect,
  items = [],
  searchItems,
  getLabel,
  getKey,
  placeholder,
  className,
  onEnter,
  inputRef,
  debounceMs = 200,
  pickExact,
}: Props<T>) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [remote, setRemote] = useState<T[]>([])
  const listId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const reqId = useRef(0)
  const autoDoneFor = useRef('')
  const onSelectRef = useRef(onSelect)
  const pickExactRef = useRef(pickExact)
  onSelectRef.current = onSelect
  pickExactRef.current = pickExact

  const localFiltered = useMemo(() => {
    if (searchItems) return []
    const q = value.trim().toLowerCase()
    if (!q) return items.slice(0, 12)
    return items.filter((it) => getLabel(it).toLowerCase().includes(q)).slice(0, 12)
  }, [items, value, getLabel, searchItems])

  const filtered = searchItems ? remote : localFiltered

  useEffect(() => {
    if (!searchItems) return
    const q = value.trim()
    if (!q) {
      reqId.current += 1
      setRemote([])
      autoDoneFor.current = ''
      return
    }
    const id = ++reqId.current
    const t = window.setTimeout(() => {
      void searchItems(q)
        .then((rows) => {
          if (id !== reqId.current) return
          const sliced = rows.slice(0, 12)
          const exact = pickExactRef.current?.(q, sliced)
          if (exact && autoDoneFor.current !== q) {
            autoDoneFor.current = q
            setRemote([])
            setOpen(false)
            onSelectRef.current(exact)
            return
          }
          setRemote(sliced)
        })
        .catch(() => {
          if (id === reqId.current) setRemote([])
        })
    }, debounceMs)
    return () => window.clearTimeout(t)
  }, [value, searchItems, debounceMs])

  useEffect(() => {
    setActive(0)
  }, [value, filtered.length])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div className={`typeahead-wrap ${className ?? ''}`} ref={wrapRef}>
      <input
        ref={inputRef}
        className="input"
        style={{ width: '100%' }}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        onFocus={(e) => {
          e.target.select()
          setOpen(true)
        }}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const q = value.trim()
            const exact = q ? pickExact?.(q, filtered) : null
            if (exact && !/^\d{8,}$/.test(q)) {
              onSelect(exact)
              setOpen(false)
            } else if (open && filtered[active] && !/^\d{8,}$/.test(q)) {
              onSelect(filtered[active])
              setOpen(false)
            } else if (onEnter) {
              onEnter()
            }
          } else if (e.key === 'Escape') {
            if (open) {
              e.preventDefault()
              e.stopPropagation()
              setOpen(false)
            }
          }
        }}
        onBlur={() => setOpen(false)}
      />
      {open && filtered.length > 0 && (
        <ul className="typeahead-list" id={listId} role="listbox">
          {filtered.map((item, i) => (
            <li key={(getKey?.(item) ?? getLabel(item)) + i} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={i === active ? 'active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(item)
                  setOpen(false)
                }}
              >
                {getLabel(item)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
