// Support Requests — the answer of supportDeskList and the pure decisions the screen draws from it.
// Apps Script decides who sees which rows, which verdicts each row offers (`may`) and every status word; nothing…
import { dayOnly, ohioDayYear, ohioTime } from '@/lib/ohio'

/* ---------- the answer ---------- */

export type StatusTone =
  | 'new' | 'pending' | 'waiting' | 'warning' | 'important' | 'approved' | 'denied' | 'resolved' | 'aware' | 'closed'

export type RowSource = 'queue' | 'scheduling' | 'event'

export type RowKind =
  | 'request' | 'call_off' | 'phone' | 'request_off' | 'time_off' | 'swap' | 'take'
  | 'late_show' | 'no_call' | 'punch' | 'incident' | 'adp' | 'vacation'

export type TypeParts = { raw: string; area: string; label: string; display: string }
export type Pair = { label: string; value: string }
/** `to`: whom a redirect handed the request to. */
export type HistoryLine = { at: string; by: string; verdict: string; note: string; via: string; to?: string }
export type Ack = { uid: string; name: string; at: string }
export type May = { approve: boolean; deny: boolean; resolve: boolean; aware: boolean; redirect: boolean; why: string }
/** `house`: an exchange asks one house manager seat per house, each named by its house. */
export type SchedSeat = { seat: string; state: string; to: string[]; by: string; at: string; note: string; house?: string }
export type SchedPart = { flow_id: string; state: string; item_id: string; words: string[]; seats: SchedSeat[] }
export type AdpState = 'applied' | 'ready' | 'refused' | 'undone' | 'off'
export type AdpPart = { state: AdpState; field: string; words: string; proof: string; why: string }

export type Row = {
  ref: string
  source: RowSource
  kind: RowKind
  status: { word: string; tone: StatusTone }
  /** an ISO instant or a plain 'yyyy-MM-dd'; sorts as text */
  date: string
  requestor: { name: string; uid: string }
  type: TypeParts
  urgency: string
  description: string
  route: string
  completed: boolean
  details: Pair[]
  history: HistoryLine[]
  acks: Ack[]
  waiting_on: string[]
  may: May
  sched?: SchedPart
  adp?: AdpPart
  link: string
}

export type SourceKey = 'queue' | 'scheduling' | 'events' | 'decisions' | 'inbox'
export type SourceState = { key: string; state: 'ready' | 'unreadable'; why: string; count: number | null; as_of: string }

export const AUTO_PARTS = [
  'late_show', 'no_call', 'punch', 'incident', 'general', 'vehicle', 'payroll', 'adp_update', 'time_off',
] as const
export type AutoPart = typeof AUTO_PARTS[number]

export type Person = { uid: string; name: string }

export type Viewer = {
  uid: string; name: string; is_master: boolean; is_director: boolean; is_lead: boolean; can_decide: boolean
}

export type Board = {
  ok: boolean
  now: string
  today: string
  viewer: Viewer
  test_mode: { on: boolean; readable: boolean; why: string }
  directors: Person[]
  leads: Person[]
  directors_readable: boolean
  directors_why: string
  /** null = the switch could not be read */
  automations: Record<AutoPart, boolean | null>
  sources: SourceState[]
  rows: Row[]
  counts: { open: number; waiting_on_me: number; warnings: number; completed: number }
  /** the live staff accounts a request may be redirected to (empty when this viewer redirects nothing) */
  people: Person[]
  /** why somebody is missing from `people`, or why it is empty */
  people_why: string
  note: string
  /** rows the answer carried that could not be read here; said on the screen, never dropped silently */
  unreadRows: number
}

const TONES: readonly StatusTone[] = ['new', 'pending', 'waiting', 'warning', 'important', 'approved', 'denied', 'resolved', 'aware', 'closed']
const SOURCES: readonly RowSource[] = ['queue', 'scheduling', 'event']
const KINDS: readonly RowKind[] = [
  'request', 'call_off', 'phone', 'request_off', 'time_off', 'swap', 'take', 'late_show', 'no_call', 'punch', 'incident', 'adp', 'vacation',
]
const ADP_STATES: readonly AdpState[] = ['applied', 'ready', 'refused', 'undone', 'off']

