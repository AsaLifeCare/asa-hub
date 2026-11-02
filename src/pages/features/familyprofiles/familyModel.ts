// Families — the shapes FamilyProfiles.gs answers and the arithmetic the screen does on them.
// Pure: the page and the tests import the same code.
import type { SharePayload } from '@/stores/useShareStore'
import { ohioDateTime } from '@/lib/ohio'
import { editRawOf, type EditField, type EditKind, type EditLock } from '@/lib/recordEdit'
import { dayWords } from '@/pages/features/locations/locationModel'
import { CLIENTS_PATH, clientHref, mailHref, nameKey, telHref } from '@/pages/features/clientprofiles/clientModel'
import type { RosterRow as ClientRosterRow } from '@/pages/features/clientprofiles/clientModel'

/* ---------- small readers ---------- */

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const str = (v: unknown): string => (v == null || typeof v === 'object' ? '' : String(v).trim())
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
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
const strings = (v: unknown): string[] => {
  const list = Array.isArray(v) ? v.map(str) : str(v) ? [str(v)] : []
  return [...new Set(list.filter(Boolean))]
}

export { CLIENTS_PATH, nameKey, clientHref, mailHref, telHref }

export const NOT_ON_FILE = 'Not on file'

/** What an answer says it could not read, one sentence per source; a single sentence is one line. */
export function whyOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean)
  const s = str(v)
  return s ? [s] : []
}

/** A calendar day or an instant, in the platform's words: 'Sep 01, 2026'; '' when it is neither. */
export function dateWords(v: string): string {
  const s = str(v)
  return s ? dayWords(s) || s : ''
}

/** An instant with its clock; a bare day stays a day. */
export function stampWords(v: string): string {
  const s = str(v)
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dayWords(s)
  return ohioDateTime(s) || s
}

/** guardianIsPerson_: a blank, "Self", "N/A", "none" and their kin name nobody. */
const NON_PERSON = ['self', 'none', 'n/a', 'na', 'no guardian', 'no legal guardian', 'not applicable', 'unknown', 'tbd', 'n a', '-', '--']
function isPerson(name: string): boolean {
  const s = name.trim().toLowerCase().replace(/[.]+$/, '')
  if (!s || NON_PERSON.includes(s)) return false
  return !(/^(no|none|not)\b/.test(s) && /guardian|listed|applicable|assigned/.test(s))
}

/** FAM_ORG: a name that is an organisation, never a person. */
const ORG = /\b(services?|agency|inc|llc|board|office|probate|guardianship|program|center|centre|association|trust|bank|hospital|clinic|department|dept|court|corp|company|group|foundation|society|county|ministries)\b/i

// famKeyOf_: the family member a name folds to, as FamilyProfiles.gs and the relay key them; '' for a blank, a…
export function familyKeyOf(name: unknown): string {
  const n = (name == null ? '' : String(name)).replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!n || !isPerson(n) || ORG.test(n)) return ''
  const k = nameKey(n)
  return k.length >= 3 ? `fam_${k}` : ''
}

/* ---------- the sections and the address ---------- */

export const FAMILY_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'documents', label: 'Documents' },
  { id: 'activity', label: 'Activity' },
  // the admin notes: drawn only when the server opens them to this viewer (familyTabs)
  { id: 'notes', label: 'Notes' },
] as const

export type FamilyTab = (typeof FAMILY_TABS)[number]['id']

/** The tabs this viewer reads: Notes only when the notes are open to them. */
export const familyTabs = (notes: boolean) => FAMILY_TABS.filter((t) => t.id !== 'notes' || notes)

export function tabOf(v: string | null | undefined): FamilyTab {
  const hit = FAMILY_TABS.find((t) => t.id === v)
  return hit ? hit.id : 'overview'
}

export const tabLabel = (tab: FamilyTab): string => FAMILY_TABS.find((t) => t.id === tab)?.label ?? 'Overview'

export const FAMILY_APP_ID = 'family-profiles'
export const FAMILY_PATH = '/app/family-profiles/profile'

/** What the one right panel holds. It rides the address as `panel=` (`note-edit~<id>` for one note or call). */
export type FamilyAsk = { kind: 'share' } | { kind: 'note' } | { kind: 'call' } | { kind: 'incident' } | { kind: 'edit' }
  | { kind: 'create' } | { kind: 'doc' } | { kind: 'note-edit'; id: string } | { kind: 'call-edit'; id: string }
type PlainAsk = Exclude<FamilyAsk, { id: string }>['kind']
const ASK_KINDS: PlainAsk[] = ['share', 'note', 'call', 'incident', 'edit', 'create', 'doc']
const ID_ASK_KINDS = ['note-edit', 'call-edit'] as const
const ASK_SEP = '~'

export const panelParam = (ask: FamilyAsk | null): string => (!ask ? '' : 'id' in ask ? `${ask.kind}${ASK_SEP}${ask.id}` : ask.kind)

