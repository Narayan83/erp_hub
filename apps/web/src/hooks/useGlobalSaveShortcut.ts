import { useEffect } from 'react'

/** Labels treated as the page's primary save/commit action for Ctrl+S. */
const SAVE_LABEL = /^(save|update|post|apply|submit|add)$/i

function buttonLabel(btn: HTMLButtonElement): string {
  return (btn.innerText || btn.textContent || '').replace(/\s+/g, ' ').trim()
}

function isVisible(el: HTMLElement): boolean {
  if (el.closest('[hidden], [aria-hidden="true"]')) return false
  return el.getClientRects().length > 0
}

function actionScore(btn: HTMLButtonElement): number {
  const label = buttonLabel(btn)
  let score = 0
  if (btn.hasAttribute('data-save-shortcut')) score += 10
  if (btn.classList.contains('hms-btn-primary') || btn.classList.contains('btn-erp')) score += 3
  if (btn.type === 'submit') score += 2
  if (/^save$/i.test(label)) score += 2
  if (/^update$/i.test(label)) score += 1
  return score
}

/**
 * Resolve the current page's save button inside the main content area
 * (falls back to document when layout is not present, e.g. login).
 */
export function findSaveAction(root: ParentNode = document): HTMLButtonElement | null {
  const scope =
    (root instanceof Document || root instanceof Element
      ? root.querySelector('.erp-main, .login-card, dialog[open], [role="dialog"]')
      : null) || root

  const marked = scope.querySelectorAll<HTMLButtonElement>(
    'button[data-save-shortcut]:not([disabled])',
  )
  for (const btn of marked) {
    if (isVisible(btn)) return btn
  }

  const buttons = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).filter(
    (btn) => !btn.disabled && isVisible(btn) && SAVE_LABEL.test(buttonLabel(btn)),
  )
  if (!buttons.length) return null

  return [...buttons].sort((a, b) => actionScore(b) - actionScore(a))[0] || null
}

/** Trigger the active page save action. Returns true if a save control was found. */
export function triggerGlobalSave(): boolean {
  const btn = findSaveAction()
  if (!btn) return false

  if (btn.type === 'submit') {
    const form = btn.form ?? btn.closest('form')
    if (form instanceof HTMLFormElement) {
      form.requestSubmit(btn)
      return true
    }
  }

  btn.click()
  return true
}

/** App-wide Ctrl+S / Cmd+S — prevents browser "Save page" and runs the form save action. */
export function useGlobalSaveShortcut() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() !== 's') return
      // Always stop the browser save-page dialog when our app handles the chord.
      e.preventDefault()
      if (e.repeat || e.altKey || e.shiftKey) return
      triggerGlobalSave()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
