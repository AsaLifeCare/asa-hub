// What counts as a person's name.
// Guessing by column name gets you most of the way — `client_name` holds a person, `invoice_no` does not — but it…
import { api, asBackground } from '@/lib/api'

/** Punctuation and case removed — "Ty  Bond" and "ty bond" are one person. */
export function normalizeName(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Strip the parenthetical and the trailing qualifier people add to distinguish records: "Ty Bond (L4P)" and "Ty…
export function nameCore(value: unknown): string {
  return normalizeName(String(value ?? '').replace(/\s*[-–(].*$/, ''))
}

/** An organisation announces itself. These settle it. */
const STRONG_ORG =
  /\b(inc|llc|ltd|corp|corporation|company|agency|dept|department|university|college|project|program|policy|training|report|invoice|order|request)\b/i
// Also surnames — House, Home, Park.
const WEAK_ORG =
  /\b(house|home|center|centre|clinic|hospital|group|team|services?|solutions?|systems?|platform)\b/i
const PLACEHOLDER = /\b(test|demo|sample|unknown|n\/?a|none|tbd|proof|other)\b/i

// Does this look like somebody's name?
export function looksLikePersonName(value: unknown): boolean {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > 60) return false
  if (/\d/.test(raw)) return false
  if (STRONG_ORG.test(raw) || PLACEHOLDER.test(raw)) return false
  const words = raw.replace(/\s*[-–(].*$/, '').trim().split(/\s+/)
  if (words.length < 2 || words.length > 4) return false
  if (WEAK_ORG.test(words[0]) || (words.length > 2 && WEAK_ORG.test(raw))) return false
  // Only the first word must be capitalised — "Kamyiah martin" is a person typed carelessly, and refusing to…
  return /^[A-ZÀ-Þ]/.test(words[0])
}

/* ---------------- the roster ---------------- */

let rosterNames: Set<string> | null = null
let loading: Promise<void> | null = null

/** Load the roster once; failures are silent — the shape test still works. */
export function primeRoster(): void {
  if (rosterNames || loading) return
  loading = asBackground(() => api.list('people'))
    .then((rows: any[]) => {
      const set = new Set<string>()
      for (const r of rows ?? []) {
        const n = nameCore(r?.name)
        if (n) set.add(n)
      }
      rosterNames = set
    })
    .catch(() => {
      rosterNames = new Set()
    })
    .finally(() => {
      loading = null
    })
}

/** Is this one of the people we actually employ or serve? */
export function isKnownPerson(value: unknown): boolean {
  const n = nameCore(value)
  if (!n) return false
  if (!rosterNames) {
    primeRoster()
    return false
  }
  return rosterNames.has(n)
}

/** The whole rule, in one call: roster first, shape second. */
export function isPersonName(value: unknown): boolean {
  return isKnownPerson(value) || looksLikePersonName(value)
}

// Find the field on a row that holds a person, without being told which.
export function findPersonKey(rows: any[], preferKey?: string): string | undefined {
  if (!rows.length) return undefined
  primeRoster()
  const sample = rows.slice(0, 40)
  const keys = new Set<string>()
  for (const r of sample) for (const k of Object.keys(r ?? {})) keys.add(k)

  let best: { key: string; score: number } | undefined
  for (const key of keys) {
    let known = 0
    let shaped = 0
    let filled = 0
    for (const r of sample) {
      const v = r?.[key]
      if (v == null || String(v).trim() === '') continue
      filled++
      if (isKnownPerson(v)) known++
      else if (looksLikePersonName(v)) shaped++
    }
    if (!filled) continue
    // a roster hit is worth three times a lucky shape
    const score = (known * 3 + shaped) / filled
    if (score < 0.5) continue
    const boosted = key === preferKey ? score + 0.25 : score
    if (!best || boosted > best.score) best = { key, score: boosted }
  }
  return best?.key
}
