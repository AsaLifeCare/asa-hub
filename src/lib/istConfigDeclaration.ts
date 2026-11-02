// THE IST SETTINGS DECLARATION, ON THIS SIDE OF THE WIRE — no network here.
// server/ist_config_defaults.json is the one declaration: every key, its group, type, limits, shipped value and…
import DECLARATION from '../../server/ist_config_defaults.json'

export type IstKeyType = 'list' | 'pairs' | 'text' | 'template' | 'int' | 'yesno' | 'choice' | 'course'

export type IstKeySpec = {
  key: string
  group: string
  type: IstKeyType
  value: string
  note: string
  min?: number
  max?: number
  unit?: string
  allowed?: string[]
  keys?: string[]
  values?: string[]
  placeholders?: string[]
  value_pattern?: string
  key_pattern?: string
  min_entry_length?: number
  course_entries?: boolean
  course_keys?: boolean
  course_values?: boolean
  never_value?: string
  never_words?: string[]
  falls_back_with?: string
  people_guard?: string
}

export type IstGroup = { id: string; title: string; blurb: string }

const DECL = DECLARATION as unknown as {
  tab: string; tints: string[]; groups: IstGroup[]; keys: IstKeySpec[]
}

export const IST_CONFIG_TAB: string = DECL.tab
/** The seven colours the platform paints. */
export const IST_CONFIG_TINTS: readonly string[] = DECL.tints
export const IST_CONFIG_GROUPS: readonly IstGroup[] = DECL.groups
export const IST_CONFIG_SPEC: Readonly<Record<string, IstKeySpec>> =
  Object.fromEntries(DECL.keys.map((d) => [d.key, d]))
export const IST_CONFIG_KEYS: readonly string[] = DECL.keys.map((d) => d.key)
/** The declared values: the seed of the tab and the floor of every reader. */
export const IST_CONFIG_SHIPPED: Record<string, string> =
  Object.fromEntries(DECL.keys.map((d) => [d.key, String(d.value)]))

/** The two words the rows carry — stored in ist_records, so never a setting. */
export const IST_STATUS_OWED = 'owed'
export const IST_STATUS_DONE = 'done'

// ------------------------------------------------------------------ PARSING AND THE CHECK…

