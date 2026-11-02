// The incident category cell, split.
// UI Reports and Locations read the same cell.
import { asList } from '@/lib/asList'

/** A comma that belongs to a category name, parked while the cell is split. */
const INNER_COMMA = '\u0000'

// incident_category holds MULTIPLE categories in one cell — but the form's own vocabulary contains commas INSIDE…
export function splitCategories(value: unknown): string[] {
  if (Array.isArray(value)) return asList(value)
  const s = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
  if (!s.includes('(')) return asList(s)
  let depth = 0
  let masked = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    masked += ch === ',' && depth > 0 ? INNER_COMMA : ch
  }
  return asList(masked).map((c) => c.split(INNER_COMMA).join(','))
}
