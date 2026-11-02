// SSA — the shapes SsaProfiles.gs answers and the arithmetic the screen does on them.
// Pure: the page and the tests import the same code.
import type { SharePayload } from '@/stores/useShareStore'
import { badgeRuleAllows } from '@/lib/badgeAccess'
import { EDITION_BADGES } from '@/lib/editions'
import { ohioDateTime } from '@/lib/ohio'
import { editRawOf, type EditField, type EditKind, type EditLock } from '@/lib/recordEdit'
import { dayWords } from '@/pages/features/locations/locationModel'
import { CLIENTS_PATH, clientHref, clientLive, mailHref, nameKey, telHref } from '@/pages/features/clientprofiles/clientModel'

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

export { CLIENTS_PATH, nameKey, clientHref, mailHref, telHref }

export const NOT_ON_FILE = 'Not on file'

/** What an answer says it could not read, one sentence per source; a single sentence is one line. */
export function whyOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean)
  const s = str(v)
  return s ? [s] : []
}

/** A calendar day or an instant, in the platform's words: 'Sep 01, 2026'; the text as written when it is neither. */
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

/** locationsText_: whitespace folded, at most `max` characters. */
const text = (v: unknown, max = 0): string => {
  const s = (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim()
  return max ? s.slice(0, max) : s
}

/** guardianIsPerson_: a blank, "N/A", "none" and their kin name nobody. */
const NON_PERSON = ['self', 'none', 'n/a', 'na', 'no guardian', 'no legal guardian', 'not applicable', 'unknown', 'tbd', 'n a', '-', '--']
function isPerson(name: string): boolean {
  const s = name.trim().toLowerCase().replace(/[.]+$/, '')
  if (!s || NON_PERSON.includes(s)) return false
  return !(/^(no|none|not)\b/.test(s) && /guardian|listed|applicable|assigned/.test(s))
}

/** The SSA a name folds to, as SsaProfiles.gs (ssaKeyOf_) and the relay key them; '' for a blank or a non-person. */
export function ssaKeyOf(name: unknown): string {
  const n = text(name, 200)
  if (!n || !isPerson(n)) return ''
  const k = nameKey(n)
  return k.length >= 3 ? `ssa_${k}` : ''
}

/** ssaAgency_: the board of DD an e-mail's domain names, else the bare domain; a free mailbox names none. */
const KNOWN_AGENCIES: Record<string, string> = {
  'starkdd.org': 'Stark County Board of DD',
  'stardd.org': 'Stark County Board of DD',
}
const FREE_MAIL = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com', 'icloud.com', 'live.com', 'msn.com', 'att.net',
  'sbcglobal.net']
export function agencyOf(email: unknown): string {
  const m = /@([a-z0-9.-]+\.[a-z]{2,})$/.exec(str(email).toLowerCase())
  if (!m) return ''
  return KNOWN_AGENCIES[m[1]] ?? (FREE_MAIL.includes(m[1]) ? '' : m[1])
}

/** ssaEmail_: one address, lower case; '' for anything else. */
const emailOf = (v: unknown): string => {
  const s = text(v, 200).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s) ? s : ''
}

/** spDigits10_: the last ten digits of a number, '' when it has fewer. */
function digits10(v: string): string {
  let d = v.replace(/\D+/g, '')
  if (d.length >= 11 && d[0] === '1') d = d.slice(1)
  d = d.slice(-10)
  return d.length === 10 ? d : ''
}

/** cpPhone_ as the index keeps it: (330) 555-0101 for ten digits, the cell as written otherwise; '' for no number. */
function phoneOf(v: unknown): string {
  const raw = v == null ? '' : String(v).trim()
  let d = raw.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') d = d.slice(1)
  const shown = d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw
  return digits10(shown) ? shown : ''
}

/* ---------- the sections and the address ---------- */

export const SSA_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'documents', label: 'Documents' },
  { id: 'activity', label: 'Activity' },
  // the admin notes, drawn only when the server opens them to this session (SsaReach.notes)
  { id: 'notes', label: 'Notes' },
] as const

export type SsaTab = (typeof SSA_TABS)[number]['id']

export function tabOf(v: string | null | undefined): SsaTab {
  const hit = SSA_TABS.find((t) => t.id === v)
  return hit ? hit.id : 'overview'
}

export const tabLabel = (tab: SsaTab): string => SSA_TABS.find((t) => t.id === tab)?.label ?? 'Overview'

export const SSA_APP_ID = 'ssa-profiles'
export const SSA_PATH = '/app/ssa-profiles/profile'

/** What the one right panel holds. It rides the address as `panel=`; an entry edited carries its id after `~`. */
export type SsaAsk = { kind: 'share' } | { kind: 'note' } | { kind: 'edit' }
  | { kind: 'doc-edit'; id: string } | { kind: 'activity-edit'; id: string }
