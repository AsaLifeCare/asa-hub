// STAFF — the shapes StaffProfiles.gs answers and the arithmetic the screen does on them.
// Pure: the page and the tests import the same code.
import type { BookmarkInput } from '@/stores/useBookmarksStore'
import type { SharePayload } from '@/stores/useShareStore'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import { ohioDateTime, ohioDayYear } from '@/lib/ohio'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { editRawOf, type EditField, type EditLock } from '@/lib/recordEdit'
import { NOTE_PRIORITIES, dayWords, nameKey } from '@/pages/features/locations/locationModel'
import { perfViewOf, type PerfView } from './perfModel'

/* ---------- small readers ---------- */

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const str = (v: unknown): string => (v == null || typeof v === 'object' ? '' : String(v).trim())
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1'
function rowsIn(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw
  const o = rec(raw)
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[]
  return []
}
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => {
  const s = str(v).toLowerCase() as T
  return allowed.includes(s) ? s : fallback
}
const digitsOf = (v: string): string => v.replace(/\D+/g, '')

export { nameKey }

export const NOT_ON_FILE = 'Not on file'

/** A calendar day or an instant, in the mockup's words: 'Sep 01, 2026'; '' when it is neither. */
export function dateWords(v: string): string {
  const s = str(v)
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dayWords(s)
  return ohioDayYear(s) || s
}

/** An instant with its clock; a bare day stays a day. */
export function stampWords(v: string): string {
  const s = str(v)
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dayWords(s)
  return ohioDateTime(s) || s
}

/** A mask carries at most four digits; anything with more is not a mask and is never drawn. */
export function safeMask(v: unknown): string {
  const s = str(v)
  return s && digitsOf(s).length <= 4 ? s : ''
}

/* ---------- the sections and the address ---------- */

export const STAFF_TABS = [
  { id: 'profile', label: 'Staff Profile' },
  { id: 'clients', label: 'Related Clients' },
  { id: 'locations', label: 'Related Locations' },
  { id: 'actions', label: 'Actions' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'driving', label: 'Driving' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'documents', label: 'Documents' },
  { id: 'performance', label: 'Performance' },
  { id: 'hr', label: 'HR Admin' },
  { id: 'pay', label: 'Employee Pay' },
  { id: 'activity', label: 'Activity' },
] as const

export type StaffTab = (typeof STAFF_TABS)[number]['id']

// Employment's cards live on Staff Profile; an address that still names it opens there
const TAB_MOVED: Record<string, StaffTab> = { employment: 'profile' }

export function tabOf(v: string | null | undefined): StaffTab {
  const hit = STAFF_TABS.find((t) => t.id === v)
  return hit ? hit.id : TAB_MOVED[v ?? ''] ?? 'profile'
}

export const tabLabel = (tab: StaffTab): string => STAFF_TABS.find((t) => t.id === tab)?.label ?? 'Staff Profile'

/** The tabs App Control splits off Staff, each under its own row (lib/featureAccess APP_FEATURES['staff-profiles']).
 *  The server asks the same ids at the tabs' doors (app/staff.py tab_open), on the viewer's own profile too. */
export const STAFF_TAB_FEATURES = {
  performance: 'staff-profiles.performance',
  hr: 'staff-profiles.hrAdmin',
  pay: 'staff-profiles.employeePay',
  activity: 'staff-profiles.activity',
} as const
export type SplitTab = keyof typeof STAFF_TAB_FEATURES

/** The split tabs whose row is shut to this viewer, in the tabs' order. */
export const shutTabsOf = (open: Readonly<Record<SplitTab, boolean>>): SplitTab[] =>
  (Object.keys(STAFF_TAB_FEATURES) as SplitTab[]).filter((t) => !open[t])

export const ACTIVITY_VIEWS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'visits', label: 'Visits' },
  { id: 'shifts', label: 'Shifts' },
  { id: 'texts', label: 'Texts' },
  { id: 'transcripts', label: 'Transcripts' },
] as const

export type ActivityView = (typeof ACTIVITY_VIEWS)[number]['id']

/** Activity and Performance have views; Activity's first is Timeline, Performance's Overview. */
export function viewOf(tab: StaffTab, v: string | null | undefined): ActivityView | PerfView | '' {
  if (tab === 'performance') return perfViewOf(v)
  if (tab !== 'activity') return ''
  return ACTIVITY_VIEWS.find((x) => x.id === v)?.id ?? 'timeline'
}

const FIRST_VIEW: Partial<Record<StaffTab, string>> = { activity: 'timeline', performance: 'overview' }

export const STAFF_APP_ID = 'staff-profiles'
export const STAFF_PATH = '/app/staff-profiles/profile'

/** What the one right panel holds. It rides the address as `panel=`. */
export type StaffAsk =
  | { kind: 'share' }
  | { kind: 'assign'; house: string }
  | { kind: 'filedoc'; course: string }
  /** a paper uploaded for a Documents row, filed under the row's title */
  | { kind: 'docupload'; doc: string }
  | { kind: 'incident' }
  | { kind: 'hrissue' }
  /** a missing documentation record (Performance › Documentation) to mark concluded */
  | { kind: 'docmark'; date: string; area: string }
  /** an IST recorded for a client worked with that holds none yet (Related Clients), by the client's key */
  | { kind: 'istadd'; client: string }
  | { kind: 'note' }
  | { kind: 'loan' }
  | { kind: 'payment' }
  | { kind: 'transcript'; id: string }
  | { kind: 'invite' }
  | { kind: 'access' }
  | { kind: 'reset' }
  /** `id`: the record a per-line section edits (a MAIS line's Cat level, an IST record's id) */
  | { kind: 'edit'; section: EditSection; id?: string }

const SEP = '~'

export function panelParam(ask: StaffAsk | null): string {
  if (!ask) return ''
  switch (ask.kind) {
    case 'share': case 'incident': case 'hrissue': case 'note': case 'loan': case 'payment': case 'invite': case 'access': case 'reset':
      return ask.kind
    case 'assign': return ask.house ? ['assign', ask.house].join(SEP) : 'assign'
    case 'filedoc': return ask.course ? ['filedoc', ask.course].join(SEP) : 'filedoc'
    case 'docupload': return ['docupload', ask.doc].join(SEP)
    case 'docmark': return ['docmark', ask.date, ask.area].join(SEP)
    case 'istadd': return ['istadd', ask.client].join(SEP)
    case 'transcript': return ['transcript', ask.id].join(SEP)
    case 'edit': return (ask.id ? ['edit', ask.section, ask.id] : ['edit', ask.section]).join(SEP)
  }
}

export function panelOf(v: string | null | undefined): StaffAsk | null {
  const [kind, a = '', b = ''] = str(v).split(SEP)
  switch (kind) {
    case 'share': case 'incident': case 'hrissue': case 'note': case 'loan': case 'payment': case 'invite': case 'access': case 'reset':
      return { kind }
    case 'assign': return { kind, house: a }
    case 'filedoc': return { kind, course: a }
    case 'docupload': return a ? { kind, doc: a } : null
    case 'docmark': return /^\d{4}-\d{2}-\d{2}$/.test(a) && b ? { kind, date: a, area: b } : null
    case 'istadd': return a ? { kind, client: a } : null
    case 'transcript': return a ? { kind, id: a } : null
    case 'edit': {
      if (!(EDIT_SECTIONS as readonly string[]).includes(a)) return null
      const section = a as EditSection
      if (!LINE_SECTIONS.includes(section)) return { kind, section }
      return b ? { kind, section, id: b } : null
    }
    default: return null
  }
}

