import { useEffect } from 'react'
import { findFieldNavContainer, handleEnterAsTab } from '../../lib/generp/enterAsTab'

/** Close the top-most application popup when Escape is pressed. */
export function EscapeClosesModals() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const backdrops = document.querySelectorAll('.modal-backdrop')
      const top = backdrops[backdrops.length - 1]
      if (!(top instanceof HTMLElement)) return
      e.preventDefault()
      top.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}

/** Left / right arrow moves between fields (at caret edges), like Tab / Shift+Tab. */
export function FieldArrowNav() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.defaultPrevented) return
      const target = e.target
      if (!(target instanceof HTMLElement)) return
      const container = findFieldNavContainer(target)
      if (!container) return
      handleEnterAsTab(e, container)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}

