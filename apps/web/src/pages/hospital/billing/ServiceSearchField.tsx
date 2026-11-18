import { useRef } from 'react'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

export function ServiceSearchField({
  value,
  onChange,
  placeholder = 'Search service name or code...',
  disabled = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="hms-search-field">
      <button
        type="button"
        className="hms-search-icon-btn"
        aria-label="Search services"
        disabled={disabled}
        onClick={() => inputRef.current?.focus()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <input
        ref={inputRef}
        className="hms-field"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
