import { useEffect } from 'react'
import { findSaveAction } from './useGlobalSaveShortcut'

/** Input types that are not typed fields (Enter should keep native behaviour). */
const SKIP_TYPES = new Set(['hidden', 'button', 'submit', 'reset', 'image', 'file'])

/** Types where focusing a field should highlight the existing value, like WinForms. */
const SELECT_TYPES = new Set(['text', 'search', 'tel', 'url', 'password', 'email', 'number'])

function isVisible(el: HTMLElement): boolean {
  if (el.closest('[hidden], [aria-hidden="true"]')) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return el.getClientRects().length > 0
}

function isEditableControl(el: Element): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly
  if (el instanceof HTMLSelectElement) return !el.disabled
  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false
    if (SKIP_TYPES.has(el.type.toLowerCase())) return false
    return true
  }
  return false
}

function isNavSource(el: HTMLElement): boolean {
  if (el.closest('[data-enter="native"]')) return false
  if (el.isContentEditable) return false
  if (el instanceof HTMLTextAreaElement) return false
  if (el instanceof HTMLButtonElement) return false
  if (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type.toLowerCase())) return false
  return isEditableControl(el)
}

function collectFields(scope: ParentNode): HTMLElement[] {
  const nodes = scope.querySelectorAll<HTMLElement>('input, select, textarea')
  return Array.from(nodes).filter((el) => {
    if (el.tabIndex < 0) return false
    if (!isEditableControl(el)) return false
    return isVisible(el)
  })
}

function fieldScope(el: HTMLElement): ParentNode {
  return (
    el.closest('form') ||
    el.closest('dialog, [role="dialog"]') ||
    el.closest('.hms-page, .erp-card, .login-card, .hms-box') ||
    el.closest('.erp-main') ||
    document
  )
}

function nextField(scope: ParentNode, current: HTMLElement): HTMLElement | null {
  const fields = collectFields(scope)
  const idx = fields.indexOf(current)
  if (idx >= 0) return fields[idx + 1] ?? null
  for (const el of fields) {
    if (current.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) return el
  }
  return null
}

function defaultButton(current: HTMLElement, scope: ParentNode): HTMLButtonElement | HTMLInputElement | null {
  const form = current.closest('form')
  const root: ParentNode = form ?? scope
  const submits = root.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
    'button[type="submit"], input[type="submit"]',
  )
  for (const btn of submits) {
    if (!btn.disabled && isVisible(btn)) return btn
  }
  return findSaveAction(root instanceof Document || root instanceof Element ? root : document)
}

function focusField(el: HTMLElement) {
  el.focus()
  if (el instanceof HTMLInputElement && SELECT_TYPES.has(el.type.toLowerCase())) {
    try {
      el.select()
    } catch {
      /* date/number in some browsers */
    }
  }
}

/**
 * Windows Forms-style keyboard: Enter in a text box / combo moves to the next
 * field and never submits the form. Enter on a button still clicks it.
 * Textareas keep newline. Last field focuses the form's Save/Find button.
 */
export function useEnterMovesNextField() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (e.isComposing || e.keyCode === 229) return
      if (e.repeat) return

      const target = e.target
      if (!(target instanceof HTMLElement)) return
      if (!isNavSource(target)) return

      const scope = fieldScope(target)
      const next = nextField(scope, target)
      if (next) {
        e.preventDefault()
        focusField(next)
        return
      }

      const btn = defaultButton(target, scope)
      if (btn && btn !== target) {
        e.preventDefault()
        btn.focus()
      } else {
        // No next field and no button — still block implicit form submit.
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