export function panelOf(v: string | null | undefined): FamilyAsk | null {
  const s = str(v)
  const at = s.indexOf(ASK_SEP)
  if (at > 0) {
    const kind = s.slice(0, at) as (typeof ID_ASK_KINDS)[number]
    const id = s.slice(at + 1)
    return ID_ASK_KINDS.includes(kind) && id ? { kind, id } : null
  }
  return ASK_KINDS.includes(s as PlainAsk) ? ({ kind: s } as FamilyAsk) : null
}

/** `?family=…&tab=…&panel=…` — the whole state of the screen. */
export function familyQuery(family: string, tab: FamilyTab, panel: FamilyAsk | null = null): string {
  const p = new URLSearchParams()
  if (family) p.set('family', family)
  if (tab !== 'overview') p.set('tab', tab)
  const pp = panelParam(panel)
  if (pp) p.set('panel', pp)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const familyHref = (family: string, tab: FamilyTab = 'overview'): string => `${FAMILY_PATH}${familyQuery(family, tab)}`

/* ---------- the roster and the switcher ---------- */

export type FamilyStatus = 'active' | 'inactive'
const STATUSES: FamilyStatus[] = ['active', 'inactive']

export type RosterRow = {
  key: string
  name: string
  /** the relationship the records name, e.g. "Mother"; '' when none does */
  relationship: string
  phone: string
  email: string
  /** how many clients this person is family of; null when the answer did not say */
  clients: number | null
  status: FamilyStatus
  avatar: string
}

// How far this session reads Families, as the roster says: the master, a released badge that sees everything…
export type FamilyViewKind = 'master' | 'all' | 'client' | 'guardian' | 'ssa'
export type FamilyView = { kind: FamilyViewKind; notes: boolean }
const VIEW_KINDS: FamilyViewKind[] = ['master', 'all', 'client', 'guardian', 'ssa']
const NARROWED: FamilyViewKind[] = ['client', 'guardian', 'ssa']

/** The roster's view; an answer that carries none is the master-only server's, which sees everything. */
export function viewOf(raw: unknown): FamilyView {
  const v = rec(raw)
  const kind = oneOf(v.kind, VIEW_KINDS, 'master')
  return { kind, notes: v.notes !== false && !NARROWED.includes(kind) }
}

/** A viewer the server cuts to its own clients: the relay's pack is never theirs. */
export const viewNarrowed = (view: Pick<FamilyView, 'kind'>): boolean => NARROWED.includes(view.kind)

export type Roster = { families: RosterRow[]; why: string[]; degraded: boolean; view: FamilyView }

function rosterRowOf(v: unknown): RosterRow {
  const x = rec(v)
  const name = str(x.name)
  return {
    key: str(x.key) || familyKeyOf(name),
    name,
    relationship: str(x.relationship) || strings(x.relationships).join(' · '),
    phone: str(x.phone),
    email: str(x.email),
    clients: num(x.clients),
    status: oneOf(x.status, STATUSES, 'active'),
    avatar: str(x.avatar),
  }
}

/** familyProfileRoster's answer: { families, why, degraded, view }, each family member once, by name. */
export function rosterOf(raw: unknown): Roster {
  const seen = new Set<string>()
  const families = rowsIn(raw, 'families', 'rows').map(rosterRowOf).filter((r) => {
    if (!r.name || !r.key || seen.has(r.key)) return false
    seen.add(r.key)
    return true
  })
  families.sort((a, b) => a.name.localeCompare(b.name))
  return { families, why: whyOf(rec(raw).why), degraded: rec(raw).degraded === true, view: viewOf(rec(raw).view) }
}

const byName = (a: RosterRow, b: RosterRow) => a.name.localeCompare(b.name)

// The switcher's list: the active family members by name, then the inactive ones when asked; the search reads the…
export function switcherFamilies(rows: RosterRow[], query: string, showInactive: boolean): RosterRow[] {
  const q = query.trim().toLowerCase()
  const hit = (r: RosterRow) => !q || [r.name, r.relationship, r.phone, r.email].some((v) => v.toLowerCase().includes(q))
  const active = rows.filter((r) => r.status === 'active' && hit(r)).sort(byName)
  if (!showInactive) return active
  return [...active, ...rows.filter((r) => r.status === 'inactive' && hit(r)).sort(byName)]
}

/** The family member the screen opens on when the address names none: the first active one by name. */
export function defaultFamily(rows: RosterRow[]): RosterRow | null {
  return switcherFamilies(rows, '', false)[0] ?? [...rows].sort(byName)[0] ?? null
}

/** The family member an address names: their key, else their name folded. Never a near match. */
export function resolveFamily(want: string, rows: RosterRow[]): RosterRow | null {
  const w = str(want)
  if (!w) return null
  return rows.find((r) => r.key === w) ?? rows.find((r) => r.key === familyKeyOf(w)) ?? null
}

/** The switcher's second line: the relationship, then how many clients. */
export function rosterLine(r: Pick<RosterRow, 'relationship' | 'clients'>): string {
  const count = r.clients === null ? '' : `${r.clients} client${r.clients === 1 ? '' : 's'}`
  return [r.relationship, count].filter(Boolean).join(' · ')
}

/* ---------- Overview ---------- */

export type FamilyDetails = {
  key: string
  name: string
  relationships: string[]
  phone: string
  email: string
  address: string
  avatar: string
  status: FamilyStatus
  /** where the platform found this person, one plain word each */
  sources: string[]
}

export type FamilyClient = {
  client_key: string
  name: string
  relationship: string
  house: string
  house_label: string
  avatar: string
  status: FamilyStatus
}

export type FamilyOverview = { family: FamilyDetails; clients: FamilyClient[]; why: string[]; degraded: boolean }

/** familyProfileOverview's answer: the family member, then their clients — the current first, each by name. */
export function overviewOf(raw: unknown): FamilyOverview {
  const o = rec(raw)
  const f = rec(o.family)
  const clients = rowsIn(o.clients).map((v) => {
    const c = rec(v)
    const name = str(c.name)
    return {
      client_key: str(c.client_key) || nameKey(name),
      name,
      relationship: str(c.relationship),
      house: str(c.house),
      house_label: str(c.house_label),
      avatar: str(c.avatar),
      status: oneOf(c.status, STATUSES, 'active'),
    }
  }).filter((c) => c.name && c.client_key)
  clients.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'active' ? -1 : 1))
  return {
    family: {
      key: str(f.key),
      name: str(f.name),
      relationships: strings(f.relationships ?? f.relationship),
      phone: str(f.phone),
      email: str(f.email),
      address: str(f.address),
      avatar: str(f.avatar),
      status: oneOf(f.status, STATUSES, 'active'),
      sources: strings(f.sources),
    },
    clients,
    why: whyOf(o.why),
    degraded: o.degraded === true,
  }
}