type Loose = Record<string, unknown>
const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const text = (v: unknown): string => (v == null ? '' : String(v)).trim()
const bool = (v: unknown): boolean => v === true
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  (list as readonly string[]).includes(text(v)) ? (text(v) as T) : fallback

// A hotline type as the hotline files it ("Area - Label") and as the screen shows it ("Area · Label"): split on the…
export function typeParts(raw: string): TypeParts {
  const r = text(raw)
  if (!r) return { raw: '', area: '', label: 'Other', display: 'Other' }
  const at = r.indexOf(' - ')
  if (at < 0) return { raw: r, area: '', label: r, display: r }
  const area = r.slice(0, at).trim()
  const label = r.slice(at + 3).trim()
  return { raw: r, area, label, display: `${area} · ${label}` }
}

function typeFrom(v: unknown): TypeParts {
  const t = obj(v)
  const raw = text(t.raw)
  const base = typeParts(raw)
  const display = text(t.display) || base.display
  return { raw, area: text(t.area) || base.area, label: text(t.label) || base.label, display }
}

function rowFrom(v: unknown): Row | null {
  const r = obj(v)
  const ref = text(r.ref)
  if (!ref) return null
  const status = obj(r.status)
  const may = obj(r.may)
  const requestor = obj(r.requestor)
  const out: Row = {
    ref,
    source: oneOf(r.source, SOURCES, 'queue'),
    kind: oneOf(r.kind, KINDS, 'request'),
    status: { word: text(status.word) || 'Unknown', tone: oneOf(status.tone, TONES, 'pending') },
    date: text(r.date),
    requestor: { name: text(requestor.name), uid: text(requestor.uid) },
    type: typeFrom(r.type),
    urgency: text(r.urgency),
    description: text(r.description),
    route: text(r.route),
    completed: bool(r.completed),
    details: arr(r.details).map(obj).map((d) => ({ label: text(d.label), value: text(d.value) })).filter((d) => d.label || d.value),
    history: arr(r.history).map(obj).map((h) => ({
      at: text(h.at), by: text(h.by), verdict: text(h.verdict), note: text(h.note), via: text(h.via),
      ...(text(h.to) ? { to: text(h.to) } : {}),
    })),
    acks: arr(r.acks).map(obj).map((a) => ({ uid: text(a.uid), name: text(a.name), at: text(a.at) })),
    waiting_on: arr(r.waiting_on).map(text).filter(Boolean),
    may: {
      approve: bool(may.approve), deny: bool(may.deny), resolve: bool(may.resolve), aware: bool(may.aware),
      redirect: bool(may.redirect), why: text(may.why),
    },
    link: text(r.link),
  }
  if (r.sched && typeof r.sched === 'object') {
    const s = obj(r.sched)
    out.sched = {
      flow_id: text(s.flow_id), state: text(s.state), item_id: text(s.item_id),
      words: arr(s.words).map(text).filter(Boolean),
      seats: arr(s.seats).map(obj).map((x) => ({
        seat: text(x.seat), state: text(x.state), to: arr(x.to).map(text).filter(Boolean),
        by: text(x.by), at: text(x.at), note: text(x.note), ...(text(x.house) ? { house: text(x.house) } : {}),
      })),
    }
  }
  if (r.adp && typeof r.adp === 'object') {
    const a = obj(r.adp)
    out.adp = {
      state: oneOf(a.state, ADP_STATES, 'refused'), field: text(a.field), words: text(a.words), proof: text(a.proof), why: text(a.why),
    }
  }
  return out
}

const people = (v: unknown): Person[] =>
  arr(v).map(obj).map((p) => ({ uid: text(p.uid), name: text(p.name) })).filter((p) => p.name || p.uid)

/** The accounts a request may be redirected to: an entry without both an id and a name is no choice. */
export const pickers = (v: unknown): Person[] => people(v).filter((p) => p.uid && p.name)

