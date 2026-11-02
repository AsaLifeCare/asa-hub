// CLIENT CANDIDATES — the shapes ClientCandidates.gs answers and the arithmetic the screen does on them.
// Pure: the page and the tests import the same code.
import type { SharePayload } from '@/stores/useShareStore'
import { ZONE, ohioDateTime, ohioToday } from '@/lib/ohio'
import { rankOf, standingOf, type Lead, type ReferralAnalysis, type Standing } from '@/lib/referralAnalysis'
import { textsOf, type StaffTexts } from '@/pages/features/staffprofiles/staffModel'
import { INTAKE_STAGES, foldStage, intakeStageOf, type IntakeStage } from '@/lib/intakeStages'
import { dayWords } from '@/pages/features/locations/locationModel'
import { clientHref, mailHref, telHref } from '@/pages/features/clientprofiles/clientModel'
import type { PillTint as SsaPillTint } from '@/pages/features/ssaprofiles/ssaModel'
import type { EditField, EditKind } from '@/lib/recordEdit'

/** The SSA pills' tints, and the intake stages' peach and pink. */
export type PillTint = SsaPillTint | 'peach' | 'pink'
export type PillMeta = { label: string; tint: PillTint }
export { mailHref, telHref }

/* ---------- small readers ---------- */

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const str = (v: unknown): string => (v == null || typeof v === 'object' ? '' : String(v).trim())
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
/** The first field of `o` that carries a value, among `keys`. */
const pick = (o: Rec, ...keys: string[]): string => {
  for (const k of keys) {
    const v = str(o[k])
    if (v) return v
  }
  return ''
}
function rowsIn(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw
  const o = rec(raw)
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[]
  return []
}
/** A state word folded to snake case: "Awaiting Confirmation" → awaiting_confirmation. */
const word = (v: unknown): string => str(v).toLowerCase().replace(/[\s-]+/g, '_')
const titled = (w: string): string => w.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const truthy = (v: unknown): boolean => ['true', 'yes', '1'].includes(str(v).toLowerCase())

export const NOT_ON_FILE = 'Not on file'

/** What an answer says it could not read, one sentence per source; a single sentence is one line. */
export function whyOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean)
  const s = str(v)
  return s ? [s] : []
}