// RELATIONSHIP as one line: with one client, the relationship itself; with several, each one with the client it…
export function relationshipLine(d: Pick<FamilyDetails, 'relationships'> | null, clients: Pick<FamilyClient, 'name' | 'relationship'>[]): string {
  const named = clients.filter((c) => c.relationship)
  if (clients.length > 1 && named.length) return named.map((c) => `${c.relationship} of ${c.name}`).join(' · ')
  if (named.length === 1) return named[0].relationship
  return (d?.relationships ?? []).join(' · ')
}

/** The line under a client: the relationship to them, then the house. */
export const clientLine = (c: Pick<FamilyClient, 'relationship' | 'house_label' | 'house'>): string =>
  [c.relationship || 'Family', c.house_label || c.house].filter(Boolean).join(' · ')

/** The rows of Clients' own roster the incident form is drawn for: the associated clients, the current first. */
export function incidentClients(clients: FamilyClient[]): ClientRosterRow[] {
  return clients.map((c) => ({
    client_key: c.client_key, client_id: '', name: c.name, status: c.status, house: c.house, avatar: c.avatar, isp_year: '',
  }))
}

/* ---------- Documents ---------- */

export type FamilyDoc = {
  id: string
  title: string
  kind: string
  client_key: string
  client_name: string
  date: string
  file_id: string
  mime: string
  source: string
}

export type FamilyDocuments = { docs: FamilyDoc[]; why: string[]; degraded: boolean }

const DOC_KIND_LABEL: Record<string, string> = {
  guardianship: 'Guardianship papers', guardianship_papers: 'Guardianship papers', isp: 'ISP', client_doc: 'Client document',
  consent: 'Consent', authorization: 'Authorization', mail: 'Mail', family_doc: 'Family document',
}

/** A document's kind in words: the known ones by name, any other as written. */
export function docKindLabel(kind: string): string {
  const k = str(kind).toLowerCase()
  if (!k) return 'Document'
  return DOC_KIND_LABEL[k] ?? `${k[0].toUpperCase()}${k.slice(1).replace(/_/g, ' ')}`
}

const stampMs = (v: string): number => {
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : 0
}

/** familyProfileDocuments' answer, in its own order. */
export function documentsOf(raw: unknown): FamilyDocuments {
  const o = rec(raw)
  const docs = rowsIn(o, 'docs', 'rows').map((v, i) => {
    const d = rec(v)
    const fileId = str(d.file_id)
    return {
      id: str(d.id) || fileId || `doc-${i}`,
      title: str(d.title) || str(d.name),
      kind: str(d.kind).toLowerCase(),
      client_key: str(d.client_key),
      client_name: str(d.client_name),
      date: str(d.date),
      file_id: fileId,
      mime: str(d.mime),
      source: str(d.source),
    }
  }).filter((d) => d.title)
  return { docs, why: whyOf(o.why), degraded: o.degraded === true }
}

/** A row opens only when it names a file; the door serves only this family member's own. */
export const docOpens = (d: Pick<FamilyDoc, 'file_id'>): boolean => !!d.file_id