/** The answer read defensively: a row that cannot be read is counted and said, never shown as something else. */
export function boardFrom(raw: unknown): Board {
  const d = obj(raw)
  const viewer = obj(d.viewer)
  const tm = obj(d.test_mode)
  const autos = obj(d.automations)
  const counts = obj(d.counts)
  const rawRows = arr(d.rows)
  const rows = rawRows.map(rowFrom).filter((r): r is Row => r !== null)
  const automations = {} as Record<AutoPart, boolean | null>
  for (const p of AUTO_PARTS) automations[p] = typeof autos[p] === 'boolean' ? (autos[p] as boolean) : null
  return {
    ok: d.ok === true,
    now: text(d.now),
    today: text(d.today),
    viewer: {
      uid: text(viewer.uid), name: text(viewer.name), is_master: bool(viewer.is_master), is_director: bool(viewer.is_director),
      is_lead: bool(viewer.is_lead), can_decide: bool(viewer.can_decide),
    },
    // test mode unreadable reads as on: nothing is said to be sent that might not be
    test_mode: { on: tm.on === true || tm.readable === false, readable: tm.readable !== false, why: text(tm.why) },
    directors: people(d.directors),
    leads: people(d.leads),
    directors_readable: d.directors_readable !== false,
    directors_why: text(d.directors_why),
    automations,
    sources: arr(d.sources).map(obj).map((s) => ({
      key: text(s.key), state: s.state === 'ready' ? 'ready' as const : 'unreadable' as const, why: text(s.why),
      count: typeof s.count === 'number' ? s.count : null, as_of: text(s.as_of),
    })),
    rows,
    counts: { open: num(counts.open), waiting_on_me: num(counts.waiting_on_me), warnings: num(counts.warnings), completed: num(counts.completed) },
    people: pickers(d.people),
    people_why: text(d.people_why),
    note: text(d.note),
    unreadRows: rawRows.length - rows.length,
  }
}

/* ---------- the list ---------- */

export const SEARCH_PLACEHOLDER = 'Search ID, requestor, type or description'

/** Case-insensitive over the ref, the requestor, the type (as shown and as filed) and the description. */
export function matches(row: Row, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [row.ref, row.requestor.name, row.type.display, row.type.raw, row.description]
    .some((v) => v.toLowerCase().includes(q))
}

export type SortDir = 'asc' | 'desc'

/** A plain day as 'yyyy-MM-dd': itself, or a 'M/D/YYYY' the book carries; null for anything else. */
export function plainDay(v: string): string | null {
  const s = text(v)
  const iso = dayOnly(s)
  if (iso) return iso
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
}

/** The text a date sorts by: a 'M/D/YYYY' day sorts as its ISO day. */
export function sortKey(date: string): string {
  return plainDay(date) ?? text(date)
}

/** Completed rows only when asked for; then the search; then the date, newest first by default. */
export function visibleRows(rows: Row[], o: { query: string; completed: boolean; dir: SortDir }): Row[] {
  const kept = rows.filter((r) => (o.completed || !r.completed) && matches(r, o.query))
  const sign = o.dir === 'asc' ? 1 : -1
  return [...kept].sort((a, b) => sign * (sortKey(a.date).localeCompare(sortKey(b.date)) || a.ref.localeCompare(b.ref)))
}

