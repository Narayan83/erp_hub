import { useEffect, useRef, useState } from 'react'
import { DATE_DISPLAY, formatDate, parseDate } from '../lib/dates'

export function DateField({
  value,
  onChange,
  className = 'input',
}: {
  value: string
  onChange: (iso: string) => void
  className?: string
}) {
  const [text, setText] = useState(() => formatDate(value))
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setText(formatDate(value))
  }, [value])

  const commit = (raw: string) => {
    const iso = parseDate(raw)
    if (!iso) {
      setText(formatDate(value))
      return
    }
    onChange(iso)
    setText(formatDate(iso))
  }

  const openPicker = () => {
    const el = picker.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker()
        return
      } catch {
        /* older browsers */
      }
    }
    el.focus()
    el.click()
  }

  return (
    <span className="date-field">
      <input
        className={className}
        value={text}
        placeholder={DATE_DISPLAY}
        inputMode="numeric"
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
        }}
      />
      <input
        ref={picker}
        className="date-field-picker"
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value}
        onChange={(e) => {
          if (!e.target.value) return
          onChange(e.target.value)
          setText(formatDate(e.target.value))
        }}
      />
      <button
        className="date-field-btn"
        type="button"
        aria-label="Pick date"
        onMouseDown={(e) => e.preventDefault()}
        onClick={openPicker}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path
            fill="currentColor"
            d="M7 2h2v2h6V2h2v2h3v18H4V4h3V2zm11 8H6v10h12V10zM6 6v2h12V6H6z"
          />
        </svg>
      </button>
    </span>
  )
}
