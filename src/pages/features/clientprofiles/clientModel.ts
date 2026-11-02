// CLIENTS — the shapes ClientProfiles.gs answers and the arithmetic the screen does on them.
// Pure: the page and the tests import the same code.
import { format } from 'date-fns'
import { ohioWall } from '@/lib/ohio'
import { splitCategories } from '@/lib/incidentCategories'
import type { EditionId } from '@/lib/editions'
import { editRawOf, type EditField, type EditLock } from '@/lib/recordEdit'
import type { SharePayload } from '@/stores/useShareStore'
import { clientCan, unknownActionWords, viewerOf, type ClientReader, type ClientViewer } from './clientViewer'

/* ---------- small readers ---------- */

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const str = (v: unknown): string => (v == null ? '' : String(v).trim())
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,$\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
const bool = (v: unknown): boolean => v === true || str(v).toLowerCase() === 'true'
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])
function rowsIn(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw
  const o = rec(raw)
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[]
  return []
}

/** A name folded the way Apps Script folds it (clientNameKey_): lower case, letters and digits only. */
export const nameKey = (v: unknown): string => str(v).toLowerCase().replace(/[^a-z0-9]+/g, '')

/** clientLive_: a client is live when not archived and its status is blank or 'active'. */
export const clientLive = (c: { status?: unknown; archived?: unknown }): boolean => {
  if (bool(c.archived)) return false
  const s = str(c.status).toLowerCase()
  return !s || s === 'active'
}

export const NOT_ON_FILE = 'Not on file'
export const NOT_APPLICABLE = 'Not Applicable'

/** A cell (or a " · " part of one) that says n/a, N/A or na is drawn as Not Applicable; the stored value is never changed. */
export const isNotApplicable = (v: string): boolean => /^(n\s*\/\s*a\.?|na|n\.a\.?)$/i.test(v.trim())
export const shownValue = (v: string): string =>
  v.split(' · ').map((part) => (isNotApplicable(part) ? NOT_APPLICABLE : part)).join(' · ')

/** A guardian cell that names the client themself. */
export const isSelfGuardian = (name: string): boolean => name.trim().toLowerCase() === 'self'

/* ---------- the sections and the address ---------- */

export const CLIENT_TABS = [
  { id: 'profile', label: 'Client Profile' },
  { id: 'care', label: 'Care & Support' },
  { id: 'medication', label: 'Medication' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'transportation', label: 'Transportation' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'funds', label: 'Client Funds' },
  { id: 'billing', label: 'Billing' },
  { id: 'activity', label: 'Activity' },
] as const

export type ClientTab = (typeof CLIENT_TABS)[number]['id']

export function tabOf(v: string | null | undefined): ClientTab {
  const hit = CLIENT_TABS.find((t) => t.id === v)
  return hit ? hit.id : 'profile'
}

export const tabLabel = (tab: ClientTab): string => CLIENT_TABS.find((t) => t.id === tab)?.label ?? 'Client Profile'

/** Each section's own tabs; the first is its default. */
export const SECTION_VIEWS = {
  care: [
    { id: 'team', label: 'Care team' },
    { id: 'daily', label: 'Daily care' },
    { id: 'health', label: 'Health & behavior' },
    { id: 'goals', label: 'Personal goals' },
    { id: 'home', label: 'Home & equipment' },
    // the plans read last, after the day-to-day
    { id: 'plans', label: 'Care plans' },
  ],
  medication: [
    { id: 'meds', label: 'Medications' },
    { id: 'admin', label: 'Administration' },
    { id: 'refills', label: 'Refills' },
  ],
  transportation: [
    { id: 'calendar', label: 'Calendar' },
    { id: 'history', label: 'History' },
    { id: 'vehicles', label: 'Vehicles' },
  ],
  funds: [
    { id: 'balances', label: 'Balances' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'receipts', label: 'Receipts' },
  ],
  billing: [
    { id: 'authorizations', label: 'Authorizations' },
    { id: 'claims', label: 'Claims' },
  ],
} as const satisfies Partial<Record<ClientTab, readonly { id: string; label: string }[]>>

export type ViewedTab = keyof typeof SECTION_VIEWS
export type CareView = (typeof SECTION_VIEWS.care)[number]['id']
export type MedView = (typeof SECTION_VIEWS.medication)[number]['id']
export type TransportView = (typeof SECTION_VIEWS.transportation)[number]['id']
export type FundsView = (typeof SECTION_VIEWS.funds)[number]['id']
export type BillingView = (typeof SECTION_VIEWS.billing)[number]['id']

const hasViews = (tab: ClientTab): tab is ViewedTab => tab in SECTION_VIEWS

/** The section's own tab the address names, else its first; '' for a section with none. */
export function viewOf(tab: ClientTab, v: string | null | undefined): string {
  if (!hasViews(tab)) return ''
  const list: readonly { id: string }[] = SECTION_VIEWS[tab]
  return list.find((x) => x.id === v)?.id ?? list[0].id
}

export function viewLabel(tab: ClientTab, view: string): string {
  if (!hasViews(tab)) return ''
  const list: readonly { id: string; label: string }[] = SECTION_VIEWS[tab]
  return list.find((x) => x.id === view)?.label ?? ''
}

export const CLIENTS_PATH = '/app/client-profiles/profile'

export type ToolId = 'users-clients' | 'users-guardians' | 'guardians-roster' | 'read-plans'
export const TOOL_IDS: ToolId[] = ['users-clients', 'users-guardians', 'guardians-roster', 'read-plans']

// What the one right panel holds.
export type ClientAsk =
  | { kind: 'share' }
  | { kind: 'edit-profile' }
  | { kind: 'add-client' }
  | { kind: 'create-user'; who: 'client' | 'guardian' }
  | { kind: 'tool'; tool: ToolId }
  | { kind: 'add-medication' }
  | { kind: 'add-authorization' }
  | { kind: 'new-incident' }
  | { kind: 'record'; section: 'care' | 'medication'; view: string; id: string; edit?: boolean }
  /** a family member corrected, hidden or added ('new') over the plan's list (clientProfileOverride) */
  | { kind: 'family-edit'; id: string }
  /** a care row the Hub adds to a Care & Support tab (clientProfileOverride) */
  | { kind: 'care-add'; view: string }
  | { kind: 'activity'; id: string }
  | { kind: 'incident'; id: string }
  | { kind: 'source'; value: string }
  /** an address in Client details: its group's details over the address's map */
  | { kind: 'address'; group: AddressGroup }