export const cfgBits = (raw: string): string[] =>
  String(raw ?? '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)

/** `a=b, c:d` in the order written, or null when the cell holds no pair. */
export function cfgPairsOf(raw: string): { keys: string[]; map: Record<string, string> } | null {
  const map: Record<string, string> = {}
  const keys: string[] = []
  for (const bit of cfgBits(raw)) {
    let i = bit.indexOf('=')
    if (i === -1) i = bit.indexOf(':')
    if (i <= 0) continue
    const k = bit.slice(0, i).trim()
    if (!k) continue
    if (!(k in map)) keys.push(k)
    map[k] = bit.slice(i + 1).trim()
  }
  return keys.length ? { keys, map } : null
}

/** A whole number in ASCII digits, optionally followed by the key's own unit ("90 days"), or null. */
export function cfgIntValue(key: string, raw: string): number | null {
  const m = /^(-?[0-9]+)(?:[ \t]*([A-Za-z]+))?$/.exec(String(raw ?? '').trim())
  if (!m) return null
  const word = (m[2] ?? '').toLowerCase()
  if (word) {
    const unit = String(IST_CONFIG_SPEC[key]?.unit ?? '').toLowerCase()
    if (!unit || (word !== unit && word !== `${unit}s`)) return null
  }
  return Number.parseInt(m[1], 10)
}

const shippedCatalogue = (): string[] => cfgPairsOf(IST_CONFIG_SHIPPED.ist_cert_labels)?.keys ?? []

/** The course keys a join may name: the course list, and every shipped course (still tracked). */
const refsOf = (catalogue: readonly string[]): string[] =>
  [...catalogue, ...shippedCatalogue().filter((k) => !catalogue.includes(k))]

/** A pair giving `never_value` to a word that means a broken record, or to a * covering one. */
function never(spec: IstKeySpec, key: string, value: string): boolean {
  if (!spec.never_value || value.trim().toLowerCase() !== spec.never_value.toLowerCase()) return false
  const k = key.trim().toLowerCase()
  const words = (spec.never_words ?? []).map((w) => w.toLowerCase())
  if (k.endsWith('*')) {
    const p = k.slice(0, -1)
    return words.some((w) => w.startsWith(p) || p.startsWith(w))
  }
  return words.some((w) => k.startsWith(w))
}

/** Whether a key's check reads the course list. */
export function cfgUsesCatalogue(key: string): boolean {
  const spec = IST_CONFIG_SPEC[key]
  return !!spec && (spec.type === 'course' || !!spec.course_entries || !!spec.course_keys || !!spec.course_values)
}

/** '' when the cell is usable, else the reason. A blank cell is the shipped value, never wrong. */
export function cfgCheck(key: string, raw: string, catalogue?: readonly string[]): string {
  const spec = IST_CONFIG_SPEC[key]
  if (!spec) return `${key} is not a setting this version reads`
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const cat = catalogue ?? shippedCatalogue()
  switch (spec.type) {
    case 'int': {
      const n = cfgIntValue(key, s)
      if (n === null || (spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max)) {
        return `${key} takes a whole number from ${spec.min} to ${spec.max} — "${s}" is not one`
      }
      return ''
    }
    case 'yesno':
      return ['yes', 'no'].includes(s.toLowerCase()) ? '' : `${key} takes yes or no — not "${s}"`
    case 'choice':
      return (spec.allowed ?? []).includes(s.toLowerCase())
        ? '' : `${key} takes one of ${(spec.allowed ?? []).join(', ')} — not "${s}"`
    case 'course':
      return cat.length && !cat.includes(s)
        ? `"${s}" is not a course in the course list — use one of its short keys: ${cat.join(', ')}`
        : ''
    case 'list': {
      const entries = cfgBits(s)
      if (!entries.length) return `${key} holds no entry`
      const least = spec.min_entry_length ?? 0
      const short = entries.filter((e) => least && e.length < least)
      if (short.length) {
        return `${short.join(', ')} — each entry needs at least ${least} characters: a short word matched inside a name removes real people`
      }
      if (spec.course_entries) {
        const refs = refsOf(cat)
        const wrong = entries.filter((e) => !refs.includes(e))
        if (wrong.length) return `${wrong.join(', ')} — not a course key; use the short keys: ${refs.join(', ')}`
      }
      return ''
    }
    case 'pairs': {
      const got = cfgPairsOf(s)
      if (!got) return `${key} holds no key=value pair`
      for (const bit of cfgBits(s)) {
        let i = bit.indexOf('=')
        if (i === -1) i = bit.indexOf(':')
        if (i <= 0) return `"${bit}" is not a key=value pair`
        if (!bit.slice(i + 1).trim()) return `"${bit}" has nothing after the =`
      }
      if (spec.keys) {
        const wrong = got.keys.filter((k) => !spec.keys!.includes(k))
        if (wrong.length) return `${wrong.join(', ')} — ${key} knows only ${spec.keys.join(', ')}`
      }
      if (spec.key_pattern) {
        const re = new RegExp(spec.key_pattern)
        const wrong = got.keys.filter((k) => !re.test(k))
        if (wrong.length) {
          return `${wrong.join(', ')} — the left side is the column heading lowercased, with spaces and punctuation turned into _ (dodd_8_hour_exp)`
        }
      }
      const refs = refsOf(cat)
      if (spec.course_keys) {
        const wrong = got.keys.filter((k) => !refs.includes(k))
        if (wrong.length) return `${wrong.join(', ')} — not a course key; use the short keys: ${refs.join(', ')}`
      }
      if (spec.values) {
        const wrong = got.keys.filter((k) => !spec.values!.includes(got.map[k].trim().toLowerCase()))
          .map((k) => `${k}=${got.map[k]}`)
        if (wrong.length) return `${wrong.join(', ')} — the value must be one of ${spec.values.join(', ')}`
      }
      if (spec.value_pattern) {
        const re = new RegExp(spec.value_pattern)
        const wrong = got.keys.filter((k) => !re.test(got.map[k].trim())).map((k) => `${k}=${got.map[k]}`)
        if (wrong.length) return `${wrong.join(', ')} — a column is lowercase letters, digits and _, joined by | or +`
      }
      if (spec.course_values) {
        const wrong = got.keys.filter((k) => !refs.includes(got.map[k].trim())).map((k) => `${k}=${got.map[k]}`)
        if (wrong.length) return `${wrong.join(', ')} — the right side must be a course key: ${refs.join(', ')}`
      }
      if (spec.never_value) {
        const wrong = got.keys.filter((k) => never(spec, k, got.map[k])).map((k) => `${k}=${got.map[k]}`)
        if (wrong.length) {
          return `${wrong.join(', ')} — ${spec.never_value} is never given to * or to a word that means a lapsed or broken record`
        }
      }
      return ''
    }
    case 'template': {
      const allowed = spec.placeholders ?? []
      const wrong = [...new Set((s.match(/\{[^{}]*\}/g) ?? []).map((m) => m.slice(1, -1)))]
        .filter((p) => !allowed.includes(p)).sort()
      return wrong.length
        ? `${wrong.map((w) => `{${w}}`).join(', ')} is not filled in by this sentence — it knows ${
          [...allowed].sort().map((a) => `{${a}}`).join(', ')}`
        : ''
    }
    default:
      return ''
  }
}

/** One cell resolved: itself, its usable entries (a list or pairs cell), or the shipped value. */
export function cfgResolveOne(key: string, raw: string | undefined, catalogue?: readonly string[]):
  { value: string; problem: string } {
  const spec = IST_CONFIG_SPEC[key]
  const s = String(raw ?? '').trim()
  if (!spec) return { value: s, problem: '' }
  if (!s) return { value: IST_CONFIG_SHIPPED[key], problem: '' }
  const why = cfgCheck(key, s, catalogue)
  if (!why) return { value: spec.type === 'int' ? String(cfgIntValue(key, s)) : s, problem: '' }
  if (spec.type === 'list' || spec.type === 'pairs') {
    const kept = cfgBits(s).filter((b) => !cfgCheck(key, b, catalogue))
    if (kept.length) return { value: kept.join(', '), problem: why }
  }
  return { value: IST_CONFIG_SHIPPED[key], problem: why }
}

/** The course keys a raw map carries, as its course list resolves. */
export function cfgCatalogueOf(raw: Record<string, string | undefined>): string[] {
  return cfgPairsOf(cfgResolveOne('ist_cert_labels', raw.ist_cert_labels).value)?.keys ?? []
}

/** The key this one falls back with, when that one is refused whole — else ''. */
export function cfgPartnerRefused(raw: Record<string, string | undefined>, key: string,
  catalogue: readonly string[]): string {
  const partner = IST_CONFIG_SPEC[key]?.falls_back_with
  if (!partner) return ''
  const got = cfgResolveOne(partner, raw[partner], catalogue)
  return got.problem && got.value === IST_CONFIG_SHIPPED[partner] ? partner : ''
}

/** Every declared key resolved: a blank or refused cell answers its usable entries or the shipped value. */
export function resolveIstValues(raw: Record<string, string | undefined>): {
  values: Record<string, string>; problems: Record<string, string>
} {
  const catalogue = cfgCatalogueOf(raw)
  const values: Record<string, string> = {}
  const problems: Record<string, string> = {}
  for (const key of IST_CONFIG_KEYS) {
    const got = cfgResolveOne(key, raw[key], catalogue)
    values[key] = got.value
    if (got.problem) problems[key] = got.problem
  }
  for (const key of IST_CONFIG_KEYS) {
    const partner = cfgPartnerRefused(raw, key, catalogue)
    if (partner && values[key] !== IST_CONFIG_SHIPPED[key]) {
      values[key] = IST_CONFIG_SHIPPED[key]
      problems[key] = `answers its shipped value with ${partner}, which is refused`
    }
  }
  return { values, problems }
}

/** Every `key: why` the save door refuses `values` over `stored` for; a course-list change re-checks the keys it leaves alone. */
export function cfgSaveProblems(values: Record<string, string>,
  stored: Record<string, string | undefined> = {}): string[] {
  const after = { ...stored, ...values }
  const before = cfgCatalogueOf(stored)
  const now = cfgCatalogueOf(after)
  const out: string[] = []
  for (const [k, v] of Object.entries(values)) {
    const why = cfgCheck(k, v, now)
    if (why) out.push(`${k}: ${why}`)
  }
  if ('ist_cert_labels' in values) {
    for (const key of IST_CONFIG_KEYS) {
      if (key in values || !cfgUsesCatalogue(key)) continue
      const cell = String(stored[key] ?? '').trim() || IST_CONFIG_SHIPPED[key]
      if (cfgCheck(key, cell, now) && !cfgCheck(key, cell, before)) {
        out.push(`${key}: "${cell}" would no longer name a course in the course list this save leaves — change ${key} in the same save, or keep the course`)
      }
    }
  }
  return out
}

/** The static classes for each platform colour (the stylesheet keeps only names it sees). */
export const TINT_CHIP: Readonly<Record<string, string>> = {
  mint: 'bg-tint-mint text-tint-fg-mint',
  peach: 'bg-tint-peach text-tint-fg-peach',
  lavender: 'bg-tint-lavender text-tint-fg-lavender',
  pink: 'bg-tint-pink text-tint-fg-pink',
  blue: 'bg-tint-blue text-tint-fg-blue',
  amber: 'bg-tint-amber text-tint-fg-amber',
  green: 'bg-tint-green text-tint-fg-green',
}
export const TINT_BG: Readonly<Record<string, string>> = {
  mint: 'bg-tint-mint', peach: 'bg-tint-peach', lavender: 'bg-tint-lavender', pink: 'bg-tint-pink',
  blue: 'bg-tint-blue', amber: 'bg-tint-amber', green: 'bg-tint-green',
}
export const TINT_FG: Readonly<Record<string, string>> = {
  mint: 'text-tint-fg-mint', peach: 'text-tint-fg-peach', lavender: 'text-tint-fg-lavender',
  pink: 'text-tint-fg-pink', blue: 'text-tint-fg-blue', amber: 'text-tint-fg-amber',
  green: 'text-tint-fg-green',
}