type PlainAsk = Exclude<SsaAsk, { id: string }>['kind']
const ASK_KINDS: PlainAsk[] = ['share', 'note', 'edit']
const ID_ASK_KINDS = ['doc-edit', 'activity-edit'] as const
const ASK_SEP = '~'

export const panelParam = (ask: SsaAsk | null): string => (!ask ? '' : 'id' in ask ? `${ask.kind}${ASK_SEP}${ask.id}` : ask.kind)

export function panelOf(v: string | null | undefined): SsaAsk | null {
  const s = str(v)
  const at = s.indexOf(ASK_SEP)
  if (at > 0) {
    const kind = s.slice(0, at) as (typeof ID_ASK_KINDS)[number]
    const id = s.slice(at + 1)
    return ID_ASK_KINDS.includes(kind) && id ? { kind, id } : null
  }
  return ASK_KINDS.includes(s as PlainAsk) ? ({ kind: s } as SsaAsk) : null
}

/** `?ssa=…&tab=…&panel=…` — the whole state of the screen. */
export function ssaQuery(ssa: string, tab: SsaTab, panel: SsaAsk | null = null): string {
  const p = new URLSearchParams()
  if (ssa) p.set('ssa', ssa)
  if (tab !== 'overview') p.set('tab', tab)
  const pp = panelParam(panel)
  if (pp) p.set('panel', pp)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const ssaHref = (ssa: string, tab: SsaTab = 'overview'): string => `${SSA_PATH}${ssaQuery(ssa, tab)}`

/* ---------- the roster and the switcher ---------- */

export type SsaStatus = 'active' | 'inactive'
const STATUSES: SsaStatus[] = ['active', 'inactive']

export type RosterRow = {
  key: string
  name: string
  phone: string
  email: string
  agency: string
  county: string
  /** how many clients' records name this SSA; null when the answer did not say */
  clients: number | null
  status: SsaStatus
  avatar: string
}

// `partial`: lane 1 could not name every current client's SSA, so only the action's roster is whole.
/** `notes`: whether the server opens the admin notes to this session (App Control's Notes row, else Admin and up); null
 *  when it did not say. */
export type Roster = { ssas: RosterRow[]; why: string[]; degraded: boolean; partial: boolean; viewer: SsaViewer; notes: boolean | null }

function rosterRowOf(v: unknown): RosterRow {
  const x = rec(v)
  const name = str(x.name)
  const email = str(x.email)
  return {
    key: str(x.key) || ssaKeyOf(name),
    name,
    phone: str(x.phone),
    email,
    agency: str(x.agency) || agencyOf(email),
    county: str(x.county),
    clients: num(x.clients),
    status: oneOf(x.status, STATUSES, 'active'),
    avatar: str(x.avatar),
  }
}

/** ssaProfileRoster's answer: { ssas, why, degraded }, each SSA once, by name. */
export function rosterOf(raw: unknown): Roster {
  const seen = new Set<string>()
  const ssas = rowsIn(raw, 'ssas', 'rows').map(rosterRowOf).filter((r) => {
    if (!r.name || !r.key || seen.has(r.key)) return false
    seen.add(r.key)
    return true
  })
  ssas.sort((a, b) => a.name.localeCompare(b.name))
  return { ssas, why: whyOf(rec(raw).why), degraded: rec(raw).degraded === true, partial: rec(raw).partial === true,
    viewer: viewerOf(rec(raw).viewer), notes: typeof rec(raw).notes === 'boolean' ? rec(raw).notes as boolean : null }
}

/* ---------- who is looking ---------- */

// How far the server lets a session see (SsaProfiles.gs, from the App Control release): 'master' and 'all' every…
export type SsaViewer = 'master' | 'all' | 'ssa' | 'client' | 'guardian' | ''
const VIEWERS: SsaViewer[] = ['master', 'all', 'ssa', 'client', 'guardian']

export const viewerOf = (v: unknown): SsaViewer => {
  const s = str(v).toLowerCase() as SsaViewer
  return VIEWERS.includes(s) ? s : ''
}

/** A session the server may cut: never the master; a client account, or one wearing FAMILY, SSA or CLIENT. */
export function narrowedViewer(u: { isMaster?: boolean; role?: string | null; types?: readonly string[] } | null | undefined): boolean {
  if (!u || u.isMaster === true) return false
  const types = (u.types ?? []).map((t) => String(t).trim().toUpperCase())
  return String(u.role ?? '').trim().toLowerCase() === 'client' || types.includes('FAMILY') || types.includes('GUARDIAN') || types.includes('CLIENT') || types.includes('SSA')
}

/** What the screen offers: its sections, whether the admin notes are read, whether anything is written. */
export type SsaReach = { tabs: SsaTab[]; notes: boolean; write: boolean }

/** App Control's Notes row, asked under the same id by the server (app/ssa.py NOTES_FEATURE). */
export const SSA_NOTES_FEATURE = 'ssa-profiles.notes'
/** Whom the notes open to while that row names no badge (app/ssa.py NOTES_FLOOR): Admin and every badge above it,
 *  in the order of access (lib/editions EDITION_BADGES, highest first). */
export const SSA_NOTES_FLOOR: readonly string[] = EDITION_BADGES.slice(0, EDITION_BADGES.indexOf('ADMIN') + 1)

// Whether the admin notes are open, as the roster said; where it said nothing (the slices' roster, the one an uncut
// viewer is drawn first) as the server decides it (app/ssa.py notes_open): the master; the badges the Notes row names,
// a role read as its badge; else Admin and above. A cut viewer is never offered them whatever this says (ssaReach).
export function ssaNotesOpen(said: boolean | null,
  user: { isMaster?: boolean; types?: string[]; role?: string } | null | undefined, rules: Record<string, string[]>): boolean {
  if (said !== null) return said
  const rule = rules[SSA_NOTES_FEATURE]
  return !!user && badgeRuleAllows(rule?.length ? rule : [...SSA_NOTES_FLOOR], user)
}

// The reach of a session: the master everything; a widening badge every section and the notes, writing nothing; an…
export function ssaReach(viewer: SsaViewer, narrowed: boolean, master: boolean, notes: boolean | null = null): SsaReach {
  const every = SSA_TABS.map((t) => t.id) as SsaTab[]
  if (master) return { tabs: every, notes: true, write: true }
  // before the roster answers, a narrowed session here is an SSA: the only cut kind this app opens (ssa.gate)
  const kind = viewer || (narrowed ? 'ssa' : 'all')
  // the notes are the server's to open (Admin and up, or App Control's Notes row); unsaid, they stay shut
  if (kind === 'master' || kind === 'all') {
    return notes ? { tabs: every, notes: true, write: false } : { tabs: every.filter((t) => t !== 'notes'), notes: false, write: false }
  }
  if (kind === 'ssa') return { tabs: ['overview', 'documents', 'activity'], notes: false, write: false }
  return { tabs: ['overview', 'documents'], notes: false, write: false }
}

/** Settings › My Work hides Documents from everyone but the master: the section, and every panel on it, is out of
 *  reach. The master's own session is never cut. */
export const withoutDocuments = (reach: SsaReach, master: boolean, hidden: boolean): SsaReach =>
  (master || !hidden ? reach : { ...reach, tabs: reach.tabs.filter((t) => t !== 'documents') })

/** The section the address names when this reach holds it, else Overview. */
export const tabWithin = (tab: SsaTab, reach: SsaReach): SsaTab => (reach.tabs.includes(tab) ? tab : 'overview')

/** Which entry edits a session makes: the Documents', the Activity's. */
export type SsaListEdits = { docs: boolean; activity: boolean }

/** The panel the address names when this reach may open it: Share for all, the note form for a note writer, the edit
 * for an editor, an entry's edit for the maker of that list's edition. */
export function askWithin(ask: SsaAsk | null, reach: SsaReach, edit = false, note = false,
  lists: SsaListEdits = { docs: false, activity: false }): SsaAsk | null {
  if (!ask) return null
  switch (ask.kind) {
    case 'share': return ask
    case 'edit': return edit ? ask : null
    case 'doc-edit': return lists.docs && reach.tabs.includes('documents') ? ask : null
    case 'activity-edit': return lists.activity && reach.tabs.includes('activity') ? ask : null
    case 'note': return reach.write || note ? ask : null
  }
}

/* ---------- the SSA's details and notes, edited (Settings › Editions) ---------- */

/** The edition the SSA's details belong to (Editions.gs; the door is Python's ssaProfileEdit). */
export const SSA_EDITION = 'ssa.profile'
/** The edition an admin note belongs to (the door is ssaProfileNoteAdd). */
export const SSA_NOTES_EDITION = 'ssa.notes'
/** The editions a Documents entry and an Activity entry are edited or removed by (Python's ssaProfileDocEdit and
 * ssaProfileActivityEdit); every director and badge above one makes them, and editionsMine names them so. */
export const SSA_DOCS_EDITION = 'ssa.documents'
export const SSA_ACTIVITY_EDITION = 'ssa.activity'
export const SSA_EDITIONS: readonly string[] = [SSA_EDITION, SSA_NOTES_EDITION, SSA_DOCS_EDITION, SSA_ACTIVITY_EDITION]

// The edit is offered to whom editionsMine names it for, the master too (none while SSA runs on Apps Script, which has…
export const ssaMayEdit = (narrowed: boolean, editions: readonly string[]): boolean =>
  !narrowed && editions.includes(SSA_EDITION)

// Add note for a holder of the notes edition; the master files one in its own session on either engine (reach.write).
export const ssaMayNote = (narrowed: boolean, editions: readonly string[]): boolean =>
  !narrowed && editions.includes(SSA_NOTES_EDITION)

// The pencils on the Documents and Activity entries, for whom editionsMine names each list's edition (none while SSA
// runs on Apps Script, which has no door for them).
export const ssaListEdits = (narrowed: boolean, editions: readonly string[]): SsaListEdits => ({
  docs: !narrowed && editions.includes(SSA_DOCS_EDITION),
  activity: !narrowed && editions.includes(SSA_ACTIVITY_EDITION),
})

/** The writes a session is offered: a notes holder writes notes wherever it reads them. */
export const ssaWriteReach = (reach: SsaReach, note = false): SsaReach =>
  (note && reach.notes && !reach.write ? { ...reach, write: true } : reach)

export type SsaEditTie = { client_key: string; name: string; status: SsaStatus; why: string }

export type SsaEdit = {
  /** each field as the overview shows it now: the witness the save sends back */
  raw: Record<string, string>
  locked: Record<string, EditLock>
  ties: SsaEditTie[]
  /** the client records the phone and the e-mail land on; the agency and office address stay on the SSA's own row */
  records: string[]
  /** every active client, for ticking the SSA onto their records */
  clients: SsaEditClient[]
}

/** ssaProfileOverview's `edit` (asked with edit: true, for a session the edit door lets in); null when it carries none. */
export function ssaEditOf(raw: unknown): SsaEdit | null {
  const e = rec(rec(raw).edit)
  if (!Object.keys(e).length) return null
  const locked: Record<string, EditLock> = {}
  for (const [k, v] of Object.entries(rec(e.locked))) {
    const l = rec(v)
    if (str(l.why)) locked[k] = str(l.door) ? { why: str(l.why), door: str(l.door) } : { why: str(l.why) }
  }
  const ties = rowsIn(e.ties).map((v) => {
    const t = rec(v)
    return { client_key: str(t.client_key), name: str(t.name), status: oneOf(t.status, STATUSES, 'active'), why: str(t.why) }
  }).filter((t) => t.client_key)
  const records = rowsIn(e.records).map(str).filter(Boolean)
  const clients = rowsIn(e.clients).map((v) => {
    const c = rec(v)
    return { client_key: str(c.client_key), name: str(c.name), on: c.on === true, why: str(c.why) }
  }).filter((c) => c.client_key)
  return { raw: editRawOf(e.raw), locked, ties, records, clients }
}

/** One active client in the edit panel's list: ticked when its record names the SSA; `why` keeps a tick fixed. */
export type SsaEditClient = { client_key: string; name: string; on: boolean; why: string }

/** What ticking and unticking would send (ssaProfileClients): the clients newly ticked, and those unticked. */
export function clientsChange(list: SsaEditClient[], ticked: Record<string, boolean>): { add: string[]; remove: string[] } {
  const add = list.filter((c) => !c.on && ticked[c.client_key]).map((c) => c.client_key)
  const remove = list.filter((c) => c.on && !c.why && ticked[c.client_key] === false).map((c) => c.client_key)
  return { add, remove }
}

const EDIT_OWN: { key: string; label: string; kind: EditKind; hint?: string }[] = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'agency', label: 'Agency', kind: 'text', hint: 'Blank goes back to the agency the e-mail\'s domain names.' },
  { key: 'phone', label: 'Phone', kind: 'phone' },
  { key: 'email', label: 'Email', kind: 'email', hint: 'An SSA\'s own sign-in finds their clients by this e-mail.' },
  { key: 'office_address', label: 'Office address', kind: 'text' },
]

