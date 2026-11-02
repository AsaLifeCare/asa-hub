// The Unique view's center tabs, and how the tabs that belong to other apps find this client's rows.
// Pure: the page, its tab modules and the tests read the same decisions.
import type { Role } from '@/auth/types'
import { nameKey, type ClientRow } from '../shared'

export type UniqueTabId =
  | 'summary' | 'care' | 'medical' | 'appointments' | 'incidents' | 'finances'
  | 'sleep' | 'hydration' | 'workout' | 'meals'

export type WellbeingTabId = 'sleep' | 'hydration' | 'workout' | 'meals'

/** `app`: the tab is that app's, shown to a viewer that app's own door admits. */
export type UniqueTab = { id: UniqueTabId; label: string; app?: string }

export const CENTER_TABS: readonly UniqueTab[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'care', label: 'Care' },
  { id: 'medical', label: 'Medical' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'finances', label: 'Finances' },
  { id: 'sleep', label: 'Sleep', app: 'sleep' },
  { id: 'hydration', label: 'Hydration', app: 'hydration' },
  { id: 'workout', label: 'Workout', app: 'workout' },
  { id: 'meals', label: 'Meals', app: 'ideal-meals' },
]

/** Client Finances is merged INTO the Finances tab, not a tab of its own — its section answers to this app. */
export const FINANCE_APP = 'finance'

// Finance.gs answers admin and manager only (finMayUse_), whatever the badge matrix lets open the app — the…
export function mayReadFinance(role: Role | null | undefined): boolean {
  return role === 'admin' || role === 'manager'
}

/** The tabs this viewer is offered, in order; `allowed` is the one access checker (isAllowedWith). */
export function visibleTabs(allowed: (appId: string) => boolean): UniqueTab[] {
  return CENTER_TABS.filter((t) => !t.app || allowed(t.app))
}

// THE SECTIONS BOTH VIEWS SHOW.
export const SHARED_SECTION_IDS = ['finances', 'sleep', 'hydration', 'workout', 'meals'] as const

export type SharedSectionId = (typeof SHARED_SECTION_IDS)[number]

export const SHARED_SECTIONS: readonly UniqueTab[] =
  CENTER_TABS.filter((t) => (SHARED_SECTION_IDS as readonly string[]).includes(t.id))

export function isSharedSection(id: string): id is SharedSectionId {
  return (SHARED_SECTION_IDS as readonly string[]).includes(id)
}

/** The shared sections this viewer is offered, in order — the same door check the tabs use. */
export function visibleSections(allowed: (appId: string) => boolean): UniqueTab[] {
  return SHARED_SECTIONS.filter((t) => !t.app || allowed(t.app))
}

/** A chosen tab that no longer exists for this viewer (a matrix edit, a visit) falls back to the named one. */
export function currentIn(ids: readonly string[], id: string, fallback: string): string {
  return ids.includes(id) ? id : fallback
}

/** A tab that was hidden under the viewer (a matrix edit, a visit) falls back to Summary. */
export function currentTab(tabs: readonly UniqueTab[], id: string): UniqueTabId {
  return currentIn(tabs.map((t) => t.id), id, 'summary') as UniqueTabId
}

/** Each wellbeing tab reads its app's own resource (the relay serves it only to that app's readers). */
export const WELLBEING_RESOURCE = {
  sleep: 'sleepProfiles',
  hydration: 'hydrationProfiles',
  workout: 'workoutPlans',
  meals: 'mealIdeals',
} as const satisfies Record<WellbeingTabId, string>

type Keyed = { client_key?: string; clientId?: string; clientName?: string }

// This client's rows.
export function rowsForClient<T extends Keyed>(rows: readonly T[], client: Pick<ClientRow, 'id' | 'name' | 'client_key'>): T[] {
  const key = String(client.client_key ?? '').trim()
  const id = String(client.id ?? '').trim()
  const name = nameKey(client.name)
  return rows.filter((r) => {
    const rowKey = String(r.client_key ?? '').trim()
    const rowId = String(r.clientId ?? '').trim()
    if (key && rowKey) return rowKey === key
    if (id && rowId) return rowId === id
    if (rowKey || rowId) return false
    return !!name && nameKey(r.clientName) === name
  })
}

const MEAL_ORDER = ['Breakfast', 'Lunch', 'Snack', 'Dinner']

/** The day's plates in the order they are eaten. */
export function sortMeals<T extends { mealType?: string }>(rows: readonly T[]): T[] {
  const at = (m?: string) => { const i = MEAL_ORDER.indexOf(String(m ?? '')); return i < 0 ? MEAL_ORDER.length : i }
  return [...rows].sort((a, b) => at(a.mealType) - at(b.mealType))
}