const SEP = '~'
const PLAIN = ['share', 'edit-profile', 'add-client', 'add-medication', 'add-authorization', 'new-incident'] as const
const BY_ID = ['activity', 'incident'] as const
const SOURCE = 'src'

export function panelParam(ask: ClientAsk | null): string {
  if (!ask) return ''
  switch (ask.kind) {
    case 'share': case 'edit-profile': case 'add-client': case 'add-medication': case 'add-authorization': case 'new-incident':
      return ask.kind
    case 'create-user': return ['create-user', ask.who].join(SEP)
    case 'tool': return ['tool', ask.tool].join(SEP)
    case 'record': return ['record', ask.section, ask.view, ask.id].join(SEP)
    case 'family-edit': return ['family-edit', ask.id].join(SEP)
    case 'care-add': return ['care-add', ask.view].join(SEP)
    case 'address': return ['address', ask.group].join(SEP)
    case 'source': return ask.value ? [SOURCE, ask.value].join(SEP) : ''
    default: return [ask.kind, ask.id].join(SEP)
  }
}

export function panelOf(v: string | null | undefined): ClientAsk | null {
  const [kind = '', a = '', b = '', ...rest] = str(v).split(SEP)
  if ((PLAIN as readonly string[]).includes(kind)) return { kind: kind as (typeof PLAIN)[number] }
  if ((BY_ID as readonly string[]).includes(kind)) return a ? { kind: kind as (typeof BY_ID)[number], id: a } : null
  switch (kind) {
    case 'create-user': return a === 'client' || a === 'guardian' ? { kind, who: a } : null
    case 'tool': return (TOOL_IDS as string[]).includes(a) ? { kind, tool: a as ToolId } : null
    case 'family-edit': {
      const id = [a, b, ...rest].filter(Boolean).join(SEP)
      return id ? { kind, id } : null
    }
    case 'care-add': return (CARE_EDIT_VIEWS as readonly string[]).includes(a) ? { kind, view: a } : null
    case 'address': return (ADDRESS_GROUPS as readonly string[]).includes(a) && !b ? { kind, group: a as AddressGroup } : null
    case 'record': {
      const id = rest.join(SEP)
      if (!id) return null
      if (a === 'care' && viewOf('care', b) === b) return { kind, section: a, view: b, id }
      if (a === 'medication' && b === 'meds') return { kind, section: a, view: b, id }
      return null
    }
    case SOURCE: {
      const value = str(v).slice(SOURCE.length + SEP.length)
      return value ? { kind: 'source', value } : null
    }
    default: return null
  }
}

/** The panel's modes that file something or run Client management: the master's own session's alone. */
export const WRITE_ASKS: readonly ClientAsk['kind'][] = [
  'edit-profile', 'add-client', 'create-user', 'tool', 'add-medication', 'add-authorization', 'new-incident',
  'family-edit', 'care-add',
]

export const isWriteAsk = (ask: ClientAsk): boolean => WRITE_ASKS.includes(ask.kind)

/** The write panels an edition opens to its holder (Settings › Editions); every other write is the master's alone. */
export const ASK_EDITION: Readonly<Partial<Record<ClientAsk['kind'], EditionId>>> = {
  'edit-profile': 'clients.profile', 'care-add': 'clients.care', 'family-edit': 'clients.family',
  'add-medication': 'clients.medication', 'new-incident': 'clients.incidents',
}

/** May this reader open the panel? Every read; a write the master's, or its edition's holder's. */
export function mayOpenAsk(r: ClientReader, ask: ClientAsk): boolean {
  if (!isWriteAsk(ask) || r.mayWrite) return true
  const edition = ASK_EDITION[ask.kind]
  return !!edition && clientCan(r, edition)
}

/** The panel a section read from its own app holds, as that section's own parameter; null for any other panel. */
export const sourcePanelOf = (ask: ClientAsk | null): string | null => (ask?.kind === 'source' ? ask.value : null)