/** The fields kept on the SSA's own row rather than on the client records. */
const OWN_ROW = ['agency', 'office_address']

/** The edit panel's fields, in the overview's order; a field the door does not write is drawn locked with its reason. */
export function ssaEditFields(e: SsaEdit): EditField[] {
  return EDIT_OWN.filter((f) => f.key in e.raw).map((f) => {
    const out: EditField = { key: f.key, label: f.label, kind: f.kind, raw: e.raw[f.key] }
    if (f.hint) out.hint = f.hint
    if (e.locked[f.key]) out.lockedBy = e.locked[f.key]
    return out
  })
}

/** The panel's opening line: where the phone and the e-mail land, and where the agency and office address stay. */
export function ssaEditIntro(name: string, e: SsaEdit): string {
  const n = e.records.length
  const lands = n ? `Phone and email land on ${n === 1 ? 'the client record' : `all ${n} client records`} that name them.`
    : 'No client record here takes the phone or email.'
  const own = OWN_ROW.some((k) => k in e.raw && !e.locked[k]) ? ' Agency and office address are kept on the SSA\'s own record.' : ''
  return `${name} · Only the fields you change are sent. ${lands}${own}`
}

type Said = { v: string; active: boolean }

/** ssaMost_: the most common non-blank value, the first seen on a tie. */
function most(list: string[]): string {
  const count = new Map<string, number>()
  let best = ''
  let n = 0
  for (const v of list) {
    if (!v) continue
    const c = (count.get(v) ?? 0) + 1
    count.set(v, c)
    if (c > n) {
      best = v
      n = c
    }
  }
  return best
}

