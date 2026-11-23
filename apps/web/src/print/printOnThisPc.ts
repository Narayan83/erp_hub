/**
 * Print the bill HTML on this computer.
 * The server only sends the HTML. The browser print dialog uses this PC's printers and copies.
 */

export function printHtmlOnThisPc(html: string): void {
  const markup = String(html || '')
  if (!markup.trim()) throw new Error('Nothing to print')

  const frame = document.createElement('iframe')
  frame.setAttribute('title', 'Print')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)

  const doc = frame.contentDocument
  const win = frame.contentWindow
  if (!doc || !win) {
    frame.remove()
    throw new Error('Could not open the print dialog on this computer')
  }

  doc.open()
  doc.write(markup)
  doc.close()

  const cleanup = () => window.setTimeout(() => frame.remove(), 400)
  win.onafterprint = cleanup
  win.focus()
  win.print()
  window.setTimeout(cleanup, 120_000)
}