const APP_NAME: Record<WellbeingTabId, string> = {
  sleep: 'Sleep', hydration: 'Hydration', workout: 'Workout', meals: 'Ideal Meals',
}

/** No row for this client — only that is known; why (no ISP, a join miss, a stale slice) is not. */
export function wellbeingEmpty(tab: WellbeingTabId, name: string): string {
  switch (tab) {
    case 'sleep': return `No sleep profile is on file for ${name}.`
    case 'hydration': return `No hydration profile is on file for ${name}.`
    case 'workout': return `No movement plan is on file for ${name}.`
    case 'meals': return `No ideal meals are on file for ${name}.`
  }
}

/** The read failed — said as a failure, never as the empty sentence. */
export function wellbeingError(tab: WellbeingTabId, message: string): string {
  return `The ${APP_NAME[tab]} app could not be read — ${message || 'try again.'}`
}

export function wellbeingReading(tab: WellbeingTabId): string {
  return `Reading the ${APP_NAME[tab]} app…`
}

// Where each tab's figures come from.
export function wellbeingSource(tab: WellbeingTabId, first: string, generate = false): string {
  const render = generate ? 'Illustrations are rendered nightly; Generate missing asks for today\'s.' : 'Illustrations are rendered nightly.'
  switch (tab) {
    case 'sleep':
      return `The target and the notes are read from ${first}'s ISP. No night is logged on this platform, so there is no average, quality or trend to show.`
    case 'hydration':
      return `The target and the notes are read from ${first}'s ISP. No drink is logged on this platform, so there is no average or trend to show.`
    case 'workout':
      return `Picked from ${first}'s ISP mobility section by the Workout app. ${render}`
    case 'meals':
      return `Planned from ${first}'s ISP diet and allergy sections by the Ideal Meals app. ${render}`
  }
}

/** Who may ask for an illustration — the roles `wellbeingGenerateImage` accepts (Wellbeing.gs). */
export function mayGenerate(role: Role | null | undefined): boolean {
  return role === 'admin' || role === 'manager' || role === 'staff'
}

// Generate missing stays while a card is missing OR rendering — a render in flight disables it, never unmounts it…
export function showsGenerate(rows: readonly { status: string }[], canGenerate: boolean): boolean {
  return canGenerate && rows.some((r) => r.status === 'pending' || r.status === 'generating')
}

// The ledger is keyed by NAME — Finance.gs keeps no client id — so the finClients row carrying this record's id…
export function financeClientName(client: Pick<ClientRow, 'id' | 'name'>, finClients: readonly { id?: string; name: string }[]): string {
  const hit = finClients.find((c) => !!c.id && String(c.id) === String(client.id))
  return String(hit?.name || client.name || '').trim()
}

// Finance.gs matches the ledger by the name, trimmed and case-folded.
export function financeNameShared(
  client: Pick<ClientRow, 'id'>,
  name: string,
  finClients: readonly { id?: string; name: string }[],
): boolean {
  const fold = (s: unknown) => String(s ?? '').trim().toLowerCase()
  const want = fold(name)
  if (!want) return false
  const ids = new Set([String(client.id ?? '').trim()])
  let unnamedIds = 0
  for (const c of finClients) {
    if (fold(c.name) !== want) continue
    const id = String(c.id ?? '').trim()
    if (id) ids.add(id)
    else unnamedIds++
  }
  return ids.size + unnamedIds > 1
}

/** New transaction from a client's record names that client and nobody else. */
export function singleClientPick(name: string, house?: string): { clients: { name: string; house?: string }[]; initialClient: string } {
  return { clients: [house ? { name, house } : { name }], initialClient: name }
}

// Bring the active tab into the strip's view SIDEWAYS only: the strip scrolls, the page does not (scrollIntoView…
export function revealTab(
  strip: { scrollLeft: number; getBoundingClientRect(): { left: number; right: number } },
  tab: { getBoundingClientRect(): { left: number; right: number } },
  pad = 0,
): void {
  const s = strip.getBoundingClientRect()
  const t = tab.getBoundingClientRect()
  if (t.left < s.left + pad) strip.scrollLeft -= s.left + pad - t.left
  else if (t.right > s.right - pad) strip.scrollLeft += t.right - (s.right - pad)
}

/** Which sides of the strip hide tabs — each hidden side is marked and gets a button, never left to a scrollbar. */
export function stripEdges(strip: { scrollLeft: number; clientWidth: number; scrollWidth: number }): { left: boolean; right: boolean } {
  const slack = 1
  return {
    left: strip.scrollLeft > slack,
    right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - slack,
  }
}