/** `?client=…&tab=…&view=…&panel=…` — the whole state of the screen. */
export function clientQuery(client: string, tab: ClientTab, view = '', panel: ClientAsk | null = null): string {
  const p = new URLSearchParams()
  if (client) p.set('client', client)
  if (tab !== 'profile') p.set('tab', tab)
  if (view && hasViews(tab) && view !== SECTION_VIEWS[tab][0].id) p.set('view', view)
  const pp = panelParam(panel)
  if (pp) p.set('panel', pp)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const clientHref = (client: string, tab: ClientTab = 'profile', view = ''): string =>
  `${CLIENTS_PATH}${clientQuery(client, tab, view)}`

/* ---------- days and times ---------- */

/** A typed M/D/YYYY stays as typed; a bare day is read as itself; an ISO stamp is read on Ohio's clock. */
export function dayOf(v: string): Date | null {
  const s = str(v)
  if (!s) return null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s)
  if (m) {
    const year = Number(m[3]) < 100 ? Number(m[3]) + 2000 : Number(m[3])
    const d = new Date(year, Number(m[1]) - 1, Number(m[2]), 12)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return ohioWall(s)
}

/** 'Sep 24, 2026'; '' for anything that is not a day. */
export function dayLabel(v: string): string {
  const d = dayOf(v)
  return d ? format(d, 'MMM d, yyyy') : ''
}

/** A clock as the answer wrote it once it reads as one; the 1899 carrier of an unformatted time cell is blank. */
export function clockLabel(v: string): string {
  const s = str(v)
  if (!s) return ''
  if (/^\d{1,2}:\d{2}/.test(s) || /^\d{1,2}(:\d{2})?\s*[ap]\.?m\.?$/i.test(s)) return s
  if (s.startsWith('1899-')) return ''
  const d = ohioWall(s)
  return d ? format(d, 'h:mm a') : s
}

/** The Ohio clock of a stamp that carries a time; '' for a bare day. */
export function ohioClockOf(v: string): string {
  const s = str(v)
  if (!/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return ''
  const d = ohioWall(s)
  return d ? format(d, 'h:mm a') : ''
}

export const countLabel = (n: number | null): string => (n === null ? '—' : n.toLocaleString('en-US'))

/* ---------- the roster and the switcher ---------- */

export type RosterRow = {
  client_key: string
  /** clientsDerived_'s row id — what clientUserCreate names a client by; '' when the answer did not carry it */
  client_id: string
  name: string
  status: 'active' | 'inactive'
  house: string
  avatar: string
  isp_year: string
  /** a client who is their own guardian: their own e-mail (clientProfileRoster), drawn as the guardian's */
  self_email?: string
}

/** `viewer`: who the doors read this account as (clientViewer.ts); '' for a roster from the slices. */
export type Roster = { clients: RosterRow[]; inactiveWhy: string; viewer: ClientViewer }

function rosterRowOf(v: unknown): RosterRow {
  const o = rec(v)
  const name = str(o.name)
  return {
    client_key: str(o.client_key) || nameKey(name),
    client_id: str(o.client_id ?? o.id),
    name,
    status: str(o.status).toLowerCase() === 'inactive' ? 'inactive' : 'active',
    house: str(o.house),
    avatar: str(o.avatar),
    isp_year: str(o.isp_year),
    ...(str(o.self_email) ? { self_email: str(o.self_email) } : {}),
  }
}

/** clientProfileRoster's answer: { clients, inactive_why, viewer }. */
export function rosterOf(raw: unknown): Roster {
  const seen = new Set<string>()
  const clients = rowsIn(raw, 'clients', 'rows').map(rosterRowOf).filter((c) => {
    if (!c.name || !c.client_key || seen.has(c.client_key)) return false
    seen.add(c.client_key)
    return true
  })
  return { clients, inactiveWhy: str(rec(raw).inactive_why), viewer: viewerOf(rec(raw).viewer) }
}

const byName = (a: RosterRow, b: RosterRow) => a.name.localeCompare(b.name)

/** The switcher's list: the active clients by name, then the inactive ones when asked; the search matches the name. */
export function switcherClients(rows: RosterRow[], query: string, showInactive: boolean): RosterRow[] {
  const q = query.trim().toLowerCase()
  const hit = (c: RosterRow) => !q || c.name.toLowerCase().includes(q) || c.house.toLowerCase().includes(q)
  const active = rows.filter((c) => c.status === 'active' && hit(c)).sort(byName)
  if (!showInactive) return active
  return [...active, ...rows.filter((c) => c.status === 'inactive' && hit(c)).sort(byName)]
}

/** The client the screen opens on when the address names none: the first active one by name. */
export function defaultClient(rows: RosterRow[]): RosterRow | null {
  return switcherClients(rows, '', false)[0] ?? [...rows].sort(byName)[0] ?? null
}

/** The client an address names: its key, else its folded name. Never a near match. */
export function resolveClient(want: string, rows: RosterRow[]): RosterRow | null {
  const w = str(want)
  if (!w) return null
  return rows.find((c) => c.client_key === w) ?? rows.find((c) => nameKey(c.name) === nameKey(w)) ?? null
}

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((p) => p[0]?.toUpperCase() ?? '').join('').slice(0, 3)
}

/* ---------- client profile ---------- */

export type FamilyMember = {
  name: string; relationship: string; phone: string; email: string; person_id: string; avatar: string
  /** the member's handle for clientProfileOverride, and its raw values; absent when the read sent none */
  key?: string
  edit?: Record<string, string>
}

export type Profile = {
  /** `email`: the client's own, as the plan holds it ('' when the answer did not carry it) */
  client: RosterRow & { client_number: string; initials: string; dob: string; age: number | null; email: string }
  identity: { ssn_last4: string | null; ssn_on_file: boolean; medicaid_id: string }
  home: { house_code: string; house_label: string; home_address: string; house_manager: string; house_manager_phone: string; house_manager_email: string }
  guardian: {
    name: string; person_id: string; relationship: string; email: string; address: string; phone: string
    ssa_name: string; ssa_person_id: string; ssa_email: string; ssa_phone: string
  }
  services: {
    outcome: string; ama_date: string; isp_year: string; isp_file_id: string; start_date: string; self_admin_assessment: string
    self_admin_expires: string; media_release: string; medical_supply: string; truelink_consent: string; guardianship_papers: string
  }
  day: { workshop: string; workshop_phone: string; workshop_address: string; transportation: string; transportation_phone: string }
  financial: {
    payee_rep: string; payee_rep_phone: string; payee_rep_email: string; tl_card_last4: string | null
    dc_exp_on_file: boolean; dc_security_code_on_file: boolean; dc_pin_on_file: boolean; food_stamp: string; spending_limit: string
  }
  family: FamilyMember[]
  /** each edit field's raw value as the door witnesses it (clientProfileSave `changes`) */
  edit: Record<string, string>
  /** the Locations homes the house is chosen from */
  houses: { code: string; name: string }[]
  degraded: boolean
  why: string
}

/** Exactly four digits, or null: anything longer is never drawn, whatever the answer carried. */
export function lastFour(v: unknown): string | null {
  const s = str(v)
  return /^\d{4}$/.test(s) ? s : null
}

const pick = <K extends string>(o: Rec, keys: readonly K[]): Record<K, string> => {
  const out = {} as Record<K, string>
  for (const k of keys) out[k] = str(o[k])
  return out
}

/** clientProfileDetails's answer. */
export function profileOf(raw: unknown): Profile {
  const o = rec(raw)
  const c = rec(o.client)
  const base = rosterRowOf(c)
  const id = rec(o.identity)
  const fin = rec(o.financial)
  const g = rec(o.guardian)
  return {
    client: { ...base, client_number: str(c.client_number), initials: str(c.initials) || initialsOf(base.name), dob: str(c.dob), age: num(c.age), email: str(c.email) },
    identity: { ssn_last4: lastFour(id.ssn_last4), ssn_on_file: bool(id.ssn_on_file) || !!lastFour(id.ssn_last4), medicaid_id: str(id.medicaid_id) },
    home: pick(rec(o.home), ['house_code', 'house_label', 'home_address', 'house_manager', 'house_manager_phone', 'house_manager_email'] as const),
    guardian: pick(g, ['name', 'person_id', 'relationship', 'email', 'address', 'phone', 'ssa_name', 'ssa_person_id', 'ssa_email', 'ssa_phone'] as const),
    services: pick(rec(o.services), ['outcome', 'ama_date', 'isp_year', 'isp_file_id', 'start_date', 'self_admin_assessment',
      'self_admin_expires', 'media_release', 'medical_supply', 'truelink_consent', 'guardianship_papers'] as const),
    day: pick(rec(o.day), ['workshop', 'workshop_phone', 'workshop_address', 'transportation', 'transportation_phone'] as const),
    financial: {
      ...pick(fin, ['payee_rep', 'payee_rep_phone', 'payee_rep_email', 'food_stamp', 'spending_limit'] as const),
      tl_card_last4: lastFour(fin.tl_card_last4),
      dc_exp_on_file: bool(fin.dc_exp_on_file),
      dc_security_code_on_file: bool(fin.dc_security_code_on_file),
      dc_pin_on_file: bool(fin.dc_pin_on_file),
    },
    family: rowsIn(o.family).map((f): FamilyMember => {
      const x = rec(f)
      const edit = editRawOf(x.edit)
      return { name: str(x.name), relationship: str(x.relationship), phone: str(x.phone), email: str(x.email),
        person_id: str(x.person_id), avatar: str(x.avatar),
        ...(str(x.key) && Object.keys(edit).length ? { key: str(x.key), edit } : {}) }
    }).filter((f) => f.name),
    edit: editRawOf(o.edit),
    houses: rowsIn(o.houses).map((h) => ({ code: str(rec(h).code), name: str(rec(h).name) || str(rec(h).code) })).filter((h) => h.code),
    degraded: bool(o.degraded),
    why: str(o.why),
  }
}

/** The masks the screen draws: the last four when sent, dots when only "on file", else null (drawn "Not on file"). */
export function ssnMask(identity: Profile['identity']): string | null {
  if (identity.ssn_last4) return `•••-••-${identity.ssn_last4}`
  return identity.ssn_on_file ? '•••-••-••••' : null
}
export const cardMask = (last4: string | null): string | null => (last4 ? `•••• •••• •••• ${last4}` : null)
export const onFileMask = (onFile: boolean, dots: string): string | null => (onFile ? dots : null)

/** The age the answer gave, else counted from the birthdate on Ohio's today. */
export function ageOf(dob: string, age: number | null, today: string): number | null {
  if (age !== null) return age
  const d = dayOf(dob)
  const t = dayOf(today)
  if (!d || !t) return null
  let years = t.getFullYear() - d.getFullYear()
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) years--
  return years >= 0 && years < 130 ? years : null
}

