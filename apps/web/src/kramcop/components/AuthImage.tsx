import { useEffect, useState } from 'react'
import { api } from '../api/client'

export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let url = ''
    let cancelled = false
    api
      .blob(path)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setSrc('')
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])

  if (!src) return <div className={`photo-ph ${className ?? ''}`}>{alt}</div>
  return <img src={src} alt={alt} className={className} />
}
