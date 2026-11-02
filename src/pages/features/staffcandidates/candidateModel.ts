// STAFF CANDIDATES — the shapes CandidateProfiles.gs answers and the arithmetic the screen does on them.
// Pure: the page and the tests import the same code.
import type { SharePayload } from '@/stores/useShareStore'
import { ohioDateTime, ohioDayOf, ohioToday } from '@/lib/ohio'
import { dayWords } from '@/pages/features/locations/locationModel'
import {
  STAGES, STAGE_LABEL, openConditions, profileRoute, stageItems, type ChecklistItem,
} from '@/pages/features/hiring/flow/shared'
import { mailHref, telHref } from '@/pages/features/clientprofiles/clientModel'
import type { PillMeta, PillTint } from '@/pages/features/ssaprofiles/ssaModel'
import type { EditField, EditKind } from '@/lib/recordEdit'
import type { EditionId } from '@/lib/editions'

export type { PillMeta, PillTint }
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

/** talentIsoDay_: a bare day as itself, an instant as the Ohio day it falls on; '' when unreadable. */
export function isoDay(v: unknown): string {
  const s = str(v)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s ? ohioDayOf(s) : ''
}

/** cndBy_: who a hiring record names, without the platform's own prefix or the time it appends. */
export function byOf(v: unknown): string {
  const s = str(v).replace(/\s+/g, ' ').slice(0, 200).replace(/^asa-hub:(manual-screen:|manual-onboarding:)?/i, '')
  return s.split(' at ')[0].split(' — ')[0].trim()
}

/* ---------- the sections and the address ---------- */

export const CANDIDATE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'actions', label: 'Actions' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'information', label: 'Information' },
  { id: 'interviews', label: 'Interviews' },
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

// The sections a narrowed reader (a client, family, an SSA) is answered: the basic card, the pipeline of the…
export const NARROW_TABS: readonly CandidateTab[] = ['overview', 'pipeline', 'interviews']

/** The sections this reader has, in the rail's order. */
export const tabsFor = (narrow: boolean) => CANDIDATE_TABS.filter((t) => !narrow || NARROW_TABS.includes(t.id))

/** The section an address names, when this reader has it; else the overview. */
export const tabFor = (v: string | null | undefined, narrow: boolean): CandidateTab => {
  const t = tabOf(v)
  return narrow && !NARROW_TABS.includes(t) ? 'overview' : t
}

export const APP_NAME = 'Staff Candidates'
export const CANDIDATES_APP_ID = 'staff-candidates'
export const CANDIDATES_PATH = '/app/staff-candidates/profile'

/** What the one right panel holds. It rides the address as `panel=`. */
export type CandidateAsk =
  | { kind: 'share' }
  | { kind: 'note'; about: string }
  | { kind: 'stage' }
  | { kind: 'complete'; item: string }
  | { kind: 'upload'; doc: string }
  | { kind: 'document'; item: string }
  | { kind: 'transcript'; id: string }
  | { kind: 'screen' }
  | { kind: 'interview' }
  | { kind: 'packet' }
  | { kind: 'edit'; section: EditSection }
  | { kind: 'noteEdit'; id: string }
  | { kind: 'review'; doc: string }

/** The record sections an edition's panel edits (candidateProfileEditRead). */
export type EditSection = 'information' | 'preferences'
const EDIT_SECTIONS: EditSection[] = ['information', 'preferences']

const SEP = '~'

export function panelParam(ask: CandidateAsk | null): string {
  if (!ask) return ''
  switch (ask.kind) {
    case 'share': case 'stage': case 'screen': case 'interview': case 'packet': return ask.kind
    case 'note': return ask.about ? ['note', ask.about].join(SEP) : 'note'
    case 'complete': return ['complete', ask.item].join(SEP)
    case 'upload': return ['upload', ask.doc].join(SEP)
    case 'document': return ['document', ask.item].join(SEP)
    case 'transcript': return ['transcript', ask.id].join(SEP)
    case 'edit': return ['edit', ask.section].join(SEP)
    case 'noteEdit': return ['noteEdit', ask.id].join(SEP)
    case 'review': return ['review', ask.doc].join(SEP)
  }
}