export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`
export const mailHref = (email: string): string => `mailto:${email}`
export const personHref = (personId: string): string => `/app/people/directory?record=${encodeURIComponent(personId)}`
export const houseHref = (code: string): string => `/app/locations/overview?house=${encodeURIComponent(code)}`

/** The profile's groups, as drawn. */
export type ProfileGroup = 'identity' | 'home' | 'guardian' | 'services' | 'day' | 'financial'

export const PROFILE_GROUPS: { id: ProfileGroup; label: string }[] = [
  { id: 'identity', label: 'Identity & eligibility' },
  { id: 'home', label: 'Home & house contacts' },
  { id: 'guardian', label: 'Guardian & SSA' },
  { id: 'services', label: 'Services, plans & consents' },
  { id: 'day', label: 'Day services & transportation' },
  { id: 'financial', label: 'Financial & benefits' },
]

/** The groups that hold an address, each opening its own panel. */
export type AddressGroup = Extract<ProfileGroup, 'home' | 'guardian' | 'day'>
export const ADDRESS_GROUPS: readonly AddressGroup[] = ['home', 'guardian', 'day']

/** A group's address and whose it is: the house, the guardian (the client when Self), the workshop. */
export function addressOf(p: Profile, client: RosterRow, group: AddressGroup): { address: string; whose: string } {
  const clientName = p.client.name || client.name
  if (group === 'guardian') {
    return { address: p.guardian.address, whose: isSelfGuardian(p.guardian.name) ? clientName : p.guardian.name || 'Guardian' }
  }
  if (group === 'day') return { address: p.day.workshop_address, whose: p.day.workshop || 'Workshop' }
  return { address: p.home.home_address, whose: p.home.house_label || client.house || clientName }
}

type EditSpec = Omit<EditField, 'raw' | 'lockedBy'>

/** The fields the profile edit writes, in the order drawn; the keys are the door's (ClientProfiles.gs cpEditColumns_). */
export const EDIT_FIELDS: EditSpec[] = [
  { key: 'client_number', label: 'Client #', kind: 'text' },
  { key: 'initials', label: 'Initials', kind: 'text' },
  { key: 'dob', label: 'Birthdate', kind: 'date' },
  { key: 'medicaid_id', label: 'Medicaid #', kind: 'text' },
  { key: 'house', label: 'House', kind: 'select', hint: 'Also moves the client in Locations (the Asa Client Database Master).' },
  { key: 'home_address', label: 'Address', kind: 'text' },
  { key: 'house_manager', label: 'House Manager', kind: 'text' },
  { key: 'house_manager_phone', label: 'House Manager #', kind: 'phone' },
  { key: 'house_manager_email', label: 'House Manager Email', kind: 'email' },
  { key: 'guardian_name', label: 'Guardian', kind: 'text' },
  { key: 'guardian_relationship', label: 'Guardian Relationship', kind: 'text' },
  { key: 'guardian_email', label: 'Guardian Email', kind: 'email' },
  { key: 'guardian_address', label: 'Guardian Address', kind: 'text' },
  { key: 'guardian_phone', label: 'Guardian #', kind: 'phone' },
  { key: 'ssa_name', label: 'SSA', kind: 'text' },
  { key: 'ssa_email', label: 'SSA Email', kind: 'email' },
  { key: 'ssa_phone', label: 'SSA #', kind: 'phone' },
  { key: 'outcome', label: 'Outcome', kind: 'text' },
  { key: 'ama_date', label: 'AMA', kind: 'date' },
  { key: 'isp_signed_date', label: 'ISP Signed', kind: 'date' },
  { key: 'start_date', label: 'Start Date', kind: 'date' },
  { key: 'self_admin_assessment', label: 'Self-Admin Assessment', kind: 'text' },
  { key: 'self_admin_expires', label: 'Self-Admin Expiration Date', kind: 'date' },
  { key: 'media_release', label: 'Media Release', kind: 'text' },
  { key: 'medical_supply', label: 'Medical Supply', kind: 'text' },
  { key: 'truelink_consent', label: 'True Link Consent Form', kind: 'text' },
  { key: 'guardianship_papers', label: 'Guardianship Papers?', kind: 'text' },
  { key: 'workshop', label: 'Workshop', kind: 'text' },
  { key: 'workshop_phone', label: 'Workshop Phone', kind: 'phone' },
  { key: 'workshop_address', label: 'Workshop Address', kind: 'text' },
  { key: 'transportation', label: 'Transportation', kind: 'text' },
  { key: 'transportation_phone', label: 'Transportation - Phone', kind: 'phone' },
  { key: 'payee_rep', label: 'Payee Rep', kind: 'text' },
  { key: 'payee_rep_phone', label: 'Payee Rep #', kind: 'phone' },
  { key: 'payee_rep_email', label: 'Payee Rep Email', kind: 'email' },
  { key: 'food_stamp', label: 'Food Stamp', kind: 'text' },
  { key: 'spending_limit', label: 'Spending Limit', kind: 'text' },
]

const PROTECTED: EditLock = { why: 'Protected: never written from the Hub.', door: "the Asa Client Database's own forms" }
const UNREAD: EditLock = { why: 'The record read did not carry this field; read it again.' }

/** The two fields that file through their own doors: the rename re-keys the client, the status moves its book row. */
export const NAME_FIELD: EditSpec = {
  key: 'name', label: 'Client', kind: 'text',
  hint: 'Renames the client in the Asa Client Database Master and every Hub record that joins them; the eMAR, appointments and incidents books keep the old name until it is changed there.',
}
export const STATUS_FIELD: EditSpec = {
  key: 'status', label: 'Status', kind: 'select', options: ['Active', 'Inactive'],
  hint: 'Inactive moves the client\'s Master row to the archive of old clients; Active moves it back.',
}

/** The name and the status, to a holder of the profile edition: their doors are not part of it. */
export const OWN_DOORS: EditLock = { why: 'A rename and the status file through their own doors, which this edition does not open.' }

/** The panel's fields with no word under them (Settings › My Work keeps the notes to the master): no hint, and a lock
 * that still locks without saying why. */
export const fieldsBare = (fields: EditField[]): EditField[] =>
  fields.map(({ hint: _hint, ...f }) => (f.lockedBy ? { ...f, lockedBy: {} } : f))

/** The SSN, the TL card number, the DC expiry, security code and PIN: saved whole by the master, a Platform Lead or a
 * Director through their own door (clientProfileSecretSet), never shown again. */
export const SECRET_FIELDS = ['ssn', 'tl_card', 'dc_exp', 'dc_security_code', 'dc_pin'] as const
const SECRET_HINT = 'The whole value, saved to the Asa Client Database and the Hub, and never shown again.'

/** Who saves them: the master, a Platform Lead or a Director. */
export const savesSecrets = (u: { isMaster?: boolean; types?: readonly string[] } | null | undefined): boolean =>
  !!u && (u.isMaster === true || (u.types ?? []).some((t) => t === 'PLATFORMLEAD' || t === 'DIRECTOR'))

/** The profile edit panel: name, status and every edit field with its raw value, the masked cells protected —
 * `secrets`: the SSN, the card and its expiry open to be typed whole, their masks in the label. */
export function clientEditFields(p: Profile, renames = true, secrets = false): EditField[] {
  const houses = Object.fromEntries(p.houses.map((h) => [h.code, h.name]))
  const open = EDIT_FIELDS.map((s): EditField => {
    if (!(s.key in p.edit)) return { ...s, raw: '', lockedBy: UNREAD }
    if (s.key !== 'house') return { ...s, raw: p.edit[s.key] }
    if (!p.houses.length) return { ...s, raw: p.edit[s.key], lockedBy: { why: 'The Locations homes list could not be read just now.' } }
    return { ...s, raw: p.edit[s.key], options: p.houses.map((h) => h.code), optionLabels: houses }
  })
  const masked: [string, string, string | null][] = [
    ['ssn', 'SSN', ssnMask(p.identity)],
    ['tl_card', 'TL Debit Card Number', cardMask(p.financial.tl_card_last4)],
    ['dc_exp', 'DC Exp Date', onFileMask(p.financial.dc_exp_on_file, '••/••')],
    ['dc_security_code', 'DC Security Code', onFileMask(p.financial.dc_security_code_on_file, '•••')],
    ['dc_pin', 'DC PIN #', onFileMask(p.financial.dc_pin_on_file, '••••')],
  ]
  const own = [NAME_FIELD, STATUS_FIELD].map((s): EditField => (s.key in p.edit
    ? { ...s, raw: p.edit[s.key], ...(renames ? {} : { lockedBy: OWN_DOORS }) }
    : { ...s, raw: s.key === 'name' ? p.client.name : (p.client.status === 'active' ? 'Active' : 'Inactive'), lockedBy: UNREAD }))
  return [
    ...own,
    ...open,
    ...masked.map(([key, label, shown]): EditField => (secrets && (SECRET_FIELDS as readonly string[]).includes(key)
      ? { key, label: shown ? `${label} · on file ${shown}` : label, kind: 'text', raw: '', hint: SECRET_HINT, max: 40 }
      : { key, label, kind: 'text', raw: shown ?? '', lockedBy: PROTECTED })),
  ]
}

/** The medication edit (emarMedUpdate): the eMAR columns a chart row is corrected in. */
export const MED_EDIT_FIELDS: EditSpec[] = [
  { key: 'name', label: 'Medicine', kind: 'text' },
  { key: 'dose', label: 'Dose', kind: 'text' },
  { key: 'times', label: 'Times', kind: 'text', hint: 'Times of day, separated by spaces — e.g. 08:00 20:00.' },
  { key: 'route', label: 'Type', kind: 'text', hint: 'Tablet, Capsule, Liquid…' },
  { key: 'freq', label: 'Frequency', kind: 'text', hint: 'Daily, PRN…' },
  { key: 'discontinued', label: 'Discontinued', kind: 'select', options: ['Yes'], hint: 'Blank keeps the medicine active.' },
]

export function medEditFields(edit: Record<string, string>): EditField[] {
  return MED_EDIT_FIELDS.map((s): EditField => (s.key in edit
    ? { ...s, raw: edit[s.key] }
    : { ...s, raw: '', lockedBy: { why: 'This chart row carries no id to edit it by.' } }))
}

/* ---------- the Hub's corrections to the plan's family and care rows (clientProfileOverride) ---------- */

/** The family-edit panel's id for a member the Hub adds. */
export const NEW_MEMBER = 'new'

/** The Care & Support tabs whose rows the Hub corrects or adds to. */
export const CARE_EDIT_VIEWS = ['daily', 'health', 'goals', 'home'] as const

const HIDE: EditSpec = { key: 'removed', label: 'Hidden from the profile', kind: 'select', options: ['Yes'],
  hint: 'Yes hides it here; the plan itself is not changed.' }

export const FAMILY_EDIT_FIELDS: EditSpec[] = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'relationship', label: 'Relationship', kind: 'text' },
  { key: 'phone', label: 'Phone', kind: 'phone' },
  { key: 'email', label: 'Email', kind: 'email' },
]

/** A family member's fields on its raw values, or blank ones for a new member (no hide). */
export function familyEditFields(edit: Record<string, string> | null): EditField[] {
  const specs = edit ? [...FAMILY_EDIT_FIELDS, HIDE] : FAMILY_EDIT_FIELDS
  return specs.map((s): EditField => ({ ...s, raw: edit?.[s.key] ?? '' }))
}

/** A care row's title and text (raw: the row as read), or blank ones for a new row (no hide). */
export function careEditFields(row: RecordRow | null): EditField[] {
  const specs: EditSpec[] = [
    { key: 'record', label: 'Title', kind: 'text' },
    { key: 'text', label: 'Text', kind: 'textarea', max: 30000 },
    ...(row ? [HIDE] : []),
  ]
  return specs.map((s): EditField => ({ ...s, raw: !row ? '' : s.key === 'text' ? row.text : (row.edit?.[s.key] ?? '') }))
}

/* ---------- the one table: care, medication, activity ---------- */

export type RecordRow = {
  id: string; record: string; date: string; details: string; status: string; source: string; text: string; file_id: string
  /** the street address a row names (the Home row), drawn as a map link; '' for none */
  address?: string
  /** a medication row's edit fields and raw values (emarMedUpdate); absent when the row cannot be edited */
  edit?: Record<string, string>
}
export type PersonRow = { name: string; relationship: string; phone: string; email: string; avatar: string; person_id: string; source: string }

function recordRowOf(v: unknown, i: number): RecordRow {
  const o = rec(v)
  const edit = editRawOf(o.edit)
  return {
    ...(Object.keys(edit).length ? { edit } : {}),
    id: str(o.id) || `row-${i}`,
    record: str(o.record),
    date: str(o.date),
    details: str(o.details),
    status: str(o.status),
    source: str(o.source),
    text: str(o.text),
    file_id: str(o.file_id),
    address: str(o.address),
  }
}

/** The statuses the answer lists, else the ones its rows carry, in first-seen order. */
function statusesOf(o: Rec, rows: { status: string }[]): string[] {
  const listed = strs(o.statuses)
  if (listed.length) return listed
  return [...new Set(rows.map((r) => r.status).filter(Boolean))]
}

export type CareAnswer = { tab: string; rows: RecordRow[]; people: PersonRow[]; statuses: string[]; absent: string[]; why: string }

/** clientProfileCare's answer: { tab, rows, people?, statuses, absent, why }. */
export function careOf(raw: unknown): CareAnswer {
  const o = rec(raw)
  const rows = rowsIn(o, 'rows').map(recordRowOf).filter((r) => r.record || r.details || r.text)
  const people = rowsIn(o, 'people').map((p) => {
    const x = rec(p)
    return { name: str(x.name), relationship: str(x.relationship), phone: str(x.phone), email: str(x.email), avatar: str(x.avatar),
      person_id: str(x.person_id), source: str(x.source) }
  }).filter((p) => p.name)
  return { tab: str(o.tab), rows, people, statuses: statusesOf(o, rows), absent: strs(o.absent), why: str(o.why) }
}

export type MedsAnswer = { tab: string; rows: RecordRow[]; statuses: string[]; asOf: string; why: string }

/** clientProfileMeds's answer: { tab, rows, statuses, as_of, why }. */
export function medsOf(raw: unknown): MedsAnswer {
  const o = rec(raw)
  const rows = rowsIn(o, 'rows').map(recordRowOf).filter((r) => r.record || r.details)
  return { tab: str(o.tab), rows, statuses: statusesOf(o, rows), asOf: str(o.as_of), why: str(o.why) }
}

/** What a plan may not carry (a care answer's `absent`), as the screen says it: routines, sections and plan fields. */
export const ROUTINE_LABEL: Record<string, string> = {
  morning: 'Morning routine', afternoon: 'Afternoon routine', evening: 'Evening routine', bedtime: 'Bedtime routine',
  overnight: 'Overnight routine', meals: 'Meals', hygiene: 'Hygiene', sleep: 'Sleep', wake: 'Waking up',
  equipment: 'Equipment', outcomes: 'Outcomes & experiences', great_things: 'Great things about me',
  home_needs: 'Community living', services: 'Paid supports', team: 'All team members', important_people: 'Important people',
  personal_care: 'Personal care', mobility: 'Mobility', diet_nutrition: 'Diet & nutrition', communication: 'Communication',
  diagnoses: 'Diagnoses', allergies: 'Allergies', medications: 'Medications in the plan', medical_summary: 'Medical summary',
  safety_risks: 'Safety & risks', behaviors: 'Behavior support', supervision_level: 'Supervision',
  goals_outcomes: 'Goals & outcomes', important_to: 'Important to', important_for: 'Important for',
}
export const routineLabel = (id: string): string => {
  if (ROUTINE_LABEL[id]) return ROUTINE_LABEL[id]
  const s = id.replace(/_/g, ' ')
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** The table's filter: a status ('' is All statuses) and a search over every drawn word. */
export function filterRows<T extends { status: string }>(rows: T[], query: string, status: string, text: (r: T) => string): T[] {
  const q = query.trim().toLowerCase()
  return rows.filter((r) => (!status || r.status === status) && (!q || text(r).toLowerCase().includes(q)))
}

export const recordText = (r: RecordRow): string => [r.record, r.details, r.date, dayLabel(r.date), r.status, r.source].join(' ')

/* ---------- incidents ---------- */

export const INCIDENT_STATUSES = ['Reported', 'Under review', 'Closed'] as const

export type IncidentRow = {
  id: string; incident_ts: string; your_name: string; client_name: string; client_key: string
  incident_category: string; categories: string[]; incident_location: string; house_code: string
  incident_date: string; incident_time: string; incident_reported_date: string; incident_reported_time: string
  employees_involved: string[]; summary_of_incident: string; immediate_action_taken: string
  cause_and_contributing_factors: string; prevention_plan: string; status: string; status_by: string; status_at: string
  /** the sheet's cells as filed, the witnesses Locations' edit panel sends ({} when the answer carries none) */
  row: Record<string, string>
}

export type IncidentsAnswer = { rows: IncidentRow[]; categories: string[]; statuses: string[] }

const INCIDENT_TEXT = ['incident_ts', 'your_name', 'client_name', 'client_key', 'incident_category', 'incident_location', 'house_code',
  'incident_date', 'incident_time', 'incident_reported_date', 'incident_reported_time', 'summary_of_incident', 'immediate_action_taken',
  'cause_and_contributing_factors', 'prevention_plan', 'status_by', 'status_at'] as const

/** clientProfileIncidents' answer: { rows, categories, statuses }; newest first, the default status Reported. */
export function clientIncidentsOf(raw: unknown): IncidentsAnswer {
  const o = rec(raw)
  const rows = rowsIn(o, 'rows').map((v, i) => {
    const x = rec(v)
    const t = pick(x, INCIDENT_TEXT)
    const emp = Array.isArray(x.employees_involved) ? strs(x.employees_involved)
      : str(x.employees_involved).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
    const cats = strs(x.categories)
    return {
      ...t,
      id: str(x.id) || t.incident_ts || `incident-${i}`,
      categories: cats.length ? cats : splitCategories(t.incident_category),
      employees_involved: emp,
      status: str(x.status) || 'Reported',
      row: Object.fromEntries(Object.entries(rec(x.row)).map(([k, v]) => [k, str(v)])),
    }
  }).sort((a, b) => (dayOf(b.incident_date)?.getTime() ?? 0) - (dayOf(a.incident_date)?.getTime() ?? 0))
  const listed = strs(o.statuses)
  return { rows, categories: strs(o.categories), statuses: listed.length ? listed : [...INCIDENT_STATUSES] }
}

export const incidentText = (r: IncidentRow): string =>
  [r.your_name, r.client_name, r.categories.join(' '), r.incident_location, dayLabel(r.incident_date), r.status,
    r.employees_involved.join(' '), r.summary_of_incident].join(' ')

/* ---------- activity ---------- */

/** The kinds ClientProfiles.gs assembles, as its rows' status names them. */
export const ACTIVITY_KINDS: Record<string, string> = {
  daily_note: 'Daily note', client_note: 'Client note', house_note: 'House note', incident: 'Incident', visit: 'Doctor visit',
  med_added: 'Medication added', med_stopped: 'Medication discontinued',
}
export const activityKindLabel = (k: string): string => ACTIVITY_KINDS[k] ?? (k ? k.replace(/_/g, ' ') : 'Record')

export type ActivityRow = { id: string; at: string; kind: string; record: string; details: string; text: string; by: string; source: string }
export type ActivityAnswer = { rows: ActivityRow[]; kinds: string[]; counts: Record<string, number>; total: number | null; lastDate: string; why: string }

/** clientProfileActivity's answer: newest first; a row's kind label is drawn in the table's status column. */
export function activityOf(raw: unknown): ActivityAnswer {
  const o = rec(raw)
  const rows = rowsIn(o, 'rows').map((v, i) => {
    const x = rec(v)
    return { id: str(x.id) || `activity-${i}`, at: str(x.date), kind: str(x.kind), record: str(x.record), details: str(x.details),
      text: str(x.text), by: str(x.by), source: str(x.source) }
  }).sort((a, b) => (dayOf(b.at)?.getTime() ?? 0) - (dayOf(a.at)?.getTime() ?? 0))
  const counts: Record<string, number> = {}
  for (const [key, v] of Object.entries(rec(o.counts))) {
    const n = num(v)
    if (n !== null) counts[key] = n
  }
  const kinds = strs(o.kinds)
  return {
    rows, kinds: kinds.length ? kinds : [...new Set(rows.map((r) => activityKindLabel(r.kind)))],
    counts, total: num(o.total), lastDate: str(o.last_date), why: str(o.why),
  }
}

export const activityText = (r: ActivityRow): string => [r.record, r.details, r.by, activityKindLabel(r.kind), dayLabel(r.at)].join(' ')

/* ---------- status pills ---------- */

export type PillTint = 'mint' | 'amber' | 'danger' | 'slate' | 'blue' | 'lavender'

const TINTS: [RegExp, PillTint][] = [
  [/^(current|active|upcoming|scheduled|receipt on file|paid|available|approved)$/i, 'mint'],
  [/^(expired|denied|maintenance|rejected)$/i, 'danger'],
  [/^(needs assignment|missing receipt|under review|renewal due|partly booked|unpaid|pending)$/i, 'amber'],
  [/^(reported|submitted|in progress)$/i, 'blue'],
  [/^(draft)$/i, 'lavender'],
]

export function statusTint(status: string): PillTint {
  for (const [re, tint] of TINTS) if (re.test(status.trim())) return tint
  return 'slate'
}

/* ---------- the panel's heading, and the Actions menu ---------- */

export function panelLabel(ask: ClientAsk): string {
  switch (ask.kind) {
    case 'share': return 'Share'
    case 'edit-profile': return 'Client Profile'
    case 'add-client': case 'create-user': case 'tool': return 'Client management'
    case 'add-medication': return 'Medication'
    case 'add-authorization': return 'Billing'
    case 'new-incident': case 'incident': return 'Incident'
    case 'record': return ask.section === 'care' ? 'Care & Support' : 'Medication'
    case 'family-edit': case 'address': return 'Client Profile'
    case 'care-add': return 'Care & Support'
    case 'activity': return 'Activity'
    case 'source': return 'Clients'
  }
}

export const TOOL_LABEL: Record<ToolId, string> = {
  'users-clients': 'Users for all clients',
  'users-guardians': 'Users for all guardians',
  'guardians-roster': 'Guardians to roster',
  'read-plans': 'Read the plans',
}

export function panelTitle(ask: ClientAsk, clientName: string): string {
  switch (ask.kind) {
    case 'share': return clientName
    case 'edit-profile': return 'Client details'
    case 'add-client': return 'Add client'
    case 'create-user': return ask.who === 'guardian' ? 'Create user guardian' : 'Create user'
    case 'tool': return TOOL_LABEL[ask.tool]
    case 'add-medication': return 'Add medication'
    case 'add-authorization': return 'Add authorization'
    case 'new-incident': return 'New incident'
    case 'record': return viewLabel(ask.section, ask.view) || 'Record'
    case 'family-edit': return ask.id === NEW_MEMBER ? 'Add family member' : 'Family member'
    case 'care-add': return `Add to ${viewLabel('care', ask.view) || 'Care & Support'}`
    case 'activity': return 'Activity record'
    case 'incident': return 'Incident report'
    case 'address': return PROFILE_GROUPS.find((g) => g.id === ask.group)?.label ?? 'Address'
    case 'source': return ''
  }
}

export type ActionItem = { label: string; ask: ClientAsk }
export type ActionGroup = { label: string; items: ActionItem[] }

/** The section's own group first, then Client management (Add client only when it is not already first). */
export function actionGroups(tab: ClientTab, view: string): ActionGroup[] {
  const context: ActionGroup | null =
    tab === 'profile' ? { label: 'Client Profile', items: [{ label: 'Add client', ask: { kind: 'add-client' } }] }
      : tab === 'medication' && view === 'meds' ? { label: 'Medication · Medications', items: [{ label: 'Add medication', ask: { kind: 'add-medication' } }] }
        : tab === 'billing' && view === 'authorizations'
          ? { label: 'Billing · Authorizations', items: [{ label: 'Add authorization', ask: { kind: 'add-authorization' } }] }
          : tab === 'incidents' ? { label: 'Incidents', items: [{ label: 'New incident', ask: { kind: 'new-incident' } }] }
            : null
  const addFirst = context?.items.some((i) => i.ask.kind === 'add-client') ?? false
  const management: ActionItem[] = [
    ...(addFirst ? [] : [{ label: 'Add client', ask: { kind: 'add-client' } as ClientAsk }]),
    { label: 'Create user', ask: { kind: 'create-user', who: 'client' } },
    { label: 'Create user guardian', ask: { kind: 'create-user', who: 'guardian' } },
    ...TOOL_IDS.map((tool) => ({ label: TOOL_LABEL[tool], ask: { kind: 'tool', tool } as ClientAsk })),
  ]
  return [...(context ? [context] : []), { label: 'Client management', items: management }]
}

/* ---------- a read the server did not answer ---------- */

export const NOT_PUBLISHED = 'The server did not recognise this read: Clients answers once the platform release that carries it is live.'

/** A refusal as a sentence. "Unknown action." is a door shut to this account, or to the master a deployment without it. */
export function readRefusal(error: string): string {
  return unknownActionWords(error, NOT_PUBLISHED) ?? (error || 'The read did not answer.')
}

/* ---------- share ---------- */

/** Identity only: the name, the house and the status — nothing clinical rides a share. */
export function sharePayloadFor(client: Pick<RosterRow, 'client_key' | 'name' | 'house' | 'status'>, tab: ClientTab, view = ''): SharePayload {
  const section = [tabLabel(tab), viewLabel(tab, view)].filter(Boolean).join(' · ')
  return {
    title: client.name,
    subtitle: `Clients · ${section}`,
    appHref: clientHref(client.client_key, tab, view),
    text: [client.house ? `House: ${client.house}` : '', `Status: ${client.status === 'inactive' ? 'Inactive' : 'Active'}`].filter(Boolean).join('\n'),
    icon: 'user-round',
    filename: `${client.name} ${tabLabel(tab)}`,
  }
}
