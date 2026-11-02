// Columns that come from the DATA, not from a promise made months earlier.
// A page schema declares the columns it expects.
import type { Column } from './types'
import type { TintName } from '@/engine/types'

/** Keys that are plumbing, never a column someone wants to read. */
const HIDDEN = new Set([
  'id', 'avatar', 'tint', 'raw_json', 'rawjson', 'row', '_row', 'docs_folder_id',
])

/** Columns that carry more prose than a cell can hold get wrapped, not clipped. */
const LONG_TEXT = /(description|notes|summary|blurb|comment|reason|detail|body)/i

/** How a value reads, decided by the value itself. */
function inferKind(key: string, samples: unknown[]): Column['kind'] {
  const values = samples.map((v) => (v == null ? '' : String(v).trim())).filter(Boolean)
  if (values.length === 0) return 'text'

  if (/(^|_)(avatar|photo|image|thumb|src)$/i.test(key)) return 'image'
  if (/(^|_)(url|link|file_url|doc_url)$/i.test(key)) return 'doc'
  // A date column is one where the values parse as dates AND look like dates — "2287" parses as a year, which is…
  if (values.every((v) => /\d{4}-\d{2}-\d{2}|[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}/.test(v))) return 'date'
  if (values.every((v) => /^-?\d+(\.\d+)?$/.test(v)) && !/(zip|postal|phone|code|_id$|^id_)/i.test(key)) {
    return 'number'
  }
  // Few distinct short values across many rows = a status, and status reads as a chip.
  const distinct = new Set(values.map((v) => v.toLowerCase()))
  if (distinct.size > 0 && distinct.size <= 8 && values.length >= distinct.size * 2 &&
      values.every((v) => v.length <= 24)) {
    return 'chip'
  }
  return 'text'
}

/** "client_name" → "Client name"; "ai_rating" → "Rating". */
function humanize(key: string): string {
  const cleaned = key
    .replace(/^ai_/i, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

/** A stable tint per distinct value, so a status keeps its colour between renders. */
function tintsFor(values: string[]): Record<string, TintName> {
  const cycle: TintName[] = ['blue', 'mint', 'lavender', 'peach', 'amber', 'pink']
  const out: Record<string, TintName> = {}
  ;[...new Set(values)].sort().forEach((v, i) => {
    out[v] = cycle[i % cycle.length]
  })
  return out
}

/** Build a readable table from whatever the rows turned out to contain. */
export function inferColumns(rows: any[], max = 8): Column[] {
  if (rows.length === 0) return []
  const sample = rows.slice(0, 60)
  const keys: string[] = []
  for (const row of sample) {
    for (const k of Object.keys(row ?? {})) {
      if (!HIDDEN.has(k.toLowerCase()) && !keys.includes(k)) keys.push(k)
    }
  }
  // Keep the keys that are actually populated — an all-empty column is noise.
  const useful = keys.filter((k) => sample.some((r) => String(r?.[k] ?? '').trim() !== ''))

  return useful.slice(0, max).map((key) => {
    const samples = sample.map((r) => r?.[key])
    const kind = inferKind(key, samples)
    const col: Column = { key, label: humanize(key), kind, sortable: kind !== 'doc' }
    if (kind === 'chip') {
      col.tintBy = tintsFor(samples.map((v) => String(v ?? '').trim()).filter(Boolean))
      col.dot = true
    }
    if (kind === 'text' && LONG_TEXT.test(key)) {
      col.wrap = 2
      col.maxWidth = 380
    }
    return col
  })
}

// Decide what the table renders with.
export function resolveColumns(declared: Column[], rows: any[]): Column[] {
  if (rows.length === 0 || declared.length === 0) return declared
  const keys = new Set<string>()
  for (const row of rows.slice(0, 30)) for (const k of Object.keys(row ?? {})) keys.add(k)
  const matched = declared.filter((c) => keys.has(c.key)).length
  if (matched / declared.length >= 0.34) return declared
  return inferColumns(rows)
}