/** `?staff=…&tab=…&view=…&panel=…` — the whole state of the screen. */
export function staffQuery(staff: string, tab: StaffTab, view: string = '', panel: StaffAsk | null = null): string {
  const p = new URLSearchParams()
  if (staff) p.set('staff', staff)
  if (tab !== 'profile') p.set('tab', tab)
  const first = FIRST_VIEW[tab]
  if (view && first && view !== first) p.set('view', view)
  const pp = panelParam(panel)
  if (pp) p.set('panel', pp)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const staffHref = (staff: string, tab: StaffTab = 'profile'): string => `${STAFF_PATH}${staffQuery(staff, tab)}`
export const clientProfileHref = (clientKey: string): string =>
  `/app/client-profiles/profile?client=${encodeURIComponent(clientKey)}`
export const locationHref = (code: string): string => `/app/locations/overview?house=${encodeURIComponent(code)}`

/* ---------- the roster and the switcher ---------- */

export type StaffStatus = 'active' | 'inactive' | 'pending' | 'other'
const STATUSES: StaffStatus[] = ['active', 'inactive', 'pending', 'other']

export type RosterRow = {
  key: string
  name: string
  first_name: string
  last_name: string
  status: StaffStatus
  role: string
  avatar: string
  employee_id: string
  /** two records share this name: never opened, never guessed */
  ambiguous: boolean
}

/** 'basic': a client or family viewer, shown the staff their houses see and each one's BASIC profile only. */
export type RosterView = 'full' | 'basic'

/** Who may assign training, as the server answers it: 'any' record, or only `selfKey`, the viewer's own; `ownOnly`
 *  when the viewer's badges open their own profile alone. */
export type RosterMay = { assign: 'any' | ''; selfKey: string; ownOnly?: boolean }

export type Roster = {
  staff: RosterRow[]
  counts: { active: number | null; inactive: number | null; ambiguous: number | null }
  view: RosterView
  may: RosterMay
  why: string
  degraded: boolean
}

export function rosterOf(raw: unknown): Roster {
  const o = rec(raw)
  const staff = rowsIn(raw, 'staff', 'rows').map((r) => {
    const x = rec(r)
    const name = str(x.name) || [str(x.first_name), str(x.last_name)].filter(Boolean).join(' ')
    return {
      key: str(x.key) || nameKey(name),
      name,
      first_name: str(x.first_name),
      last_name: str(x.last_name),
      status: oneOf(x.status, STATUSES, 'other'),
      role: str(x.role),
      avatar: str(x.avatar),
      employee_id: str(x.employee_id),
      ambiguous: x.ambiguous === true,
    }
  }).filter((r) => r.key && r.name)
  const c = rec(o.counts)
  const may = rec(o.may)
  return {
    staff,
    counts: { active: num(c.active), inactive: num(c.inactive), ambiguous: num(c.ambiguous) },
    view: str(o.view) === 'basic' ? 'basic' : 'full',
    may: { assign: str(may.assign) === 'any' ? 'any' : '', selfKey: str(may.self_key), ownOnly: may.own_only === true },
    why: str(o.why),
    degraded: o.degraded === true,
  }
}

export const STATUS_META: Record<StaffStatus, { label: string; tint: PillTint }> = {
  active: { label: 'Active', tint: 'mint' },
  inactive: { label: 'Inactive', tint: 'slate' },
  pending: { label: 'Pending', tint: 'amber' },
  other: { label: 'Other', tint: 'slate' },
}

/** The switcher's list: the active first, by name, then the rest when Show Inactive is on. The search reads name, id and role. */
export function switcherStaff(rows: RosterRow[], query: string, showInactive: boolean): RosterRow[] {
  const q = query.trim().toLowerCase()
  const hit = (r: RosterRow) => !q || [r.name, r.employee_id, r.role].some((v) => v.toLowerCase().includes(q))
  const byName = (a: RosterRow, b: RosterRow) => a.name.localeCompare(b.name)
  const active = rows.filter((r) => r.status !== 'inactive' && hit(r)).sort(byName)
  if (!showInactive) return active
  return [...active, ...rows.filter((r) => r.status === 'inactive' && hit(r)).sort(byName)]
}

/** The person the screen opens on when the address names none: the first active one by name that can be opened. */
export function defaultStaff(rows: RosterRow[]): RosterRow | null {
  const open = rows.filter((r) => !r.ambiguous)
  return switcherStaff(open, '', false)[0] ?? switcherStaff(open, '', true)[0] ?? null
}

/** The row the address names: its key, else the same name folded. */
export function resolveStaff(wanted: string, rows: RosterRow[]): RosterRow | null {
  const w = str(wanted)
  if (!w) return null
  return rows.find((r) => r.key === w) ?? rows.find((r) => r.key === nameKey(w)) ?? null
}

/* ---------- the pills ---------- */

export type PillTint = 'mint' | 'amber' | 'danger' | 'slate' | 'blue' | 'lavender'

export type PillMeta = { label: string; tint: PillTint }

/* ---------- Staff Profile ---------- */

export type Labelled = { label: string; value: string }

export type StaffPerson = {
  key: string
  name: string
  first_name: string
  last_name: string
  employee_id: string
  employee_id_source: 'master' | 'roster' | ''
  roster_id: string
  role: string
  status: StaffStatus
  start_date: string
  end_date: string
  avatar: string
  /** in the answer's order, one line each, the same number never twice */
  phones: Labelled[]
  emails: Labelled[]
}

/** How a client was worked with: a punch names them, or a past shift at the home they alone live in. */
export type ClientVia = 'punches' | 'house'

export type StaffClient = {
  client_key: string
  client_id: string
  name: string
  avatar: string
  house: string
  via: ClientVia[]
  /** the first and the last day worked with them: the punches naming them and the shifts at their own home */
  first_day: string
  last_day: string
}

/** The latest day this person was trained on the client's plan; '' when no IST says so. */
export function istLatest(ist: StaffIst[], clientKey: string): string {
  return ist.filter((r) => r.client_key === clientKey && r.trained_at).map((r) => r.trained_at).sort().pop() ?? ''
}

export type StaffHouse = {
  code: string
  home_name: string
  address: string
  photo: string
  current: boolean
  days: number | null
  first_day: string
  last_day: string
  hm: boolean
  lead: boolean
}

export type IstStatus = 'done' | 'owed' | ''

export type StaffIst = {
  id: string
  client_key: string
  client_name: string
  house: string
  status: IstStatus
  due: string
  trained_at: string
  doc_id: string
}

/** What the licence's standing word means: the pill's colour, never its words. */
export type StandingState = 'valid' | 'invalid' | 'none' | 'other'
const STANDING_STATES: StandingState[] = ['valid', 'invalid', 'none', 'other']

/** The word as the tab wrote it ("Suspended"), and the tab that said it. */
export type LicenseStanding = { word: string; state: StandingState; source: string }

/** A day's state on the Staff Compliance clock; '' when the value is not a day. */
export type DayState = 'expired' | 'due_soon' | 'current' | ''

/** The two tabs the driving record is read from, as the answer names them in `source` and `unread`. */
export const DRIVER_TABS = { main: 'employee driver', compliance: 'Driver Compliance' } as const

/** The employee driver tab's facts for the person; the licence number arrives masked to its last four. */
export type StaffDriving = {
  found: boolean
  ambiguous: boolean
  driver: boolean | null
  driverWord: string
  /** the employee driver tab's own standing word, sent only when Driver Compliance says something else */
  driverStanding: LicenseStanding | null
  points: number | null
  /** the Points cell's own words when it holds no number ("CANT CHECK") */
  pointsNote: string
  /** a day (yyyy-MM-dd), or the cell's own words when it holds no whole date */
  licenseExpires: string
  licenseState: DayState
  abstractOriginal: string
  abstractLatest: string
  insuranceExpires: string
  insuranceState: DayState
  standing: LicenseStanding | null
  /** two Driver Compliance rows carry the name: the standing is not read */
  standingAmbiguous: boolean
  dlLast4: string
  source: string
  /** the tabs that could not be read: what only they hold is unread, never absent */
  unread: string[]
  why: string
  degraded: boolean
}

/** One MAIS line per Cat level: the latest record, the scrape's own Status word, and how many older records it has. */
export type MaisCert = {
  level: string
  effective: string
  expires: string
  status: 'certified' | 'expired'
  word: string
  expired: boolean
  /** certified, and expiring inside the Staff Compliance window */
  dueSoon: boolean
  older: number
}

export type StaffMedDel = {
  certs: MaisCert[]
  history: number
  /** 'search': the registry's name differs, found by the name DODD was searched with */
  matchedBy: 'name' | 'search' | ''
  ambiguous: boolean
  source: string
  why: string
  degraded: boolean
}

export type StaffOverview = {
  person: StaffPerson
  clients: StaffClient[]
  houses: StaffHouse[]
  ist: StaffIst[]
  notesOpen: number | null
  /** null: the answer does not carry the part — never read as "not a driver" or "no record" */
  driving: StaffDriving | null
  medDel: StaffMedDel | null
  why: string
  degraded: boolean
}

function labelledOf(list: unknown, fold: (v: string) => string): Labelled[] {
  const out: Labelled[] = []
  const seen = new Set<string>()
  for (const item of rowsIn(list)) {
    const x = typeof item === 'string' ? { value: item } : rec(item)
    const value = str(x.value)
    const k = fold(value)
    if (!value || !k || seen.has(k)) continue
    seen.add(k)
    out.push({ label: str(x.label), value })
  }
  return out
}

const phoneFold = (v: string): string => digitsOf(v).slice(-10)
const emailFold = (v: string): string => v.toLowerCase()

function personOf(v: unknown): StaffPerson {
  const x = rec(v)
  const name = str(x.name) || [str(x.first_name), str(x.last_name)].filter(Boolean).join(' ')
  const source = str(x.employee_id_source)
  return {
    key: str(x.key) || nameKey(name),
    name,
    first_name: str(x.first_name),
    last_name: str(x.last_name),
    employee_id: str(x.employee_id),
    employee_id_source: source === 'master' || source === 'roster' ? source : '',
    roster_id: str(x.roster_id),
    role: str(x.role),
    status: oneOf(x.status, STATUSES, 'other'),
    start_date: str(x.start_date),
    end_date: str(x.end_date),
    avatar: str(x.avatar),
    phones: labelledOf(x.phones, phoneFold),
    emails: labelledOf(x.emails, emailFold),
  }
}

export function houseOf(v: unknown): StaffHouse {
  const x = rec(v)
  return {
    code: str(x.code).toUpperCase(),
    home_name: str(x.home_name) || str(x.code).toUpperCase(),
    address: str(x.address),
    photo: str(x.photo),
    current: x.current === true,
    days: num(x.days),
    first_day: str(x.first_day),
    last_day: str(x.last_day),
    hm: x.hm === true,
    lead: x.lead === true,
  }
}

const VIA: ClientVia[] = ['punches', 'house']

const isPart = (v: unknown): boolean => !!v && typeof v === 'object' && !Array.isArray(v)

function standingOf(v: unknown): LicenseStanding | null {
  if (!isPart(v)) return null
  const s = rec(v)
  const word = str(s.word)
  return word ? { word, state: oneOf(s.state, STANDING_STATES, 'other'), source: str(s.source) } : null
}

const DAY_STATES: DayState[] = ['expired', 'due_soon', 'current']
const dayState = (v: unknown): DayState => oneOf(v, DAY_STATES, '')

/** Only the fields named here are read; anything else the part might carry is never drawn. */
export function drivingOf(v: unknown): StaffDriving | null {
  if (!isPart(v)) return null
  const x = rec(v)
  return {
    found: x.found === true,
    ambiguous: x.ambiguous === true,
    driver: x.driver === true ? true : x.driver === false ? false : null,
    driverWord: str(x.driver_word),
    driverStanding: standingOf(x.driver_standing),
    points: num(x.points),
    pointsNote: str(x.points_note),
    licenseExpires: str(x.license_expires),
    licenseState: dayState(x.license_state),
    abstractOriginal: str(x.abstract_original),
    abstractLatest: str(x.abstract_latest),
    insuranceExpires: str(x.insurance_expires),
    insuranceState: dayState(x.insurance_state),
    standing: standingOf(x.license_standing),
    standingAmbiguous: x.standing_ambiguous === true,
    dlLast4: safeMask(x.dl_last4),
    source: str(x.source),
    unread: rowsIn(x.unread).map(str).filter(Boolean),
    why: str(x.why),
    degraded: x.degraded === true,
  }
}

/** Whether the row says anything beyond "not a driver": a number, a day, a licence or a standing that is not "none". */
export function drivingSaysMore(d: StaffDriving): boolean {
  return d.points !== null || !!d.pointsNote || !!d.licenseExpires || !!d.abstractOriginal || !!d.abstractLatest ||
    !!d.insuranceExpires || !!d.dlLast4 || !!d.driverStanding || (!!d.standing && d.standing.state !== 'none')
}

export function medDelOf(v: unknown): StaffMedDel | null {
  if (!isPart(v)) return null
  const x = rec(v)
  const by = str(x.matched_by)
  return {
    certs: rowsIn(x.certs).map((c) => {
      const y = rec(c)
      const status = oneOf(y.status, ['certified', 'expired'] as const, 'expired')
      // an answer that does not say is never drawn as certified
      const expired = y.expired === false ? status !== 'certified' : true
      return {
        level: str(y.level),
        effective: str(y.effective),
        expires: str(y.expires),
        status,
        word: str(y.word),
        expired,
        dueSoon: !expired && y.due_soon === true,
        older: Math.max(0, num(y.older) ?? 0),
      }
    }).filter((c) => c.level),
    history: Math.max(0, num(x.history) ?? 0),
    matchedBy: by === 'name' || by === 'search' ? by : '',
    ambiguous: x.ambiguous === true,
    source: str(x.source),
    why: str(x.why),
    degraded: x.degraded === true,
  }
}

export function overviewOf(raw: unknown): StaffOverview {
  const o = rec(raw)
  const clients = rowsIn(o, 'clients').map((c) => {
    const x = rec(c)
    return {
      client_key: str(x.client_key),
      client_id: str(x.client_id),
      name: str(x.name),
      avatar: str(x.avatar),
      house: str(x.house),
      via: (Array.isArray(x.via) ? x.via : []).map((w) => str(w).toLowerCase()).filter((w): w is ClientVia => (VIA as string[]).includes(w)),
      first_day: str(x.first_day),
      last_day: str(x.last_day),
    }
  }).filter((c) => c.name)
  const ist = rowsIn(o, 'ist').map((r) => {
    const x = rec(r)
    return {
      id: str(x.id),
      client_key: str(x.client_key),
      client_name: str(x.client_name),
      house: str(x.house).toUpperCase(),
      status: oneOf(x.status, ['done', 'owed', ''] as const, ''),
      due: str(x.due),
      trained_at: str(x.trained_at),
      doc_id: str(x.doc_id),
    }
  }).filter((r) => r.client_name || r.client_key)
  return {
    person: personOf(o.person),
    clients,
    houses: rowsIn(o, 'houses').map(houseOf).filter((h) => h.code),
    ist,
    notesOpen: num(o.notes_open),
    driving: drivingOf(o.driving),
    medDel: medDelOf(o.med_del),
    why: str(o.why),
    degraded: o.degraded === true,
  }
}

/** Points: none is quiet, any is a warning, six or more is the strong one. */
export function pointsTint(points: number | null): PillTint {
  if (points === null || points <= 0) return 'slate'
  return points >= 6 ? 'danger' : 'amber'
}

export const pointsWords = (points: number): string => `${points} point${points === 1 ? '' : 's'}`

export function standingMeta(s: LicenseStanding): PillMeta {
  if (s.state === 'valid') return { label: 'Valid', tint: 'mint' }
  if (s.state === 'none') return { label: 'Not a driver', tint: 'slate' }
  return { label: s.word, tint: s.state === 'invalid' ? 'danger' : 'amber' }
}

/** Due Soon wears the Staff Compliance section's own words and tint for the same window. */
export const MAIS_META: Record<'certified' | 'due_soon' | 'expired', PillMeta> = {
  certified: { label: 'Certified', tint: 'mint' },
  due_soon: { label: 'Due Soon', tint: 'amber' },
  expired: { label: 'Expired', tint: 'danger' },
}

export const maisPill = (c: Pick<MaisCert, 'expired' | 'dueSoon'>): PillMeta =>
  MAIS_META[c.expired ? 'expired' : c.dueSoon ? 'due_soon' : 'certified']

/** The pill beside a licence or insurance day: Expired or Due Soon as Staff Compliance says them; nothing when current. */
export const dayPill = (state: DayState): PillMeta | null =>
  state === 'expired' || state === 'due_soon' ? TRAINING_META[state] : null

/** The registry's own word when the pill does not already say it ("Voluntary Withdrawal", a Certified past its day). */
export function maisWordNote(c: Pick<MaisCert, 'word' | 'expired'>): string {
  const word = c.word.trim()
  const pill = MAIS_META[c.expired ? 'expired' : 'certified'].label
  return word && word.toLowerCase() !== pill.toLowerCase() ? `Registry says ${word}` : ''
}

export const VIA_WORDS: Record<ClientVia, string> = { punches: 'Punches', house: 'Shifts at their home' }

export const IST_META: Record<Exclude<IstStatus, ''>, PillMeta> = {
  done: { label: 'Done', tint: 'mint' },
  owed: { label: 'Owed', tint: 'amber' },
}

export const houseRole = (h: Pick<StaffHouse, 'hm' | 'lead'>): string => (h.hm ? 'House manager' : h.lead ? 'Team lead' : '')

/* ---------- assign training ---------- */

type AssignHouse = Pick<HouseRow, 'code' | 'title' | 'active' | 'clients'>

// The house's clients split the way the door splits them: one IST row per staff member and client, at any house and…
export function assignSplit(house: AssignHouse, ist: StaffIst[]): { toTrain: string[]; trained: string[]; owed: string[] } {
  const held = new Map<string, 'done' | 'owed'>()
  for (const r of ist) {
    const k = nameKey(r.client_name || r.client_key)
    if (k && held.get(k) !== 'done') held.set(k, r.status === 'done' ? 'done' : 'owed')
  }
  const names = house.clients.map((c) => c.name).filter(Boolean)
  return {
    toTrain: names.filter((n) => !held.has(nameKey(n))),
    trained: names.filter((n) => held.get(nameKey(n)) === 'done'),
    owed: names.filter((n) => held.get(nameKey(n)) === 'owed'),
  }
}

/** The active houses a training can be assigned at: every one but those whose every client is already on record. */
export function assignableHouses<T extends AssignHouse>(houses: T[], ist: StaffIst[]): T[] {
  return houses
    .filter((h) => h.active)
    .filter((h) => {
      const { toTrain, trained, owed } = assignSplit(h, ist)
      return toTrain.length > 0 || (trained.length === 0 && owed.length === 0)
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** The one-line span a house was worked: 'Jan 06, 2025 – Sep 23, 2026 · 40 days'. */
export function workedSpan(h: Pick<StaffHouse, 'first_day' | 'last_day' | 'days'>): string {
  const span = [dateWords(h.first_day), dateWords(h.last_day)].filter(Boolean).join(' – ')
  const days = h.days === null ? '' : `${h.days} day${h.days === 1 ? '' : 's'}`
  return [span, days].filter(Boolean).join(' · ')
}

/** The embeddable map of an address — the platform's keyless embed. */
export const mapEmbed = (address: string): string => `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`

/* ---------- shifts ---------- */

export type ShiftSource = 'archive' | 'punches' | ''
export type Span = { from: string; to: string }

export type ShiftDay = { date: string; house: string; start: string; end: string; designation: '' | 'hm' | 'lead'; source: ShiftSource }
export type Upcoming = { date: string; house: string; start: string; end: string }
export type ShiftPattern = { house: string; weekdays: string[]; start: string; end: string; from: string; to: string }
export type SourceRead = { readable: boolean; why: string; rows: number | null }

export type StaffShifts = {
  houses: StaffHouse[]
  days: ShiftDay[]
  upcoming: Upcoming[]
  patterns: ShiftPattern[]
  sources: { archive: SourceRead; punches: SourceRead }
  gaps: Span[]
  why: string
  degraded: boolean
}

const spansOf = (v: unknown): Span[] =>
  rowsIn(v).map((g) => ({ from: str(rec(g).from), to: str(rec(g).to) })).filter((g) => g.from || g.to)

function sourceRead(v: unknown): SourceRead {
  const x = rec(v)
  return { readable: x.readable !== false, why: str(x.why), rows: num(x.rows) }
}

export function shiftsOf(raw: unknown): StaffShifts {
  const o = rec(raw)
  const src = rec(o.sources)
  return {
    houses: rowsIn(o, 'houses').map(houseOf).filter((h) => h.code),
    days: rowsIn(o, 'days').map((d) => {
      const x = rec(d)
      return {
        date: str(x.date).slice(0, 10), house: str(x.house).toUpperCase(), start: str(x.start), end: str(x.end),
        designation: oneOf(x.designation, ['hm', 'lead', ''] as const, ''),
        source: oneOf(x.source, ['archive', 'punches', ''] as const, ''),
      }
    }).filter((d) => d.date).sort((a, b) => b.date.localeCompare(a.date)),
    upcoming: rowsIn(o, 'upcoming').map((d) => {
      const x = rec(d)
      return { date: str(x.date).slice(0, 10), house: str(x.house).toUpperCase(), start: str(x.start), end: str(x.end) }
    }).filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date)),
    patterns: rowsIn(o, 'patterns').map((p) => {
      const x = rec(p)
      return {
        house: str(x.house).toUpperCase(), weekdays: (Array.isArray(x.weekdays) ? x.weekdays : []).map(str).filter(Boolean),
        start: str(x.start), end: str(x.end), from: str(x.from), to: str(x.to),
      }
    }).filter((p) => p.house),
    sources: { archive: sourceRead(src.archive), punches: sourceRead(src.punches) },
    gaps: spansOf(o.gaps),
    why: str(o.why),
    degraded: o.degraded === true,
  }
}

export const hoursWords = (start: string, end: string): string => (start || end ? `${start || '?'}–${end || '?'}` : '')

/** 'NW4045 · Mon, Wed, Fri · 7a–3p' — house · weekdays · hours. */
export function patternWords(p: ShiftPattern, houseName = ''): string {
  return [houseName || p.house, p.weekdays.join(', '), hoursWords(p.start, p.end)].filter(Boolean).join(' · ')
}

export const SHIFT_SOURCE_LABEL: Record<Exclude<ShiftSource, ''>, string> = { archive: 'Calendar Archive', punches: 'PSI punches' }

export function spanWords(g: Span): string {
  return [dateWords(g.from), dateWords(g.to)].filter(Boolean).join(' – ')
}

/* ---------- employment ---------- */

export type YesNo = 'yes' | 'no' | ''

export type StaffEmployment = {
  hiring: {
    referral: string
    referral_paid: string
    referral_paid_flag: YesNo
    job_app_date: string
    resume: { flag: YesNo; doc_id: string }
    attestation_date: string
  }
  dates: { start_doc: string; start_first_day: string; end_last_day: string }
  qualifications: {
    hs_diploma: { value: string; flag: string; doc_id: string; doc_date: string }
    driver: { value: string; approved: boolean }
  }
  onMaster: boolean
  why: string
  degraded: boolean
}

const yesNo = (v: unknown): YesNo => {
  const s = str(v).toLowerCase()
  if (['yes', 'y', 'true', '1'].includes(s) || v === true || v === 1) return 'yes'
  if (['no', 'n', 'false', '0'].includes(s) || v === false || v === 0) return 'no'
  return ''
}

export function employmentOf(raw: unknown): StaffEmployment {
  const o = rec(raw)
  const h = rec(o.hiring)
  const d = rec(o.dates)
  const q = rec(o.qualifications)
  const hs = rec(q.hs_diploma)
  const dr = rec(q.driver)
  const resume = rec(h.resume)
  return {
    hiring: {
      referral: str(h.referral),
      referral_paid: str(h.referral_paid),
      referral_paid_flag: yesNo(h.referral_paid_flag),
      job_app_date: str(h.job_app_date),
      resume: { flag: yesNo(resume.flag), doc_id: str(resume.doc_id) },
      attestation_date: str(h.attestation_date),
    },
    dates: { start_doc: str(d.start_doc), start_first_day: str(d.start_first_day), end_last_day: str(d.end_last_day) },
    qualifications: {
      hs_diploma: { value: str(hs.value), flag: str(hs.flag), doc_id: str(hs.doc_id), doc_date: str(hs.doc_date) },
      driver: { value: str(dr.value), approved: bool(dr.approved) },
    },
    onMaster: o.on_master !== false,
    why: str(o.why),
    degraded: o.degraded === true,
  }
}

/** A cell that may be a day: the day in words, "Not applicable" for n/a, else the cell as written. */
export const cellWords = (v: string): string => (/^(n\/?a|not applicable)$/i.test(str(v)) ? 'Not applicable' : dateWords(v) || v)

/** "Referral paid?": Yes · the day, No, or the cell as written. */
export function referralPaidWords(e: StaffEmployment['hiring']): string {
  const day = dateWords(e.referral_paid)
  if (e.referral_paid_flag === 'yes') return day ? `Yes · ${day}` : 'Yes'
  if (e.referral_paid_flag === 'no') return 'No'
  return day || e.referral_paid
}

/** A Master flag: 1 is verified, 0.5 partly, 0 not. */
export function flagWords(flag: string): string {
  const n = num(flag)
  if (n === 1) return 'Verified'
  if (n === 0.5) return 'Partly on file'
  if (n === 0) return 'Not verified'
  return ''
}

export function diplomaWords(hs: StaffEmployment['qualifications']['hs_diploma']): string {
  const flag = flagWords(hs.flag)
  const day = dateWords(hs.doc_date)
  if (flag) return [flag, day].filter(Boolean).join(' · ')
  return [cellWords(hs.value), day].filter(Boolean).join(' · ')
}

export function driverWords(dr: StaffEmployment['qualifications']['driver']): string {
  if (dr.approved) return 'Approved driver'
  return dr.value
}

/** End date (last day): the day, or "Not applicable · Active" for a person still active. */
export function endDayWords(endLastDay: string, status: StaffStatus): string {
  const day = cellWords(endLastDay)
  if (day) return day
  return status === 'active' ? 'Not applicable · Active' : ''
}

/* ---------- documents ---------- */

export type DocCategory = 'hiring' | 'tax' | 'work_authorization' | 'training' | 'driving' | 'background' | 'medical' | 'other'
const DOC_CATEGORIES: DocCategory[] = ['hiring', 'tax', 'work_authorization', 'training', 'driving', 'background', 'medical', 'other']

export type DocStatus = 'verified' | 'signed' | 'on_file' | 'partial' | 'missing'
const DOC_STATUSES: DocStatus[] = ['verified', 'signed', 'on_file', 'partial', 'missing']

export type StaffDoc = {
  id: string
  /** the Drive file staffProfileDocFile answers as bytes; '' when nothing is on file */
  fileId: string
  title: string
  category: DocCategory
  date: string
  expires: string
  status: DocStatus
  source: string
  mime: string
}

export type StaffDocuments = {
  docs: StaffDoc[]
  counts: { total: number | null; with_file: number | null; missing: number | null }
  why: string
  degraded: boolean
}

export function documentsOf(raw: unknown): StaffDocuments {
  const o = rec(raw)
  const c = rec(o.counts)
  return {
    docs: rowsIn(o, 'docs').map((d) => {
      const x = rec(d)
      return {
        id: str(x.id) || str(x.file_id),
        fileId: str(x.file_id),
        title: str(x.title),
        category: oneOf(x.category, DOC_CATEGORIES, 'other'),
        date: str(x.date),
        expires: str(x.expires),
        status: oneOf(x.status, DOC_STATUSES, 'on_file'),
        source: str(x.source),
        mime: str(x.mime),
      }
    }).filter((d) => d.id && d.title),
    counts: { total: num(c.total), with_file: num(c.with_file), missing: num(c.missing) },
    why: str(o.why),
    degraded: o.degraded === true,
  }
}

export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  hiring: 'Hiring', tax: 'Tax', work_authorization: 'Work authorization', training: 'Training', driving: 'Driving',
  background: 'Background check', medical: 'Medical', other: 'Other',
}

export const DOC_STATUS_META: Record<DocStatus, PillMeta> = {
  verified: { label: 'Verified', tint: 'mint' },
  signed: { label: 'Signed', tint: 'mint' },
  on_file: { label: 'On File', tint: 'mint' },
  partial: { label: 'Partly on file', tint: 'amber' },
  missing: { label: 'Missing', tint: 'danger' },
}

/** Only a row with a file opens; a missing one has nothing to show and no arrow. */
export const docOpens = (d: Pick<StaffDoc, 'fileId' | 'status'>): boolean => !!d.fileId && d.status !== 'missing'

/** 'Work authorization · Aug 24, 2026 · expires Mar 18, 2032'. */
export function docLine(d: Pick<StaffDoc, 'category' | 'date' | 'expires'>): string {
  const expires = dateWords(d.expires)
  return [DOC_CATEGORY_LABEL[d.category], dateWords(d.date), expires ? `expires ${expires}` : ''].filter(Boolean).join(' · ')
}

/** Under a row's name in the table: its category and expiry ('Work authorization · expires Mar 18, 2032'); the date has
 * its own column. */
export function docKind(d: Pick<StaffDoc, 'category' | 'expires'>): string {
  const expires = dateWords(d.expires)
  return [DOC_CATEGORY_LABEL[d.category], expires ? `expires ${expires}` : ''].filter(Boolean).join(' · ')
}

/* ---------- compliance ---------- */

export type TrainingState = 'current' | 'due_soon' | 'expired' | 'not_on_file' | 'in_review' | 'no_date' | 'renewal_assigned'
const TRAINING_STATES: TrainingState[] = ['current', 'due_soon', 'expired', 'not_on_file', 'in_review', 'no_date', 'renewal_assigned']

/** A Med Del renewal running for the course: its phase number and the Med Del page's word for it. */
export type TrainingRenewal = { phase: string; phaseLabel: string; level: string }

// Where a course's paper files (StaffProfiles.gs spFilingOf_): the catalogue requirement, the Employee Database…
export type CourseFiling = { reqId: string; masterHeader: string; dateRole: DateRole; files: boolean; confirmWhy: string }
export type DateRole = 'issued' | 'expires' | ''

export type TrainingRow = {
  id: string
  label: string
  expires: string
  state: TrainingState
  source: string
  /** The Trainings Status tracker's own Status word, as written there. */
  trackerWord: string
  renewal: TrainingRenewal | null
  /** null on an answer that carries no filing (read before the server named it) */
  filing: CourseFiling | null
}

export type CredentialState = TrainingState | 'na'
export type CredentialRow = {
  id: string; label: string; expires: string; state: CredentialState; note: string; filing: CourseFiling | null
}

export const dateRoleOf = (v: unknown): DateRole => {
  const s = str(v)
  return s === 'issued' || s === 'expires' ? s : ''
}

function filingOf(v: unknown): CourseFiling | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const x = rec(v)
  return { reqId: str(x.req_id), masterHeader: str(x.master_header), dateRole: dateRoleOf(x.date_role), files: x.files === true,
    confirmWhy: str(x.confirm_why) }
}

