import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { englishToKannada } from '../lib/kannada'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

/** Type English phonetically — it becomes Kannada Unicode as you type. */
export function KannadaInput({ value, onChange, placeholder, className }: Props) {
  const buf = useRef('')
  const committed = useRef(value)

  useEffect(() => {
    if (!buf.current) committed.current = value
  }, [value])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key.length === 1 && /[A-Za-z]/.test(e.key)) {
      e.preventDefault()
      buf.current += e.key
      onChange(committed.current + englishToKannada(buf.current))
      return
    }
    if (e.key === ' ') {
      e.preventDefault()
      committed.current = committed.current + englishToKannada(buf.current) + ' '
      buf.current = ''
      onChange(committed.current)
      return
    }
    if (e.key === 'Backspace' && buf.current) {
      e.preventDefault()
      buf.current = buf.current.slice(0, -1)
      onChange(committed.current + englishToKannada(buf.current))
    }
  }

  const onBlur = () => {
    if (buf.current) {
      committed.current = committed.current + englishToKannada(buf.current)
      buf.current = ''
      onChange(committed.current)
    } else if (/[A-Za-z]/.test(value)) {
      const converted = englishToKannada(value)
      committed.current = converted
      onChange(converted)
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (text && /[A-Za-z]/.test(text)) {
      e.preventDefault()
      committed.current = committed.current + englishToKannada(text)
      buf.current = ''
      onChange(committed.current)
    }
  }

  return (
    <input
      className={className ?? 'input kn'}
      value={value}
      placeholder={placeholder ?? 'Type English → Kannada'}
      onChange={(e) => {
        buf.current = ''
        committed.current = e.target.value
        onChange(e.target.value)
      }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onPaste={onPaste}
    />
  )
}