/** ssaPick_: what the current clients' records say most, else what any record says. */
const pick = (list: Said[]): string => most(list.filter((x) => x.active).map((x) => x.v)) || most(list.map((x) => x.v))

// The roster from the clients slice (lane 1), as ssaProfileRoster answers it (ssaIndexBuild_ over the current…
export function rosterFrom(rows: unknown[], faces: Record<string, string> = {}): { ssas: Record<string, unknown>[]; why: string[]; degraded: boolean; partial: boolean } {
  const by = new Map<string, { names: Said[]; phones: Said[]; emails: Said[]; counties: Said[]; clients: number; active: boolean }>()
  const seen = new Set<string>()
  let partial = false
  for (const raw of rows) {
    const r = rec(raw)
    const name = text(r.name)
    const client = str(r.client_key) || nameKey(name)
    if (!client || seen.has(client)) continue
    seen.add(client)
    const live = clientLive(r)
    if (!text(r.ssa_name)) {
      if (live) partial = true
      continue
    }
    const key = ssaKeyOf(r.ssa_name)
    if (!key) continue
    const g = by.get(key) ?? { names: [], phones: [], emails: [], counties: [], clients: 0, active: false }
    g.names.push({ v: text(r.ssa_name, 120), active: live })
    const phone = phoneOf(r.ssa_phone)
    if (phone) g.phones.push({ v: phone, active: live })
    const email = emailOf(r.ssa_email)
    if (email) g.emails.push({ v: email, active: live })
    const county = text(r.county, 80)
    if (county) g.counties.push({ v: county, active: live })
    g.clients++
    if (live) g.active = true
    by.set(key, g)
  }
  const ssas = [...by.entries()].map(([key, g]) => {
    const email = pick(g.emails)
    return { key, name: pick(g.names), phone: pick(g.phones), email, agency: agencyOf(email), county: pick(g.counties),
      clients: g.clients, status: g.active ? 'active' : 'inactive', avatar: faces[key.slice(4)] ?? '' }
  })
  ssas.sort((a, b) => a.name.localeCompare(b.name))
  return { ssas, why: [], degraded: false, partial }
}