export type ScreenState = 'clear' | 'pending' | 'missing' | 'na'
const SCREEN_STATES: ScreenState[] = ['clear', 'pending', 'missing', 'na']

export type ScreeningRow = { id: string; label: string; state: ScreenState; date: string; rapbackDate: string; refMasked: string }

export type StaffCompliance = {
  training: TrainingRow[]
  credentials: CredentialRow[]
  screening: ScreeningRow[]
  windowDays: number | null
  /** papers filed for a course and not yet confirmed into the record, newest first */
  papers: PaperRow[]
  why: string
  degraded: boolean
}

/** A course or credential drawn "Current" has a date; with none it is "No date on file", never current by default. */
function trainingState(v: unknown, expires: string): TrainingState {
  const s = oneOf(v, TRAINING_STATES, 'not_on_file')
  return s === 'current' && !expires ? 'no_date' : s
}

function screeningOf(v: unknown): ScreeningRow[] {
  return rowsIn(v).map((r) => {
    const x = rec(r)
    return {
      id: str(x.id),
      label: str(x.label),
      state: oneOf(x.state, SCREEN_STATES, 'missing'),
      date: str(x.date),
      rapbackDate: str(x.rapback_date),
      refMasked: safeMask(x.ref_masked),
    }
  }).filter((r) => r.id || r.label)
}