/** 'Sep 18, 2026 2:24 PM' for an instant, 'Sep 18, 2026' for a day, in Ohio; the text as filed when unreadable. */
export function dateWords(date: string): string {
  const v = text(date)
  if (!v) return '—'
  const day = plainDay(v)
  if (day) return ohioDayYear(`${day}T12:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v)) return v
  if (!Number.isFinite(Date.parse(v))) return v
  return `${ohioDayYear(v)} ${ohioTime(v)}`
}

/** An instant as Ohio words with the time; a day as the day. */
export function stampWords(at: string): string {
  return dateWords(at)
}

export const UNKNOWN_CALLER = 'Unknown caller'

export function requestorName(row: Pick<Row, 'requestor'>): string {
  return row.requestor.name || UNKNOWN_CALLER
}

/* ---------- the paint ---------- */

export type Tint = 'blue' | 'lavender' | 'amber' | 'slate' | 'danger' | 'mint' | 'peach' | 'green'

export const PILL: Record<Tint, string> = {
  blue: 'bg-tint-blue text-tint-fg-blue',
  lavender: 'bg-tint-lavender text-tint-fg-lavender',
  amber: 'bg-tint-amber text-tint-fg-amber',
  slate: 'bg-tint-slate text-tint-fg-slate',
  danger: 'bg-tint-danger text-tint-fg-danger',
  mint: 'bg-tint-mint text-tint-fg-mint',
  peach: 'bg-tint-peach text-tint-fg-peach',
  green: 'bg-tint-mint text-tint-fg-mint',
}

const AREA_TINT: Record<string, Tint> = {
  schedule: 'blue', scheduling: 'blue',
  adp: 'lavender', payroll: 'lavender', 'pay stubs': 'lavender', finances: 'lavender', psi: 'lavender',
  operations: 'amber', 'van calendar': 'amber', incident: 'amber',
  attendance: 'danger',
  admin: 'mint', training: 'green', safety: 'peach',
  other: 'slate',
}

/** The area a type belongs to: its own, else the first word group before " · ", else the label. */
export function areaOf(t: TypeParts): string {
  if (t.area) return t.area
  const dot = t.display.indexOf(' · ')
  return dot > 0 ? t.display.slice(0, dot) : t.label
}

/** The Request Type pill's tint: Schedule blue, ADP and Payroll purple, Operations amber, Attendance red, Other gray. */
export function typeTint(row: Pick<Row, 'type' | 'route'>): Tint {
  const hit = AREA_TINT[areaOf(row.type).trim().toLowerCase()]
  if (hit) return hit
  if (row.route === 'payroll' || row.route === 'adp_update') return 'lavender'
  if (row.route === 'vehicle') return 'amber'
  return 'slate'
}

export type StatusLook = { icon: 'dot' | 'clock' | 'triangle-alert' | 'flag' | 'check' | 'x' | 'check-circle'; className: string }

/** The Status column: an icon only, its word read out. */
export function statusLook(tone: StatusTone): StatusLook {
  switch (tone) {
    case 'new': return { icon: 'dot', className: 'text-[var(--info)]' }
    case 'pending':
    case 'waiting': return { icon: 'clock', className: 'text-[var(--warning)]' }
    case 'warning': return { icon: 'triangle-alert', className: 'text-danger' }
    case 'important': return { icon: 'flag', className: 'text-[var(--warning)]' }
    case 'approved': return { icon: 'check', className: 'text-[var(--success)]' }
    case 'denied': return { icon: 'x', className: 'text-text-3' }
    default: return { icon: 'check-circle', className: 'text-[var(--success)]' }
  }
}

/** The status word's pill in the panel. */
export function statusPill(tone: StatusTone): string {
  if (tone === 'warning') return PILL.danger
  if (tone === 'important' || tone === 'pending' || tone === 'waiting') return PILL.amber
  if (tone === 'new') return PILL.blue
  if (tone === 'denied') return PILL.slate
  return PILL.mint
}

/* ---------- the figures and the sources ---------- */

export function countChips(b: Pick<Board, 'counts'>): { key: string; label: string; n: number }[] {
  return [
    { key: 'open', label: 'Open', n: b.counts.open },
    { key: 'waiting_on_me', label: 'Waiting on you', n: b.counts.waiting_on_me },
    { key: 'warnings', label: 'Warnings', n: b.counts.warnings },
  ]
}

const SOURCE_LABEL: Record<string, string> = {
  queue: 'The hotline’s Support Queue',
  scheduling: 'Scheduling',
  events: 'Warnings and alerts',
  decisions: 'Decisions',
  inbox: 'My Inbox items',
}

/** One sentence per source that could not be read: its rows are missing, and the screen says so. */
export function sourceLines(b: Pick<Board, 'sources'>): { key: string; text: string }[] {
  return b.sources.filter((s) => s.state !== 'ready').map((s) => ({
    key: s.key,
    text: `${SOURCE_LABEL[s.key] ?? s.key} could not be read${s.why ? ` — ${sentence(s.why)}` : '.'} Its requests are not listed.`,
  }))
}

export function sentence(v: string): string {
  const t = text(v)
  if (!t) return ''
  const s = t[0].toUpperCase() + t.slice(1)
  return /[.!?]$/.test(s) ? s : `${s}.`
}

/** What the empty table says: never "no requests" when a source did not answer. */
export function emptyLine(b: Pick<Board, 'sources' | 'rows'>, filtered: boolean): string {
  if (b.sources.some((s) => s.state !== 'ready')) return 'Nothing from the sources that answered — the lines above say what is missing.'
  if (filtered) return 'Nothing matches the search.'
  return 'No open requests.'
}

export const TEST_MODE_PILL = 'Test mode — texts are written to the rehearsal sheet'

/* ---------- the panel ---------- */

export type Verdict = 'approve' | 'deny' | 'resolve' | 'redirect' | 'aware'

export const VERDICTS: readonly Verdict[] = ['approve', 'deny', 'resolve', 'redirect', 'aware']

export const VERDICT_WORDS: Record<Verdict, { label: string; armed: string; tone: 'primary' | 'outline' | 'danger' }> = {
  approve: { label: 'Approve', armed: 'Press again to approve', tone: 'primary' },
  deny: { label: 'Deny', armed: 'Press again to deny', tone: 'outline' },
  resolve: { label: 'Resolved', armed: 'Press again to resolve', tone: 'outline' },
  redirect: { label: 'Redirect', armed: 'Press again to redirect', tone: 'outline' },
  aware: { label: 'I’m aware', armed: 'Press again — I’m aware', tone: 'danger' },
}

const WARNINGS: readonly RowKind[] = ['late_show', 'no_call', 'punch']
const DECISIONS: readonly RowKind[] = ['request_off', 'time_off', 'swap', 'vacation']

// The verdicts a row of this kind answers with, whether or not this viewer may press them: a request its four…
export function naturalVerdicts(row: Pick<Row, 'kind' | 'source'>): Verdict[] {
  if (WARNINGS.includes(row.kind)) return ['aware']
  if (row.source === 'scheduling' || DECISIONS.includes(row.kind)) return ['approve', 'deny']
  if (row.source === 'event') return ['resolve', 'redirect']
  return ['approve', 'deny', 'resolve', 'redirect']
}

export type PanelButton = { verdict: Verdict; on: boolean }
export type PanelButtons = { buttons: PanelButton[]; why: string }

// The buttons a row's decision block draws.
export function panelButtons(row: Pick<Row, 'may' | 'kind' | 'source' | 'completed'>): PanelButtons {
  const natural = naturalVerdicts(row)
  const offered = VERDICTS.filter((v) => row.may[v])
  let shown: Verdict[]
  if (offered.length) shown = natural.includes('redirect') ? VERDICTS.filter((v) => natural.includes(v) || offered.includes(v)) : offered
  else if (row.completed && !row.may.why) shown = []
  else shown = natural
  const buttons = shown.map((verdict) => ({ verdict, on: row.may[verdict] }))
  return { buttons, why: buttons.some((b) => !b.on) ? row.may.why || 'This one is not yours to answer.' : '' }
}

/** The people a search keeps: every word typed found in the name, in any case. */
export function searchPeople(list: Person[], query: string): Person[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return list
  return list.filter((p) => words.every((w) => p.name.toLowerCase().includes(w)))
}

/** One history line's head: "Redirected to Ann Roe by Ty Bond", "Approved by Ty Bond". */
export function historyHead(h: HistoryLine): { verdict: string; by: string } {
  const verdict = h.verdict === 'redirected' && h.to ? `Redirected to ${h.to}` : verdictWord(h.verdict)
  return { verdict, by: h.by }
}

export const NOTE_MAX = 500

export type DecideAnswer = { ok?: boolean; changed?: boolean; said?: string; state?: string; row?: unknown; open?: unknown }

// Where an approved ADP e-mail or phone is saved: the person's own profile, its contacts opened with the value…
export function adpOpenHref(a: DecideAnswer | null | undefined): string {
  const href = text(obj(a?.open).href)
  return /^\/app\/users\/profile\?u=[^&]+&contacts=1&add_(email|phone)=[^&]+$/.test(href) ? href : ''
}

/** The toast after an answer: the server's sentence, else a plain one. */
export function decideToast(verdict: Verdict, a: DecideAnswer | null | undefined): { type: 'success' | 'info'; title: string; body: string } {
  const said = text(a?.said)
  if (a && a.changed === false) return { type: 'info', title: 'Nothing changed', body: said || 'It was already answered.' }
  return { type: 'success', title: verdict === 'redirect' ? 'Redirected' : `${VERDICT_WORDS[verdict].label} — recorded`, body: said || 'Recorded.' }
}

/** What supportDeskSeat answers: one request as its viewer sees it, and the people it may be redirected to. */
export type Seat = { row: Row | null; people: Person[]; people_why: string; viewer: Viewer }

export function seatFrom(raw: unknown): Seat {
  const d = obj(raw)
  const v = obj(d.viewer)
  return {
    row: d.row ? rowFrom(d.row) : null,
    people: pickers(d.people),
    people_why: text(d.people_why),
    viewer: {
      uid: text(v.uid), name: text(v.name), is_master: bool(v.is_master), is_director: bool(v.is_director),
      is_lead: bool(v.is_lead), can_decide: bool(v.can_decide),
    },
  }
}

/** The answer's own row laid over the board's. */
export function replaceRow(b: Board, row: Row): Board {
  const at = b.rows.findIndex((r) => r.ref === row.ref)
  if (at < 0) return { ...b, rows: [row, ...b.rows] }
  const rows = b.rows.slice()
  rows[at] = row
  return { ...b, rows }
}

/** The answer's row, when it carried one that reads. */
export function answerRow(a: DecideAnswer | null | undefined): Row | null {
  return a && a.row ? rowFrom(a.row) : null
}

/** A history line's verdict as a word. */
export function verdictWord(v: string): string {
  const w: Record<string, string> = {
    approved: 'Approved', denied: 'Denied', resolved: 'Resolved', aware: 'Aware', redirected: 'Redirected', applied: 'Applied automatically',
    undone: 'Undone', refused_auto: 'Not applied automatically', note: 'Note', approve: 'Approved', decline: 'Declined',
    declined: 'Declined', seen: 'Seen',
  }
  return w[text(v).toLowerCase()] ?? sentence(v).replace(/\.$/, '')
}

export function viaWord(v: string): string {
  const w: Record<string, string> = { 'support-desk': 'Support Requests', 'my-inbox': 'My Inbox', auto: 'automatically', scheduling: 'Scheduling', 'my-work': 'My Work' }
  return w[text(v)] ?? text(v)
}

/** Why a refusal of 409 re-reads the list: somebody answered first. */
export function isConflict(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { status?: number }).status === 409)
}

export function saidOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err ?? '')) || 'Try again.'
}

/** The ref an address opens (`?ref=`); it opens only when the list holds it. '' for anything not shaped like a ref. */
export function openRefOf(params: URLSearchParams): string {
  const ref = text(params.get('ref'))
  return /^[A-Za-z0-9-]{1,40}$/.test(ref) ? ref : ''
}

/* ---------- ADP ---------- */

/** The ADP block's sentence for each state. */
export function adpLine(a: AdpPart): string {
  if (a.state === 'applied') return a.words || `${sentence(a.field) || 'The change'} was applied on the platform. ADP still needs the change.`
  if (a.state === 'ready') return a.words || 'A new contact waits for one-click approval.'
  if (a.state === 'undone') return a.words || 'The automatic change was undone.'
  if (a.state === 'off') return 'ADP information updates are off in Settings, so nothing was changed.'
  return a.why ? sentence(a.why) : 'It could not be applied automatically.'
}