export function panelOf(v: string | null | undefined): CandidateAsk | null {
  const [kind, a = ''] = str(v).split(SEP)
  switch (kind) {
    case 'share': case 'stage': case 'screen': case 'interview': case 'packet': return { kind }
    case 'note': return { kind, about: a }
    case 'complete': return a ? { kind, item: a } : null
    case 'upload': return a ? { kind, doc: a } : null
    case 'document': return a ? { kind, item: a } : null
    case 'transcript': return a ? { kind, id: a } : null
    case 'edit': return (EDIT_SECTIONS as string[]).includes(a) ? { kind, section: a as EditSection } : null
    case 'noteEdit': return a ? { kind, id: a } : null
    case 'review': return a ? { kind, doc: a } : null
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

/** The same candidate in the Hiring app's own profile. */
export const hiringHref = (candidate: string): string => profileRoute(candidate)

/* ---------- the stages: the Hiring board's own ---------- */

export const STAGE_IDS = STAGES.map((s) => s.id)

/** The stage as the board names it; an id the board does not know, as written. */
export const stageLabel = (id: string): string =>
  STAGE_LABEL[id] ?? (id === 'not-hiring' ? 'Not hiring' : id ? titled(word(id)) : '')

const STAGE_TINT: Record<string, PillTint> = {
  new: 'blue', 'phone-screen': 'lavender', interview: 'amber', onboarding: 'amber', hired: 'mint', ready: 'mint',
}

export const stageMeta = (id: string): PillMeta => ({ label: stageLabel(id) || 'No stage', tint: STAGE_TINT[id] ?? 'slate' })

export const ARCHIVED_META: PillMeta = { label: 'Archived', tint: 'slate' }

/* ---------- the roster, the switcher and the pipeline ---------- */

export type RosterRow = {
  /** the Hiring app's candidate id (CAN_…) */
  key: string
  name: string
  position: string
  stage: string
  location: string
  next_step: string
  /** the next step's own checklist id (talentChecklist_); '' when nothing is open or the answer does not say */
  next_id: string
  /** the New Hire packet's state as the board reads it: signed, waived, unsigned, ambiguous, unknown; '' before it */
  packet: string
  recruiter: string
  source: string
  applied: string
  phone: string
  email: string
  avatar: string
  /** out of the Hiring pipeline: opened by its id, never listed */
  archived: boolean
}

/** Whose narrowed view an answer is ('client', 'guardian' or 'ssa'); '' for the whole app. */
export type Viewer = '' | 'client' | 'guardian' | 'ssa'
const VIEWERS: Viewer[] = ['client', 'guardian', 'ssa']

export const viewerOf = (v: unknown): Viewer => {
  const w = word(v) as Viewer
  return VIEWERS.includes(w) ? w : ''
}

export type Roster = { candidates: RosterRow[]; why: string[]; degraded: boolean; viewer: Viewer }

/** City and state as one line. */
export const placeOf = (city: unknown, state: unknown): string => [str(city), str(state)].filter(Boolean).join(', ')

export const DEFAULT_POSITION = 'Direct Support Professional'

function rosterRowOf(v: unknown): RosterRow {
  const x = rec(v)
  return {
    key: pick(x, 'key', 'candidate_id', 'id'),
    name: pick(x, 'name'),
    position: pick(x, 'position', 'role'),
    stage: pick(x, 'stage'),
    location: pick(x, 'location') || placeOf(x.city, x.state),
    next_step: pick(x, 'next_step'),
    next_id: pick(x, 'next_id'),
    packet: pick(x, 'packet') || pick(rec(x.packet), 'state'),
    recruiter: pick(x, 'recruiter'),
    source: pick(x, 'source'),
    applied: pick(x, 'applied_at', 'applied'),
    phone: pick(x, 'phone'),
    email: pick(x, 'email'),
    avatar: pick(x, 'avatar'),
    archived: x.archived === true,
  }
}

/** candidateProfileRoster's answer: { candidates, why, degraded, viewer }, each candidate once, by name. */
export function rosterOf(raw: unknown): Roster {
  const seen = new Set<string>()
  const candidates = rowsIn(raw, 'candidates', 'rows').map(rosterRowOf).filter((r) => {
    if (!r.name || !r.key || seen.has(r.key)) return false
    seen.add(r.key)
    return true
  })
  candidates.sort(byName)
  return { candidates, why: whyOf(rec(raw).why), degraded: rec(raw).degraded === true, viewer: viewerOf(rec(raw).viewer) }
}

// The step the Hiring board's Actions view names on a candidate's line (cndNextSteps_): the first open item of the…
export function nextItemOf(row: { stage?: string; checklist?: ChecklistItem[] }): ChecklistItem | null {
  const r = { id: '', name: '', stage: str(row.stage), checklist: Array.isArray(row.checklist) ? row.checklist : [] }
  const open = openConditions(r)
  const inPhase = new Set(stageItems(r).map((c) => c.id))
  return open.find((c) => inPhase.has(c.id)) ?? open[0] ?? null
}

// The roster from the candidates slice (lane 1), as candidateProfileRoster answers it (cndRosterRow_ over the…
export function rosterFrom(rows: unknown[]): { candidates: Record<string, unknown>[]; why: string[]; degraded: boolean } {
  const seen = new Set<string>()
  const candidates: Record<string, unknown>[] = []
  for (const raw of rows) {
    const r = rec(raw)
    const key = pick(r, 'id')
    const name = pick(r, 'name')
    if (!key || !name || seen.has(key)) continue
    seen.add(key)
    const checklist = (Array.isArray(r.checklist) ? r.checklist : []) as ChecklistItem[]
    const next = nextItemOf({ stage: str(r.stage), checklist })
    const packetItem = rec(checklist.find((c) => rec(c).id === 'new-hire-packet'))
    candidates.push({
      key, name, position: pick(r, 'role') || DEFAULT_POSITION, stage: pick(r, 'stage'), location: placeOf(r.city, r.state),
      next_step: next?.label ?? '', next_id: next?.id ?? '', packet: pick(rec(r.packet), 'state') || pick(packetItem, 'packetState'),
      recruiter: byOf(r.owner), source: pick(r, 'source'), applied_at: isoDay(r.appliedAt),
      phone: pick(r, 'phone'), email: pick(r, 'email'), avatar: pick(r, 'avatar'),
    })
  }
  candidates.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { candidates, why: [], degraded: false }
}

const byName = (a: RosterRow, b: RosterRow) => a.name.localeCompare(b.name)

function matcher(query: string): (r: RosterRow) => boolean {
  const q = query.trim().toLowerCase()
  return (r) => !q || [r.name, r.position, stageLabel(r.stage), r.location, r.recruiter, r.next_step, r.phone, r.email]
    .some((v) => v.toLowerCase().includes(q))
}

// The switcher's list: every candidate on the board, by name; the search reads name, position, stage, location…
export function switcherCandidates(rows: RosterRow[], query: string): RosterRow[] {
  return rows.filter((r) => !r.archived && matcher(query)(r)).sort(byName)
}

/** The candidate the screen opens on when the address names none: the first on the board by name. */
export function defaultCandidate(rows: RosterRow[]): RosterRow | null {
  return switcherCandidates(rows, '')[0] ?? null
}

/** The candidate an address names: their id. Never a near match. */
export function resolveCandidate(want: string, rows: RosterRow[]): RosterRow | null {
  const w = str(want)
  return w ? rows.find((r) => r.key === w) ?? null : null
}

/** The switcher's second line: the stage, then the position. */
export const rosterLine = (r: Pick<RosterRow, 'stage' | 'position'>): string =>
  [stageLabel(r.stage), r.position].filter(Boolean).join(' · ')

/** The Pipeline: every candidate the search and the stage filter keep, by the board's stage order, then by name. */
export function pipelineRows(rows: RosterRow[], query: string, stage: string): RosterRow[] {
  const hit = matcher(query)
  const at = (s: string) => {
    const i = STAGE_IDS.indexOf(s)
    return i === -1 ? STAGE_IDS.length : i
  }
  return rows.filter((r) => !r.archived && (!stage || r.stage === stage) && hit(r))
    .sort((a, b) => at(a.stage) - at(b.stage) || byName(a, b))
}

/** The Phone Screen checklist items: each one's evidence is the phone screen's transcript. */
export const SCREEN_ITEMS = ['transcript', 'ai-report', 'screen-details', 'advance-decision']

/** The packet states that mean the New Hire package is complete — signed in Dropbox Sign, or attested by hand. */
export const PACKET_DONE = ['signed', 'waived']

/** What a Pipeline NEXT STEP cell opens: the phone screen's transcript, the interview, or the signed New Hire packet. */
export type PipelineOpen = { kind: 'screen' | 'interview' | 'packet'; label: string; hint: string }

// The NEXT STEP cell's door, or null when it has nothing to open: a Phone Screen step opens the phone screen's…
export function pipelineOpen(r: Pick<RosterRow, 'name' | 'stage' | 'next_step' | 'next_id' | 'packet'>): PipelineOpen | null {
  const screen = r.next_id ? SCREEN_ITEMS.includes(r.next_id) : r.stage === 'phone-screen' && !!r.next_step
  if (screen) return { kind: 'screen', label: r.next_step || 'Phone screen', hint: `Open ${r.name}'s phone screen transcript` }
  if (r.next_id.startsWith('interview-') || r.stage === 'interview') {
    return { kind: 'interview', label: r.next_step || 'Interview', hint: `Open ${r.name}'s interview` }
  }
  if (PACKET_DONE.includes(r.packet)) {
    return { kind: 'packet', label: 'Signed New Hire packet', hint: `Open ${r.name}'s signed New Hire packet` }
  }
  return null
}

/** How many candidates stand at each stage, in the board's order. */
export function stageCounts(rows: RosterRow[]): { id: string; label: string; count: number }[] {
  return STAGES.map((s) => ({ id: s.id, label: s.label, count: rows.filter((r) => !r.archived && r.stage === s.id).length }))
}

/* ---------- the Hiring doors an answer names ---------- */

// What a door asks for before it is pressed: nothing, notes, a required note, a schedule, a scorecard, a file or a…
export type DoorForm = '' | 'notes' | 'note' | 'schedule' | 'scorecard' | 'upload' | 'reason'
const FORMS: DoorForm[] = ['', 'notes', 'note', 'schedule', 'scorecard', 'upload', 'reason']

export type Door = { action: string; form: DoorForm; payload: Record<string, string> }

export function doorOf(v: unknown): Door | null {
  const x = rec(v)
  const action = pick(x, 'action')
  if (!action) return null
  const form = word(x.form) as DoorForm
  const payload: Record<string, string> = {}
  for (const [k, val] of Object.entries(rec(x.payload))) if (str(val)) payload[k] = str(val)
  return { action, form: FORMS.includes(form) ? form : '', payload }
}

/** Each Hiring door this screen may open: what it is called, what it does, and its press. */
export const DOOR_WORDS: Record<string, { title: string; says: string; press: string }> = {
  setDecision: {
    title: 'Advance',
    says: 'Records the decision as Advance, the same Accept the Hiring card records. At Phone Screen an Advance moves the candidate to Interview.',
    press: 'Advance',
  },
  screenManualComplete: {
    title: 'Manual phone screen',
    says: 'Records that a person screened the candidate by voice. What the automated line already captured stays as evidence; every Phone Screen checkpoint reads settled. The card stays at Phone Screen until the advance decision.',
    press: 'Record the screen',
  },
  hiringScheduleCreate: {
    title: 'Schedule the interview',
    says: 'Puts the in-person interview on the hiring calendar. The candidate is e-mailed the day and time when an address is on file.',
    press: 'Schedule',
  },
  interviewSave: {
    title: 'Interview scorecard',
    says: 'Signs the interview: who held it, the score, the comments and the recommendation. A Decline ends the candidate\'s process.',
    press: 'Sign the scorecard',
  },
  packetWaive: {
    title: 'New Hire packet on file',
    says: 'Attests the signed New Hire packet by hand. A candidate waiting on it moves to Hired, and the move sends the new hire their login.',
    press: 'Record the packet',
  },
  onboardingManualComplete: {
    title: 'Manual onboarding',
    says: 'Records the onboarding as done by hand: every Onboarding step reads settled and the candidate moves to Hired, unless the signed New Hire packet is still missing.',
    press: 'Record the onboarding',
  },
  tableDocUpload: {
    title: 'Upload the file',
    says: 'Files the paper on the candidate\'s record and in the hiring document folders, as the Hiring card\'s Upload does.',
    press: 'Upload',
  },
  moveStage: {
    title: 'Move the stage',
    says: 'Moves the card one stage forward on the Hiring board. The move is refused when the stage\'s gate has not passed. Entering Onboarding mints the new hire\'s login and e-mails it.',
    press: 'Apply',
  },
  hiringDiscard: {
    title: 'Not hiring',
    says: 'Takes the candidate out of the process: the reason is written on their record and the team is told.',
    press: 'Take them out',
  },
}

export const doorTitle = (d: Door | null): string => (d ? DOOR_WORDS[d.action]?.title ?? titled(d.action) : '')

/** What a door's form adds to its payload. */
export type DoorFields = {
  notes: string
  date: string
  time: string
  location: string
  with_name: string
  interviewer_name: string
  score: string
  recommendation: string
  file: File | null
}

export const NO_FIELDS: DoorFields = {
  notes: '', date: '', time: '', location: '', with_name: '', interviewer_name: '', score: '', recommendation: '', file: null,
}

/** The fields a door asks for are all there, as the door itself will check them. */
export function doorReady(door: Door, f: DoorFields): boolean {
  switch (door.form) {
    case 'note': return f.notes.trim().length >= 3
    case 'reason': return !!f.notes.trim()
    case 'schedule': return /^\d{4}-\d{2}-\d{2}$/.test(f.date) && !!f.location.trim() && !!f.with_name.trim()
    case 'scorecard': {
      const n = Number(f.score)
      return !!f.interviewer_name.trim() && f.score !== '' && n >= 0 && n <= 10 && !!f.recommendation && f.notes.trim().length >= 10
    }
    case 'upload': return !!f.file
    default: return true
  }
}

/* ---------- Overview and Information ---------- */

export type CandidateDetails = {
  key: string
  name: string
  position: string
  stage: string
  status_label: string
  archived: boolean
  archived_reason: string
  location: string
  recruiter: string
  source: string
  applied: string
  phone: string
  email: string
  avatar: string
  availability: string
  experience: string
  preferred_location: string
  earliest_start: string
}

export type NextStep = { item: string; action: string; owner: string; due: string; status: string }

export type ActivityKind = 'step' | 'stage' | 'note' | 'sms' | 'call' | 'mail' | 'document' | 'interview' | 'record'
const ACTIVITY_KINDS: ActivityKind[] = ['step', 'stage', 'note', 'sms', 'call', 'mail', 'document', 'interview', 'record']

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
  open_actions: number | null
  docs_on_file: number | null
  docs_total: number | null
  next_step: NextStep | null
  attention: string[]
  recent: ActivityItem[]
  why: string[]
  degraded: boolean
}

function detailsOf(candidate: unknown, information: unknown): CandidateDetails {
  const x = rec(candidate)
  const i = rec(information)
  return {
    key: pick(x, 'key'),
    name: pick(x, 'name') || pick(i, 'full_name'),
    position: pick(x, 'position') || pick(i, 'position'),
    stage: pick(x, 'stage'),
    status_label: pick(x, 'status_label') || pick(i, 'stage_label'),
    archived: x.archived === true,
    archived_reason: pick(x, 'archived_reason'),
    location: pick(x, 'location'),
    recruiter: pick(x, 'recruiter') || pick(i, 'recruiter'),
    source: pick(x, 'source') || pick(i, 'source'),
    applied: pick(x, 'applied_at') || pick(i, 'applied_at'),
    phone: pick(x, 'phone') || pick(i, 'phone'),
    email: pick(x, 'email') || pick(i, 'email'),
    avatar: pick(x, 'avatar'),
    availability: pick(i, 'availability'),
    experience: pick(i, 'experience'),
    preferred_location: pick(i, 'preferred_location'),
    earliest_start: pick(i, 'earliest_start'),
  }
}

function nextStepOf(v: unknown): NextStep | null {
  const x = rec(v)
  const action = pick(x, 'label', 'action')
  if (!action) return null
  return { item: pick(x, 'id'), action, owner: pick(x, 'owner'), due: pick(x, 'due'), status: word(x.status) }
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

/** candidateProfileOverview's answer. */
export function overviewOf(raw: unknown): CandidateOverview {
  const o = rec(raw)
  const tiles = rec(o.tiles)
  return {
    candidate: detailsOf(o.candidate, o.information),
    summary: pick(o, 'summary'),
    open_actions: num(tiles.open_actions),
    docs_on_file: num(tiles.docs_on_file),
    docs_total: num(tiles.docs_total),
    next_step: nextStepOf(o.next),
    attention: whyOf(o.attention),
    recent: activityItems(o.recent),
    why: whyOf(o.why),
    degraded: o.degraded === true,
  }
}

/** What is known of the candidate: the overview's once read, over the roster's line. */
export function knownDetails(row: RosterRow, o: CandidateOverview | null): CandidateDetails {
  const d = o && (!o.candidate.key || o.candidate.key === row.key) ? o.candidate : null
  const or = (a: string | undefined, b: string) => a || b
  return {
    key: row.key,
    name: or(d?.name, row.name),
    position: or(d?.position, row.position),
    stage: or(d?.stage, row.stage),
    status_label: d?.status_label ?? '',
    archived: d?.archived ?? row.archived,
    archived_reason: d?.archived_reason ?? '',
    location: or(d?.location, row.location),
    recruiter: or(d?.recruiter, row.recruiter),
    source: or(d?.source, row.source),
    applied: or(d?.applied, row.applied),
    phone: or(d?.phone, row.phone),
    email: or(d?.email, row.email),
    avatar: or(d?.avatar, row.avatar),
    availability: d?.availability ?? '',
    experience: d?.experience ?? '',
    preferred_location: d?.preferred_location ?? '',
    earliest_start: d?.earliest_start ?? '',
  }
}

/** A candidate the board no longer carries, opened by their id: the overview's own record as a roster line. */
export function rowFromOverview(o: CandidateOverview): RosterRow | null {
  const c = o.candidate
  if (!c.key || !c.name) return null
  return {
    key: c.key, name: c.name, position: c.position, stage: c.stage, location: c.location, next_step: o.next_step?.action ?? '',
    next_id: o.next_step?.item ?? '', packet: '', recruiter: c.recruiter, source: c.source, applied: c.applied, phone: c.phone,
    email: c.email, avatar: c.avatar, archived: c.archived,
  }
}

/** "1 of 3"; '' when either count is unknown. */
export const docsWords = (onFile: number | null, total: number | null): string =>
  onFile === null || total === null ? '' : `${onFile} of ${total}`

/** A due day as a pill: overdue, today, within three days, or the day itself. */
export function dueMeta(due: string, today = ohioToday()): PillMeta | null {
  const d = str(due).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return due ? { label: `Due ${due}`, tint: 'slate' } : null
  const days = Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
  if (days < 0) return { label: 'Overdue', tint: 'danger' }
  if (days === 0) return { label: 'Due today', tint: 'amber' }
  if (days <= 3) return { label: `Due in ${days} day${days === 1 ? '' : 's'}`, tint: 'amber' }
  return { label: `Due ${dayWords(d)}`, tint: 'blue' }
}

/** "<owner> · due <day>", as known. */
export function ownerDue(owner: string, due: string): string {
  return [owner, due ? `due ${dateWords(due)}` : ''].filter(Boolean).join(' · ')
}

/* ---------- Actions ---------- */

export type ActionItem = {
  /** the Hiring checklist item's own id (talentChecklist_) */
  id: string
  label: string
  status: string
  open: boolean
  owner: string
  stage: string
  in_phase: boolean
  is_next: boolean
  due: string
  /** the Hiring door that closes it; null when no press here may, with why */
  door: Door | null
  why: string
  /** the paper Add document files for it, read by the decoder first; null when it takes none */
  paper: StepPaper | null
}

/** One of the new hire's papers, once the New Hire packet is signed: its catalog id, its name, what it must read as. */
export type PaperChoice = { doc_id: string; label: string; expects: string }

/** cndStepPaper_: what a step takes as a paper, what the decoder must read it as, and where it is filed. */
export type StepPaper = {
  asks: string
  expects: string
  where: string
  /** the step's door keeps a PDF only */
  pdf_only: boolean
  /** the file extensions the step takes, lowercase and without the dot */
  exts: string[]
  /** the background results a person picks from (cjisUpload's own four); [] on any other step */
  statuses: string[]
  /** which of the new hire's papers it is, when the step takes several */
  choices: PaperChoice[]
}

function stepPaperOf(v: unknown): StepPaper | null {
  if (!v || typeof v !== 'object') return null
  const x = rec(v)
  const choices = rowsIn(x.choices).map((c) => {
    const y = rec(c)
    return { doc_id: pick(y, 'doc_id'), label: pick(y, 'label'), expects: pick(y, 'expects') }
  }).filter((c) => c.doc_id && c.label)
  const asks = pick(x, 'asks')
  const pdfOnly = x.pdf_only === true
  const exts = rowsIn(x.exts).map((e) => str(e).toLowerCase().replace(/^\./, '')).filter(Boolean)
  const statuses = rowsIn(x.statuses).map(str).filter(Boolean)
  return asks || choices.length
    ? { asks, expects: pick(x, 'expects'), where: pick(x, 'where'), pdf_only: pdfOnly,
        exts: pdfOnly ? ['pdf'] : exts.length ? exts : PAPER_EXTS, statuses, choices }
    : null
}

export type StageMove = { id: string; label: string; current: boolean; reachable: boolean; door: Door | null; why: string }

export type CandidateActions = {
  items: ActionItem[]
  next: ActionItem | null
  open: number | null
  attention: string[]
  stages: StageMove[]
  archived: boolean
  why: string[]
  degraded: boolean
}

const DONE = ['done', 'auto', 'completed', 'complete', 'signed', 'on_file', 'waived']

export const actionDone = (status: string): boolean => DONE.includes(word(status))

/** candidateProfileActions' answer: the Hiring checklist in the board's order, and where the card may move. */
export function actionsOf(raw: unknown): CandidateActions {
  const o = rec(raw)
  const items: ActionItem[] = rowsIn(o, 'items').map((v, i) => {
    const x = rec(v)
    const status = word(x.status)
    return {
      id: pick(x, 'id') || `action-${i}`,
      label: pick(x, 'label'),
      status,
      open: typeof x.open === 'boolean' ? x.open : !actionDone(status),
      owner: pick(x, 'owner'),
      stage: pick(x, 'stage'),
      in_phase: x.in_phase === true,
      is_next: x.is_next === true,
      due: pick(x, 'due'),
      door: doorOf(x.complete),
      why: pick(x, 'complete_why'),
      paper: stepPaperOf(x.paper),
    }
  }).filter((x) => x.label)
  const stages: StageMove[] = rowsIn(o, 'stages').map((v) => {
    const x = rec(v)
    const id = pick(x, 'id')
    return { id, label: pick(x, 'label') || stageLabel(id), current: x.current === true, reachable: x.reachable === true,
      door: doorOf(x.door), why: pick(x, 'why') }
  }).filter((s) => s.id)
  return {
    items,
    next: items.find((x) => x.is_next) ?? null,
    open: num(o.open) ?? items.filter((x) => x.open).length,
    attention: whyOf(o.attention),
    stages,
    archived: o.archived === true,
    why: whyOf(o.why),
    degraded: o.degraded === true,
  }
}

const ACTION_TINT: Record<string, PillTint> = {
  done: 'mint', auto: 'mint', completed: 'mint', complete: 'mint', signed: 'mint', on_file: 'mint', waived: 'mint',
  pending: 'amber', missing: 'danger',
}

const ACTION_WORD: Record<string, string> = { done: 'Completed', auto: 'Completed', complete: 'Completed' }

export const actionStatusMeta = (status: string): PillMeta => {
  const w = word(status)
  return { label: ACTION_WORD[w] ?? (w ? titled(w) : 'Unknown'), tint: ACTION_TINT[w] ?? 'slate' }
}

export const openCount = (a: CandidateActions | null): number | null => (a ? a.open : null)

/** The NEXT STEP column: what closes the item — its Hiring door, else why no press here does; nothing once done. */
export function nextStepWords(x: Pick<ActionItem, 'open' | 'door' | 'why'>): string {
  if (!x.open) return ''
  return x.door ? doorTitle(x.door) : x.why
}

/** The actions the search keeps: it reads the step, its owner, its next step, its status and its stage. */
export function filterActions(items: ActionItem[], query: string): ActionItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((x) => [x.label, x.owner, nextStepWords(x), x.status.replace(/_/g, ' '), stageLabel(x.stage)]
    .some((v) => v.toLowerCase().includes(q)))
}

/** The next step: the overview's own, else the actions' next, else the board's line on the roster. */
export function nextStepFrom(row: Pick<RosterRow, 'next_step'>, o: CandidateOverview | null, a: CandidateActions | null): NextStep | null {
  if (o?.next_step) return o.next_step
  const next = a?.next ?? null
  if (next) return { item: next.id, action: next.label, owner: next.owner, due: next.due, status: next.status }
  return row.next_step ? { item: '', action: row.next_step, owner: '', due: '', status: '' } : null
}

/* ---------- Add document ---------- */

/** What the decoder reads words off: a PDF, or a photo or a scan of the paper. */
export const PAPER_EXTS = ['pdf', 'jpg', 'jpeg', 'png', 'gif']

/** The paper Add document may file for a step; up to 15MB, as the backend holds it. */
export const PAPER_MAX_BYTES = 15 * 1024 * 1024

/** The files a step takes, as the drop zone says them: "PDF, JPG, PNG or GIF" — JPEG is JPG's other name. */
export function paperExtsWords(exts: string[]): string {
  const shown = exts.filter((e) => !(e === 'jpeg' && exts.includes('jpg'))).map((e) => e.toUpperCase())
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} or ${shown[shown.length - 1]}` : shown[0] ?? ''
}

/** The drop zone's `accept`, from the step's own extensions. */
export function paperAccept(exts: string[]): string {
  return exts.map((e) => `.${e}`).join(',')
}

/** Why a file is not handed to the decoder for this step; '' when it is. `exts` is the step's own (StepPaper.exts). */
export function paperFileRefusal(name: string, size: number, exts: string[]): string {
  const dot = name.lastIndexOf('.')
  const ext = dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
  if (!exts.includes(ext)) {
    return exts.length === 1 && exts[0] === 'pdf' ? 'The Hiring record keeps this paper as a PDF — a PDF of it, please.'
      : `Only ${paperExtsWords(exts)}.`
  }
  if (size > PAPER_MAX_BYTES) return 'Up to 15MB.'
  return ''
}

/** Why the decoder did not take the paper as the one asked (cndPaperVerdict_); '' when it did. */
export type PaperReason = '' | 'unread' | 'untaught' | 'kind' | 'faint' | 'person'
const PAPER_REASONS: string[] = ['unread', 'untaught', 'kind', 'faint', 'person']

/** candidateProfileDoor's answer to Add document: what the decoder read, held against what the step asks. */
export type PaperReading = {
  verified: boolean
  /** why it is not the paper asked; '' when it is */
  reason: PaperReason
  /** the decoder's own state: read, empty, error or heic */
  state: string
  /** read only, nothing written */
  check: boolean
  filed: boolean
  override: boolean
  asks: string
  expects: string
  where: string
  read_as: string
  why: string
  /** what the filing could not do after the step's own door took the paper */
  filing_why: string
  name_check: 'match' | 'other' | 'unread'
  person_seen: string
  issued_on: string
  expires_on: string
  /** a background check's result: clear, records, or '' */
  result: string
  /** the background result: the one suggested on a check, the one written on a filing; '' off the CJIS step */
  cjis_status: string
  /** the background result on the Hiring record now; '' when none */
  cjis_on_file: string
  /** whether filing it closes its step on the Hiring board; null when it closes none */
  closes: boolean | null
  /** why filing it leaves its step open */
  closes_why: string
}

export function paperReadingOf(raw: unknown): PaperReading {
  const o = rec(raw)
  const r = rec(o.reading)
  const named = word(r.name_check)
  const verified = o.verified === true
  const state = word(r.state)
  const said = word(o.reason)
  // an answer that says no reason still says whether the decoder read it
  const reason = (verified ? '' : PAPER_REASONS.includes(said) ? said : state && state !== 'read' ? 'unread' : 'kind') as PaperReason
  return {
    verified,
    reason,
    state,
    check: o.check === true,
    filed: o.filed === true,
    override: o.override === true,
    asks: pick(o, 'asks'),
    expects: pick(o, 'expects'),
    where: pick(o, 'where'),
    read_as: pick(o, 'read_as'),
    why: pick(o, 'why'),
    filing_why: pick(o, 'filing_why'),
    name_check: named === 'match' || named === 'other' ? named : 'unread',
    person_seen: pick(r, 'person_seen'),
    issued_on: isoDay(r.issued_on),
    expires_on: isoDay(r.expires_on),
    result: word(r.result),
    cjis_status: pick(o, 'cjis_status'),
    cjis_on_file: pick(o, 'cjis_on_file'),
    closes: typeof o.closes === 'boolean' ? o.closes : null,
    closes_why: pick(o, 'closes_why'),
  }
}

// The verdict as the panel words it, by why it is not the paper asked: a reading that never happened is "Could not…
export function paperVerdictWords(r: PaperReading, asks: string, name: string): { pill: PillMeta; warning: string } {
  if (r.verified) return { pill: { label: 'Matches', tint: 'mint' }, warning: '' }
  switch (r.reason) {
    case 'unread':
      return { pill: { label: 'Could not read', tint: 'amber' },
        warning: `The decoder could not read this paper, so nothing says it is ${asks}. Read it again, or file it anyway only ` +
          `if you know it is — it goes on the record as ${asks}, and the hiring journey says it was filed unread.` }
    case 'person': {
      const who = r.person_seen || 'someone else'
      const what = r.read_as.replace(/^(a|an) /, '') || 'paper'
      return { pill: { label: 'Names someone else', tint: 'danger' },
        warning: `This paper names ${who}, not ${name}. Filing it anyway puts ${who}’s ${what} on ${name}’s record as ` +
          `${asks}. File anyway only if it is ${name}’s own.` }
    }
    case 'untaught':
      return { pill: { label: 'Cannot tell', tint: 'slate' },
        warning: `The decoder is not taught what ${asks} looks like, so it cannot say this is it. File anyway only if you know ` +
          `it is — it goes on the record as ${asks}.` }
    default:
      return { pill: { label: 'Does not match', tint: 'danger' },
        warning: `This paper does not read as ${asks}. File anyway only if you know it is — it goes on the record as ${asks}, ` +
          'and the hiring journey says it was filed over its reading.' }
  }
}

/** What a background result does to the CJIS step: Clear and Verified complete it, with the report; the rest leave it open. */
export function cjisResultWords(status: string): string {
  if (!status) return ''
  return status === 'Clear' || status === 'Verified' ? `${status} — the step is marked done` : `${status} — the step stays open`
}

/** What the decoder read, line by line: the kind, whose name, the paper's own dates, a check's result. */
export function readingLines(r: PaperReading, name: string): Labelled[] {
  const who = r.name_check === 'match' ? (r.person_seen || name)
    : r.name_check === 'other' ? `${r.person_seen || 'Someone else'} — not ${name}` : 'No name could be read'
  const result = r.result === 'clear' ? 'Clear — no record found' : r.result === 'records' ? 'Records on file — a person decides' : ''
  return [
    { label: 'Read as', value: r.read_as || 'Nothing the decoder could name' },
    { label: 'Name on it', value: who },
    { label: 'Issued', value: dateWords(r.issued_on) },
    { label: 'Expires', value: dateWords(r.expires_on) },
    { label: 'Result', value: result },
  ].filter((l) => l.value)
}

/* ---------- Interviews ---------- */

export type PlanStatus = 'completed' | 'awaiting_confirmation' | 'scheduled' | 'pending'
const PLAN_STATUSES: string[] = ['completed', 'awaiting_confirmation', 'scheduled', 'pending']

export type PlanStep = {
  id: string
  title: string
  date: string
  owner: string
  status: PlanStatus
  result: string
  comments: string
  detail: string
  /** the slot as the Ohio day and 'HH:MM' clock it names; '' when unknown */
  day: string
  time: string
  /** when the scorecard was signed (an instant) */
  interviewed_at: string
  score: string
  score_max: number | null
  recommendation: string
  /** who the hiring calendar booked to hold it, and where */
  with_name: string
  location: string
}

export type Labelled = { label: string; value: string; heard?: boolean; onFile?: boolean }

export type CandidateInterviews = { plan: PlanStep[]; preferences: Labelled[]; why: string[]; degraded: boolean }

export const PLAN_META: Record<PlanStatus, PillMeta> = {
  completed: { label: 'Completed', tint: 'mint' },
  awaiting_confirmation: { label: 'Awaiting Confirmation', tint: 'amber' },
  scheduled: { label: 'Scheduled', tint: 'blue' },
  pending: { label: 'Pending', tint: 'slate' },
}

const yesNo = (v: unknown): string => {
  const w = word(v)
  return w === 'yes' ? 'Yes' : w === 'no' ? 'No' : str(v)
}

const listWords = (v: unknown): string => (Array.isArray(v) ? v.map(str).filter(Boolean).join(', ') : str(v))

const CERT_LABEL: Record<string, string> = { dodd: 'DODD', cpr_first_aid: 'CPR / First Aid', med_del: 'Med Del' }

/** cndPreferences_: what the candidate said they want and have, labelled, in the section's order; `heard` names the
 *  lines the record left empty and a call answered (app/call_prefs.py), `onFile` the lines a filed paper answers. */
export function preferencesOf(v: unknown, heard: string[] = [], onFile: string[] = []): Labelled[] {
  const p = rec(v)
  const certs = Object.entries(rec(p.certificates))
    .filter(([, val]) => word(val) === 'yes').map(([k]) => CERT_LABEL[k] ?? titled(word(k)))
  const line = (key: string, label: string, value: string): Labelled => ({
    label, value,
    ...(value && onFile.includes(key) ? { onFile: true } : value && heard.includes(key) ? { heard: true } : {}),
  })
  return [
    line('availability', 'Availability', str(p.availability)),
    line('shifts', 'Shifts', listWords(p.shifts)),
    line('hours', 'Hours', listWords(p.hours)),
    line('every_other_weekend', 'Every other weekend', yesNo(p.every_other_weekend)),
    line('best_in_person', 'Best time in person', str(p.best_in_person)),
    line('preferred_location', 'Preferred location', str(p.preferred_location)),
    line('earliest_start', 'Earliest start', dateWords(str(p.earliest_start))),
    line('male_care', 'Male care', yesNo(p.male_care)),
    line('behavioral_care', 'Behavioral care', yesNo(p.behavioral_care)),
    line('drivers_license', 'Driver\'s license', yesNo(p.drivers_license)),
    line('vehicle', 'Vehicle', yesNo(p.vehicle)),
    line('insurance', 'Insurance', yesNo(p.insurance)),
    line('certificates', 'Certificates', certs.join(', ')),
  ]
}

/** candidateProfileInterviews' answer: the plan in its own order, then what the candidate prefers. */
export function interviewsOf(raw: unknown): CandidateInterviews {
  const o = rec(raw)
  const plan = rowsIn(o, 'plan').map((v, i) => {
    const x = rec(v)
    const st = word(x.status)
    return {
      id: pick(x, 'id') || `step-${i}`,
      title: pick(x, 'title'),
      date: pick(x, 'date'),
      owner: pick(x, 'owner'),
      status: (PLAN_STATUSES.includes(st) ? st : actionDone(st) ? 'completed' : 'pending') as PlanStatus,
      result: pick(x, 'result'),
      comments: pick(x, 'comments'),
      detail: pick(x, 'detail'),
      day: pick(x, 'day'),
      time: pick(x, 'time'),
      interviewed_at: pick(x, 'interviewed_at'),
      score: pick(x, 'score'),
      score_max: num(x.score_max),
      recommendation: pick(x, 'recommendation'),
      with_name: pick(x, 'with_name'),
      location: pick(x, 'location'),
    }
  }).filter((x) => x.title)
  const preferences = preferencesOf(o.preferences, whyOf(o.from_call), whyOf(o.on_file))
  return { plan, preferences, why: whyOf(o.why), degraded: o.degraded === true }
}

/** '14:05' as '2:05 PM'; '' when it is not a clock. */
export function clockWords(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(str(hhmm))
  if (!m) return ''
  const h = Number(m[1])
  if (h > 23) return ''
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

/** A slot in words: 'Sep 25, 2026 · 10:00 AM', the day alone, or the date as the plan wrote it. */
export function slotWords(s: Pick<PlanStep, 'day' | 'time' | 'date'>): string {
  const day = dateWords(s.day || s.date)
  return [day, clockWords(s.time)].filter(Boolean).join(' · ')
}

// The structured interview's lines in its panel, each with what the record holds, in the panel's order.
export function interviewLines(s: PlanStep): Labelled[] {
  const score = s.score ? (s.score_max !== null ? `${s.score} / ${s.score_max}` : s.score) : ''
  const booked = s.with_name && s.with_name !== s.owner ? [{ label: 'Booked with', value: s.with_name }] : []
  return [
    { label: 'Interviewer', value: s.owner },
    ...booked,
    { label: 'Scheduled', value: slotWords(s) },
    { label: 'Location', value: s.location },
    { label: 'Scorecard signed', value: stampWords(s.interviewed_at) },
    { label: 'Score', value: score },
    { label: 'Recommendation', value: s.recommendation },
    { label: 'Result', value: s.result },
  ]
}

/* ---------- Documents ---------- */

export type DocGroup = 'onboarding' | 'application' | 'interview' | 'screening' | 'checklist' | 'other'
const DOC_GROUPS: DocGroup[] = ['onboarding', 'application', 'interview', 'screening', 'checklist', 'other']

export const DOC_GROUP_LABEL: Record<DocGroup, string> = {
  onboarding: 'Onboarding documents',
  application: 'Application & resume',
  interview: 'Interview notes',
  screening: 'Background check',
  checklist: 'Onboarding checklist',
  other: 'Other documents',
}

export type DocStatus = 'on_file' | 'pending'

export type DocRecord = { interviewer: string; score: string; recommendation: string; comments: string; at: string }

export type CandidateDoc = {
  id: string
  /** the catalog id of an onboarding paper (doc_<id>); none for the others */
  doc_id?: string
  title: string
  group: DocGroup
  status: DocStatus
  file_id: string
  date: string
  expires: string
  source: string
  verified: boolean
  result: string
  /** the Hiring door that files it, while it is pending */
  upload: Door | null
  record: DocRecord | null
  items: { id: string; label: string; done: boolean }[]
}

export type CandidateDocuments = { docs: CandidateDoc[]; on_file: number | null; total: number | null; why: string[]; degraded: boolean }

export const DOC_STATUS_META: Record<DocStatus, PillMeta> = {
  on_file: { label: 'On File', tint: 'mint' },
  pending: { label: 'Pending', tint: 'amber' },
}

/** candidateProfileDocuments' answer, in its own order within each group. */
export function documentsOf(raw: unknown): CandidateDocuments {
  const o = rec(raw)
  const docs = rowsIn(o, 'docs').map((v, i): CandidateDoc => {
    const x = rec(v)
    const id = pick(x, 'id') || `doc-${i}`
    const g = word(x.group) as DocGroup
    const r = x.record ? rec(x.record) : null
    return {
      id,
      doc_id: pick(x, 'doc_id'),
      title: pick(x, 'title'),
      group: id === 'onboarding_checklist' ? 'checklist' : DOC_GROUPS.includes(g) ? g : 'other',
      status: word(x.status) === 'on_file' ? 'on_file' : 'pending',
      file_id: pick(x, 'file_id'),
      date: pick(x, 'date'),
      expires: pick(x, 'expires'),
      source: pick(x, 'source'),
      verified: x.verified === true,
      result: pick(x, 'result'),
      upload: doorOf(x.upload),
      record: r ? { interviewer: pick(r, 'interviewer'), score: pick(r, 'score'), recommendation: pick(r, 'recommendation'),
        comments: pick(r, 'comments'), at: pick(r, 'interviewed_at') } : null,
      items: rowsIn(x.items).map((it) => {
        const y = rec(it)
        return { id: pick(y, 'id'), label: pick(y, 'label'), done: actionDone(str(y.status)) }
      }).filter((it) => it.label),
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

/** The documents by group, in the section's order; an empty group is left out. */
export function docGroups(docs: CandidateDoc[]): { group: DocGroup; label: string; docs: CandidateDoc[] }[] {
  return DOC_GROUPS.map((g) => ({ group: g, label: DOC_GROUP_LABEL[g], docs: docs.filter((d) => d.group === g) }))
    .filter((g) => g.docs.length > 0)
}

/** A row opens only when it names a file; the door serves only this candidate's own. */
export const docOpens = (d: Pick<CandidateDoc, 'file_id'>): boolean => !!d.file_id

/** The signed New Hire packet's row on the documents list (catalog id dropbox_packet). */
export const PACKET_DOC = 'doc_dropbox_packet'

/** The New Hire packet's row, or null when the list carries none. */
export const packetDocOf = (docs: CandidateDoc[]): CandidateDoc | null => docs.find((d) => d.id === PACKET_DOC) ?? null

export function docLine(d: Pick<CandidateDoc, 'source' | 'date' | 'expires' | 'verified' | 'result'>): string {
  return [d.source, d.result, dateWords(d.date), d.expires ? `expires ${dateWords(d.expires)}` : '', d.verified ? 'Verified' : '']
    .filter(Boolean).join(' · ')
}

/* ---------- Information: the resume ---------- */

export type ResumeJob = { role: string; employer: string; place: string; from: string; to: string }
export type ResumeSchool = { school: string; degree: string; year: string; place: string }

export type ResumeFields = {
  experience: string
  availability: string
  preferred_location: string
  /** 'stated': the resume names where they want to work; 'home': only where they live */
  preferred_basis: '' | 'stated' | 'home'
  earliest_start: string
}

export type CandidateResume = {
  /** a resume file or a scored analysis of one is on the record */
  on_file: boolean
  /** the file's own text was read for this answer */
  file_read: boolean
  fields: ResumeFields
  summary: string
  work: ResumeJob[]
  education: ResumeSchool[]
  certifications: string[]
  skills: string[]
  languages: string[]
  /** what the scored analysis says of the career, labelled */
  analysis: Labelled[]
  why: string[]
  degraded: boolean
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])

/** candidateProfileResume's answer. */
export function resumeOf(raw: unknown): CandidateResume {
  const o = rec(raw)
  const f = rec(o.fields)
  const a = rec(o.analysis)
  const basis = word(f.preferred_basis)
  return {
    on_file: o.on_file === true,
    file_read: o.file_read === true,
    fields: {
      experience: pick(f, 'experience'), availability: pick(f, 'availability'),
      preferred_location: pick(f, 'preferred_location'),
      preferred_basis: basis === 'stated' || basis === 'home' ? basis : '',
      earliest_start: pick(f, 'earliest_start'),
    },
    summary: pick(o, 'summary'),
    work: rowsIn(o.work).map((v) => {
      const x = rec(v)
      return { role: pick(x, 'role'), employer: pick(x, 'employer'), place: pick(x, 'place'), from: pick(x, 'from'), to: pick(x, 'to') }
    }).filter((j) => j.role || j.employer),
    education: rowsIn(o.education).map((v) => {
      const x = rec(v)
      return { school: pick(x, 'school'), degree: pick(x, 'degree'), year: pick(x, 'year'), place: pick(x, 'place') }
    }).filter((e) => e.school || e.degree),
    certifications: strings(o.certifications),
    skills: strings(o.skills),
    languages: strings(o.languages),
    analysis: [
      { label: 'Highest responsibility', value: pick(a, 'highest_responsibility') },
      { label: 'DSP agencies', value: pick(a, 'dsp_agencies') },
      { label: 'Average time per job', value: pick(a, 'avg_tenure') },
      { label: 'Months since the last care job', value: pick(a, 'months_since_last') },
    ].filter((l) => l.value),
    why: whyOf(o.why),
    degraded: o.degraded === true,
  }
}

export type InfoSource = 'record' | 'resume'

export const INFO_SOURCE_LABEL: Record<InfoSource, string> = { record: 'Hiring record', resume: 'Resume' }

/** One Information line: its words, where they came from, and a qualifier the source needs said. */
export type InfoValue = { value: string; source: InfoSource | ''; note: string }

const fromRecord = (value: string): InfoValue => ({ value, source: value ? 'record' : '', note: '' })

// The four lines the resume may answer — availability, experience, preferred location, earliest start: the hiring…
export function resumeFilled(d: Pick<CandidateDetails, 'availability' | 'experience' | 'preferred_location' | 'earliest_start'>,
  r: CandidateResume | null): Record<'availability' | 'experience' | 'preferred_location' | 'earliest_start', InfoValue> {
  const pickOne = (record: string, resume: string, note = ''): InfoValue =>
    record ? fromRecord(record) : resume ? { value: resume, source: 'resume', note } : fromRecord('')
  const f = r?.fields
  return {
    availability: pickOne(d.availability, f?.availability ?? ''),
    experience: pickOne(d.experience, f?.experience ?? ''),
    preferred_location: pickOne(d.preferred_location, f?.preferred_location ?? '',
      f?.preferred_basis === 'home' ? 'where they live' : ''),
    earliest_start: d.earliest_start ? fromRecord(dateWords(d.earliest_start)) : pickOne('', f?.earliest_start ?? ''),
  }
}

/** A job as one line: role at employer · place. */
export function jobLine(j: ResumeJob): string {
  const head = j.role && j.employer ? `${j.role} · ${j.employer}` : j.role || j.employer
  return [head, j.place].filter(Boolean).join(' · ')
}

/** 'June 2019 – Present', one end alone, or ''. */
export const spanOf = (from: string, to: string): string => [from, to].filter(Boolean).join(' – ')

/* ---------- Activity Log ---------- */

export type CandidateActivity = { items: ActivityItem[]; why: string[]; degraded: boolean; total: number | null }

/** candidateProfileActivity's answer, newest first as it comes. */
export function activityOf(raw: unknown): CandidateActivity {
  const o = rec(raw)
  return { items: activityItems(raw), why: whyOf(o.why), degraded: o.degraded === true, total: num(o.total) }
}

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  step: 'Hiring step', stage: 'Stage', note: 'Note', sms: 'Text', call: 'Call', mail: 'E-mail', document: 'Document',
  interview: 'Interview', record: 'Record',
}

/** "<by> · <channel> · <date>", or the kind when nobody is named. */
export function activityMeta(x: Pick<ActivityItem, 'by' | 'kind' | 'at' | 'channel'>): string {
  return [x.by || ACTIVITY_KIND_LABEL[x.kind], x.channel, stampWords(x.at)].filter(Boolean).join(' · ')
}

/* ---------- notes ---------- */

/** journeyLog_ keeps this much of a note (CND_NOTE_MAX). */
export const NOTE_MAX = 900

/** The note as filed: the step it is about first, when there is one. */
export const noteBody = (text: string, about: string): string => (about ? `${about}: ${text.trim()}` : text.trim())

/* ---------- the panel's heading, and the Actions menu ---------- */

export function panelLabel(ask: CandidateAsk): string {
  switch (ask.kind) {
    case 'share': return 'Share'
    case 'note': return 'Add note'
    case 'stage': return 'Update stage'
    case 'complete': return 'Mark complete'
    case 'upload': return 'Upload'
    case 'document': return 'Add document'
    case 'transcript': return 'Transcript'
    case 'screen': return 'Phone screen'
    case 'interview': return 'Interview'
    case 'packet': return 'New Hire packet'
    case 'edit': return ask.section === 'preferences' ? 'Edit preferences' : 'Edit information'
    case 'noteEdit': return 'Edit note'
    case 'review': return 'Review document'
  }
}

export function panelTitle(ask: CandidateAsk, name: string): string {
  switch (ask.kind) {
    case 'share': return name
    case 'note': return `Add note · ${name}`
    case 'stage': return `Update stage · ${name}`
    case 'complete': return `Mark complete · ${name}`
    case 'upload': return `Upload a document · ${name}`
    case 'document': return `Add document · ${name}`
    case 'transcript': return 'Call transcript'
    case 'screen': return `Phone screen transcript · ${name}`
    case 'interview': return `Interview · ${name}`
    case 'packet': return `New Hire packet · ${name}`
    case 'edit': return `${ask.section === 'preferences' ? 'Preferences' : 'Information'} · ${name}`
    case 'noteEdit': return `Edit note · ${name}`
    case 'review': return `Review a document · ${name}`
  }
}

export type MenuItem =
  | { id: 'note'; label: string; ask: CandidateAsk }
  | { id: 'stage'; label: string; ask: CandidateAsk }
  | { id: 'copy-email'; label: string; value: string; why: string }
  | { id: 'call'; label: string; href: string; why: string }
  | { id: 'pipeline'; label: string; tab: CandidateTab }
  | { id: 'hiring'; label: string; href: string }

/** What this reader may do here: `write` for the master; `editions` as editionsMine names them; `narrow` for a client,
 *  family or an SSA. */
export type Reach = { write: boolean; narrow: boolean; editions?: readonly CandidateEdition[] }

export const READ_ONLY: Reach = { write: false, narrow: false }

/* ---------- the editions (Settings › Editions): what a listed person makes beside the master ---------- */

/** Staff Candidates' editions (app/editions.py CATALOGUE), in the order Settings lists them. */
export const CANDIDATE_EDITIONS = [
  'candidates.information', 'candidates.pipeline', 'candidates.notes', 'candidates.interviews', 'candidates.documents',
] as const satisfies readonly EditionId[]
export type CandidateEdition = (typeof CANDIDATE_EDITIONS)[number]

/** The editions whose door only Python has: offered as editionsMine names them, the master's too (none on Apps Script). */
export const PYTHON_EDITIONS: readonly CandidateEdition[] = ['candidates.information', 'candidates.interviews', 'candidates.documents']

/** editionsMine's answer as Staff Candidates keeps it: its own editions, once each, in catalogue order. */
export const candidateEditionsOf = (raw: unknown): CandidateEdition[] => {
  const list = Array.isArray(raw) ? raw.map((x) => String(x ?? '')) : []
  return CANDIDATE_EDITIONS.filter((e) => list.includes(e))
}

/** Does this reader make the edition? The master always (a Python-only one as editionsMine names it); a holder its own. */
export const candidateCan = (reach: Reach, edition: CandidateEdition): boolean =>
  !reach.narrow && ((reach.write && !PYTHON_EDITIONS.includes(edition)) || (reach.editions ?? []).includes(edition))

/** Mark complete and Update stage: the master's on either engine, a pipeline holder's on Python. */
export const mayPress = (reach: Reach): boolean => candidateCan(reach, 'candidates.pipeline')

/** Add note: the master's on either engine, a notes holder's on Python. */
export const mayNote = (reach: Reach): boolean => candidateCan(reach, 'candidates.notes')

/** A note's text changed or the note removed: Python's own door, so only as editionsMine names it. */
export const mayNoteEdit = (reach: Reach): boolean => !reach.narrow && (reach.editions ?? []).includes('candidates.notes')

const SECTION_EDITION: Record<EditSection, CandidateEdition> = {
  information: 'candidates.information', preferences: 'candidates.interviews',
}

/** A section's edit panel: Python's own door, so only as editionsMine names it. */
export const mayEdit = (reach: Reach, section: EditSection): boolean => candidateCan(reach, SECTION_EDITION[section])

/** A filed document reviewed: Python's own door, so only as editionsMine names it. */
export const mayReview = (reach: Reach): boolean => candidateCan(reach, 'candidates.documents')
/** Filing a paper from Documents: the master's, and a holder's of the documents edition (Settings › Editions). */
export const mayUpload = (reach: Reach): boolean => (reach.write && !reach.narrow) || candidateCan(reach, 'candidates.documents')

/** Whether this reader opens a panel's form: each by the edition that makes it, the master's own on either engine. */
export function formOpen(ask: CandidateAsk, reach: Reach): boolean {
  switch (ask.kind) {
    case 'note': return mayNote(reach)
    case 'stage': case 'complete': return mayPress(reach)
    case 'upload': return mayUpload(reach)
    case 'edit': return mayEdit(reach, ask.section)
    case 'noteEdit': return mayNoteEdit(reach)
    case 'review': return mayReview(reach)
    default: return true
  }
}

/** Whether a document row takes a review: an onboarding paper filed on the record, never the background check. */
export const reviewable = (d: Pick<CandidateDoc, 'doc_id' | 'status' | 'source'>): boolean =>
  !!d.doc_id && d.doc_id !== 'background_check' && d.status === 'on_file' && d.source === 'Onboarding documents'

/** Why a door is the master's alone, said to a pipeline holder: every other press Python decides for whoever holds the
 *  pipeline edition (app/candidate_writes.py), its letters through Smart Comms. */
export const HELD_WORDS: Record<string, string> = {
  tableDocUpload: 'Filing a paper on the record is the master\'s here; the Hiring board files it for everyone else.',
}

/** '' when this reader presses the door; else why it is the master's. */
export function pressHeld(door: Door, master: boolean): string {
  if (master) return ''
  return HELD_WORDS[door.action] ?? ''
}

/* ---------- an edition's panel: the raw values it opens on (candidateProfileEditRead) ---------- */

export type EditElsewhere = { field: string; label: string; why: string }

export type CandidateEdit = {
  section: string
  name: string
  fields: EditField[]
  /** the lines this panel does not change, each with where it is changed */
  elsewhere: EditElsewhere[]
  /** a document's catalog id, label and file name; a note's id, filer and time */
  doc: string
  label: string
  file: string
  id: string
  by: string
  at: string
}

const EDIT_KINDS: EditKind[] = ['text', 'textarea', 'date', 'phone', 'email', 'url', 'select']

/** candidateProfileEditRead's answer: each field as RecordEditBody draws it, its raw value the save's witness. */
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
  return { section: str(o.section), name: str(o.name), fields, elsewhere, doc: str(o.doc), label: str(o.label),
    file: str(o.file), id: str(o.id), by: str(o.by), at: str(o.at) }
}

/** What an edition's panel says before its fields. */
export function editIntro(section: EditSection | 'document' | 'note', name: string): string {
  switch (section) {
    case 'information': return `${name}'s details on the Hiring record. A line the record leaves empty stays empty until it is typed here.`
    case 'preferences': return `What ${name} told the phone screen. Yes or No, or blank when it was not said.`
    case 'document': return 'Verified or Returned, and the paper\'s own days and notes. The file itself stays as it was filed.'
    case 'note': return 'The note\'s text as it is on the hiring journey. Who filed it and when stay as filed.'
  }
}