export function complianceOf(raw: unknown): StaffCompliance {
  const o = rec(raw)
  return {
    training: rowsIn(o, 'training').map((r) => {
      const x = rec(r)
      const expires = str(x.expires)
      const n = x.renewal && typeof x.renewal === 'object' ? rec(x.renewal) : null
      return {
        id: str(x.id), label: str(x.label), expires, state: trainingState(x.state, expires), source: str(x.source),
        trackerWord: str(x.tracker_word),
        renewal: n ? { phase: str(n.phase), phaseLabel: str(n.phase_label), level: str(n.level) } : null,
        filing: filingOf(x.filing),
      }
    }).filter((r) => r.label),
    credentials: rowsIn(o, 'credentials').map((r) => {
      const x = rec(r)
      const expires = str(x.expires)
      const state: CredentialState = str(x.state).toLowerCase() === 'na' ? 'na' : trainingState(x.state, expires)
      return { id: str(x.id), label: str(x.label), expires, state, note: str(x.note), filing: filingOf(x.filing) }
    }).filter((r) => r.label),
    screening: screeningOf(o.screening),
    windowDays: num(o.window_days),
    papers: rowsIn(o, 'papers').map(paperOf).filter((p) => p.id),
    why: str(o.why),
    degraded: o.degraded === true,
  }
}

export const TRAINING_META: Record<CredentialState, PillMeta> = {
  current: { label: 'Current', tint: 'mint' },
  due_soon: { label: 'Due Soon', tint: 'amber' },
  expired: { label: 'Expired', tint: 'danger' },
  not_on_file: { label: 'Not on file', tint: 'slate' },
  in_review: { label: 'In review', tint: 'blue' },
  no_date: { label: 'No date on file', tint: 'slate' },
  renewal_assigned: { label: 'Renewal assigned', tint: 'blue' },
  na: { label: 'Not Applicable', tint: 'blue' },
}

// A course's sub-line: its running renewal ("Renewal assigned · Phase 3 · Relias training"), a certificate waiting…
export function trainingSub(t: Pick<TrainingRow, 'state' | 'trackerWord' | 'renewal'>): string {
  const parts: string[] = []
  if (t.renewal) {
    if (t.state !== 'renewal_assigned') parts.push('Renewal assigned')
    if (t.renewal.phase) parts.push(`Phase ${t.renewal.phase}`)
    if (t.renewal.phaseLabel) parts.push(t.renewal.phaseLabel)
  }
  if (t.state === 'in_review') parts.push('A certificate is waiting for review')
  const word = t.trackerWord.trim()
  const said = [TRAINING_META[t.state].label, ...parts].join(' · ').toLowerCase()
  if (word && !said.includes(word.toLowerCase())) parts.push(word)
  return parts.join(' · ')
}

/* ---------- a training paper: filed, read by the decoder, confirmed into the Master ---------- */

/** A course or credential the picker offers, by the requirement id its paper files under. */
export type FilingCourse = Omit<CourseFiling, 'files'> & { label: string; group: 'Training' | 'Credentials'; state: CredentialState }

// The picker: the person's courses as the Compliance section lists them, then the credentials — only those a paper…
export function filingCourses(c: StaffCompliance | null): FilingCourse[] {
  if (!c) return []
  const out: FilingCourse[] = []
  const seen = new Set<string>()
  const add = (group: FilingCourse['group'], row: { id: string; label: string; state: CredentialState; filing: CourseFiling | null },
    fallback: boolean) => {
    const f = row.filing
    const reqId = f ? f.reqId : fallback ? row.id : ''
    if (!reqId || (f && !f.files) || seen.has(reqId)) return
    seen.add(reqId)
    out.push({ reqId, label: row.label, group, state: row.state, masterHeader: f?.masterHeader ?? '', dateRole: f?.dateRole ?? '',
      confirmWhy: f?.confirmWhy ?? '' })
  }
  c.training.forEach((t) => add('Training', t, true))
  c.credentials.forEach((t) => add('Credentials', t, false))
  return out
}

/** The option's words: the course, then the Employee Database column its date lands in. */
export const courseWords = (c: Pick<FilingCourse, 'label' | 'masterHeader'>): string =>
  c.masterHeader ? `${c.label} — ${c.masterHeader}` : c.label

/** One ledger row as the certificate doors answer it (ComplianceDocs.gs complianceDocsOut_). */
export type PaperRow = {
  id: string
  person: string
  cert: string
  name: string
  /** when it was filed */
  at: string
  reqId: string
  readState: 'pending' | 'read' | 'unread' | ''
  readKind: string
  /** the kind in the decoder's own words (CERT_READ_KIND_WORDS); '' for a kind they do not name */
  readKindWords: string
  issuedOn: string
  expiresOn: string
  confidence: number | null
  readWhy: string
}

const READ_STATES = ['pending', 'read', 'unread'] as const

export function paperOf(raw: unknown): PaperRow {
  const o = rec(raw)
  const rs = str(o.read_state)
  return {
    id: str(o.id), person: str(o.person), cert: str(o.cert), name: str(o.name), at: str(o.at), reqId: str(o.req_id),
    readState: (READ_STATES as readonly string[]).includes(rs) ? (rs as PaperRow['readState']) : '',
    readKind: str(o.read_kind), readKindWords: str(o.read_kind_words), issuedOn: str(o.issued_on), expiresOn: str(o.expires_on),
    confidence: num(o.read_confidence), readWhy: str(o.read_why),
  }
}

/** A paper filed for a course and not yet confirmed, with the course the picker offers it under. */
export type WaitingPaper = { paper: PaperRow; course: FilingCourse }

// The papers to continue from (StaffProfiles.gs `papers`, newest first): those filed under a course the picker…
export function waitingPapers(papers: PaperRow[], courses: FilingCourse[]): WaitingPaper[] {
  const out: WaitingPaper[] = []
  for (const paper of papers) {
    const course = courses.find((c) => c.reqId === paper.reqId)
    if (paper.id && course && !course.confirmWhy) out.push({ paper, course })
  }
  return out
}

/** What the Employee Database holds now for a filed paper (certUploadRecord) — the witness a confirmation is checked against. */
export type PaperRecord = { dateSource: string; dateRole: DateRole; value: string; why: string; allowed: boolean }

export function paperRecordOf(raw: unknown): PaperRecord {
  const o = rec(raw)
  const c = rec(o.confirm)
  // kept exactly as answered: it is sent back as the witness
  const value = typeof o.record === 'string' ? o.record : str(o.record)
  return { dateSource: str(o.date_source), dateRole: dateRoleOf(o.date_role), value, why: str(o.record_why) || str(c.why),
    allowed: c.allowed === true }
}

const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s)

const paperDate = (p: PaperRow, role: DateRole): string => (role === 'issued' ? p.issuedOn : p.expiresOn)