const byName = (a: RosterRow, b: RosterRow) => a.name.localeCompare(b.name)

// The switcher's list: the active SSAs by name, then the inactive ones when asked; the search reads name, agency…
export function switcherSsas(rows: RosterRow[], query: string, showInactive: boolean, hideCounty = false): RosterRow[] {
  const q = query.trim().toLowerCase()
  const hit = (r: RosterRow) =>
    !q || [r.name, r.agency, hideCounty ? '' : r.county, r.email].some((v) => v.toLowerCase().includes(q))
  const active = rows.filter((r) => r.status === 'active' && hit(r)).sort(byName)
  if (!showInactive) return active
  return [...active, ...rows.filter((r) => r.status === 'inactive' && hit(r)).sort(byName)]
}

/** The SSA the screen opens on when the address names none: the first active one by name. */
export function defaultSsa(rows: RosterRow[]): RosterRow | null {
  return switcherSsas(rows, '', false)[0] ?? [...rows].sort(byName)[0] ?? null
}

/** The SSA an address names: its key, else its name folded. Never a near match. */
export function resolveSsa(want: string, rows: RosterRow[]): RosterRow | null {
  const w = str(want)
  if (!w) return null
  return rows.find((r) => r.key === w) ?? rows.find((r) => r.key === ssaKeyOf(w)) ?? null
}

// The switcher's second line: the agency, else the county unless hidden.
export const rosterLine = (r: Pick<RosterRow, 'agency' | 'county'>, hideCounty = false): string =>
  r.agency || (hideCounty ? '' : r.county)

/* ---------- Overview ---------- */

export type SsaDetails = {
  key: string
  name: string
  phone: string
  email: string
  agency: string
  county: string
  office_address: string
  avatar: string
  status: SsaStatus
}

export type SsaClient = { client_key: string; name: string; house: string; house_label: string; avatar: string; status: SsaStatus }

export type SsaOverview = {
  ssa: SsaDetails
  clients: SsaClient[]
  why: string[]
  degraded: boolean
  /** what every session but the master's own leaves out; null when the answer carries none */
  hidden?: SsaHidden | null
}

/** ssaProfileOverview's answer: the SSA, then their clients in its own order (the current first, each by name). */
export function overviewOf(raw: unknown): SsaOverview {
  const o = rec(raw)
  const s = rec(o.ssa)
  const email = str(s.email)
  const clients = rowsIn(o.clients).map((v) => {
    const c = rec(v)
    const name = str(c.name)
    return {
      client_key: str(c.client_key) || nameKey(name),
      name,
      house: str(c.house),
      house_label: str(c.house_label),
      avatar: str(c.avatar),
      status: oneOf(c.status, STATUSES, 'active'),
    }
  }).filter((c) => c.name && c.client_key)
  return {
    ssa: {
      key: str(s.key),
      name: str(s.name),
      phone: str(s.phone),
      email,
      agency: str(s.agency) || agencyOf(email),
      county: str(s.county),
      office_address: str(s.office_address),
      avatar: str(s.avatar),
      status: oneOf(s.status, STATUSES, 'active'),
    },
    clients,
    why: whyOf(o.why),
    degraded: o.degraded === true,
    hidden: ssaHiddenOf(raw),
  }
}