// The Actions menu: Add note and Update stage (the master's, and whom the editions name); the candidate's e-mail and…
export function actionGroups(key: string, d: Pick<CandidateDetails, 'email' | 'phone'> | null, reach: Reach = READ_ONLY):
  { label: string; items: MenuItem[] }[] {
  const reading = d === null
  const groups: { label: string; items: MenuItem[] }[] = []
  const own: MenuItem[] = [
    ...(mayNote(reach) ? [{ id: 'note' as const, label: 'Add note', ask: { kind: 'note', about: '' } as CandidateAsk }] : []),
    ...(mayPress(reach) ? [{ id: 'stage' as const, label: 'Update stage', ask: { kind: 'stage' } as CandidateAsk }] : []),
  ]
  if (own.length) groups.push({ label: 'Candidate actions', items: own })
  if (!reach.narrow) {
    groups.push({
      label: 'Contact',
      items: [
        { id: 'copy-email', label: 'Copy e-mail', value: d?.email ?? '', why: reading ? 'Reading the candidate…' : d?.email ? '' : 'No e-mail on file' },
        { id: 'call', label: 'Call', href: d?.phone ? telHref(d.phone) : '', why: reading ? 'Reading the candidate…' : d?.phone ? '' : 'No phone on file' },
      ],
    })
  }
  groups.push({
    label: 'Navigation',
    items: reach.narrow ? [{ id: 'pipeline', label: 'View all candidates', tab: 'pipeline' }] : [
      { id: 'pipeline', label: 'View all candidates', tab: 'pipeline' },
      { id: 'hiring', label: 'Open in Hiring', href: hiringHref(key) },
    ],
  })
  return groups
}

