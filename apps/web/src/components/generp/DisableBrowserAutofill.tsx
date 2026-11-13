import { useEffect } from 'react'

const SKIP_TYPES = new Set(['hidden', 'file', 'checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'image'])
const MARK = 'data-generp-ac-ro'

function isField(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  return el instanceof HTMLInputElement && !SKIP_TYPES.has(el.type)
}

function disableAutofillAttrs(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const token = el instanceof HTMLInputElement && el.type === 'password' ? 'new-password' : 'off'
  if (el.getAttribute('autocomplete') !== token) el.setAttribute('autocomplete', token)
  el.setAttribute('autocorrect', 'off')
  el.setAttribute('autocapitalize', 'none')
  el.setAttribute('data-lpignore', 'true')
  el.setAttribute('data-1p-ignore', 'true')
  el.setAttribute('data-form-type', 'other')
}

function lockUntilFocus(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  disableAutofillAttrs(el)
  if (el instanceof HTMLSelectElement) return
  if (el instanceof HTMLInputElement && el.type === 'password') return
  if (document.activeElement === el) return
  if (el.hasAttribute('readonly') && el.getAttribute(MARK) !== '1') return
  el.setAttribute('readonly', 'true')
  el.setAttribute(MARK, '1')
}

function unlock(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  disableAutofillAttrs(el)
  if (el.getAttribute(MARK) === '1') {
    el.removeAttribute('readonly')
  }
}

function relock(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  if (el.getAttribute(MARK) === '1') {
    el.setAttribute('readonly', 'true')
  }
}

function scan(root: ParentNode = document) {
  root.querySelectorAll('input, textarea, select').forEach((node) => {
    if (isField(node)) lockUntilFocus(node)
  })
}

/** Stop Chrome / Edge "Saved info" and similar autofill on every field. */
export function DisableBrowserAutofill() {
  useEffect(() => {
    document.documentElement.setAttribute('autocomplete', 'off')
    document.body.setAttribute('autocomplete', 'off')
    scan()

    const observer = new MutationObserver((records) => {
      for (const rec of records) {
        if (rec.type === 'childList') {
          rec.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              if (isField(node)) lockUntilFocus(node)
              else scan(node)
            }
          })
        }
      }
    })
    observer.observe(document.body, { subtree: true, childList: true })

    const onFocusIn = (e: Event) => {
      if (isField(e.target)) unlock(e.target)
    }
    const onFocusOut = (e: Event) => {
      if (isField(e.target)) relock(e.target)
    }

    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)

    return () => {
      observer.disconnect()
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
    }
  }, [])

  return null
}