export function docLine(d: Pick<FamilyDoc, 'client_name' | 'kind' | 'date'>): string {
  return [d.client_name, docKindLabel(d.kind), dateWords(d.date)].filter(Boolean).join(' · ')
}

/* ---------- Activity ---------- */

// registered, client_tied and document_added are the registry's own steps (db/families.sql), from New Family on
export type FamilyActivityKind = 'note' | 'sms' | 'call' | 'isp' | 'calendar' | 'scheduled_call' | 'incident' | 'registered'
  | 'client_tied' | 'document_added' | 'other'
const ACTIVITY_KINDS: FamilyActivityKind[] = ['note', 'sms', 'call', 'isp', 'calendar', 'scheduled_call', 'incident', 'registered',
  'client_tied', 'document_added', 'other']

export const ACTIVITY_KIND_LABEL: Record<FamilyActivityKind, string> = {
  note: 'Admin note', sms: 'Text', call: 'Call', isp: 'ISP', calendar: 'Family coverage shift', scheduled_call: 'Scheduled call',
  incident: 'Incident', registered: 'Registered', client_tied: 'Client tied', document_added: 'Document added', other: 'Record',
}

/** A registry step: the progress since the family member was registered in Families. */
export const isRegistryStep = (kind: FamilyActivityKind): boolean =>
  kind === 'registered' || kind === 'client_tied' || kind === 'document_added'

export type FamilyActivityItem = {
  id: string
  at: string
  kind: FamilyActivityKind
  title: string
  body: string
  by: string
  client_key: string
}

/** `total`: how many items the sources hold, when the answer carries only the newest of them; null when it did not say. */
export type FamilyActivity = { items: FamilyActivityItem[]; why: string[]; degraded: boolean; total: number | null }

/** familyProfileActivity's answer, newest first. */
export function activityOf(raw: unknown): FamilyActivity {
  const o = rec(raw)
  const items = rowsIn(o, 'items', 'rows').map((v, i) => {
    const x = rec(v)
    return {
      id: str(x.id) || `activity-${i}`,
      at: str(x.at),
      kind: oneOf(x.kind, ACTIVITY_KINDS, 'other'),
      title: str(x.title),
      body: str(x.body),
      by: str(x.by),
      client_key: str(x.client_key),
    }
  }).filter((x) => x.title || x.body)
  items.sort((a, b) => stampMs(b.at) - stampMs(a.at))
  return { items, why: whyOf(o.why), degraded: o.degraded === true, total: num(o.total) }
}

export type RegistryProgress = {
  /** the registry's steps, oldest first: registered, each client tied, each paper added */
  steps: FamilyActivityItem[]
  /** every other line of Activity since the registration, by kind */
  since: { kind: FamilyActivityKind; count: number }[]
}

/** Activity's progress list: what happened from the registration on; null for a member never registered in Families. */
export function registryProgress(items: FamilyActivityItem[]): RegistryProgress | null {
  const steps = items.filter((x) => isRegistryStep(x.kind)).sort((a, b) => stampMs(a.at) - stampMs(b.at))
  const born = steps.find((x) => x.kind === 'registered')
  if (!born) return null
  const from = stampMs(born.at)
  const counts = new Map<FamilyActivityKind, number>()
  for (const x of items) {
    if (isRegistryStep(x.kind) || stampMs(x.at) < from) continue
    counts.set(x.kind, (counts.get(x.kind) ?? 0) + 1)
  }
  return { steps, since: [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count) }
}

/** "3 admin notes · 1 call" — the lines since the registration, in words. */
export function sinceWords(since: RegistryProgress['since']): string {
  return since.map((s) => {
    const label = ACTIVITY_KIND_LABEL[s.kind]
    return `${s.count} ${label === label.toUpperCase() ? label : label.toLowerCase()}${s.count === 1 ? '' : 's'}`
  }).join(' · ')
}

/** "<Kind> · <date>", with who wrote it when the item names someone. */
export function activityMeta(x: Pick<FamilyActivityItem, 'by' | 'kind' | 'at'>): string {
  return [ACTIVITY_KIND_LABEL[x.kind], x.by, stampWords(x.at)].filter(Boolean).join(' · ')
}

export type BodyPart = { text: string; href?: string }

// An activity line with the family member and the client as links: each name the body carries becomes its link, and…
export function bodyParts(body: string, links: { name: string; href: string }[]): BodyPart[] {
  const named = links.filter((l) => l.name && l.href)
  let parts: BodyPart[] = body ? [{ text: body }] : []
  const carried = new Set<string>()
  for (const l of named) {
    const next: BodyPart[] = []
    for (const p of parts) {
      if (p.href) {
        next.push(p)
        continue
      }
      const bits = p.text.split(l.name)
      bits.forEach((bit, i) => {
        if (bit) next.push({ text: bit })
        if (i < bits.length - 1) {
          next.push({ text: l.name, href: l.href })
          carried.add(l.href)
        }
      })
    }
    parts = next
  }
  const missing = named.slice(1).filter((l) => !carried.has(l.href))
  for (const l of missing) parts.push(...(parts.length ? [{ text: ' · ' }] : []), { text: l.name, href: l.href })
  return parts
}