/** The day a confirmation writes, from a settled reading: the paper's own day for a record that keeps it, else its expiry. */
export function paperDay(p: PaperRow | null, role: DateRole): string {
  if (!p || p.readState !== 'read') return ''
  const d = paperDate(p, role)
  return isDay(d) ? d : ''
}

/** A day the decoder printed without settling on it (not sure enough, another kind): offered, never filled in. */
export function paperSeen(p: PaperRow | null, role: DateRole): string {
  if (!p || p.readState === 'read') return ''
  const d = paperDate(p, role)
  return isDay(d) ? d : ''
}

/** "CPR / First Aid card": the decoder's own words for the kind, else its key spelled out. */
export function kindWords(p: Pick<PaperRow, 'readKind' | 'readKindWords'>): string {
  if (p.readKindWords) return p.readKindWords
  const s = p.readKind.replace(/_/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}

export const SCREEN_META: Record<ScreenState, PillMeta> = {
  clear: { label: 'Clear', tint: 'mint' },
  pending: { label: 'Pending', tint: 'amber' },
  missing: { label: 'Missing', tint: 'danger' },
  na: { label: 'Not applicable', tint: 'blue' },
}

/** An HR screening cell: "Clear · Aug 27, 2026", "Not applicable", "Pending", "Missing". */
export function screenWords(r: Pick<ScreeningRow, 'state' | 'date'>): string {
  if (r.state === 'na') return 'Not applicable'
  const day = dateWords(r.date)
  return [SCREEN_META[r.state].label, day].filter(Boolean).join(' · ')
}

/* ---------- HR admin ---------- */

export type StaffAccount = { user_id: string; login: string; role: string; active: boolean; last_login: string; created_at: string }

export type StaffHr = {
  personal: { ssn_masked: string; dob: string; address: string; city: string; state: string; zip: string; w4_date: string; pay_auth_date: string }
  work_auth: { i9_date: string; i9_completed: string; i9_type_1: string; i9_type_1_exp: string; i9_type_2: string; i9_type_2_exp: string; hipaa_date: string }
  driver: { driver: string; approved: boolean; license_masked: string; license_exp: string; abstract_original: string; abstract_latest: string; insurance_exp: string }
  screening: ScreeningRow[]
  bci_check_date: string
  rapback_entry_date: string
  account: StaffAccount | null
  account_why: string
  why: string
  degraded: boolean
}

export function hrOf(raw: unknown): StaffHr {
  const o = rec(raw)
  const p = rec(o.personal)
  const w = rec(o.work_auth)
  const d = rec(o.driver)
  const a = o.account && typeof o.account === 'object' ? rec(o.account) : null
  return {
    personal: {
      ssn_masked: safeMask(p.ssn_masked), dob: str(p.dob), address: str(p.address), city: str(p.city), state: str(p.state),
      zip: str(p.zip), w4_date: str(p.w4_date), pay_auth_date: str(p.pay_auth_date),
    },
    work_auth: {
      i9_date: str(w.i9_date), i9_completed: str(w.i9_completed), i9_type_1: str(w.i9_type_1), i9_type_1_exp: str(w.i9_type_1_exp),
      i9_type_2: str(w.i9_type_2), i9_type_2_exp: str(w.i9_type_2_exp), hipaa_date: str(w.hipaa_date),
    },
    driver: {
      driver: str(d.driver), approved: bool(d.approved), license_masked: safeMask(d.license_masked), license_exp: str(d.license_exp),
      abstract_original: str(d.abstract_original), abstract_latest: str(d.abstract_latest), insurance_exp: str(d.insurance_exp),
    },
    screening: screeningOf(o.screening),
    bci_check_date: str(o.bci_check_date),
    rapback_entry_date: str(o.rapback_entry_date),
    account: a && str(a.user_id) ? {
      user_id: str(a.user_id), login: str(a.login), role: str(a.role), active: a.active !== false, last_login: str(a.last_login),
      created_at: str(a.created_at),
    } : null,
    account_why: str(o.account_why),
    why: str(o.why),
    degraded: o.degraded === true,
  }
}

/** "Driver": "Yes · approved", "Yes", "No", or the cell as written. */
export function driverLine(d: StaffHr['driver']): string {
  const said = yesNo(d.driver)
  if (said === 'yes' || (!said && d.approved)) return d.approved ? 'Yes · approved' : 'Yes'
  if (said === 'no') return 'No'
  return d.driver
}

/* ---------- actions (the pendencies) ---------- */

export type ActionStatus = 'needs_attention' | 'due_soon' | 'in_review'
const ACTION_STATUSES: ActionStatus[] = ['needs_attention', 'due_soon', 'in_review']

export type ActionKind = 'doc' | 'assign_training' | 'none'

export type StaffActionItem = {
  id: string
  status: ActionStatus
  item: string
  date: string
  flow: string
  phase: string
  action: { kind: ActionKind; docId: string; house: string }
  /** the requirement a certificate is filed under for this pendency; '' when HR files it */
  reqId: string
}

export type StaffActions = {
  items: StaffActionItem[]
  counts: { needs_attention: number | null; due_soon: number | null; in_review: number | null }
  why: string
  degraded: boolean
}

export function actionsOf(raw: unknown): StaffActions {
  const o = rec(raw)
  const c = rec(o.counts)
  return {
    items: rowsIn(o, 'items').map((r, i) => {
      const x = rec(r)
      const a = rec(x.action)
      const kind = oneOf(a.kind, ['doc', 'assign_training', 'none'] as const, 'none')
      const docId = str(a.doc_id)
      return {
        id: str(x.id) || `item-${i}`,
        status: oneOf(x.status, ACTION_STATUSES, 'needs_attention'),
        item: str(x.item),
        date: str(x.date),
        flow: str(x.flow),
        phase: str(x.phase),
        // a document to review needs its file; without one there is nothing to open
        action: { kind: kind === 'doc' && !docId ? 'none' : kind, docId, house: str(a.house).toUpperCase() },
        reqId: str(x.req_id),
      }
    }).filter((r) => r.item),
    counts: { needs_attention: num(c.needs_attention), due_soon: num(c.due_soon), in_review: num(c.in_review) },
    why: str(o.why),
    degraded: o.degraded === true,
  }
}

export const ACTION_STATUS_META: Record<ActionStatus, PillMeta> = {
  needs_attention: { label: 'Needs Attention', tint: 'danger' },
  due_soon: { label: 'Due Soon', tint: 'amber' },
  in_review: { label: 'In Review', tint: 'blue' },
}

/** The row's button: "Review certificate" for a certificate, "Review document", "Assign training", or none. */
export function actionButton(item: Pick<StaffActionItem, 'flow' | 'action'>): string {
  if (item.action.kind === 'doc') return /certificate/i.test(item.flow) ? 'Review certificate' : 'Review document'
  if (item.action.kind === 'assign_training') return 'Assign training'
  return ''
}

export function filterActions(items: StaffActionItem[], query: string): StaffActionItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) => [i.item, i.flow, i.phase, ACTION_STATUS_META[i.status].label].some((v) => v.toLowerCase().includes(q)))
}

/** The nav badge: how many pendencies the answer lists. */
export const actionCount = (a: StaffActions | null): number | null => (a ? a.items.length : null)

/* ---------- activity ---------- */

export type ActivityKind = 'visit' | 'note' | 'ist_assigned' | 'ist_done' | 'requirement' | 'upload' | 'upload_confirmed' | 'incident' |
  'scheduled' | 'hr_view'
const ACTIVITY_KINDS: ActivityKind[] = ['visit', 'note', 'ist_assigned', 'ist_done', 'requirement', 'upload', 'upload_confirmed',
  'incident', 'scheduled', 'hr_view']

export type ActivityEvent = { at: string; kind: ActivityKind; title: string; detail: string; by: string }
export type Visit = { at: string; visitor: string; section: string }

export type StaffActivity = { events: ActivityEvent[]; visits: Visit[]; visitsTotal: number | null; why: string; degraded: boolean }

export function activityOf(raw: unknown): StaffActivity {
  const o = rec(raw)
  return {
    events: rowsIn(o, 'events').map((e) => {
      const x = rec(e)
      return { at: str(x.at), kind: oneOf(x.kind, ACTIVITY_KINDS, 'note'), title: str(x.title), detail: str(x.detail), by: str(x.by) }
    }).filter((e) => e.title).sort((a, b) => b.at.localeCompare(a.at)),
    visits: rowsIn(o, 'visits').map((v) => {
      const x = rec(v)
      return { at: str(x.at), visitor: str(x.visitor), section: str(x.section) }
    }).filter((v) => v.at).sort((a, b) => b.at.localeCompare(a.at)),
    visitsTotal: num(o.visits_total),
    why: str(o.why),
    degraded: o.degraded === true,
  }
}

export const sectionWords = (section: string): string =>
  STAFF_TABS.find((t) => t.id === section)?.label ?? (section ? section[0].toUpperCase() + section.slice(1) : '')

/* ---------- staff notes ---------- */

export type NoteCategory = 'general' | 'performance' | 'training' | 'scheduling' | 'hr'
export const NOTE_CATEGORIES: { id: NoteCategory; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'performance', label: 'Performance' },
  { id: 'training', label: 'Training' },
  { id: 'scheduling', label: 'Scheduling' },
  { id: 'hr', label: 'HR' },
]

export type StaffNote = {
  id: string
  category: string
  priority: string
  details: string
  state: 'open' | 'resolved'
  by: string
  at: string
  stateBy: string
  stateAt: string
}

export type EarlierNote = { at: string; by: string; details: string }

export type StaffNotes = { notes: StaffNote[]; earlier: EarlierNote[]; why: string }

export function notesOf(raw: unknown): StaffNotes {
  const o = rec(raw)
  return {
    notes: rowsIn(o, 'notes', 'rows').map((n) => {
      const x = rec(n)
      return {
        id: str(x.id),
        category: str(x.category).toLowerCase(),
        priority: str(x.priority).toLowerCase() || 'normal',
        details: str(x.details),
        state: str(x.state).toLowerCase() === 'resolved' ? 'resolved' as const : 'open' as const,
        by: str(x.by),
        at: str(x.at),
        stateBy: str(x.state_by),
        stateAt: str(x.state_at),
      }
    }).filter((n) => n.id).sort((a, b) => b.at.localeCompare(a.at)),
    earlier: rowsIn(o, 'earlier').map((n) => {
      const x = rec(n)
      return { at: str(x.at), by: str(x.by), details: str(x.details) }
    }).filter((n) => n.details).sort((a, b) => b.at.localeCompare(a.at)),
    why: str(o.why),
  }
}

export const categoryLabel = (c: string): string =>
  NOTE_CATEGORIES.find((x) => x.id === c)?.label ?? (c ? c[0].toUpperCase() + c.slice(1) : 'General')

/* ---------- texts ---------- */

export type Counterpart = { id: string; label: string; owner: string; count: number | null; firstAt: string; lastAt: string }
export type TextMessage = { id: string; at: string; dir: 'in' | 'out'; body: string; by: string }

export type StaffTexts = {
  counterparts: Counterpart[]
  with: string
  /** newest first, as the answer sends them */
  messages: TextMessage[]
  more: boolean
  coverage: { from: string; to: string; gaps: Span[] }
  phonesMatched: number | null
  why: string
  degraded: boolean
}

export function textsOf(raw: unknown): StaffTexts {
  const o = rec(raw)
  const cov = rec(o.coverage)
  return {
    counterparts: rowsIn(o, 'counterparts').map((c) => {
      const x = rec(c)
      return { id: str(x.id), label: str(x.label), owner: str(x.owner), count: num(x.count), firstAt: str(x.first_at), lastAt: str(x.last_at) }
    }).filter((c) => c.id),
    with: str(o.with),
    messages: rowsIn(o, 'messages').map((m, i) => {
      const x = rec(m)
      return { id: str(x.id) || `m-${i}-${str(x.at)}`, at: str(x.at), dir: str(x.dir).toLowerCase() === 'out' ? 'out' as const : 'in' as const,
        body: str(x.body), by: str(x.by) }
    }).filter((m) => m.at),
    more: o.more === true,
    coverage: { from: str(cov.from), to: str(cov.to), gaps: spansOf(cov.gaps) },
    phonesMatched: num(o.phones_matched),
    why: str(o.why),
    degraded: o.degraded === true,
  }
}

