// What "my asa." looks like — decided by whoever it belongs to.
// The page shipped as five fixed cards in a fixed order.
import type { TintName } from '@/engine/types'

// The cards the page ships with.
export type BuiltInCard = 'profile' | 'week' | 'certifications' | 'bookmarks' | 'master'

export type IndicatorSpec = {
  id: string
  kind: 'indicator'
  label: string
  /** any resource the api facade can list */
  resource: string
  /** optional narrowing: count only rows where field === value */
  field?: string
  value?: string
  // HOW IT DRAWS — widgets in a range of styles, tables and pie drawings among them.
  chart?: 'number' | 'donut' | 'bars' | 'progress' | 'table' | 'forecast'
  /** what the number means when it is missing — never invent a zero */
  icon?: string
  tint?: TintName
  /** where clicking it goes */
  href?: string
}

export type CardSpec = { id: BuiltInCard; kind: 'builtin' } | IndicatorSpec

export type MyAsaLayout = {
  cards: CardSpec[]
  /** cards the person removed — remembered so "add back" can offer them */
  hidden: BuiltInCard[]
}

export const DEFAULT_LAYOUT: MyAsaLayout = {
  cards: [
    { id: 'profile', kind: 'builtin' },
    { id: 'week', kind: 'builtin' },
    { id: 'certifications', kind: 'builtin' },
    { id: 'bookmarks', kind: 'builtin' },
  ],
  hidden: [],
}

export const BUILTIN_LABEL: Record<BuiltInCard, string> = {
  profile: 'My profile',
  week: 'My week',
  certifications: 'My certifications',
  bookmarks: 'My bookmarks',
  master: 'Platform (master)',
}

/** Cards nobody can add from the palette — see `master` on BuiltInCard. */
export const MASTER_ONLY_CARDS: BuiltInCard[] = ['master']

// Cards that only mean something to somebody who WORKS here — My asa.
export const EMPLOYEE_ONLY_CARDS: BuiltInCard[] = ['certifications']

const key = (userId: string) => `asa-myasa-layout-v1:${userId}`

export function loadLayout(userId: string): MyAsaLayout {
  try {
    const raw = localStorage.getItem(key(userId))
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as MyAsaLayout
    if (!parsed || !Array.isArray(parsed.cards)) return DEFAULT_LAYOUT
    // A stored layout may still carry cards that no longer exist ('courses'); resurrecting one draws an empty hole…
    const known = new Set(Object.keys(BUILTIN_LABEL))
    const cards = parsed.cards.filter((c) => c.kind !== 'builtin' || known.has(c.id))
    const hidden = (Array.isArray(parsed.hidden) ? parsed.hidden : []).filter((h) => known.has(h))
    // My profile cannot be removed — a stored layout from before that rule may still be missing it; it comes back…
    if (!cards.some((c) => c.kind === 'builtin' && c.id === 'profile')) {
      cards.unshift({ id: 'profile', kind: 'builtin' })
    }
    return { cards, hidden: hidden.filter((h) => h !== 'profile') }
  } catch {
    return DEFAULT_LAYOUT
  }
}

export function saveLayout(userId: string, layout: MyAsaLayout): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify(layout))
  } catch {
    /* storage blocked — the layout lasts for this visit */
  }
}

// Put one indicator on a person's page — the ONE door every "add to My asa" walks through (the bank, the examples…
export function addSpecToLayout(userId: string, spec: IndicatorSpec): boolean {
  const layout = loadLayout(userId)
  if (layout.cards.some((c) => c.id === spec.id)) return false
  saveLayout(userId, { ...layout, cards: [...layout.cards, spec] })
  return true
}

export function resetLayout(userId: string): MyAsaLayout {
  try {
    localStorage.removeItem(key(userId))
  } catch {
    /* nothing to remove */
  }
  return DEFAULT_LAYOUT
}