/* ---------- admin notes ---------- */

export type FamilyNote = { id: string; at: string; by: string; body: string }
export type FamilyNotes = { notes: FamilyNote[] }

/** familyProfileNotes' answer, newest first. */
export function notesOf(raw: unknown): FamilyNotes {
  const notes = rowsIn(raw, 'notes', 'rows').map((v, i) => {
    const n = rec(v)
    return { id: str(n.id) || `note-${i}`, at: str(n.at), by: str(n.by), body: str(n.body) }
  }).filter((n) => n.body)
  notes.sort((a, b) => stampMs(b.at) - stampMs(a.at))
  return { notes }
}

export const NOTE_MAX = 4000

/* ---------- a call to schedule ---------- */

export const CALL_PRIORITIES = [
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'High' },
  { id: 'urgent', label: 'Urgent' },
] as const

export type CallPriority = (typeof CALL_PRIORITIES)[number]['id']

export type CallDraft = { family: string; client_key: string; date: string; priority: CallPriority; details: string }

/** FAM_NOTE_MAX: the details, like a note, are at most this long. */
export const DETAILS_MAX = 4000

/** What a call still needs before it can be reviewed, as the door checks it; [] when it is whole. `today` is Ohio's. */
export function callMissing(d: Pick<CallDraft, 'client_key' | 'date'>, today: string): string[] {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? Date.parse(`${d.date}T12:00:00Z`) : NaN
  // a day the calendar has: 2026-02-31 is no day, though Date rolls it over
  const day = Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d.date
  return [
    d.client_key ? '' : 'an associated client',
    !day ? 'a date' : d.date < today ? 'a date from today on' : '',
  ].filter(Boolean)
}

export const priorityLabel = (p: string): string => CALL_PRIORITIES.find((x) => x.id === p)?.label ?? p

/* ---------- the member's details, edited ---------- */

export type FamilyEditTie = { client_key: string; name: string; status: FamilyStatus; why: string }

export type FamilyEdit = {
  /** each field as the profile shows it now: the witness the save sends back */
  raw: Record<string, string>
  locked: Record<string, EditLock>
  ties: FamilyEditTie[]
  /** the client records the member's own fields land on */
  records: string[]
  person_id: string
  /** a sign-in already uses the email or phone */
  account: boolean
}

/** A read's locks: field → why it is drawn read-only, and where it is edited instead. */
function locksOf(v: unknown): Record<string, EditLock> {
  const locked: Record<string, EditLock> = {}
  for (const [k, x] of Object.entries(rec(v))) {
    const l = rec(x)
    if (str(l.why)) locked[k] = str(l.door) ? { why: str(l.why), door: str(l.door) } : { why: str(l.why) }
  }
  return locked
}

/** familyProfileOverview's `edit` (asked with edit: true, the master's alone); null when the answer carries none. */
export function familyEditOf(raw: unknown): FamilyEdit | null {
  const e = rec(rec(raw).edit)
  if (!Object.keys(e).length) return null
  const locked = locksOf(e.locked)
  const ties = rowsIn(e.ties).map((v) => {
    const t = rec(v)
    return { client_key: str(t.client_key), name: str(t.name), status: oneOf(t.status, STATUSES, 'active'), why: str(t.why) }
  }).filter((t) => t.client_key)
  return { raw: editRawOf(e.raw), locked, ties, records: strings(e.records), person_id: str(e.person_id), account: e.account === true }
}

const EDIT_OWN: { key: string; label: string; kind: EditKind; hint?: string }[] = [
  { key: 'name', label: 'Name', kind: 'text', hint: 'A new name moves the admin notes with it.' },
  { key: 'phone', label: 'Phone', kind: 'phone' },
  { key: 'email', label: 'Email', kind: 'email' },
  { key: 'address', label: 'Address', kind: 'text' },
  { key: 'avatar', label: 'Photo link', kind: 'url' },
]

/** The edit panel's fields: the member's own, then each client's relationship and guardianship papers. `bare`: Settings ›
 * My Work keeps the papers, the hints and a lock's words to the master — a locked field stays locked, unexplained. */
export function familyEditFields(e: FamilyEdit, bare = false): EditField[] {
  const field = (key: string, label: string, kind: EditKind, hint?: string): EditField[] => {
    if (!(key in e.raw)) return []
    const f: EditField = { key, label, kind, raw: e.raw[key] }
    if (hint && !bare) f.hint = hint
    if (e.locked[key]) f.lockedBy = bare ? {} : e.locked[key]
    return [f]
  }
  return [
    ...EDIT_OWN.flatMap((f) => field(f.key, f.label, f.kind, f.hint)),
    ...e.ties.flatMap((t) => [
      ...field(`rel_${t.client_key}`, `Relationship to ${t.name}`, 'text'),
      ...(bare ? [] : field(`papers_${t.client_key}`, `Guardianship papers · ${t.name}`, 'text', 'A Drive link or file id.')),
    ]),
  ]
}

