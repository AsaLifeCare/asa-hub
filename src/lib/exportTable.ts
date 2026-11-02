// Client-side table export — zero dependencies.
// `exportRows` serializes the CURRENT (filtered + sorted) rows and triggers a Blob download in one of three…

export type ExportFormat = 'csv' | 'xlsx' | 'txt'

export type ExportColumn = {
  /** record key read when no accessor is given */
  key: string
  /** header label in the exported file */
  label: string
  /** optional value extractor (return anything — it goes through cellText) */
  accessor?: (row: any) => unknown
}

/** Plain-text version of any cell value. */
export function cellText(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join('; ')
  switch (typeof value) {
    case 'string':
      return value
    case 'number':
    case 'boolean':
      return String(value)
    case 'object': {
      const v = value as { props?: { children?: unknown } }
      // React element (or fragment) — walk down to its text children
      if (v.props && 'children' in v.props) return cellText(v.props.children)
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    }
    default:
      return String(value)
  }
}

/** Header row + one string[] per record. */
function rowsToTable(columns: ExportColumn[], rows: any[]): string[][] {
  return [
    columns.map((c) => c.label),
    ...rows.map((r) => columns.map((c) => cellText(c.accessor ? c.accessor(r) : r?.[c.key]))),
  ]
}

const csvEscape = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

function toCsv(table: string[][]): string {
  return '\uFEFF' + table.map((r) => r.map(csvEscape).join(',')).join('\r\n')
}

/** SpreadsheetML 2003 — the XML workbook Excel opens without a library. */
function toSpreadsheetML(table: string[][], sheetName: string): string {
  const rows = table
    .map((r) => `<Row>${r.map((c) => `<Cell><Data ss:Type="String">${xmlEscape(c)}</Data></Cell>`).join('')}</Row>`)
    .join('')
  const name = xmlEscape(sheetName.replace(/[[\]\\/*?:]/g, ' ').slice(0, 31).trim() || 'Export')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="${name}"><Table>${rows}</Table></Worksheet></Workbook>`
  )
}

function toTxt(table: string[][]): string {
  return table.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n')
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Serialize `rows` against `columns` and download as csv / xls / txt. */
export function exportRows(filename: string, columns: ExportColumn[], rows: any[], format: ExportFormat) {
  const base = filename.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export'
  const table = rowsToTable(columns, rows)
  if (format === 'csv') download(`${base}.csv`, toCsv(table), 'text/csv')
  else if (format === 'txt') download(`${base}.txt`, toTxt(table), 'text/plain')
  else download(`${base}.xls`, toSpreadsheetML(table, base), 'application/vnd.ms-excel')
}