/** COUNTY / AGENCY as one line: both when both are known; the agency alone when the county is hidden. */
export function countyAgency(d: Pick<SsaDetails, 'county' | 'agency'>, hideCounty = false): string {
  if (hideCounty) return d.agency
  const county = d.county && !/county/i.test(d.county) ? `${d.county} County` : d.county
  return [county, d.agency].filter(Boolean).join(' · ')
}

/** The line under a client: their SSA's role, then the house; the house alone when the role is hidden. */
export const clientLine = (c: Pick<SsaClient, 'house_label' | 'house'>, hideRole = false): string =>
  [hideRole ? '' : 'Service and Support Administrator', c.house_label || c.house].filter(Boolean).join(' · ')

/* ---------- what Settings › My Work hides ---------- */

/** Settings › My Work's SSA parts, as the overview's and the notes' answers carry them (SsaProfiles.gs ssaDisplay_). */
export type SsaHidden = { updated: boolean; county: boolean; count: boolean; role: boolean }

export const SSA_SHOWN: SsaHidden = { updated: false, county: false, count: false, role: false }

const SSA_HIDE_WORDS: Record<keyof SsaHidden, string> = {
  updated: 'the Updated stamps',
  county: 'the county before the agency',
  count: 'the clients count',
  role: 'the role on each client',
}

// An answer's display.hidden; null when it carries none — switches that could not be read hide nothing.
export function ssaHiddenOf(raw: unknown): SsaHidden | null {
  const h = rec(rec(rec(raw).display).hidden)
  if (!Object.keys(h).length) return null
  return { updated: h.updated === true, county: h.county === true, count: h.count === true, role: h.role === true }
}

/** What this session leaves out: nothing for the master's own session, nothing when the answer said nothing. */
export const ssaHiddenFor = (master: boolean, hidden: SsaHidden | null | undefined): SsaHidden =>
  (master || !hidden ? SSA_SHOWN : hidden)

// Whether this session leaves the county out, everywhere in SSA.
export const ssaCountyHidden = (master: boolean, overview: Pick<SsaOverview, 'hidden'> | null | undefined): boolean =>
  ssaHiddenFor(master, overview?.hidden).county || (!overview && !master)

/** The master's own session: which parts everyone else does not see. '' when none is. */
export function ssaForUsersLine(master: boolean, hidden: SsaHidden | null | undefined): string {
  if (!master || !hidden) return ''
  const parts = (Object.keys(SSA_HIDE_WORDS) as (keyof SsaHidden)[]).filter((k) => hidden[k]).map((k) => SSA_HIDE_WORDS[k])
  if (!parts.length) return ''
  const words = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `Hidden from everyone else by Settings › My Work: ${words}. You see everything.`
}

/* ---------- Documents ---------- */

export type SsaDocKind = 'isp' | 'client_doc' | 'mail'
const DOC_KINDS: SsaDocKind[] = ['isp', 'client_doc', 'mail']

export type SsaDoc = {
  id: string
  title: string
  kind: SsaDocKind
  client_key: string
  client_name: string
  date: string
  file_id: string
  mime: string
  source: string
}

export type SsaDocuments = { docs: SsaDoc[]; why: string[]; degraded: boolean }

export const DOC_KIND_LABEL: Record<SsaDocKind, string> = { isp: 'ISP', client_doc: 'Client document', mail: 'Mail' }