/** The cursor "Load earlier" sends: the oldest message held. */
export function olderCursor(messages: TextMessage[]): string {
  return messages.reduce((min, m) => (!min || m.at < min ? m.at : min), '')
}

/** Every page held, once each, oldest first — how a thread reads. */
export function threadOrder(...pages: TextMessage[][]): TextMessage[] {
  const seen = new Map<string, TextMessage>()
  for (const page of pages) for (const m of page) if (!seen.has(m.id)) seen.set(m.id, m)
  return [...seen.values()].sort((a, b) => a.at.localeCompare(b.at))
}

export type ThreadItem =
  | { kind: 'day'; day: string }
  | { kind: 'gap'; gap: Span }
  | { kind: 'msg'; msg: TextMessage }

/** The thread as drawn: a day line when the day changes, and a stretch the store holds nothing for as its own line. */
export function threadItems(messages: TextMessage[], gaps: Span[]): ThreadItem[] {
  const out: ThreadItem[] = []
  let lastDay = ''
  let prevAt = ''
  const shown = new Set<Span>()
  for (const m of messages) {
    for (const g of gaps) {
      if (shown.has(g) || !g.from || !prevAt) continue
      if (prevAt.slice(0, 10) <= g.from && m.at.slice(0, 10) >= (g.to || g.from)) {
        out.push({ kind: 'gap', gap: g })
        shown.add(g)
      }
    }
    const day = m.at.slice(0, 10)
    if (day !== lastDay) {
      out.push({ kind: 'day', day })
      lastDay = day
    }
    out.push({ kind: 'msg', msg: m })
    prevAt = m.at
  }
  return out
}

/** The line book's name, else its number — the server may hand the number as the label. */
export const counterpartLabel = (c: Counterpart): string => formatPhoneDisplay(c.label) || formatPhoneDisplay(c.id)

/* ---------- transcripts ---------- */

export type CallMeta = {
  callId: string
  at: string
  secs: number | null
  direction: string
  line: string
  turns: number | null
  kind: string
  categories: string[]
}

export type StaffTranscripts = {
  calls: CallMeta[]
  categories: { name: string; count: number | null }[]
  gaps: Span[]
  why: string
  degraded: boolean
}

export function transcriptsOf(raw: unknown): StaffTranscripts {
  const o = rec(raw)
  return {
    calls: rowsIn(o, 'calls').map((c) => {
      const x = rec(c)
      return {
        callId: str(x.call_id), at: str(x.at), secs: num(x.secs), direction: str(x.direction), line: str(x.line), turns: num(x.turns),
        kind: str(x.kind), categories: (Array.isArray(x.categories) ? x.categories : []).map(str).filter(Boolean),
      }
    }).filter((c) => c.callId).sort((a, b) => b.at.localeCompare(a.at)),
    categories: rowsIn(o, 'categories').map((c) => ({ name: str(rec(c).name), count: num(rec(c).count) })).filter((c) => c.name),
    gaps: spansOf(o.gaps),
    why: str(o.why),
    degraded: o.degraded === true,
  }
}

/** The calls under one category ('' is all), grouped by their Ohio day, newest first. */
export function callsByDay(calls: CallMeta[], category: string): { day: string; calls: CallMeta[] }[] {
  const out: { day: string; calls: CallMeta[] }[] = []
  for (const c of calls) {
    if (category && !c.categories.includes(category) && c.kind !== category) continue
    const day = dateWords(c.at) || 'Undated'
    const last = out[out.length - 1]
    if (last && last.day === day) last.calls.push(c)
    else out.push({ day, calls: [c] })
  }
  return out
}

export function secsWords(secs: number | null): string {
  if (secs === null) return ''
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

export type TurnRole = 'agent' | 'caller' | 'other'
export type TranscriptTurn = { at: string; speaker: string; role: TurnRole; text: string }

export type StaffTranscript = {
  callId: string
  at: string
  line: string
  /** the company line's name, when the platform's line book names it; '' otherwise */
  lineName: string
  /** what the call was, when the answer says — 'Phone screen' */
  kind: string
  direction: string
  durationSec: number | null
  full: string
  speaker: string
  hasWords: boolean
}

export function transcriptOf(raw: unknown): StaffTranscript {
  const o = rec(raw)
  const full = str(o.full_transcript)
  const speaker = str(o.speaker_transcript)
  return {
    callId: str(o.call_id), at: str(o.at), line: str(o.line), lineName: str(o.line_name), kind: str(o.kind),
    direction: str(o.direction), durationSec: num(o.duration_sec),
    full, speaker, hasWords: o.has_words === undefined ? !!(full || speaker) : o.has_words === true,
  }
}

const TURN = /^\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s*([^:\n]{0,80}?)\s*:\s?(.*)$/

// Lines like "[0:00] +13305550101: Hello." as turns — the hotline desk's own reading.
export function parseSpeakerTranscript(text: string, line: string, phones: string[]): TranscriptTurn[] {
  const lineDigits = digitsOf(line).slice(-10)
  const own = new Set(phones.map((p) => digitsOf(p).slice(-10)).filter(Boolean))
  const turns: TranscriptTurn[] = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const m = TURN.exec(raw)
    if (m) {
      const speaker = m[2].trim()
      const sd = digitsOf(speaker).slice(-10)
      const role: TurnRole = sd && sd === lineDigits ? 'agent' : sd && own.has(sd) ? 'caller' : 'other'
      turns.push({ at: m[1], speaker, role, text: m[3].trim() })
      continue
    }
    const piece = raw.trim()
    if (!piece) continue
    if (turns.length) turns[turns.length - 1].text = `${turns[turns.length - 1].text}\n${piece}`.trim()
    else turns.push({ at: '', speaker: '', role: 'other', text: piece })
  }
  return turns.some((t) => t.at) ? turns : []
}

/* ---------- the Actions menu, the panel's heading, favorites and share ---------- */

export type MenuItem = { label: string; ask: StaffAsk } | { label: string; favorite: true }

export const FILE_DOC_LABEL = 'File training document'

export const ACTION_GROUPS: { label: string; items: MenuItem[] }[] = [
  {
    label: 'Performance',
    items: [
      { label: 'New HR Issue', ask: { kind: 'hrissue' } },
      { label: 'Add Note', ask: { kind: 'note' } },
      { label: 'Assign Training', ask: { kind: 'assign', house: '' } },
      { label: FILE_DOC_LABEL, ask: { kind: 'filedoc', course: '' } },
    ],
  },
  {
    label: 'Staff actions',
    items: [
      { label: 'New Incident', ask: { kind: 'incident' } },
      { label: 'New Employee Loan', ask: { kind: 'loan' } },
      { label: 'Add Payment', ask: { kind: 'payment' } },
    ],
  },
  { label: 'Navigation & preferences', items: [{ label: 'Add to favorites', favorite: true }] },
]

export function panelLabel(ask: StaffAsk): string {
  switch (ask.kind) {
    case 'share': return 'Share'
    case 'assign': return 'Assign Training'
    case 'filedoc': return 'Training Document'
    case 'docupload': return 'Documents'
    case 'incident': return 'Incident'
    case 'hrissue': return 'HR Issue'
    case 'docmark': return 'Documentation'
    case 'istadd': return 'IST'
    case 'note': return 'Staff Notes'
    case 'loan': return 'Employee Loan'
    case 'payment': return 'Loan Payment'
    case 'transcript': return 'Transcript'
    case 'invite': case 'access': case 'reset': return 'Account Access'
    case 'edit': return 'Edit'
  }
}

export function panelTitle(ask: StaffAsk, name: string, accountActive: boolean | null = null): string {
  switch (ask.kind) {
    case 'share': return name
    case 'assign': return 'Assign Training'
    case 'filedoc': return `${FILE_DOC_LABEL} · ${name}`
    case 'docupload': return `Upload ${ask.doc} · ${name}`
    case 'incident': return 'New Incident'
    case 'hrissue': return `Add HR Issue · ${name}`
    case 'docmark': return `Mark concluded · ${name}`
    case 'istadd': return `Record IST · ${name}`
    case 'note': return `Add Note · ${name}`
    case 'loan': return 'New Employee Loan'
    case 'payment': return 'Add Payment'
    case 'transcript': return 'Call transcript'
    case 'invite': return 'Send Invite'
    case 'access': return accountActive === false ? 'Enable Access' : 'Disable Access'
    case 'reset': return 'Reset Password'
    case 'edit': return `Edit ${EDIT_SECTION_LABEL[ask.section]} · ${name}`
  }
}

/** The favorite a person is kept under — the platform's own bookmarks. */
export function favoriteFor(row: Pick<RosterRow, 'key' | 'name' | 'role' | 'avatar'>): BookmarkInput {
  return {
    type: 'person', refId: `staff:${row.key}`, title: row.name, subtitle: row.role || 'Staff', avatar: row.avatar || undefined,
    tint: 'blue', href: staffHref(row.key),
  }
}

export function sharePayloadFor(row: Pick<RosterRow, 'key' | 'name' | 'role' | 'status' | 'employee_id'>, tab: StaffTab): SharePayload {
  const lines = [
    row.role ? `Role: ${row.role}` : '',
    `Status: ${STATUS_META[row.status].label}`,
    row.employee_id ? `Employee ID: ${row.employee_id}` : '',
  ].filter(Boolean)
  return {
    title: row.name,
    subtitle: `Staff · ${tabLabel(tab)}`,
    appHref: staffHref(row.key, tab),
    text: lines.join('\n'),
    icon: 'id-card',
    filename: `${row.name} ${tabLabel(tab)}`,
  }
}

/* ---------- what the viewer may do ---------- */

// The asks that write or open an account door: offered to the master in its own session alone — but Assign…
export const WRITE_ASKS: readonly StaffAsk['kind'][] = ['assign', 'filedoc', 'docupload', 'hrissue', 'docmark', 'istadd',
  'incident', 'note', 'loan', 'invite', 'access', 'reset', 'edit']

/* ---------- the record edit (staffProfileEdit) ---------- */

export const EDIT_SECTIONS = ['profile', 'employment', 'hr', 'compliance', 'driving', 'mais', 'ist', 'note'] as const
export type EditSection = (typeof EDIT_SECTIONS)[number]
export const EDIT_SECTION_LABEL: Record<EditSection, string> = {
  profile: 'Staff Details', employment: 'Employment', hr: 'HR Admin', compliance: 'Compliance', driving: 'Driver',
  mais: 'Med Del (MAIS)', ist: 'IST', note: 'Staff note',
}
/** The sections whose panel edits one line of a card, named by `id`. */
export const LINE_SECTIONS: readonly EditSection[] = ['mais', 'ist', 'note']
/** The name fields: filed through the rename door, which re-keys the record. */
export const RENAME_FIELDS = ['first_name', 'last_name']

type EditSpec = Omit<EditField, 'raw' | 'lockedBy'>

const DAY = 'date' as const