/* ---------- a note or a call, edited ---------- */

export type FamilyNoteEdit = { id: string; at: string; by: string; raw: Record<string, string>; locked: Record<string, EditLock> }
export type FamilyCallEdit = {
  id: string
  at: string
  client_key: string
  client_name: string
  raw: Record<string, string>
  locked: Record<string, EditLock>
}

/** familyProfileNotes' `edit` (asked with edit: true): each part only to its edition's; null when the answer carries none. */
export type FamilyAdminEdit = { notes: FamilyNoteEdit[] | null; calls: FamilyCallEdit[] | null; why: string[] }

export function familyAdminEditOf(raw: unknown): FamilyAdminEdit | null {
  const e = rec(rec(raw).edit)
  if (!Object.keys(e).length) return null
  const notes = Array.isArray(e.notes) ? e.notes.map((v) => {
    const n = rec(v)
    return { id: str(n.id), at: str(n.at), by: str(n.by), raw: editRawOf(n.raw), locked: locksOf(n.locked) }
  }).filter((n) => n.id) : null
  const calls = Array.isArray(e.calls) ? e.calls.map((v) => {
    const c = rec(v)
    return { id: str(c.id), at: str(c.at), client_key: str(c.client_key), client_name: str(c.client_name), raw: editRawOf(c.raw),
      locked: locksOf(c.locked) }
  }).filter((c) => c.id) : null
  return { notes, calls, why: whyOf(e.why) }
}

/** The removal's own change: the note's state, from open. */
export const NOTE_REMOVE = 'removed'

export function noteEditFields(n: FamilyNoteEdit): EditField[] {
  const f: EditField = { key: 'body', label: 'Note', kind: 'textarea', raw: n.raw.body ?? '', max: NOTE_MAX }
  if (n.locked.body) f.lockedBy = n.locked.body
  return [f]
}

/** A call card's state: its Task Board column, or cancelled (Done, labelled Cancelled). */
export const CALL_STATES = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'this-week', label: 'This week' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
] as const

export const CALL_CANCEL = 'cancelled'

/** FAM_CALL_DETAILS_MAX: the card's whole text, the lines scheduling added included. */
export const CALL_DETAILS_EDIT_MAX = 5000

const labelsOf = (list: readonly { id: string; label: string }[]): Record<string, string> =>
  Object.fromEntries(list.map((x) => [x.id, x.label]))

export function callEditFields(c: FamilyCallEdit): EditField[] {
  const fields: EditField[] = [
    { key: 'due', label: 'Date', kind: 'date', raw: c.raw.due ?? '', hint: 'Today or later.' },
    { key: 'priority', label: 'Priority', kind: 'select', raw: c.raw.priority ?? 'normal', options: CALL_PRIORITIES.map((p) => p.id),
      optionLabels: labelsOf(CALL_PRIORITIES) },
    { key: 'state', label: 'State', kind: 'select', raw: c.raw.state ?? '', options: CALL_STATES.map((s) => s.id),
      optionLabels: labelsOf(CALL_STATES), hint: 'Cancelled moves the card to Done with the Cancelled label.' },
    { key: 'details', label: 'Details', kind: 'textarea', raw: c.raw.details ?? '', max: CALL_DETAILS_EDIT_MAX },
  ]
  return fields.map((f) => (c.locked[f.key] ? { ...f, lockedBy: c.locked[f.key] } : f))
}

/* ---------- New Family, and a paper added ---------- */

/** A client New Family can tie the member to (familyClientChoices), the active first. */
export type ClientChoice = { client_key: string; name: string; house: string; status: FamilyStatus }

export function clientChoicesOf(raw: unknown): ClientChoice[] {
  const seen = new Set<string>()
  return rowsIn(raw, 'clients', 'rows').map((v) => {
    const c = rec(v)
    return { client_key: str(c.client_key), name: str(c.name), house: str(c.house), status: oneOf(c.status, STATUSES, 'active') }
  }).filter((c) => {
    if (!c.client_key || !c.name || seen.has(c.client_key)) return false
    seen.add(c.client_key)
    return true
  })
}

/** The choices a search keeps: by name or house, the picked ones always. */
export function choicesFor(list: ClientChoice[], query: string, picked: readonly string[]): ClientChoice[] {
  const q = query.trim().toLowerCase()
  return list.filter((c) => picked.includes(c.client_key) || !q || c.name.toLowerCase().includes(q) || c.house.toLowerCase().includes(q))
}

export const RELATIONSHIPS = ['Mother', 'Father', 'Sister', 'Brother', 'Daughter', 'Son', 'Grandmother', 'Grandfather', 'Aunt', 'Uncle',
  'Cousin', 'Spouse', 'Stepmother', 'Stepfather', 'Guardian', 'Friend'] as const

