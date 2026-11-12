export type ExcelCell = string | number | null | undefined

export type ExcelSheet = {
  name?: string
  headers: string[]
  rows: ExcelCell[][]
}

export type SpreadsheetFormat = 'xlsx' | 'csv'

export const SPREADSHEET_ACCEPT =
  '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, n, true)
  return b
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, true)
  return b
}

function zipStore(files: { name: string; data: Uint8Array }[]): Blob {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const crc = crc32(file.data)
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      file.data,
    ])
    locals.push(local)
    centrals.push(
      concatBytes([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(file.data.length),
        u32(file.data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    )
    offset += local.length
  }
  const central = concatBytes(centrals)
  const eocd = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
  const packed = concatBytes([...locals, central, eocd])
  return new Blob([Uint8Array.from(packed)], { type: XLSX_MIME })
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function xmlText(value: string): string {
  return xmlEscape(value).replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
    (ch) => `_x${ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}_`,
  )
}

function sheetName(name: string | undefined, index: number): string {
  const raw = (name || `Sheet${index + 1}`).replace(/[:\\/?*[\]]/g, ' ').trim() || `Sheet${index + 1}`
  return raw.slice(0, 31)
}

function colLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function cellXml(ref: string, value: ExcelCell): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`
  }
  const text = xmlText(String(value))
  const space = /^\s|\s$/.test(String(value)) ? ' xml:space="preserve"' : ''
  return `<c r="${ref}" t="inlineStr"><is><t${space}>${text}</t></is></c>`
}

function rowXml(cells: ExcelCell[], rowNo: number): string {
  const body = cells
    .map((c, i) => cellXml(`${colLetter(i)}${rowNo}`, c))
    .filter(Boolean)
    .join('')
  return `<row r="${rowNo}">${body}</row>`
}

function worksheetXml(sheet: ExcelSheet): string {
  const rows = [rowXml(sheet.headers, 1), ...sheet.rows.map((r, i) => rowXml(r, i + 2))].join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rows}</sheetData></worksheet>`
  )
}

function buildXlsx(sheets: ExcelSheet[]): Blob {
  const encoder = new TextEncoder()
  const utf8 = (s: string) => encoder.encode(s)
  const names = sheets.map((s, i) => sheetName(s.name, i))
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    names
      .map(
        (_n, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '</Types>'
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'
  const wbRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    names
      .map(
        (_n, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>'
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    names
      .map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('') +
    '</sheets></workbook>'
  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
    '<cellXfs count="1"><xf/></cellXfs></styleSheet>'
  const files = [
    { name: '[Content_Types].xml', data: utf8(contentTypes) },
    { name: '_rels/.rels', data: utf8(rootRels) },
    { name: 'xl/workbook.xml', data: utf8(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(wbRels) },
    { name: 'xl/styles.xml', data: utf8(styles) },
    ...sheets.map((sheet, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: utf8(worksheetXml(sheet)),
    })),
  ]
  return zipStore(files)
}

function csvEscape(value: ExcelCell): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function sheetToCsv(sheet: ExcelSheet): string {
  const lines = [sheet.headers.map(csvEscape).join(',')]
  for (const row of sheet.rows) {
    const width = Math.max(sheet.headers.length, row.length)
    const cells = Array.from({ length: width }, (_, i) => csvEscape(row[i]))
    lines.push(cells.join(','))
  }
  return lines.join('\r\n')
}

function buildCsv(sheets: ExcelSheet[]): Blob {
  const body =
    sheets.length === 1
      ? sheetToCsv(sheets[0])
      : sheets.map((s, i) => `${sheetName(s.name, i)}\r\n${sheetToCsv(s)}`).join('\r\n\r\n')
  return new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' })
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadExcel(
  filename: string,
  sheets: ExcelSheet | ExcelSheet[],
  format: SpreadsheetFormat = 'xlsx',
): void {
  const list = (Array.isArray(sheets) ? sheets : [sheets]).filter(
    (s) => s.headers.length || s.rows.length,
  )
  if (!list.length) {
    alert('Nothing to export.')
    return
  }
  const base = filename.replace(/\.(xlsx|xls|csv)$/i, '')
  if (format === 'csv') {
    triggerDownload(`${base}.csv`, buildCsv(list))
    return
  }
  triggerDownload(`${base}.xlsx`, buildXlsx(list))
}
