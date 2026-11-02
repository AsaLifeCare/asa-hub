// Preferences: preferred shifts, the days of Week A and Week B a person cannot work, the houses and other places…
// Shaped here, compared here; the section only draws.

export const PREF_SHIFTS = [
  { id: 'morning', label: 'Morning' }, { id: 'afternoon', label: 'Afternoon' }, { id: 'nights', label: 'Nights' },
] as const
export const PREF_WEEKS = [{ id: 'a', label: 'Week A' }, { id: 'b', label: 'Week B' }] as const
export const PREF_DAYS = [
  { id: 'mon', label: 'Mon' }, { id: 'tue', label: 'Tue' }, { id: 'wed', label: 'Wed' }, { id: 'thu', label: 'Thu' },
  { id: 'fri', label: 'Fri' }, { id: 'sat', label: 'Sat' }, { id: 'sun', label: 'Sun' },
] as const
export const PREF_ALLERGIES = [
  { id: 'cats', label: 'Cats' }, { id: 'dogs', label: 'Dogs' }, { id: 'birds', label: 'Birds' }, { id: 'dust', label: 'Dust' },
  { id: 'mold', label: 'Mold' }, { id: 'fragrances', label: 'Fragrances' }, { id: 'other', label: 'Other' },
] as const
export const PREF_OTHER_MAX = 20
export const PREF_PICKUP = [{ id: '', label: 'Not set' }, { id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] as const

export type PrefWeek = (typeof PREF_WEEKS)[number]['id']

export type Prefs = {
  shifts: string[]
  unavailable_days: Record<PrefWeek, string[]>
  unavailable_locations: string[]
  other_locations: string[]
  allergies: string[]
  allergy_other: string
  pickup: string
  weekend_work: string
  note: string
  shifts_note: string
}

export type PrefHouse = { code: string; name: string }

export type StaffPrefs = {
  ready: boolean
  houses: PrefHouse[]
  prefs: Prefs
  updatedAt: string
  updatedBy: string
  why: string
}

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const str = (v: unknown): string => (v == null || typeof v === 'object' ? '' : String(v).trim())
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const line = (v: unknown, max: number): string => str(v).replace(/\s+/g, ' ').slice(0, max)

/** The ids a list allows, once each, in the list's own order. */
function pick(v: unknown, allowed: readonly { id: string }[]): string[] {
  const have = new Set(list(v).map((x) => str(x).toLowerCase()))
  return allowed.map((a) => a.id).filter((id) => have.has(id))
}

export function prefsFrom(raw: unknown): Prefs {
  const o = rec(raw)
  const days = rec(o.unavailable_days)
  const seen = new Set<string>()
  const others: string[] = []
  for (const x of list(o.other_locations)) {
    const s = str(x).replace(/\s+/g, ' ').slice(0, 80)
    if (!s || seen.has(s.toLowerCase()) || others.length >= PREF_OTHER_MAX) continue
    seen.add(s.toLowerCase())
    others.push(s)
  }
  const allergies = pick(o.allergies, PREF_ALLERGIES)
  return {
    shifts: pick(o.shifts, PREF_SHIFTS),
    unavailable_days: { a: pick(days.a, PREF_DAYS), b: pick(days.b, PREF_DAYS) },
    unavailable_locations: [...new Set(list(o.unavailable_locations).map((c) => str(c).toUpperCase()).filter(Boolean))].sort(),
    other_locations: others,
    allergies,
    allergy_other: allergies.includes('other') ? str(o.allergy_other).slice(0, 200) : '',
    pickup: ['yes', 'no'].includes(str(o.pickup).toLowerCase()) ? str(o.pickup).toLowerCase() : '',
    weekend_work: line(o.weekend_work, 200),
    note: line(o.note, 500),
    shifts_note: line(o.shifts_note, 200),
  }
}

export function staffPrefsOf(raw: unknown): StaffPrefs {
  const o = rec(raw)
  return {
    ready: o.ready === true,
    houses: list(o.houses).map((h) => ({ code: str(rec(h).code), name: str(rec(h).name) || str(rec(h).code) }))
      .filter((h) => !!h.code),
    prefs: prefsFrom(o.prefs),
    updatedAt: str(o.updated_at),
    updatedBy: str(o.updated_by),
    why: str(o.why),
  }
}

export const samePrefs = (a: Prefs, b: Prefs): boolean => JSON.stringify(prefsFrom(a)) === JSON.stringify(prefsFrom(b))

/** A list with `id` in or out. */
export const toggled = (ids: string[], id: string, on: boolean): string[] =>
  on ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((x) => x !== id)

/** Every house a checkbox is drawn for: the registry's, then any code held that it no longer carries. */
export function housesShown(houses: PrefHouse[], held: string[]): PrefHouse[] {
  const known = new Set(houses.map((h) => h.code))
  return [...houses, ...held.filter((c) => !known.has(c)).map((c) => ({ code: c, name: c }))]
}