/** family_writes.PREFERRED: how the member likes to be reached, or not said. */
export const PREFERRED_CONTACTS = [
  { id: '', label: 'Not said' },
  { id: 'phone', label: 'Phone call' },
  { id: 'text', label: 'Text' },
  { id: 'email', label: 'Email' },
] as const

export type PreferredContact = (typeof PREFERRED_CONTACTS)[number]['id']

export type NewFamilyTie = { client_key: string; guardian: boolean }

export type NewFamilyDraft = {
  name: string
  relationship: string
  phone: string
  email: string
  address: string
  preferred_contact: PreferredContact
  notes: string
  clients: NewFamilyTie[]
}

export const EMPTY_FAMILY: NewFamilyDraft = {
  name: '', relationship: '', phone: '', email: '', address: '', preferred_contact: '', notes: '', clients: [],
}

/** family_writes.CLIENTS_MAX */
export const NEW_FAMILY_CLIENTS_MAX = 20

const phoneDigits = (v: string): string => v.replace(/\D/g, '')

/** What New Family still needs before it can be reviewed, as familyCreate checks it; [] when it is whole. */
export function newFamilyMissing(d: NewFamilyDraft): string[] {
  const name = d.name.trim()
  const digits = phoneDigits(d.phone)
  const mail = d.email.trim()
  return [
    !name ? 'the full name' : !familyKeyOf(name) ? 'a person’s name (not an agency)' : '',
    d.relationship.trim() ? '' : 'the relationship',
    digits && !/^1?\d{10}$/.test(digits) ? 'a 10-digit phone' : '',
    mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) ? 'a valid email' : '',
    d.clients.length ? '' : 'at least one client',
    d.clients.length > NEW_FAMILY_CLIENTS_MAX ? `at most ${NEW_FAMILY_CLIENTS_MAX} clients` : '',
  ].filter(Boolean)
}

/** familyCreate's payload: the text trimmed, each client with the relationship and guardianship. */
export function newFamilyPayload(d: NewFamilyDraft): Record<string, unknown> {
  const relationship = d.relationship.trim()
  return {
    name: d.name.replace(/\s+/g, ' ').trim(), relationship, phone: d.phone.trim(), email: d.email.trim(), address: d.address.trim(),
    preferred_contact: d.preferred_contact, notes: d.notes.trim(),
    clients: d.clients.map((c) => ({ client_key: c.client_key, relationship, guardian: c.guardian })),
  }
}

/** The key familyCreate answered, else the one the name folds to. */
export function createdKey(answer: unknown, name: string): string {
  return str(rec(answer).family_key) || familyKeyOf(name)
}

/** The kinds of paper Documents offers; any other is written in. */
export const PAPER_KINDS = ['Guardianship papers', 'Power of attorney', 'ID', 'Consent', 'Authorization', 'Letter', 'Medical',
  'Insurance', 'Other'] as const

/** A Drive file named by its link (…/d/<id>/…, ?id=<id>) or by its id; '' when it names none. */
export function driveFileId(v: string): string {
  const s = v.trim()
  const m = s.match(/\/d\/([A-Za-z0-9_-]{10,200})/) ?? s.match(/[?&]id=([A-Za-z0-9_-]{10,200})/)
  if (m) return m[1]
  return /^[A-Za-z0-9_-]{10,200}$/.test(s) ? s : ''
}

/* ---------- the editions (Settings › Editions) ---------- */

/** Families' editions (app family-profiles): the details, the notes, the calls, an incident, New Family and a paper. */
export const FAMILY_EDITIONS = ['family.profile', 'family.notes', 'family.calls', 'family.incidents', 'family.create',
  'family.documents'] as const
export type FamilyEdition = (typeof FAMILY_EDITIONS)[number]

/** editionsMine's list as Families keeps it: its own editions once each, anything else dropped. */
export function familyEditionsOf(raw: unknown): FamilyEdition[] {
  const list = Array.isArray(raw) ? raw.map((x) => String(x ?? '').trim()) : []
  return FAMILY_EDITIONS.filter((id) => list.includes(id))
}

/** The writes a viewer makes here, one per Actions item. */
export type FamilyCan = Record<MenuItem['id'], boolean>
export const CAN_ALL: FamilyCan = { create: true, edit: true, doc: true, note: true, call: true, incident: true }
export const CAN_NONE: FamilyCan = { create: false, edit: false, doc: false, note: false, call: false, incident: false }

/** The edition each write panel opens to its holder (New Family and a paper: a director's or a badge above, too). */
export const ASK_EDITION: Record<MenuItem['id'], FamilyEdition> = {
  create: 'family.create', edit: 'family.profile', doc: 'family.documents', note: 'family.notes', call: 'family.calls',
  incident: 'family.incidents',
}

/** The master makes every write; a listed holder its edition's, never from a view cut to its own clients. */
export function familyCan(master: boolean, editions: readonly string[], view: Pick<FamilyView, 'kind'>): FamilyCan {
  if (master) return CAN_ALL
  if (viewNarrowed(view) || view.kind === 'master') return CAN_NONE
  const ids = Object.keys(ASK_EDITION) as MenuItem['id'][]
  return Object.fromEntries(ids.map((id) => [id, editions.includes(ASK_EDITION[id])])) as FamilyCan
}