/* ---------- a read the server did not answer ---------- */

export const NOT_OPEN = 'This part is not open to you.'

/** A refusal that says this reader may not see it: the app's own 404, or a door's role refusal. */
export const notOpen = (error: string): boolean =>
  /unknown action|^this action is for |^requires an admin or manager/i.test(str(error))

/** A refusal as a sentence: one this reader may not see is said plainly. */
export function readRefusal(error: string): string {
  if (notOpen(error)) return NOT_OPEN
  return error || 'The read did not answer.'
}

// The lookup's own answer that no hiring record carries the id (CandidateProfiles.gs cndCandidate_), as against a…
export const notOnFile = (error: string): boolean => /^No candidate ".*" is on file\.$/.test(str(error))

/* ---------- share ---------- */

/** Who the candidate is and where they stand — never a phone, an e-mail or anything the record keeps private. */
export function sharePayloadFor(row: Pick<RosterRow, 'key' | 'name' | 'position' | 'stage' | 'location'>, tab: CandidateTab): SharePayload {
  const lines = [
    row.position ? `Position: ${row.position}` : '',
    row.stage ? `Stage: ${stageLabel(row.stage)}` : '',
    row.location ? `Location: ${row.location}` : '',
  ].filter(Boolean)
  return {
    title: row.name,
    subtitle: `${APP_NAME} · ${tabLabel(tab)}`,
    appHref: candidateHref(row.key, tab),
    text: lines.join('\n'),
    icon: 'user-plus',
    filename: `${row.name} ${tabLabel(tab)}`,
  }
}