/** ssaProfileDocuments' answer, in its own order (newest first). */
export function documentsOf(raw: unknown): SsaDocuments {
  const o = rec(raw)
  const docs = rowsIn(o, 'docs', 'rows').map((v, i) => {
    const d = rec(v)
    const fileId = str(d.file_id)
    return {
      id: str(d.id) || fileId || `doc-${i}`,
      title: str(d.title) || str(d.name),
      kind: oneOf(d.kind, DOC_KINDS, 'client_doc'),
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

/** SSA_LIST_TITLE_MAX: the longest title an edited entry keeps. */
export const LIST_TITLE_MAX = 200

/** The removal's own change: the entry's state, from shown. */
export const LIST_SHOWN = 'shown'
export const LIST_REMOVE = 'removed'

/** A Documents entry's fields on the shared record panel: what it is called and its day; its file stays its own. */
export const docEditFields = (d: Pick<SsaDoc, 'title' | 'date'>): EditField[] => [
  { key: 'title', label: 'Title', kind: 'text', raw: d.title, max: LIST_TITLE_MAX },
  { key: 'date', label: 'Date', kind: 'date', raw: d.date, hint: 'Blank leaves the document undated.' },
]

/** A row opens only when it names a file; the door serves only this SSA's own. */
export const docOpens = (d: Pick<SsaDoc, 'file_id'>): boolean => !!d.file_id

export function docLine(d: Pick<SsaDoc, 'client_name' | 'kind' | 'date'>): string {
  return [d.client_name, DOC_KIND_LABEL[d.kind], dateWords(d.date)].filter(Boolean).join(' · ')
}

/* ---------- Activity ---------- */

export type SsaActivityKind = 'note' | 'sms' | 'call' | 'mail' | 'record'
const ACTIVITY_KINDS: SsaActivityKind[] = ['note', 'sms', 'call', 'mail', 'record']

export const ACTIVITY_KIND_LABEL: Record<SsaActivityKind, string> = {
  note: 'Admin note', sms: 'Text', call: 'Call', mail: 'E-mail', record: 'Client record',
}

export type SsaActivityItem = { id: string; at: string; kind: SsaActivityKind; title: string; body: string; by: string; client_key: string }

export type FollowStatus = 'overdue' | 'to_schedule' | 'current' | ''
const FOLLOW_STATUSES: FollowStatus[] = ['overdue', 'to_schedule', 'current', '']

export type SsaFollowup = { client_key: string; name: string; what: string; due: string; status: FollowStatus }

export type SsaActivity = { items: SsaActivityItem[]; followups: SsaFollowup[]; why: string[]; degraded: boolean; total: number | null }

/** ssaProfileActivity's answer, in its own order: the items newest first, then one follow-up per current client. */
export function activityOf(raw: unknown): SsaActivity {
  const o = rec(raw)
  const items = rowsIn(o, 'items', 'rows').map((v, i) => {
    const x = rec(v)
    return {
      id: str(x.id) || `activity-${i}`,
      at: str(x.at),
      kind: oneOf(x.kind, ACTIVITY_KINDS, 'record'),
      title: str(x.title),
      body: str(x.body),
      by: str(x.by),
      client_key: str(x.client_key),
    }
  }).filter((x) => x.title || x.body)
  const followups = rowsIn(o.followups).map((v) => {
    const f = rec(v)
    const name = str(f.name)
    return { client_key: str(f.client_key) || nameKey(name), name, what: str(f.what), due: str(f.due),
      status: oneOf(f.status, FOLLOW_STATUSES, '') }
  }).filter((f) => f.name)
  return { items, followups, why: whyOf(o.why), degraded: o.degraded === true, total: num(o.total) }
}

/** The Activity entry an admin note is: `note_<the note's id>`; '' for any other entry. */
export const noteIdOf = (x: Pick<SsaActivityItem, 'id' | 'kind'>): string =>
  (x.kind === 'note' && x.id.startsWith('note_') ? x.id.slice('note_'.length) : '')

// An Activity entry's fields on the shared record panel: its title and its text — an admin note's whole text, the
// note's own, passed as `noteBody`; when it happened, its kind and who it was by stay as recorded.
export function activityEditFields(x: Pick<SsaActivityItem, 'title' | 'body' | 'kind'>, noteBody?: string): EditField[] {
  const note = x.kind === 'note'
  return [
    { key: 'title', label: 'Title', kind: 'text', raw: x.title, max: LIST_TITLE_MAX },
    { key: 'body', label: note ? 'Note' : 'Text', kind: 'textarea', raw: note ? noteBody ?? x.body : x.body, max: NOTE_MAX,
      ...(note ? { hint: 'The note itself: Overview\'s admin notes show the change too.' } : {}) },
  ]
}

/** "<by> · <date>", or "<Kind> · <date>" when nobody is named. */
export function activityMeta(x: Pick<SsaActivityItem, 'by' | 'kind' | 'at'>): string {
  return [x.by || ACTIVITY_KIND_LABEL[x.kind], stampWords(x.at)].filter(Boolean).join(' · ')
}

/** "<what> · follow-up", with the day it is due when known. */
export function followLine(f: Pick<SsaFollowup, 'what' | 'due'>): string {
  const what = f.what ? `${f.what} · follow-up` : 'Follow-up'
  const due = dateWords(f.due)
  return due ? `${what} · due ${due}` : what
}

/* ---------- admin notes ---------- */

export type SsaNote = { id: string; at: string; by: string; body: string }
export type SsaNotes = { notes: SsaNote[]; hidden?: SsaHidden | null }

/** ssaProfileNotes' answer, in its own order (newest first). */
export function notesOf(raw: unknown): SsaNotes {
  const notes = rowsIn(raw, 'notes', 'rows').map((v, i) => {
    const n = rec(v)
    return { id: str(n.id) || `note-${i}`, at: str(n.at), by: str(n.by), body: str(n.body) }
  }).filter((n) => n.body)
  return { notes, hidden: ssaHiddenOf(raw) }
}

export const NOTE_MAX = 4000

/* ---------- the pills ---------- */

export type PillTint = 'mint' | 'amber' | 'danger' | 'slate' | 'blue' | 'lavender'
export type PillMeta = { label: string; tint: PillTint }

export const FOLLOW_META: Record<Exclude<FollowStatus, ''> | 'unknown', PillMeta> = {
  overdue: { label: 'Overdue', tint: 'danger' },
  to_schedule: { label: 'To Schedule', tint: 'amber' },
  current: { label: 'Current', tint: 'mint' },
  unknown: { label: 'Unknown', tint: 'slate' },
}

export const followMeta = (s: FollowStatus): PillMeta => FOLLOW_META[s || 'unknown']

/* ---------- the panel's heading, and the Actions menu ---------- */

const PANEL_LABEL: Record<SsaAsk['kind'], string> = {
  share: 'Share', edit: 'Edit details', note: 'Admin notes', 'doc-edit': 'Edit document', 'activity-edit': 'Edit activity',
}

export const panelLabel = (ask: SsaAsk): string => PANEL_LABEL[ask.kind]

export function panelTitle(ask: SsaAsk, name: string): string {
  return ask.kind === 'share' ? name : ask.kind === 'note' ? `Add note · ${name}` : `${PANEL_LABEL[ask.kind]} · ${name}`
}

export type MenuItem =
  | { id: 'note'; label: string; ask: SsaAsk }
  | { id: 'edit'; label: string; ask: SsaAsk }
  | { id: 'copy-email'; label: string; value: string; why: string }
  | { id: 'call'; label: string; href: string; why: string }
  | { id: 'open-client'; label: string; href: string; why: string }

// The Actions menu: Edit details for an editor, Add note for a writer; the SSA's e-mail and phone; the first client.
export function actionGroups(d: Pick<SsaDetails, 'email' | 'phone'> | null, clients: SsaClient[] | null,
  write: boolean, edit = false): { label: string; items: MenuItem[] }[] {
  const first = clients?.[0] ?? null
  const reading = d === null
  const own: MenuItem[] = [
    ...(edit ? [{ id: 'edit', label: 'Edit details', ask: { kind: 'edit' } } as MenuItem] : []),
    ...(write ? [{ id: 'note', label: 'Add note', ask: { kind: 'note' } } as MenuItem] : []),
  ]
  return [
    ...(own.length ? [{ label: 'SSA actions', items: own }] : []),
    {
      label: 'Contact',
      items: [
        { id: 'copy-email', label: 'Copy e-mail', value: d?.email ?? '', why: reading ? 'Reading the SSA…' : d?.email ? '' : 'No e-mail on file' },
        { id: 'call', label: 'Call', href: d?.phone ? telHref(d.phone) : '', why: reading ? 'Reading the SSA…' : d?.phone ? '' : 'No phone on file' },
      ],
    },
    {
      label: 'Navigation',
      items: [{ id: 'open-client', label: 'Open first client in Clients', href: first ? clientHref(first.client_key) : '',
        why: clients === null ? 'Reading the clients…' : first ? '' : 'No client names this SSA' }],
    },
  ]
}

/* ---------- a read the server did not answer ---------- */

export const NOT_PUBLISHED = 'The server did not recognise this read: SSA answers once the platform release that carries it is live, and not during a visit.'

/** A refusal as the master is told it: "Unknown action." is the answer of a deployment that does not carry SSA. */
export function readRefusal(error: string): string {
  if (/unknown action/i.test(error)) return NOT_PUBLISHED
  return error || 'The read did not answer.'
}

export const NOT_OPEN = 'This part is not open to you.'

/** Whether a failure is a door shut to a session that is not the master: the app's 404 or the role list's 403. */
export const shutTo = (error: string, master: boolean): boolean =>
  !master && /unknown action|^this action is for/i.test(str(error))

/** A refusal as this session is told it. */
export const refusalFor = (error: string, master: boolean): string => (shutTo(error, master) ? NOT_OPEN : readRefusal(error))

/* ---------- share ---------- */

/** Who the SSA is and where they work — nothing about any client rides a share; no county when it is hidden. */
export function sharePayloadFor(row: Pick<RosterRow, 'key' | 'name' | 'agency' | 'county' | 'status'>, tab: SsaTab,
  hideCounty = false): SharePayload {
  const lines = [
    row.agency ? `Agency: ${row.agency}` : '',
    row.county && !hideCounty ? `County: ${row.county}` : '',
    `Status: ${row.status === 'inactive' ? 'Inactive' : 'Active'}`,
  ].filter(Boolean)
  return {
    title: row.name,
    subtitle: `SSA · ${tabLabel(tab)}`,
    appHref: ssaHref(row.key, tab),
    text: lines.join('\n'),
    icon: 'briefcase',
    filename: `${row.name} ${tabLabel(tab)}`,
  }
}