/** A referral's day as YYYY-MM-DD — the portal's MM/DD/YY or an ISO stamp — or '' when it names no day. */
export function isoDay(v: unknown): string {
  const s = str(v)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/.exec(s)
  if (!us || Number(us[1]) < 1 || Number(us[1]) > 12 || Number(us[2]) < 1 || Number(us[2]) > 31) return ''
  let year = Number(us[3])
  if (year < 100) year += year < 69 ? 2000 : 1900
  return `${String(year).padStart(4, '0')}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
}

/** A calendar day or an instant, in the platform's words: 'Sep 01, 2026'; the text as written when it is neither. */
export function dateWords(v: string): string {
  const s = str(v)
  if (!s) return ''
  const day = isoDay(s)
  return (day ? dayWords(day) : dayWords(s)) || s
}

/** An instant with its clock; a bare day stays a day. */
export function stampWords(v: string): string {
  const s = str(v)
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return dateWords(s)
  return ohioDateTime(s) || s
}

const TO_THE_SECOND = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
})

/** An instant to the second, Ohio's clock: 'Sep 28, 2026, 2:03:22 PM'; a bare day stays a day. */
export function secondWords(v: string): string {
  const s = str(v)
  if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return stampWords(s)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : TO_THE_SECOND.format(d)
}

/* ---------- the sections and the address ---------- */

export const CANDIDATE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'actions', label: 'Actions' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'information', label: 'Information' },
  { id: 'intake', label: 'Intake' },
  { id: 'documents', label: 'Documents' },
  { id: 'activity', label: 'Activity Log' },
  { id: 'sms', label: 'SMS' },
  { id: 'transcripts', label: 'Transcripts' },
] as const

export type CandidateTab = (typeof CANDIDATE_TABS)[number]['id']

export function tabOf(v: string | null | undefined): CandidateTab {
  const hit = CANDIDATE_TABS.find((t) => t.id === v)
  return hit ? hit.id : 'overview'
}

export const tabLabel = (tab: CandidateTab): string => CANDIDATE_TABS.find((t) => t.id === tab)?.label ?? 'Overview'

export const APP_NAME = 'Client Candidates'
export const CANDIDATES_APP_ID = 'client-candidates'
export const CANDIDATES_PATH = '/app/client-candidates/profile'

/** What the one right panel holds. It rides the address as `panel=`. */
export type CandidateAsk =
  | { kind: 'share' }
  | { kind: 'note'; about: string }
  | { kind: 'stage' }
  | { kind: 'complete'; item: string }
  | { kind: 'reopen'; item: string }
  | { kind: 'file-assessment' }
  | { kind: 'consent' }
  | { kind: 'transcript'; id: string }
  | { kind: 'edit'; section: EditSection }
  | { kind: 'noteEdit'; id: string }
  | { kind: 'paper'; doc: PaperDoc }

/** The row's sections an edition's panel edits (clientCandidateEditRead). */
export type EditSection = 'information' | 'intake'
const EDIT_SECTIONS: EditSection[] = ['information', 'intake']

/** The papers filed here whose record on the row an edition changes. */
export type PaperDoc = 'assessment' | 'consent'
const PAPER_DOCS: PaperDoc[] = ['assessment', 'consent']

/** The panel's forms: each a press on the Potential Clients row, the master's or an edition holder's. */
export function isWriteAsk(ask: CandidateAsk): boolean {
  return ask.kind !== 'share' && ask.kind !== 'transcript'
}

/** What a released reader who is not the master is told when an address opens one of the forms. */
export const NOT_OPEN = 'This part is not open to you.'

const SEP = '~'

export function panelParam(ask: CandidateAsk | null): string {
  if (!ask) return ''
  switch (ask.kind) {
    case 'share': case 'stage': case 'file-assessment': case 'consent': return ask.kind
    case 'note': return ask.about ? ['note', ask.about].join(SEP) : 'note'
    case 'complete': case 'reopen': return [ask.kind, ask.item].join(SEP)
    case 'transcript': return ['transcript', ask.id].join(SEP)
    case 'edit': return ['edit', ask.section].join(SEP)
    case 'noteEdit': return ['noteEdit', ask.id].join(SEP)
    case 'paper': return ['paper', ask.doc].join(SEP)
  }
}

export function panelOf(v: string | null | undefined): CandidateAsk | null {
  const [kind, a = ''] = str(v).split(SEP)
  switch (kind) {
    case 'share': case 'stage': case 'file-assessment': case 'consent': return { kind }
    case 'note': return { kind, about: a }
    case 'complete': case 'reopen': return a ? { kind, item: a } : null
    case 'transcript': return a ? { kind, id: a } : null
    case 'edit': return (EDIT_SECTIONS as string[]).includes(a) ? { kind, section: a as EditSection } : null
    case 'noteEdit': return /^note_[1-9]\d{0,4}$/.test(a) ? { kind, id: a } : null
    case 'paper': return (PAPER_DOCS as string[]).includes(a) ? { kind, doc: a as PaperDoc } : null
    default: return null
  }
}

/** `?candidate=…&tab=…&panel=…` — the whole state of the screen. */
export function candidateQuery(candidate: string, tab: CandidateTab, panel: CandidateAsk | null = null): string {
  const p = new URLSearchParams()
  if (candidate) p.set('candidate', candidate)
  if (tab !== 'overview') p.set('tab', tab)
  const pp = panelParam(panel)
  if (pp) p.set('panel', pp)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const candidateHref = (candidate: string, tab: CandidateTab = 'overview'): string =>
  `${CANDIDATES_PATH}${candidateQuery(candidate, tab)}`

/** The same referral in the Potential Clients app's own profile. */
export const potentialClientHref = (candidate: string): string =>
  `/app/potential-clients/unique?record=${encodeURIComponent(candidate)}`

/** The client a converted referral became, in the Clients app. */
export const convertedHref = (clientKey: string): string => clientHref(clientKey)

/* ---------- the stages: the intake's six ---------- */

export type { IntakeStage }

/** The six, in order — what Update stage offers and the Pipeline filters by (lib/intakeStages). */
export const STAGES: readonly IntakeStage[] = INTAKE_STAGES
export const STAGE_IDS = STAGES.map((s) => s.id)

/** The stages a referral has left the intake in. */
export const CLOSED_STAGES = ['ready-for-intake', 'closed']
/** The stages a hand moved a referral into the intake with. */
export const MOVED_STAGES = ['discovery', 'assessment', 'placement-review']

/** The stage row's own word, folded ('Placement Review' → placement-review); the row keeps what it holds. */
export const stageId = (v: unknown): string => foldStage(v)

/** The intake stage a row's word shows as; '' for a word the intake does not know. */
export const intakeId = (v: unknown): string => intakeStageOf(v)?.id ?? ''

/** The stage as the intake names it; a word it does not know, as written. */
export const stageLabel = (v: string): string => {
  const s = intakeStageOf(v)
  if (s) return s.label
  const w = word(v)
  return w ? titled(w) : ''
}

export const stageMeta = (v: string): PillMeta => {
  const s = intakeStageOf(v)
  return s ? { label: s.label, tint: s.tint } : { label: stageLabel(v) || 'No stage', tint: 'slate' }
}

/** The intake stage after this one, while the referral is still in the intake. */
export function nextStageOf(v: string): IntakeStage | null {
  const s = intakeId(v)
  if (!s || CLOSED_STAGES.includes(s)) return null
  const order = STAGES.filter((x) => x.id !== 'closed')
  return order[order.findIndex((x) => x.id === s) + 1] ?? null
}

/* ---------- the roster, the switcher and the pipeline ---------- */

export type RosterRow = {
  /** the Potential Clients row id (LEAD_…) */
  key: string
  referral: string
  name: string
  /** the service requested, as the referral describes it */
  service: string
  stage: string
  zip: string
  county: string
  location: string
  next_step: string
  /** the intake coordinator: the referral's owner */
  owner: string
  source: string
  referred: string
  phone: string
  email: string
  rating: string
  expires: string
  /** the referral portal's alert went out */
  alerted: boolean
  /** the Potential Clients ranking (lib/referralAnalysis); null when not known here */
  rank: number | null
  avatar: string
  /** the referral's own notes field, as the file holds it */
  notes: string
}

export type Roster = { candidates: RosterRow[]; why: string[]; degraded: boolean }

/** Where the referral lives: the county when it is known, then the ZIP. */
export const placeOf = (county: string, zip: string): string =>
  [county ? `${county.replace(/\s+county$/i, '')} County` : '', zip ? `ZIP ${zip}` : ''].filter(Boolean).join(' · ')

/** A referral the scraper took from the county's portal says so; a hand-added one names its own source. */
export const sourceOf = (source: unknown, scrapedAt: unknown): string =>
  str(source) || (str(scrapedAt) ? 'County referral portal' : '')

function rosterRowOf(v: unknown): RosterRow {
  const x = rec(v)
  const zip = pick(x, 'zip', 'postal_code')
  const county = pick(x, 'county')
  return {
    key: pick(x, 'key', 'candidate', 'id'),
    referral: pick(x, 'referral_id', 'referral'),
    name: pick(x, 'name', 'client_name'),
    service: pick(x, 'service', 'description'),
    stage: stageId(x.stage),
    zip,
    county,
    location: pick(x, 'location') || placeOf(county, zip),
    next_step: pick(x, 'next_step'),
    owner: pick(x, 'owner', 'coordinator'),
    source: pick(x, 'source'),
    referred: pick(x, 'referred_at', 'referred', 'scraped_at'),
    phone: pick(x, 'phone'),
    email: pick(x, 'email'),
    rating: pick(x, 'rating', 'ai_rating'),
    expires: pick(x, 'expires', 'expiration_date'),
    alerted: x.alerted === true || truthy(x.sms_sent),
    rank: num(x.rank),
    avatar: pick(x, 'avatar'),
    notes: typeof x.notes === 'string' ? x.notes.trim() : '',
  }
}

/** clientCandidateRoster's answer: { candidates, why, degraded }, each referral once. */
export function rosterOf(raw: unknown): Roster {
  const seen = new Set<string>()
  const candidates = rowsIn(raw, 'candidates', 'rows').map(rosterRowOf).filter((r) => {
    if (!r.name || !r.key || seen.has(r.key)) return false
    seen.add(r.key)
    return true
  })
  candidates.sort(byName)
  return { candidates, why: whyOf(rec(raw).why), degraded: rec(raw).degraded === true }
}

// The roster from the potentialClients slice (lane 1), as clientCandidateRoster answers it: every referral on the…
export function rosterFrom(rows: unknown[], now: number = Date.now()): { candidates: Record<string, unknown>[]; why: string[]; degraded: boolean } {
  const seen = new Set<string>()
  const candidates: Record<string, unknown>[] = []
  for (const raw of rows) {
    const r = rec(raw)
    const key = pick(r, 'id')
    const name = pick(r, 'client_name')
    if (!key || !name || seen.has(key)) continue
    seen.add(key)
    candidates.push({
      key, name, referral_id: pick(r, 'referral_id'), service: pick(r, 'description'), stage: stageId(r.stage),
      zip: pick(r, 'postal_code'), county: pick(r, 'county'), next_step: pick(r, 'next_step'), owner: pick(r, 'owner'),
      source: sourceOf(r.source, r.scraped_at), referred_at: pick(r, 'scraped_at', 'createdAt'), phone: pick(r, 'phone'),
      email: pick(r, 'email'), rating: pick(r, 'ai_rating'), expires: pick(r, 'expiration_date'), alerted: truthy(r.sms_sent),
      rank: rankOf(r as Lead, now), notes: typeof r.notes === 'string' ? r.notes : '',
    })
  }
  candidates.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { candidates, why: [], degraded: false }
}

const byName = (a: RosterRow, b: RosterRow) => a.name.localeCompare(b.name)
const byRank = (a: RosterRow, b: RosterRow) => (b.rank ?? -1) - (a.rank ?? -1) || byName(a, b)

function matcher(query: string): (r: RosterRow) => boolean {
  const q = query.trim().toLowerCase()
  return (r) => !q || [r.name, r.referral, r.service, stageLabel(r.stage), r.location, r.owner, r.next_step, r.phone, r.email]
    .some((v) => v.toLowerCase().includes(q))
}

// The switcher's list: every referral, by name; the search reads name, referral number, service, stage, location…
export function switcherCandidates(rows: RosterRow[], query: string): RosterRow[] {
  return rows.filter(matcher(query)).sort(byName)
}

/** How many the switcher draws at once; the search narrows the rest. */
export const SWITCHER_MAX = 120

// The referral still in the intake — not Ready for Intake or Closed, and in the intake by a hand or with its window…
export function inIntake(r: Pick<RosterRow, 'stage' | 'expires'>, today = ohioToday()): boolean {
  const shown = intakeId(r.stage)
  if (CLOSED_STAGES.includes(shown)) return false
  if (MOVED_STAGES.includes(shown)) return true
  const day = isoDay(r.expires)
  return !day || day >= today
}

// The referral the screen opens on when the address names none: the furthest along in the intake, else the one the…
export function defaultCandidate(rows: RosterRow[], today = ohioToday()): RosterRow | null {
  for (const s of [...MOVED_STAGES].reverse()) {
    const hit = rows.filter((r) => intakeId(r.stage) === s).sort(byRank)[0]
    if (hit) return hit
  }
  return rows.filter((r) => inIntake(r, today)).sort(byRank)[0] ?? [...rows].sort(byName)[0] ?? null
}

/** The referral an address names: its row id. Never a near match. */
export function resolveCandidate(want: string, rows: RosterRow[]): RosterRow | null {
  const w = str(want)
  return w ? rows.find((r) => r.key === w) ?? null : null
}

/** The switcher's second line: the stage, then where they live. */
export const rosterLine = (r: Pick<RosterRow, 'stage' | 'location'>): string =>
  [stageLabel(r.stage), r.location].filter(Boolean).join(' · ')

// The Pipeline's order: the furthest along in the intake first, then the referrals by the ranking, then a word the…
const PIPELINE_ORDER = ['placement-review', 'assessment', 'discovery', 'referral', '', 'ready-for-intake', 'closed']

// The Pipeline: every referral the search and the stage filter keep.
export function pipelineRows(rows: RosterRow[], query: string, stage: string): RosterRow[] {
  const hit = matcher(query)
  const at = (r: RosterRow) => PIPELINE_ORDER.indexOf(intakeId(r.stage))
  return rows.filter((r) => (!stage || intakeId(r.stage) === stage) && hit(r))
    .sort((a, b) => at(a) - at(b) || byRank(a, b))
}

/** The Pipeline filter's choices: All, then the six in order, each with how many referrals it shows. */
export function stageCounts(rows: RosterRow[]): { id: string; label: string; count: number }[] {
  return [{ id: '', label: 'All', count: rows.length },
    ...STAGES.map((s) => ({ id: s.id, label: s.label, count: rows.filter((r) => intakeId(r.stage) === s.id).length }))]
}

/** The Pipeline's NEXT STEP: the one written on the referral, else the intake's next stage — said as such. */
export function pipelineNext(r: Pick<RosterRow, 'next_step' | 'stage'>): { text: string; recorded: boolean } {
  if (r.next_step) return { text: r.next_step, recorded: true }
  const next = nextStageOf(r.stage)
  return next ? { text: `Next stage: ${next.label}`, recorded: false } : { text: '', recorded: false }
}

/* ---------- a press on the referral's row ---------- */

/** What one press writes on the referral's row: the intake stage it moves to (one of the six, by id). */
export type Door = { fields: { stage: string } }

// The press an answer names — `{fields|patch|payload: {stage}}`, or the stage bare, by its label or its id; a stage…
export function doorOf(v: unknown): Door | null {
  const x = rec(v)
  const said = [rec(x.fields), rec(x.patch), rec(x.payload), x].map((s) => str(s.stage) || str(s.to_stage)).find(Boolean) ?? ''
  const s = foldStage(said)
  return s && STAGE_IDS.includes(s) ? { fields: { stage: s } } : null
}

/** What a press writes, in words: "Stage → Placement Review". */
export function doorWords(d: Door | null): string {
  return d ? `Stage → ${stageLabel(d.fields.stage)}` : ''
}

/** One press, as ClientCandidates.gs clientCandidateWrite takes it; the stage is sent as its id. */
export type CandidateWrite =
  | { kind: 'stage'; stage: string }
  | { kind: 'complete' | 'reopen'; item: string; note?: string }
  | { kind: 'note'; note: string; item?: string }

/* ---------- Overview and Information ---------- */

export type CandidateDetails = {
  key: string
  name: string
  referral: string
  service: string
  stage: string
  status_label: string
  location: string
  county: string
  zip: string
  owner: string
  source: string
  referred: string
  phone: string
  email: string
  avatar: string
  family: string
  important: string
  preferred_start: string
  rating: string
  expires: string
  /** the client the referral became, when it converted and the Clients app knows them */
  client_key: string
  client_name: string
  notes: string
  /** what the referral itself says: the lead page's fields (Scraper.gs SCRAPER_LEAD_HEADER) */
  diagnosis: string
  age: string
  gender: string
  funding: string
  frequency: string
}

export type NextStep = { item: string; action: string; owner: string; due: string; status: string; next_step: string }

export type ActivityKind = 'step' | 'stage' | 'note' | 'sms' | 'call' | 'mail' | 'document' | 'referral' | 'alert' | 'record'
const ACTIVITY_KINDS: ActivityKind[] = ['step', 'stage', 'note', 'sms', 'call', 'mail', 'document', 'referral', 'alert', 'record']

export type ActivityItem = {
  id: string
  at: string
  kind: ActivityKind
  title: string
  body: string
  by: string
  channel: string
  /** false when the step was tried and did not land */
  ok: boolean
  rehearsal: boolean
}

export type CandidateOverview = {
  candidate: CandidateDetails
  summary: string
  /** the scraper's AI rating of the referral (0–10, as written) and the notes it rated from */
  rating: string
  rating_notes: string
  open_actions: number | null
  docs_on_file: number | null
  docs_total: number | null
  next_step: NextStep | null
  attention: string[]
  recent: ActivityItem[]
  /** the answer names Potential Clients' leadOpened for this referral: opening it is the acknowledgement */
  opened: boolean
  why: string[]
  degraded: boolean
}

function detailsOf(candidate: unknown, information: unknown, client: unknown): CandidateDetails {
  const x = rec(candidate)
  const i = rec(information)
  const c = rec(client)
  const zip = pick(x, 'zip', 'postal_code') || pick(i, 'zip', 'postal_code')
  const county = pick(x, 'county') || pick(i, 'county')
  return {
    key: pick(x, 'key', 'id'),
    name: pick(x, 'name', 'client_name') || pick(i, 'full_name'),
    referral: pick(x, 'referral_id', 'referral') || pick(i, 'referral_id'),
    service: pick(x, 'service', 'description') || pick(i, 'service_requested', 'service'),
    stage: stageId(pick(x, 'stage')),
    status_label: pick(x, 'status_label') || pick(i, 'stage_label'),
    location: pick(x, 'location') || placeOf(county, zip),
    county,
    zip,
    owner: pick(x, 'owner', 'coordinator') || pick(i, 'intake_coordinator', 'owner'),
    source: pick(x, 'source') || pick(i, 'source'),
    referred: pick(x, 'referred_at', 'referred') || pick(i, 'referred_at', 'referred'),
    phone: pick(x, 'phone') || pick(i, 'phone'),
    email: pick(x, 'email') || pick(i, 'email'),
    avatar: pick(x, 'avatar'),
    family: pick(i, 'family', 'guardian', 'family_guardian') || pick(x, 'family', 'guardian'),
    important: pick(i, 'important_to_me', 'important') || pick(x, 'important_to_me'),
    preferred_start: pick(i, 'preferred_start') || pick(x, 'preferred_start'),
    rating: pick(x, 'rating', 'ai_rating') || pick(i, 'rating'),
    expires: pick(x, 'expires', 'expiration_date') || pick(i, 'expires'),
    client_key: pick(c, 'key', 'client_key') || pick(x, 'client_key'),
    client_name: pick(c, 'name') || pick(x, 'client_name_converted'),
    notes: typeof x.notes === 'string' ? x.notes.trim() : typeof i.notes === 'string' ? i.notes.trim() : '',
    diagnosis: pick(i, 'diagnosis') || pick(x, 'diagnosis'),
    age: pick(i, 'age', 'client_age') || pick(x, 'client_age'),
    gender: pick(i, 'gender', 'client_gender') || pick(x, 'client_gender'),
    funding: pick(i, 'funding_source') || pick(x, 'funding_source'),
    frequency: pick(i, 'frequency') || pick(x, 'frequency'),
  }
}

function nextStepOf(v: unknown): NextStep | null {
  const x = rec(v)
  const action = pick(x, 'label', 'action')
  if (!action) return null
  return { item: pick(x, 'id'), action, owner: pick(x, 'owner'), due: pick(x, 'due'), status: word(x.status),
    next_step: pick(x, 'next_step') }
}

function activityItemOf(v: unknown, i: number): ActivityItem {
  const x = rec(v)
  const kind = word(x.kind) as ActivityKind
  return {
    id: pick(x, 'id') || `activity-${i}`,
    at: pick(x, 'at'),
    kind: ACTIVITY_KINDS.includes(kind) ? kind : 'record',
    title: pick(x, 'title', 'step'),
    body: pick(x, 'body'),
    by: pick(x, 'by'),
    channel: pick(x, 'channel'),
    ok: x.ok !== false,
    rehearsal: x.rehearsal === true,
  }
}

const activityItems = (raw: unknown): ActivityItem[] =>
  rowsIn(raw, 'items').map(activityItemOf).filter((x) => x.title || x.body)

/** clientCandidateOverview's answer. */
export function overviewOf(raw: unknown): CandidateOverview {
  const o = rec(raw)
  const tiles = rec(o.tiles)
  const candidate = detailsOf(o.candidate, o.information, o.client)
  return {
    candidate,
    summary: pick(o, 'summary'),
    rating: pick(rec(o.rating), 'value') || candidate.rating,
    rating_notes: pick(rec(o.rating), 'notes'),
    open_actions: num(tiles.open_actions),
    docs_on_file: num(tiles.docs_on_file),
    docs_total: num(tiles.docs_total),
    next_step: nextStepOf(o.next),
    attention: whyOf(o.attention),
    recent: activityItems(o.recent),
    opened: pick(rec(o.opened), 'action') === 'leadOpened',
    why: whyOf(o.why),
    degraded: o.degraded === true,
  }
}

/** What is known of the referral: the overview's once read, over the roster's line. */
export function knownDetails(row: RosterRow, o: CandidateOverview | null): CandidateDetails {
  const d = o && (!o.candidate.key || o.candidate.key === row.key) ? o.candidate : null
  const or = (a: string | undefined, b: string) => a || b
  return {
    key: row.key,
    name: or(d?.name, row.name),
    referral: or(d?.referral, row.referral),
    service: or(d?.service, row.service),
    stage: or(d?.stage, row.stage),
    status_label: d?.status_label ?? '',
    location: or(d?.location, row.location),
    county: or(d?.county, row.county),
    zip: or(d?.zip, row.zip),
    owner: or(d?.owner, row.owner),
    source: or(d?.source, row.source),
    referred: or(d?.referred, row.referred),
    phone: or(d?.phone, row.phone),
    email: or(d?.email, row.email),
    avatar: or(d?.avatar, row.avatar),
    family: d?.family ?? '',
    important: d?.important ?? '',
    preferred_start: d?.preferred_start ?? '',
    rating: or(d?.rating, row.rating),
    expires: or(d?.expires, row.expires),
    client_key: d?.client_key ?? '',
    client_name: d?.client_name ?? '',
    notes: or(d?.notes, row.notes),
    diagnosis: d?.diagnosis ?? '',
    age: d?.age ?? '',
    gender: d?.gender ?? '',
    funding: d?.funding ?? '',
    frequency: d?.frequency ?? '',
  }
}

/** A referral the slice no longer carries, opened by its id: the overview's own record as a roster line. */
export function rowFromOverview(o: CandidateOverview): RosterRow | null {
  const c = o.candidate
  if (!c.key || !c.name) return null
  return {
    key: c.key, referral: c.referral, name: c.name, service: c.service, stage: c.stage, zip: c.zip, county: c.county,
    location: c.location, next_step: o.next_step?.action ?? '', owner: c.owner, source: c.source, referred: c.referred,
    phone: c.phone, email: c.email, rating: c.rating, expires: c.expires, alerted: false, rank: null, avatar: c.avatar,
    notes: c.notes,
  }
}

/** The scraper's AI rating in words: "9 of 10"; '' when the referral was never rated. */
export const ratingWords = (rating: string): string => (str(rating) ? `${str(rating)} of 10` : '')

/** The rating as a pill, tinted as the Potential Clients Pipeline tints it: 8+ worth a call, 5–7 worth reading. */
export function ratingMeta(rating: string): PillMeta | null {
  const n = num(rating)
  if (n === null) return null
  return { label: `AI rating ${ratingWords(rating)}`, tint: n >= 8 ? 'mint' : n >= 5 ? 'amber' : 'slate' }
}

// The referral's place in the Potential Clients ranking, as far as the ranking has been read — the same computation…
export type StandingRead = { state: 'loading' | 'failed' | 'ready'; standing: Standing | null }

export function standingRead(read: { state: 'loading' } | { state: 'failed' } | { state: 'ready'; analysis: ReferralAnalysis },
  key: string): StandingRead {
  return { state: read.state, standing: read.state === 'ready' ? standingOf(read.analysis, key) : null }
}

/** "1 of 3"; '' when either count is unknown. */
export const docsWords = (onFile: number | null, total: number | null): string =>
  onFile === null || total === null ? '' : `${onFile} of ${total}`

/** A due day as a pill: overdue, today, within three days, or the day itself. */
export function dueMeta(due: string, today = ohioToday()): PillMeta | null {
  const d = isoDay(due)
  if (!d) return due ? { label: `Due ${due}`, tint: 'slate' } : null
  const days = Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
  if (days < 0) return { label: 'Overdue', tint: 'danger' }
  if (days === 0) return { label: 'Due today', tint: 'amber' }
  if (days <= 3) return { label: `Due in ${days} day${days === 1 ? '' : 's'}`, tint: 'amber' }
  return { label: `Due ${dayWords(d)}`, tint: 'blue' }
}

/** The referral's window: open until a day, closing soon, or closed. */
export function windowMeta(expires: string, today = ohioToday()): PillMeta | null {
  const d = isoDay(expires)
  if (!d) return null
  if (d < today) return { label: 'Window closed', tint: 'slate' }
  const days = Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
  return days <= 14 ? { label: `Closes in ${days} day${days === 1 ? '' : 's'}`, tint: 'amber' } : { label: `Open until ${dayWords(d)}`, tint: 'mint' }
}

/** "<owner> · due <day>", as known. */
export function ownerDue(owner: string, due: string): string {
  return [owner, due ? `due ${dateWords(due)}` : ''].filter(Boolean).join(' · ')
}

/* ---------- Actions: the intake with the family ---------- */

export type ActionItem = {
  id: string
  label: string
  /** the intake phase it belongs to (Referral review, Discovery & assessment…) */
  title: string
  status: string
  open: boolean
  owner: string
  stage: string
  is_next: boolean
  due: string
  /** the next step written on the referral, on the step being worked */
  next_step: string
  /** the write on the referral that closes it; null when no press here may, with why */
  door: Door | null
  /** the write that reopens it once complete (its own stage again); null while it is open or the referral is closed */
  reopen: Door | null
  why: string
}

export type CandidateActions = {
  items: ActionItem[]
  next: ActionItem | null
  open: number | null
  attention: string[]
  why: string[]
  degraded: boolean
}

const DONE = ['done', 'auto', 'completed', 'complete', 'on_file', 'waived', 'converted']

export const actionDone = (status: string): boolean => DONE.includes(word(status))

/** clientCandidateActions' answer: the intake's steps in their own order. */
export function actionsOf(raw: unknown): CandidateActions {
  const o = rec(raw)
  const items: ActionItem[] = rowsIn(o, 'items').map((v, i) => {
    const x = rec(v)
    const status = word(x.status)
    return {
      id: pick(x, 'id') || `action-${i}`,
      label: pick(x, 'label', 'action'),
      title: pick(x, 'title'),
      status,
      open: typeof x.open === 'boolean' ? x.open : !actionDone(status),
      owner: pick(x, 'owner'),
      stage: stageId(pick(x, 'stage')),
      is_next: x.is_next === true,
      due: pick(x, 'due'),
      next_step: pick(x, 'next_step'),
      door: doorOf(x.complete),
      reopen: doorOf(x.reopen),
      why: pick(x, 'complete_why', 'why'),
    }
  }).filter((x) => x.label)
  return {
    items,
    next: items.find((x) => x.is_next) ?? items.find((x) => x.open) ?? null,
    open: num(o.open) ?? items.filter((x) => x.open).length,
    attention: whyOf(o.attention),
    why: whyOf(o.why),
    degraded: o.degraded === true,
  }
}

const ACTION_TINT: Record<string, PillTint> = {
  done: 'mint', auto: 'mint', completed: 'mint', complete: 'mint', on_file: 'mint', waived: 'mint', converted: 'mint',
  in_progress: 'blue', awaiting_confirmation: 'amber', pending: 'amber', in_review: 'lavender', missing: 'danger',
  overdue: 'danger',
}

const ACTION_WORD: Record<string, string> = {
  done: 'Completed', auto: 'Completed', complete: 'Completed', in_progress: 'In Progress',
}

export const actionStatusMeta = (status: string): PillMeta => {
  const w = word(status)
  return { label: ACTION_WORD[w] ?? (w ? titled(w) : 'Unknown'), tint: ACTION_TINT[w] ?? 'slate' }
}

export const openCount = (a: CandidateActions | null): number | null => (a ? a.open : null)

// The NEXT STEP column: the next step written on the referral, else what closes the step — its write on the…
export function nextStepWords(x: Pick<ActionItem, 'open' | 'door' | 'why' | 'next_step'>): string {
  if (!x.open) return ''
  return x.next_step || (x.door ? doorWords(x.door) : x.why)
}

/* ---------- Intake ---------- */

export type PlanStatus = 'completed' | 'awaiting_confirmation' | 'pending'
const PLAN_STATUSES: string[] = ['completed', 'awaiting_confirmation', 'pending']

export type PlanStep = { id: string; title: string; date: string; owner: string; status: PlanStatus; result: string; comments: string; detail: string }

export type Labelled = { label: string; value: string }

export type CandidateIntake = { plan: PlanStep[]; preferences: Labelled[]; support: Labelled[]; why: string[]; degraded: boolean }

export const PLAN_META: Record<PlanStatus, PillMeta> = {
  completed: { label: 'Completed', tint: 'mint' },
  awaiting_confirmation: { label: 'Awaiting Confirmation', tint: 'amber' },
  pending: { label: 'Pending', tint: 'slate' },
}

/** A labelled list, from [{label, value}] or from an object's own fields in their order. */
export function labelledOf(v: unknown): Labelled[] {
  if (Array.isArray(v)) {
    return v.map((x) => {
      const r = rec(x)
      const value = Array.isArray(r.value) ? r.value.map(str).filter(Boolean).join(', ') : pick(r, 'value')
      return { label: pick(r, 'label'), value }
    }).filter((x) => x.label)
  }
  return Object.entries(rec(v)).map(([k, val]) => ({
    label: titled(word(k)),
    value: Array.isArray(val) ? val.map(str).filter(Boolean).join(', ') : str(val),
  }))
}

// clientCandidateIntake's answer: the intake plan in its own order, then what the referral asks for and who is…
export function intakeOf(raw: unknown): CandidateIntake {
  const o = rec(raw)
  const plan = rowsIn(o, 'plan', 'steps').map((v, i) => {
    const x = rec(v)
    const st = word(x.status)
    return {
      id: pick(x, 'id') || `step-${i}`,
      title: pick(x, 'title', 'label'),
      date: pick(x, 'date', 'at'),
      owner: pick(x, 'owner'),
      status: (PLAN_STATUSES.includes(st) ? st : actionDone(st) ? 'completed' : 'pending') as PlanStatus,
      result: pick(x, 'result'),
      comments: pick(x, 'comments', 'comment'),
      detail: pick(x, 'detail'),
    }
  }).filter((x) => x.title)
  return {
    plan,
    preferences: labelledOf(o.preferences),
    support: [...labelledOf(o.support), ...labelledOf(o.network)],
    why: whyOf(o.why),
    degraded: o.degraded === true,
  }
}

/* ---------- Documents ---------- */

export type DocStatus = 'on_file' | 'pending' | 'in_review'

/** The contact preferences recorded with the consent. */
export type ContactPreferences = { method: string; best_time: string; who: string }

export type CandidateDoc = {
  id: string
  title: string
  group: string
  group_label: string
  status: DocStatus
  file_id: string
  /** a paper the door renders as a PDF (the referral summary, the assessment read from the plan); '' otherwise */
  render: string
  date: string
  source: string
  detail: string
  /** a paper this app files here now (the assessment at the Assessment stage, the consent) */
  can_file: boolean
  preferences: ContactPreferences | null
}

export type CandidateDocuments = { docs: CandidateDoc[]; on_file: number | null; total: number | null; why: string[]; degraded: boolean }

export const DOC_STATUS_META: Record<DocStatus, PillMeta> = {
  on_file: { label: 'On File', tint: 'mint' },
  pending: { label: 'Pending', tint: 'amber' },
  in_review: { label: 'In Review', tint: 'lavender' },
}

const docStatusOf = (v: unknown): DocStatus => {
  const w = word(v)
  if (w === 'on_file' || w === 'onfile' || w === 'filed') return 'on_file'
  if (w === 'in_review' || w === 'review' || w === 'reviewing') return 'in_review'
  return 'pending'
}

/** clientCandidateDocuments' answer, in its own order. */
export function documentsOf(raw: unknown): CandidateDocuments {
  const o = rec(raw)
  const docs = rowsIn(o, 'docs', 'documents').map((v, i): CandidateDoc => {
    const x = rec(v)
    const group = word(x.group)
    const prefs = rec(x.preferences)
    return {
      id: pick(x, 'id') || `doc-${i}`,
      title: pick(x, 'title', 'name'),
      group,
      group_label: pick(x, 'group_label') || (group ? titled(group) : ''),
      status: docStatusOf(x.status),
      file_id: pick(x, 'file_id'),
      render: pick(x, 'render'),
      date: pick(x, 'date'),
      source: pick(x, 'source'),
      detail: pick(x, 'detail', 'why'),
      can_file: x.can_file === true,
      preferences: x.preferences && typeof x.preferences === 'object'
        ? { method: pick(prefs, 'method'), best_time: pick(prefs, 'best_time'), who: pick(prefs, 'who') } : null,
    }
  }).filter((d) => d.title)
  const counts = rec(o.counts)
  return {
    docs,
    on_file: num(counts.on_file) ?? docs.filter((d) => d.status === 'on_file').length,
    total: num(counts.total) ?? docs.length,
    why: whyOf(o.why),
    degraded: o.degraded === true,
  }
}

/** The documents by group, in the answer's order; with no group named, one list. */
export function docGroups(docs: CandidateDoc[]): { group: string; label: string; docs: CandidateDoc[] }[] {
  const out: { group: string; label: string; docs: CandidateDoc[] }[] = []
  for (const d of docs) {
    const hit = out.find((g) => g.group === d.group)
    if (hit) hit.docs.push(d)
    else out.push({ group: d.group, label: d.group_label, docs: [d] })
  }
  return out
}

/** A row opens when it names a file or a paper the door renders; the door serves only this referral's own. */
export const docOpens = (d: Pick<CandidateDoc, 'file_id' | 'render'>): boolean => !!(d.file_id || d.render)

/** The right panel a paper is filed from here: the support assessment and the consent; null for any other. */
export function docFileAsk(d: Pick<CandidateDoc, 'id' | 'status' | 'can_file'>): CandidateAsk | null {
  if (d.id === 'assessment' && d.status === 'pending' && d.can_file) return { kind: 'file-assessment' }
  if (d.id === 'consent' && d.status !== 'on_file') return { kind: 'consent' }
  return null
}

/** The consent's contact preferences in words: "by Phone call · Mornings · ask for Rosa (daughter)". */
export function preferencesWords(p: ContactPreferences | null): string {
  if (!p) return ''
  return [p.method ? `by ${p.method}` : '', p.best_time, p.who ? `ask for ${p.who}` : ''].filter(Boolean).join(' · ')
}

/** The ways a family may want to be reached, for the consent's form. */
export const CONTACT_METHODS = ['Phone call', 'Text message', 'E-mail', 'Mail', 'In person']

export function docLine(d: Pick<CandidateDoc, 'source' | 'date' | 'detail'>): string {
  return [d.source, dateWords(d.date), d.detail].filter(Boolean).join(' · ')
}

/* ---------- Activity Log ---------- */

export type CandidateActivity = { items: ActivityItem[]; why: string[]; degraded: boolean; total: number | null }

/** clientCandidateActivity's answer, newest first as it comes. */
export function activityOf(raw: unknown): CandidateActivity {
  const o = rec(raw)
  return { items: activityItems(raw), why: whyOf(o.why), degraded: o.degraded === true, total: num(o.total) }
}

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  step: 'Intake step', stage: 'Stage', note: 'Note', sms: 'Text', call: 'Call', mail: 'E-mail', document: 'Document',
  referral: 'Referral', alert: 'Alert', record: 'Record',
}

/** "<by> · <channel> · <when, to the second>", or the kind when nobody is named. */
export function activityMeta(x: Pick<ActivityItem, 'by' | 'kind' | 'at' | 'channel'>): string {
  return [x.by || ACTIVITY_KIND_LABEL[x.kind], x.channel, secondWords(x.at)].filter(Boolean).join(' · ')
}

/* ---------- SMS: the platform's alerts about the referral ---------- */

/** One lead alert the platform sent the team about this referral (Scraper.gs scraperNotify's outbox row). */
export type PlatformAlert = { id: string; at: string; result: string; to: string; body: string; held_by: string }

export type CandidateAlerts = { alerts: PlatformAlert[]; why: string }

/** The texts answer's `alerts`, newest first as they come. */
export function alertsOf(raw: unknown): CandidateAlerts {
  const o = rec(raw)
  const alerts = rowsIn(o.alerts).map((v, i) => {
    const x = rec(v)
    return { id: pick(x, 'id') || `alert-${i}`, at: pick(x, 'at'), result: word(x.result), to: pick(x, 'to'),
      body: pick(x, 'body'), held_by: pick(x, 'held_by') }
  }).filter((a) => a.at || a.body)
  return { alerts, why: pick(o, 'alerts_why') }
}

/** The texts answer: the conversations (the Staff app's reader), and the platform's alerts about the referral. */
export const candidateTextsOf = (raw: unknown): StaffTexts & { platform: CandidateAlerts } => ({ ...textsOf(raw), platform: alertsOf(raw) })

const ALERT_WORD: Record<string, PillMeta> = {
  sent: { label: 'Sent', tint: 'mint' }, rehearsed: { label: 'Rehearsed', tint: 'lavender' },
  held: { label: 'Held', tint: 'amber' }, held_quiet: { label: 'Held (quiet hours)', tint: 'amber' },
  refused: { label: 'Not sent', tint: 'danger' }, failed: { label: 'Failed', tint: 'danger' },
}

export const alertMeta = (result: string): PillMeta => ALERT_WORD[word(result)] ?? { label: titled(word(result)) || 'Recorded', tint: 'slate' }

/* ---------- notes: the referral's own notes field ---------- */

/** How much a note may say. */
export const NOTE_MAX = 900

/** What a note adds to the referral's notes, before the server stamps it with the time and the author. */
export function notePreview(text: string, about: string): string {
  const words = text.replace(/\s+/g, ' ').trim()
  return `${about ? `${about}: ` : ''}${words}`
}

/** The notes' latest lines, newest first. */
export const latestNotes = (notes: string, n = 5): string[] =>
  str(notes).split(/\n+/).map((l) => l.trim()).filter(Boolean).reverse().slice(0, n)

/** One line of the notes and the id its edit names it by (note_<n>: the n-th line written, blank lines aside). */
export type NoteLine = { id: string; text: string }

/** The notes' latest lines with their ids, newest first. */
export const latestNoteLines = (notes: string, n = 5): NoteLine[] =>
  str(notes).split(/\n+/).map((l) => l.trim()).filter(Boolean).map((text, i) => ({ id: `note_${i + 1}`, text })).reverse().slice(0, n)

/* ---------- the panel's heading, and the Actions menu ---------- */

export function panelLabel(ask: CandidateAsk): string {
  switch (ask.kind) {
    case 'share': return 'Share'
    case 'note': return 'Add note'
    case 'stage': return 'Update stage'
    case 'complete': return 'Mark complete'
    case 'reopen': return 'Reopen'
    case 'file-assessment': return 'Support assessment'
    case 'consent': return 'Consent & contact preferences'
    case 'transcript': return 'Transcript'
    case 'edit': return ask.section === 'intake' ? 'Edit intake' : 'Edit information'
    case 'noteEdit': return 'Edit note'
    case 'paper': return 'Paper on the referral'
  }
}

export function panelTitle(ask: CandidateAsk, name: string): string {
  switch (ask.kind) {
    case 'share': return name
    case 'note': return `Add note · ${name}`
    case 'stage': return `Update stage · ${name}`
    case 'complete': return `Mark complete · ${name}`
    case 'reopen': return `Reopen · ${name}`
    case 'file-assessment': return `File the support assessment · ${name}`
    case 'consent': return `Consent & contact preferences · ${name}`
    case 'transcript': return 'Call transcript'
    case 'edit': return `${ask.section === 'intake' ? 'Intake' : 'Information'} · ${name}`
    case 'noteEdit': return `Edit note · ${name}`
    case 'paper': return `${ask.doc === 'consent' ? 'Consent & contact preferences' : 'Support assessment'} · ${name}`
  }
}

export type MenuItem =
  | { id: 'note'; label: string; ask: CandidateAsk }
  | { id: 'stage'; label: string; ask: CandidateAsk }
  | { id: 'copy-email'; label: string; value: string; why: string }
  | { id: 'call'; label: string; href: string; why: string }
  | { id: 'pipeline'; label: string; tab: CandidateTab }
  | { id: 'potential'; label: string; href: string }
  | { id: 'client'; label: string; href: string }

/* ---------- the editions (Settings › Editions): what a listed person makes beside the master ---------- */

/** Client Candidates' editions (app/editions.py CATALOGUE), in the order Settings lists them. */
export const CANDIDATE_EDITIONS = [
  'clientCandidates.information', 'clientCandidates.intake', 'clientCandidates.pipeline', 'clientCandidates.notes',
  'clientCandidates.documents',
] as const
export type CandidateEdition = (typeof CANDIDATE_EDITIONS)[number]

/** editionsMine's answer as Client Candidates keeps it: its own editions, once each, in catalogue order. */
export const candidateEditionsOf = (raw: unknown): CandidateEdition[] => {
  const list = Array.isArray(raw) ? raw.map((x) => String(x ?? '')) : []
  return CANDIDATE_EDITIONS.filter((e) => list.includes(e))
}

/** What this reader may do: `write` for the master; `editions` as editionsMine names them (none on Apps Script). */
export type Reach = { write: boolean; editions: readonly CandidateEdition[] }

export const reachOf = (write: boolean, editions: readonly CandidateEdition[] = []): Reach => ({ write, editions })

/** The editions whose doors only Python has: offered as editionsMine names them, the master's too. */
const PYTHON_EDITIONS: readonly CandidateEdition[] = ['clientCandidates.information', 'clientCandidates.intake']

/** The master's on either engine (a Python-only one as editionsMine names it); a holder its own. */
export const candidateCan = (reach: Reach, edition: CandidateEdition): boolean =>
  (reach.write && !PYTHON_EDITIONS.includes(edition)) || reach.editions.includes(edition)

/** Update stage, Mark complete and Reopen. */
export const mayPress = (reach: Reach): boolean => candidateCan(reach, 'clientCandidates.pipeline')

/** Add note. */
export const mayNote = (reach: Reach): boolean => candidateCan(reach, 'clientCandidates.notes')

/** A note's words changed or the note removed: Python's own door. */
export const mayNoteEdit = (reach: Reach): boolean => reach.editions.includes('clientCandidates.notes')

const SECTION_EDITION: Record<EditSection, CandidateEdition> = {
  information: 'clientCandidates.information', intake: 'clientCandidates.intake',
}

/** A section's edit panel: Python's own door. */
export const mayEdit = (reach: Reach, section: EditSection): boolean => reach.editions.includes(SECTION_EDITION[section])

/** The filed consent confirmed. */
export const mayConfirm = (reach: Reach): boolean => candidateCan(reach, 'clientCandidates.documents')

/** A filed paper's record on the row changed: Python's own door. */
export const mayPaper = (reach: Reach): boolean => reach.editions.includes('clientCandidates.documents')

/** Whether this reader opens a panel's form; a paper stored in Drive is the master's alone. */
export function formOpen(ask: CandidateAsk, reach: Reach): boolean {
  switch (ask.kind) {
    case 'note': return mayNote(reach)
    case 'stage': case 'complete': case 'reopen': return mayPress(reach)
    case 'file-assessment': return reach.write
    case 'consent': return reach.write || mayConfirm(reach)
    case 'edit': return mayEdit(reach, ask.section)
    case 'noteEdit': return mayNoteEdit(reach)
    case 'paper': return mayPaper(reach)
    default: return true
  }
}

/** The paper filed here whose record an edition changes: the consent once filed, an assessment filed here. */
export function paperOf(d: Pick<CandidateDoc, 'id' | 'status' | 'source'>): PaperDoc | null {
  if (d.id === 'consent' && d.status !== 'pending') return 'consent'
  if (d.id === 'assessment' && d.status === 'on_file' && d.source.startsWith('Filed')) return 'assessment'
  return null
}

/* ---------- an edition's panel: the raw values it opens on (clientCandidateEditRead) ---------- */

export type EditElsewhere = { field: string; label: string; why: string }

export type CandidateEdit = {
  section: string
  name: string
  fields: EditField[]
  /** the lines this panel does not change, each with where it is changed */
  elsewhere: EditElsewhere[]
  /** a note's id, filer and time; a paper's label and file name */
  id: string
  by: string
  at: string
  label: string
  file: string
}

const EDIT_KINDS: EditKind[] = ['text', 'textarea', 'date', 'phone', 'email', 'url', 'select']

/** clientCandidateEditRead's answer: each field as RecordEditBody draws it, its raw value the save's witness. */
export function candidateEditOf(raw: unknown): CandidateEdit {
  const o = rec(raw)
  const fields = rowsIn(o, 'fields').map((v): EditField | null => {
    const x = rec(v)
    const key = str(x.key)
    if (!key) return null
    const kind = (EDIT_KINDS as string[]).includes(str(x.kind)) ? (str(x.kind) as EditKind) : 'text'
    const options = Array.isArray(x.options) ? x.options.map((y) => (y == null ? '' : String(y))) : undefined
    const labels = rec(x.optionLabels)
    const lock = rec(x.lockedBy)
    const max = num(x.max)
    return {
      key, label: str(x.label) || key, kind, raw: typeof x.raw === 'string' ? x.raw : str(x.raw),
      ...(options ? { options, optionLabels: Object.fromEntries(Object.entries(labels).map(([k, w]) => [k, str(w)])) } : {}),
      ...(str(x.hint) ? { hint: str(x.hint) } : {}),
      ...(max ? { max } : {}),
      ...(str(lock.why) ? { lockedBy: { why: str(lock.why), ...(str(lock.door) ? { door: str(lock.door) } : {}) } } : {}),
    }
  }).filter((f): f is EditField => f !== null)
  const elsewhere = rowsIn(o, 'elsewhere').map((v) => {
    const x = rec(v)
    return { field: str(x.field), label: str(x.label), why: str(x.why) }
  }).filter((e) => e.label && e.why)
  return { section: str(o.section), name: str(o.name), fields, elsewhere, id: str(o.id), by: str(o.by), at: str(o.at),
    label: str(o.label), file: str(o.file) }
}

/** What an edition's panel says before its fields. */
export function editIntro(section: EditSection | 'note' | 'paper', name: string): string {
  switch (section) {
    case 'information': return `${name}'s details on the Potential Clients row. A line the row leaves empty stays empty until it is typed here.`
    case 'intake': return `The intake's next step and how ${name}'s family wants to be reached.`
    case 'note': return 'The note\'s words as they are on the referral. When it was written and by whom stay as written.'
    case 'paper': return 'The paper\'s record on the referral. The file itself stays in the referral\'s folder.'
  }
}

