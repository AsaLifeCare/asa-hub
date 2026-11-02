// Per-resource row cosmetics, applied at the API facade (lib/api).
// WHY THIS EXISTS — the table rendered extremely ugly: the clients directory is derived from ISP prose by the Apps…

import { thumbFor } from '@/lib/thumbs'

const GUARDIAN_LABEL = /^\s*(legal\s+)?guardian(ship)?(\s+of\s+person)?\s*[:\-–]?\s*/i

function truncate(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  // cut at a word boundary so "Intellectual Disabi…" doesn't happen
  const cut = t.slice(0, max - 1)
  const atWord = cut.lastIndexOf(' ')
  return (atWord > max * 0.6 ? cut.slice(0, atWord) : cut).replace(/[,;\s]+$/, '') + '…'
}

/** "Guardian: Denise Hollenbach - Guardianship of person…" → "Denise Hollenbach". */
export function cleanGuardianName(raw: unknown): string {
  let s = String(raw ?? '').trim()
  if (!s) return ''
  // a contacts-table header leaked into the field — it names nobody
  if (/person supported\s*\/\s*family/i.test(s)) return ''
  s = s.replace(GUARDIAN_LABEL, '')
  // keep the name, drop the role prose after it: "Denise Hollenbach - Guardianship of person" → "Denise Hollenbach"…
  s = s.split(/\s+[-–—]\s+/)[0]
  s = s.replace(/,\s+(his|her|their|who|and|a|the)\b.*$/i, '')
  s = s.trim().replace(/[.,;:]+$/, '')
  return s.length > 48 ? truncate(s, 48) : s
}

/** "Auditory supervision. Per SSA/QIDP…" → "Auditory supervision"; 24/7 stays loud. */
export function shortSupervision(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (/24\s*\/?\s*7|around.the.clock|constant/i.test(s)) return '24/7 supervision'
  const first = s.split(/[.;\n]|\s+per\s+/i)[0].trim()
  return first ? truncate(first, 36) : ''
}

/** A chip stays a chip: drop the leading bullet and trailing parenthetical, cap the words. */
function cleanChip(raw: unknown, max: number): string {
  let s = String(raw ?? '').replace(/^[\s•·\-–]+/, '').trim()
  if (s.length > max) s = s.replace(/\s*\([^)]*\)?\s*$/, '').trim()
  return s.length > max ? truncate(s, max) : s
}

function cleanChipList(v: unknown, max: number): string[] {
  const arr = Array.isArray(v) ? v : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const it of arr) {
    const chip = cleanChip(it, max)
    const key = chip.toLowerCase()
    if (!chip || seen.has(key)) continue
    seen.add(key)
    out.push(chip)
  }
  return out
}

function normalizeClientRow(row: any): any {
  if (!row || typeof row !== 'object') return row
  const out = { ...row }
  // The row carries the ORIGINAL photo; screens draw circles.
  if (typeof out.avatar === 'string' && out.avatar) out.avatar = thumbFor(out.avatar)
  out.guardianName = cleanGuardianName(out.guardianName)
  out.supervisionShort = shortSupervision(out.supervision_level)
  out.conditions = cleanChipList(out.conditions, 40)
  out.allergies = cleanChipList(out.allergies, 40)
  out.medications = cleanChipList(out.medications, 48)
  out.conditionCount = out.conditions.length
  out.medCount = out.medications.length
  return out
}

const NORMALIZERS: Record<string, (row: any) => any> = {
  clients: normalizeClientRow,
}

export function normalizeRow<T>(resource: string, row: T): T {
  const fn = NORMALIZERS[resource] as ((row: any) => any) | undefined
  return fn ? (fn(row) as T) : row
}

export function normalizeRows<T>(resource: string, rows: T[]): T[] {
  const fn = NORMALIZERS[resource] as ((row: any) => any) | undefined
  if (!fn || !Array.isArray(rows)) return rows
  return rows.map((r) => fn(r) as T)
}
