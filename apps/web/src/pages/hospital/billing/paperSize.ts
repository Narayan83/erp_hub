const NAMED_PAGES: { code: string; label: string; width: number; height: number }[] = [
  { code: 'A6', label: 'A6', width: 105, height: 148 },
  { code: 'A5', label: 'A5', width: 148, height: 210 },
  { code: 'A4', label: 'A4', width: 210, height: 297 },
  { code: 'LETTER', label: 'Letter', width: 215.9, height: 279.4 },
  { code: 'LEGAL', label: 'Legal', width: 215.9, height: 355.6 },
]

export type PageInfo = {
  widthMm: number
  heightMm: number
  orientation: 'Portrait' | 'Landscape'
  sizeName: string
  label: string
}

function mmText(value: number) {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function nameFromCode(code: string | null) {
  if (!code) return null
  const upper = code.toUpperCase()
  const known = NAMED_PAGES.find((page) => page.code === upper)
  if (known) return known.label
  if (upper === 'CUSTOM' || upper.startsWith('CUSTOM_')) return 'Custom'
  return null
}

function nameFromMm(width: number, height: number) {
  const short = Math.min(width, height)
  const long = Math.max(width, height)
  const known = NAMED_PAGES.find(
    (page) => Math.abs(page.width - short) < 1.5 && Math.abs(page.height - long) < 1.5,
  )
  return known?.label || 'Custom'
}

export function reportCodeFromHtml(html: string): string {
  const match = html.match(/data-report-code\s*=\s*['"]([A-Za-z0-9_]+)['"]/i)
  return match?.[1]?.toUpperCase() || ''
}

function pageFromAtRule(html: string): { widthMm: number; heightMm: number; orientation: PageInfo['orientation']; sizeName: string } | null {
  const match = html.match(/@page\s*\{[^}]*size\s*:\s*([^;}]+)/i)
  if (!match) return null
  const spec = match[1].trim().toLowerCase()
  const mm = spec.match(/([\d.]+)\s*mm(?:\s+([\d.]+)\s*mm)?/)
  const landscape = /\blandscape\b/.test(spec)
  if (mm) {
    let widthMm = Number(mm[1])
    let heightMm = mm[2] ? Number(mm[2]) : widthMm * 1.414
    if (!(widthMm > 0) || !(heightMm > 0)) return null
    const orientation: PageInfo['orientation'] = landscape || widthMm > heightMm + 1 ? 'Landscape' : 'Portrait'
    return { widthMm, heightMm, orientation, sizeName: nameFromMm(widthMm, heightMm) }
  }
  const named = spec.match(/\b(a6|a5|a4|letter|legal)\b/)
  if (!named) return null
  const page = NAMED_PAGES.find((item) => item.code.toLowerCase() === named[1] || item.label.toLowerCase() === named[1])
  if (!page) return null
  const widthMm = landscape ? page.height : page.width
  const heightMm = landscape ? page.width : page.height
  return {
    widthMm,
    heightMm,
    orientation: landscape ? 'Landscape' : 'Portrait',
    sizeName: page.label,
  }
}

export function pageInfoFromHtml(html: string): PageInfo | null {
  const width = html.match(/data-page-w\s*=\s*['"]([\d.]+)['"]/i)
  const height = html.match(/data-page-h\s*=\s*['"]([\d.]+)['"]/i)
  const named = html.match(/data-page-size\s*=\s*['"]([A-Za-z0-9_]+)['"]/i)
  const orientationMatch = html.match(/data-page-orientation\s*=\s*['"](portrait|landscape)['"]/i)
  if (width && height) {
    const widthMm = Number(width[1])
    const heightMm = Number(height[1])
    if (widthMm > 0 && heightMm > 0) {
      const orientation: PageInfo['orientation'] =
        orientationMatch?.[1]?.toLowerCase() === 'landscape' || widthMm > heightMm + 1
          ? 'Landscape'
          : 'Portrait'
      const sizeName = nameFromCode(named?.[1] || null) || nameFromMm(widthMm, heightMm)
      return {
        widthMm,
        heightMm,
        orientation,
        sizeName,
        label: `${sizeName} · ${mmText(widthMm)} × ${mmText(heightMm)} mm · ${orientation}`,
      }
    }
  }
  const fromRule = pageFromAtRule(html)
  if (!fromRule) return null
  return {
    ...fromRule,
    label: `${fromRule.sizeName} · ${mmText(fromRule.widthMm)} × ${mmText(fromRule.heightMm)} mm · ${fromRule.orientation}`,
  }
}