/** The fields each section edits, in the order drawn; the keys are the door's (StaffProfiles.gs SP_EDIT_SECTIONS). */
export const EDIT_FIELDS: Record<EditSection, EditSpec[]> = {
  profile: [
    { key: 'first_name', label: 'First name', kind: 'text', hint: 'A rename moves the profile, its notes and visits to the new name.' },
    { key: 'last_name', label: 'Last name', kind: 'text' },
    { key: 'status', label: 'Status (Employee Database)', kind: 'text', hint: 'As the Master words it: Yes, No, Hired, Other.' },
    { key: 'phone', label: 'Phone (Employee Database)', kind: 'phone' },
    { key: 'email', label: 'Email (Employee Database)', kind: 'email' },
    { key: 'account_phones', label: 'Account phones', kind: 'text', hint: 'Label: number, separated by commas — e.g. Mobile: 330-555-0101.' },
    { key: 'account_emails', label: 'Account contact emails', kind: 'text', hint: 'Separated by commas. The sign-in email is below.' },
    { key: 'avatar', label: 'Photo link', kind: 'url', hint: 'An https:// link to the picture.' },
    { key: 'login_email', label: 'Sign-in email', kind: 'email',
      confirm: 'Change the sign-in email: this person signs in with the new address from now on.' },
  ],
  employment: [
    { key: 'referral', label: 'Referral', kind: 'text' },
    { key: 'referral_paid', label: 'Referral paid?', kind: 'text' },
    { key: 'job_app_date', label: 'Job application date', kind: DAY },
    { key: 'resume', label: 'Resume', kind: 'text' },
    { key: 'attestation_date', label: 'Attestation date', kind: DAY },
    { key: 'start_doc', label: 'Start date (documented)', kind: DAY },
    { key: 'start_first_day', label: 'Start date (first day)', kind: DAY },
    { key: 'end_last_day', label: 'End date (last day)', kind: DAY },
    { key: 'hs_diploma', label: 'High school diploma', kind: 'text' },
    { key: 'driver', label: 'Driver', kind: 'text' },
  ],
  hr: [
    { key: 'address', label: 'Address', kind: 'text' },
    { key: 'city', label: 'City', kind: 'text' },
    { key: 'state', label: 'State', kind: 'text' },
    { key: 'zip', label: 'Zip', kind: 'text' },
    { key: 'w4_date', label: 'W-4 date', kind: DAY },
    { key: 'pay_auth_date', label: 'Pay authorization date', kind: DAY },
    { key: 'i9_date', label: 'I-9 date', kind: DAY },
    { key: 'i9_completed', label: 'I-9 completed', kind: 'text' },
    { key: 'i9_type_1', label: 'I-9 document 1', kind: 'text' },
    { key: 'i9_type_1_exp', label: 'I-9 document 1 expires', kind: DAY },
    { key: 'i9_type_2', label: 'I-9 document 2', kind: 'text' },
    { key: 'i9_type_2_exp', label: 'I-9 document 2 expires', kind: DAY },
    { key: 'hipaa_date', label: 'HIPAA form date', kind: DAY },
    { key: 'license_exp', label: 'License expires', kind: DAY },
    { key: 'abstract_original', label: "Driver's abstract (original)", kind: DAY },
    { key: 'abstract_latest', label: "Driver's abstract (latest)", kind: DAY },
    { key: 'insurance_exp', label: 'Insurance expires', kind: DAY },
    { key: 'sam', label: 'SAM database', kind: DAY },
    { key: 'oig', label: 'OIG exclusions', kind: DAY },
    { key: 'abuser', label: 'Abuser registry', kind: DAY },
    { key: 'sex_offender', label: 'Sex offender registry', kind: DAY },
    { key: 'offender', label: 'Offender registry', kind: DAY },
    { key: 'nurse_aide', label: 'Nurse aide registry', kind: DAY },
    { key: 'exclusions', label: 'Exclusions database', kind: DAY },
    { key: 'bci_check_date', label: 'BCI check date', kind: DAY },
    { key: 'rapback_entry_date', label: 'Rapback entry date', kind: DAY },
  ],
  compliance: [
    { key: 'dodd_exp', label: 'DODD 8-Hour expires', kind: DAY },
    { key: 'cpr_exp', label: 'CPR / First Aid expires', kind: DAY },
    { key: 'mandt_exp', label: 'MANDT expires', kind: DAY },
    { key: 'money_mgt_date', label: 'Money Management date', kind: DAY },
    { key: 'license_exp', label: 'License expires', kind: DAY },
    { key: 'insurance_exp', label: 'Insurance expires', kind: DAY },
    { key: 'sam', label: 'SAM database', kind: DAY },
    { key: 'oig', label: 'OIG exclusions', kind: DAY },
    { key: 'abuser', label: 'Abuser registry', kind: DAY },
    { key: 'sex_offender', label: 'Sex offender registry', kind: DAY },
    { key: 'offender', label: 'Offender registry', kind: DAY },
    { key: 'nurse_aide', label: 'Nurse aide registry', kind: DAY },
    { key: 'exclusions', label: 'Exclusions database', kind: DAY },
    { key: 'bci_check_date', label: 'BCI check date', kind: DAY },
    { key: 'rapback_entry_date', label: 'Rapback entry date', kind: DAY },
  ],
  driving: [
    { key: 'driver', label: 'Driver (employee driver)', kind: 'text', hint: 'As the tab words it: Yes, No, or the licence state.' },
    { key: 'points', label: 'Points', kind: 'text', hint: 'A number, or the words the tab keeps (e.g. CANT CHECK).' },
    { key: 'license_exp', label: 'License expires', kind: DAY },
    { key: 'abstract_original', label: "Driver's abstract (original)", kind: DAY },
    { key: 'abstract_latest', label: "Driver's abstract (latest)", kind: DAY },
    { key: 'insurance_exp', label: 'Insurance expires', kind: DAY },
    { key: 'standing', label: 'License standing (Driver Compliance)', kind: 'text', hint: 'As the tab words it: Valid, Suspended…' },
  ],
  mais: [
    { key: 'status', label: 'Status', kind: 'text', hint: 'As the registry words it.' },
    { key: 'effective', label: 'Effective', kind: DAY },
    { key: 'expires', label: 'Expires', kind: DAY },
  ],
  ist: [
    { key: 'status', label: 'Status', kind: 'select', options: ['owed', 'done'], optionLabels: { owed: 'Owed', done: 'Trained' } },
    { key: 'due', label: 'Due', kind: DAY },
    { key: 'trained_at', label: 'Trained on', kind: DAY },
  ],
  note: [
    { key: 'category', label: 'Category', kind: 'select', options: NOTE_CATEGORIES.map((c) => c.id),
      optionLabels: Object.fromEntries(NOTE_CATEGORIES.map((c) => [c.id, c.label])) },
    { key: 'priority', label: 'Priority', kind: 'select', options: NOTE_PRIORITIES.map((p) => p.id),
      optionLabels: Object.fromEntries(NOTE_PRIORITIES.map((p) => [p.id, p.label])) },
    { key: 'details', label: 'Details', kind: 'textarea', max: 4000 },
  ],
}

const PROTECTED = 'Protected: never written from the Hub.'

/** The fields drawn read-only on each section's panel, with the reason and where they are edited instead. */
export const EDIT_LOCKED: Record<EditSection, { key: string; label: string; lock: EditLock }[]> = {
  profile: [
    { key: 'employee_id', label: 'Employee ID', lock: { why: 'The payroll id: read-only.', door: 'payroll' } },
    { key: 'role', label: 'Role', lock: { why: 'Comes from the employee roster sync, which would overwrite an edit made here.', door: 'the employee roster' } },
  ],
  employment: [],
  hr: [
    { key: 'ssn', label: 'SSN', lock: { why: PROTECTED, door: "the Employee Database's own forms" } },
    { key: 'dob', label: 'Date of birth', lock: { why: PROTECTED, door: "the Employee Database's own forms" } },
    { key: 'dl', label: "Driver's license number", lock: { why: PROTECTED, door: "the Employee Database's own forms" } },
    { key: 'bci_fbi', label: 'BCI / FBI receipt', lock: { why: PROTECTED, door: "the Employee Database's own forms" } },
  ],
  compliance: [
    { key: 'med_dates', label: 'Med Delivery 1–3 and MAIS',
      lock: { why: 'Written by the MAIS registry check, not here.', door: 'Staff Details › Med Del (MAIS)' } },
  ],
  driving: [
    { key: 'dl', label: "Driver's license number", lock: { why: PROTECTED, door: "the Employee Database's own forms" } },
  ],
  mais: [
    { key: 'level', label: 'Cat level', lock: { why: 'The line this panel edits.', door: 'the DODD registry' } },
  ],
  ist: [
    { key: 'client', label: 'Client', lock: { why: 'The pairing this record trains.', door: 'Settings → IST' } },
  ],
  note: [
    { key: 'by', label: 'Filed', lock: { why: 'Who filed the note and when stay as filed; resolving it is on the notes panel.' } },
  ],
}

const ACCOUNT_FIELDS = ['account_phones', 'account_emails', 'avatar', 'login_email']

/** Why an editable field is drawn locked: its store is not read for this person. */
function missingWhy(section: EditSection, key: string): string {
  if (ACCOUNT_FIELDS.includes(key)) return 'No platform account is matched to this person.'
  if (section === 'driving') {
    return key === 'standing' ? `No ${DRIVER_TABS.compliance} row is read for this person.` : `No ${DRIVER_TABS.main} row is read for this person.`
  }
  if (section === 'mais') return 'This MAIS line is not read just now.'
  if (section === 'ist') return 'This IST record is not read just now.'
  if (section === 'note') return 'This note is not read just now.'
  return 'No Employee Database row or column is read for this person.'
}

/** The driving record's edit values: the employee driver tab's facts and Driver Compliance's word, as the read shows them. */
function drivingEdit(d: StaffDriving | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!d) return out
  if (d.found && !d.ambiguous && d.source === DRIVER_TABS.main && !d.unread.includes(DRIVER_TABS.main)) {
    out.driver = d.driverWord
    out.points = d.points !== null ? String(d.points) : d.pointsNote
    out.license_exp = d.licenseExpires
    out.abstract_original = d.abstractOriginal
    out.abstract_latest = d.abstractLatest
    out.insurance_exp = d.insuranceExpires
  }
  if (!d.standingAmbiguous && d.standing?.source === DRIVER_TABS.compliance) out.standing = d.standing.word
  return out
}

/** One section's edit panel: the raw values the read handed over, and what the locked fields show. */
export type StaffEditView = { edit: Record<string, string>; locked: Record<string, string> }

/** What HR Admin shows of each field an edition opens there (StaffProfiles.gs spHrBuild_, app/staff.py hr_shown). */
export function hrShownOf(h: StaffHr): Record<string, string> {
  const hr = new Set(EDIT_FIELDS.hr.map((f) => f.key))
  const screens = Object.fromEntries(h.screening.filter((s) => hr.has(s.id)).map((s) => [s.id, s.date]))
  return {
    address: h.personal.address, city: h.personal.city, state: h.personal.state, zip: h.personal.zip,
    w4_date: h.personal.w4_date, pay_auth_date: h.personal.pay_auth_date, ...h.work_auth,
    license_exp: h.driver.license_exp, abstract_original: h.driver.abstract_original, abstract_latest: h.driver.abstract_latest,
    insurance_exp: h.driver.insurance_exp, ...screens, bci_check_date: h.bci_check_date, rapback_entry_date: h.rapback_entry_date,
  }
}