export const canAny = (can: FamilyCan): boolean => Object.values(can).some(Boolean)

/** The write a panel makes: a note's edit is the notes edition's, a call's the calls edition's. */
const askWrite = (kind: Exclude<FamilyAsk['kind'], 'share'>): MenuItem['id'] =>
  kind === 'note-edit' ? 'note' : kind === 'call-edit' ? 'call' : kind

/** May this viewer open the panel? Share always; a write when it makes it. */
export const mayOpenAsk = (can: FamilyCan, ask: FamilyAsk): boolean => ask.kind === 'share' || can[askWrite(ask.kind)]

/* ---------- the panel's heading, and the Actions menu ---------- */

const PANEL_LABEL: Record<FamilyAsk['kind'], string> = {
  share: 'Share', note: 'Admin notes', call: 'Schedule call', incident: 'New incident', edit: 'Edit details',
  create: 'New Family', doc: 'Documents', 'note-edit': 'Edit note', 'call-edit': 'Edit call',
}

export const panelLabel = (ask: FamilyAsk): string => PANEL_LABEL[ask.kind]

export function panelTitle(ask: FamilyAsk, name: string): string {
  if (ask.kind === 'share') return name
  if (ask.kind === 'create') return 'Register a family member'
  if (ask.kind === 'doc') return `Add document · ${name}`
  if (ask.kind === 'note') return `Add note · ${name}`
  if (ask.kind === 'call') return `Schedule call · ${name}`
  if (ask.kind === 'edit') return `Edit details · ${name}`
  if (ask.kind === 'note-edit') return `Edit note · ${name}`
  if (ask.kind === 'call-edit') return `Edit call · ${name}`
  return `New incident · ${name}`
}

/** A scheduled call's Activity line names its card: `task_<card id>`; '' for any other line. */
export const callIdOf = (x: Pick<FamilyActivityItem, 'id' | 'kind'>): string =>
  x.kind === 'scheduled_call' && x.id.startsWith('task_') ? x.id.slice(5) : ''

export type MenuItem = { id: 'create' | 'edit' | 'doc' | 'note' | 'call' | 'incident'; label: string; ask: FamilyAsk; why: string }

// The Actions menu in four groups: Families (New Family), Details (Edit details, Add document), Activity (Add note…
export function actionGroups(clients: FamilyClient[] | null, can: FamilyCan = CAN_ALL): { label: string; items: MenuItem[] }[] {
  const needClient = clients === null ? 'Reading the clients…' : clients.length ? '' : 'No client is associated with this family member'
  return actionGroupsAll(needClient)
    .map((g) => ({ ...g, items: g.items.filter((it) => can[it.id]) }))
    .filter((g) => g.items.length > 0)
}

function actionGroupsAll(needClient: string): { label: string; items: MenuItem[] }[] {
  return [
    { label: 'Families & Guardians', items: [{ id: 'create', label: 'New Family', ask: { kind: 'create' }, why: '' }] },
    {
      label: 'Details',
      items: [
        { id: 'edit', label: 'Edit details', ask: { kind: 'edit' }, why: '' },
        { id: 'doc', label: 'Add document', ask: { kind: 'doc' }, why: '' },
      ],
    },
    {
      label: 'Activity',
      items: [
        { id: 'note', label: 'Add note', ask: { kind: 'note' }, why: '' },
        { id: 'call', label: 'Schedule call', ask: { kind: 'call' }, why: needClient },
      ],
    },
    {
      label: 'Family contact actions',
      items: [{ id: 'incident', label: 'New incident', ask: { kind: 'incident' }, why: needClient }],
    },
  ]
}

/* ---------- a read the server did not answer ---------- */

export const NOT_PUBLISHED =
  'The server did not recognise this read: Families answers once the platform release that carries it is live, and not during a visit.'

export const NOT_OPEN = 'This part is not open to you.'

// A refusal as a sentence.
export function readRefusal(error: string, master = true): string {
  if (/unknown action/i.test(error)) return master ? NOT_PUBLISHED : NOT_OPEN
  return error || 'The read did not answer.'
}

/* ---------- share ---------- */

/** Who the family member is — nothing about any client rides a share. */
export function sharePayloadFor(row: Pick<RosterRow, 'key' | 'name' | 'relationship' | 'status'>, tab: FamilyTab): SharePayload {
  const lines = [
    row.relationship ? `Relationship: ${row.relationship}` : '',
    `Status: ${row.status === 'inactive' ? 'Inactive' : 'Active'}`,
  ].filter(Boolean)
  return {
    title: row.name,
    subtitle: `Families · ${tabLabel(tab)}`,
    appHref: familyHref(row.key, tab),
    text: lines.join('\n'),
    icon: 'users-round',
    filename: `${row.name} ${tabLabel(tab)}`,
  }
}