// The Actions menu: Add note and Update stage (the master's, and whom the editions name); the referral's e-mail…
export function actionGroups(key: string, d: Pick<CandidateDetails, 'email' | 'phone' | 'client_key'> | null,
  canWrite = false, editions: readonly CandidateEdition[] = []): { label: string; items: MenuItem[] }[] {
  const reading = d === null
  const reach = reachOf(canWrite, editions)
  const nav: MenuItem[] = [
    { id: 'pipeline', label: 'View all candidates', tab: 'pipeline' },
    { id: 'potential', label: 'Open in Potential Clients', href: potentialClientHref(key) },
  ]
  if (d?.client_key) nav.push({ id: 'client', label: 'Open in Clients', href: convertedHref(d.client_key) })
  const own: MenuItem[] = [
    ...(mayNote(reach) ? [{ id: 'note' as const, label: 'Add note', ask: { kind: 'note', about: '' } as CandidateAsk }] : []),
    ...(mayPress(reach) ? [{ id: 'stage' as const, label: 'Update stage', ask: { kind: 'stage' } as CandidateAsk }] : []),
  ]
  const writes: { label: string; items: MenuItem[] }[] = own.length ? [{ label: 'Candidate actions', items: own }] : []
  return [
    ...writes,
    {
      label: 'Contact',
      items: [
        { id: 'copy-email', label: 'Copy e-mail', value: d?.email ?? '', why: reading ? 'Reading the referral…' : d?.email ? '' : 'No e-mail on file' },
        { id: 'call', label: 'Call', href: d?.phone ? telHref(d.phone) : '', why: reading ? 'Reading the referral…' : d?.phone ? '' : 'No phone on file' },
      ],
    },
    { label: 'Navigation', items: nav },
  ]
}

/* ---------- a read the server did not answer ---------- */

export const NOT_PUBLISHED = 'The server did not recognise this read: Client Candidates answers once the platform release that carries it is live, and not during a visit.'

// A refusal as a sentence.
export function readRefusal(error: string): string {
  if (/unknown action/i.test(error)) return NOT_PUBLISHED
  return error || 'The read did not answer.'
}

/* ---------- share ---------- */

// Who the referral is and where it stands — never a phone, an e-mail, a diagnosis or anything the referral keeps…
export function sharePayloadFor(row: Pick<RosterRow, 'key' | 'name' | 'referral' | 'stage' | 'location'>, tab: CandidateTab): SharePayload {
  const lines = [
    row.referral ? `Referral: ${row.referral}` : '',
    row.stage ? `Stage: ${stageLabel(row.stage)}` : '',
    row.location ? `Location: ${row.location}` : '',
  ].filter(Boolean)
  return {
    title: row.name,
    subtitle: `${APP_NAME} · ${tabLabel(tab)}`,
    appHref: candidateHref(row.key, tab),
    text: lines.join('\n'),
    icon: 'user-round-plus',
    filename: `${row.name} ${tabLabel(tab)}`,
  }
}