// `shown`: a holder's panel, whose HR values are what the audited HR read shows (its raw cells are the master's alone).
export function staffEditViewOf(section: EditSection, raw: unknown, id = '', shown = false): StaffEditView {
  const edit = editRawOf(rec(raw).edit)
  if (section === 'note') {
    const n = notesOf(raw).notes.find((x) => x.id === id)
    return {
      edit: n ? { category: n.category, priority: n.priority, details: n.details } : {},
      locked: { by: n ? [n.by, stampWords(n.at)].filter(Boolean).join(' · ') : '' },
    }
  }
  if (section === 'driving') {
    const d = overviewOf(raw).driving
    return { edit: drivingEdit(d), locked: { dl: d?.dlLast4 ? `•••• ${d.dlLast4}` : '' } }
  }
  if (section === 'mais') {
    const m = overviewOf(raw).medDel
    const c = m && !m.ambiguous ? m.certs.find((x) => x.level === id) : undefined
    return { edit: c ? { status: c.word, effective: c.effective, expires: c.expires } : {}, locked: { level: id } }
  }
  if (section === 'ist') {
    const r = overviewOf(raw).ist.find((x) => x.id === id)
    return {
      edit: r ? { status: r.status, due: r.due, trained_at: r.trained_at } : {},
      locked: { client: r ? [r.client_name || r.client_key, r.house].filter(Boolean).join(' · ') : '' },
    }
  }
  if (section === 'profile') {
    const p = overviewOf(raw).person
    return { edit, locked: { employee_id: p.employee_id, role: p.role, first_name: p.first_name, last_name: p.last_name,
      status: STATUS_META[p.status]?.label ?? '' } }
  }
  if (section === 'hr') {
    const h = hrOf(raw)
    const bci = h.screening.find((s) => s.id === 'bci_fbi')
    return { edit: shown ? hrShownOf(h) : edit,
      locked: { ssn: h.personal.ssn_masked, dob: dateWords(h.personal.dob), dl: h.driver.license_masked, bci_fbi: bci?.refMasked ?? '' } }
  }
  return { edit, locked: {} }
}

/** The fields a holder of an edition sees locked with their own reason; any other field outside their editions is not drawn. */
const MASTER_ONLY: Readonly<Record<string, string>> = {
  first_name: 'A rename re-keys the staff record: the master files it.',
  last_name: 'A rename re-keys the staff record: the master files it.',
  status: 'The status is changed by the master alone.',
  login_email: 'The sign-in e-mail is changed by the master alone.',
}

// The panel's fields: each editable one with its raw value, or locked with why when its store is not read; `open`, a…
export function staffEditFields(section: EditSection, view: StaffEditView, open: ReadonlySet<string> | null = null): EditField[] {
  const locked = EDIT_LOCKED[section].map((l) => ({ key: l.key, label: l.label, kind: 'text' as const, raw: view.locked[l.key] ?? '', lockedBy: l.lock }))
  const own = (s: EditSpec): EditField[] => {
    if (open && !open.has(s.key)) return MASTER_ONLY[s.key] ? [{ ...s, raw: view.locked[s.key] ?? '', lockedBy: { why: MASTER_ONLY[s.key] } }] : []
    if (s.key in view.edit) return [{ ...s, raw: view.edit[s.key] }]
    return [{ ...s, raw: '', lockedBy: { why: missingWhy(section, s.key) } }]
  }
  const fields = EDIT_FIELDS[section].flatMap(own)
  return section === 'profile' || LINE_SECTIONS.includes(section) ? [...locked, ...fields] : [...fields, ...locked]
}

/* ---------- the editions (Settings › Editions): what a listed person edits besides the master ---------- */

/** Staff's editions (StaffProfiles.gs SP_EDITION_FIELDS and its doors), in the order Settings lists them. */
export const STAFF_EDITIONS = [
  'staff.profile', 'staff.employment', 'staff.hr', 'staff.compliance', 'staff.hrIssues', 'staff.documentation', 'staff.driving',
  'staff.mais', 'staff.ist', 'staff.preferences', 'staff.notes', 'staff.notesEdit',
] as const
export type StaffEdition = (typeof STAFF_EDITIONS)[number]

/** The editions whose door only Python has: offered as editionsMine names them, the master's too (none on Apps Script). */
export const PYTHON_EDITIONS: readonly StaffEdition[] = ['staff.notesEdit', 'staff.compliance', 'staff.hrIssues', 'staff.documentation']

/** The record fields each edition opens (SP_EDITION_FIELDS); the name, the status and the sign-in e-mail stay the master's. */
export const EDITION_FIELDS: Readonly<Partial<Record<StaffEdition, readonly string[]>>> = {
  'staff.profile': ['phone', 'email', 'account_phones', 'account_emails', 'avatar', 'address', 'city', 'state', 'zip'],
  'staff.employment': EDIT_FIELDS.employment.map((f) => f.key),
  'staff.hr': EDIT_FIELDS.hr.map((f) => f.key).filter((k) => !['address', 'city', 'state', 'zip'].includes(k)),
  'staff.compliance': EDIT_FIELDS.compliance.map((f) => f.key),
}

/** The editions each section's pencil opens: the record's by field, a line's by its own door. */
export const SECTION_EDITIONS: Readonly<Record<EditSection, readonly StaffEdition[]>> = {
  profile: ['staff.profile'], employment: ['staff.employment'], hr: ['staff.profile', 'staff.hr'],
  compliance: ['staff.compliance', 'staff.hr'], driving: ['staff.driving'], mais: ['staff.mais'], ist: ['staff.ist'],
  note: ['staff.notesEdit'],
}

/** editionsMine's answer as Staff keeps it: its own editions, once each, in catalogue order. */
export const staffEditionsOf = (raw: unknown): StaffEdition[] => {
  const list = Array.isArray(raw) ? raw.map((x) => String(x ?? '')) : []
  return STAFF_EDITIONS.filter((e) => list.includes(e))
}

export type StaffViewer = {
  /** the master in its own session: the forms, the note box and the account doors */
  writes: boolean
  /** a client or family viewer: the BASIC profile of the staff their houses see, and nothing else */
  basic: boolean
  /** Assign Training on any record ('any'), or only on `selfKey` */
  assign: 'any' | ''
  selfKey: string
  /** the editions editionsMine names for this session (the master holds the others through `writes`) */
  editions?: readonly StaffEdition[]
  /** Compliance documents' review edition: the filed papers' panel, to open a paper and confirm its date */
  review?: boolean
  /** the split tabs App Control's own rows keep from this viewer (STAFF_TAB_FEATURES), and with them their panels */
  shut?: readonly SplitTab[]
}

export const WHOLE_VIEWER: StaffViewer = { writes: true, basic: false, assign: 'any', selfKey: '' }

// The editions that live in a split tab: a holder keeps the tab, since an edition only ever adds people (app/staff.py
// HR_EDITIONS, PERF_EDITIONS)
const TAB_EDITIONS: Readonly<Partial<Record<SplitTab, readonly StaffEdition[]>>> = {
  hr: ['staff.hr'], performance: ['staff.hrIssues', 'staff.documentation'],
}

// The panels that are a split tab's own: shut with it
const TAB_ASKS: Readonly<Record<SplitTab, readonly StaffAsk['kind'][]>> = {
  performance: [], hr: ['invite', 'access', 'reset'], pay: ['loan', 'payment'], activity: ['transcript'],
}

/** `shut`: the split tabs whose App Control row is shut to this session (shutTabsOf); the master is never narrowed. */
export function viewerOf(isMaster: boolean, view: RosterView | undefined, may?: RosterMay, editions?: readonly StaffEdition[],
  review = false, shut: readonly SplitTab[] = []): StaffViewer {
  const basic = view === 'basic'
  const held = basic ? [] : [...(editions ?? [])]
  const cut = isMaster || basic ? [] : shut.filter((t) => !(TAB_EDITIONS[t] ?? []).some((e) => held.includes(e)))
  return { writes: isMaster && !basic, basic, assign: basic ? '' : (may?.assign ?? ''), selfKey: basic ? '' : (may?.selfKey ?? ''),
    ...(held.length ? { editions: held } : {}), ...(review && !basic ? { review: true } : {}), ...(cut.length ? { shut: cut } : {}) }
}

/** Does this viewer make the edition? The master always (a Python-only one as editionsMine names it); a holder its own. */
export const staffCan = (viewer: StaffViewer, edition: StaffEdition): boolean =>
  !viewer.basic && ((viewer.writes && !PYTHON_EDITIONS.includes(edition)) || (viewer.editions ?? []).includes(edition))

// Whether this viewer opens a section's edit panel: a holder's HR panel opens on what the audited HR read shows.
export const mayEditSection = (viewer: StaffViewer, section: EditSection): boolean =>
  (SECTION_EDITIONS[section] ?? []).some((e) => staffCan(viewer, e))

/** The record fields this viewer writes: null for the master (every one), else its editions' own. */
export function editOpenFor(viewer: StaffViewer): ReadonlySet<string> | null {
  if (viewer.writes) return null
  return new Set(STAFF_EDITIONS.filter((e) => staffCan(viewer, e)).flatMap((e) => EDITION_FIELDS[e] ?? []))
}

/** Whether this viewer may open `kind` on the staff record `staffKey`. */
export function mayAsk(viewer: StaffViewer, kind: StaffAsk['kind'], staffKey: string): boolean {
  if (viewer.basic) return kind === 'share'
  if ((viewer.shut ?? []).some((t) => TAB_ASKS[t].includes(kind))) return false
  if (kind === 'assign') return viewer.writes || viewer.assign === 'any' || (!!viewer.selfKey && viewer.selfKey === staffKey)
  if (kind === 'note') return staffCan(viewer, 'staff.notes')
  if (kind === 'edit') return EDIT_SECTIONS.some((s) => mayEditSection(viewer, s))
  if (kind === 'filedoc') return viewer.writes || viewer.review === true
  // a person's own papers are theirs to file; anyone else's, a writer's or a reviewer's (certDocUpload decides again)
  if (kind === 'docupload') return viewer.writes || viewer.review === true || (!!viewer.selfKey && viewer.selfKey === staffKey)
  if (kind === 'hrissue') return viewer.writes || staffCan(viewer, 'staff.hrIssues')
  if (kind === 'docmark') return staffCan(viewer, 'staff.documentation')
  if (kind === 'istadd') return staffCan(viewer, 'staff.ist')
  return viewer.writes || !WRITE_ASKS.includes(kind)
}

export function tabsFor(viewer: StaffViewer): (typeof STAFF_TABS)[number][] {
  if (viewer.basic) return STAFF_TABS.filter((t) => t.id === 'profile')
  const shut: readonly StaffTab[] = viewer.shut ?? []
  return STAFF_TABS.filter((t) => !shut.includes(t.id))
}

/** The tab the address names, when this viewer is offered it; Staff Profile otherwise. */
export const tabShown = (viewer: StaffViewer, tab: StaffTab): StaffTab =>
  tabsFor(viewer).some((t) => t.id === tab) ? tab : 'profile'

/** The panel this viewer may open on `staffKey`: a basic viewer only Share, a viewer who writes nothing no form. */
export function askFor(ask: StaffAsk | null, viewer: StaffViewer, staffKey = ''): StaffAsk | null {
  if (!ask) return null
  if (ask.kind === 'edit' && !mayEditSection(viewer, ask.section)) return null
  // HR Admin's pencil reads the HR record, which a shut HR Admin is not handed
  if (ask.kind === 'edit' && ask.section === 'hr' && (viewer.shut ?? []).includes('hr')) return null
  return mayAsk(viewer, ask.kind, staffKey) ? ask : null
}

// The Actions menu this viewer is offered on `staffKey`: without writes, the doors its rules open (Add Payment…
export function actionGroupsFor(viewer: StaffViewer, staffKey = ''): typeof ACTION_GROUPS {
  if (viewer.writes && !viewer.basic) return ACTION_GROUPS
  return ACTION_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !('ask' in i) || mayAsk(viewer, i.ask.kind, staffKey)) }))
    .filter((g) => g.items.length > 0)
}

/* ---------- a read the server did not answer ---------- */

export const NOT_PUBLISHED = 'This part is not open to you.'

/** A refusal: the app's own "Unknown action.", or a door that is not this account's. */
export function isRefusal(error: string): boolean {
  return /unknown action|^requires an admin|^this action is for/i.test(str(error))
}

/** A refusal as a sentence; any other failure keeps its own words. */
export function readRefusal(error: string): string {
  if (isRefusal(error)) return NOT_PUBLISHED
  return error || 'The read did not answer.'
}
