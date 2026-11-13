/** Enter / arrows move focus like Tab (desktop voucher UX). */

const FOCUSABLE =
  'input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'

const ARROW_SKIP_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'range',
  'file',
  'color',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
])

/** Nearest form region for global left/right field navigation. */
const FIELD_NAV_ROOT =
  '[data-enter-root], .party-enter-root, .master-form, .settings-box, .sale-bill-screen, .sale-bill, .stock-voucher-page, .journal-entry-page'

function isVisible(el: HTMLElement): boolean {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
}

function isEnterFocusable(el: HTMLElement): boolean {
  if (!isVisible(el)) return false
  if (el.tabIndex < 0) return false
  if (el.dataset.skipEnter === 'true') return false
  if (el.getAttribute('aria-hidden') === 'true') return false
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return false
  return true
}

export function listEnterTargets(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isEnterFocusable)
}

export function focusNextEnterTarget(
  container: HTMLElement,
  current: HTMLElement,
  direction: 1 | -1 = 1,
): HTMLElement | null {
  const nodes = listEnterTargets(container)
  const idx = nodes.indexOf(current)
  if (idx < 0) {
    const first = direction === 1 ? nodes[0] : nodes[nodes.length - 1]
    first?.focus()
    return first ?? null
  }
  const next = nodes[idx + direction]
  if (!next) return null
  next.focus()
  if (next instanceof HTMLInputElement && next.type !== 'date' && next.type !== 'checkbox') {
    next.select()
  }
  return next
}

export function findFieldNavContainer(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>(FIELD_NAV_ROOT)
}

function caretAllowsArrowNav(
  el: HTMLInputElement | HTMLTextAreaElement,
  key: 'ArrowLeft' | 'ArrowRight',
): boolean {
  const start = el.selectionStart
  const end = el.selectionEnd
  // type=number in Chrome has no selection API — treat arrows as field move
  if (start == null || end == null) return true
  const len = el.value.length
  if (start === 0 && end === len) return true
  if (key === 'ArrowLeft') return start === 0 && end === 0
  return start === len && end === len
}

function shouldArrowNavigate(el: HTMLElement, key: 'ArrowLeft' | 'ArrowRight'): boolean {
  if (el.tagName === 'BUTTON') return false
  if (el.tagName === 'TEXTAREA') return false
  if (el.tagName === 'SELECT') return true
  if (!(el instanceof HTMLInputElement)) return false
  if (ARROW_SKIP_INPUT_TYPES.has(el.type)) return false
  return caretAllowsArrowNav(el, key)
}

type NavKeyEvent = {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  defaultPrevented: boolean
  preventDefault: () => void
  target: EventTarget | null
}

function handleArrowAsTab(e: NavKeyEvent, container: HTMLElement | null): void {
  if (!container) return
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return
  if (e.defaultPrevented) return

  const target = e.target
  if (!(target instanceof HTMLElement)) return
  if (!container.contains(target)) return
  if (target.closest('[data-enter-own]')) return
  if (!shouldArrowNavigate(target, e.key)) return

  e.preventDefault()
  focusNextEnterTarget(container, target, e.key === 'ArrowRight' ? 1 : -1)
}

/**
 * Attach to a form root: onKeyDown={(e) => handleEnterAsTab(e, rootRef.current)}
 * Enter and Right arrow go forward; Left arrow goes back (at caret edges).
 * Mark History / secondary buttons with data-skip-enter="true".
 * Mark Add with data-enter-activate="add" and put data-enter-refocus on the field to return to.
 */
export function handleEnterAsTab(e: NavKeyEvent, container: HTMLElement | null): void {
  if (!container) return
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    handleArrowAsTab(e, container)
    return
  }
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return
  if (e.defaultPrevented) return

  const target = e.target
  if (!(target instanceof HTMLElement)) return
  if (!container.contains(target)) return
  if (target.tagName === 'TEXTAREA') return

  // Let Typeahead / open listboxes keep their own Enter handling
  if (target.closest('[data-enter-own]')) return

  const activate = target.dataset.enterActivate
  if (target.tagName === 'BUTTON') {
    e.preventDefault()
    target.click()
    if (activate === 'add') {
      const refocus = container.querySelector<HTMLElement>('[data-enter-refocus]')
      requestAnimationFrame(() => {
        refocus?.focus()
        if (refocus instanceof HTMLInputElement) refocus.select()
      })
    }
    return
  }

  e.preventDefault()
  focusNextEnterTarget(container, target, 1)
}
