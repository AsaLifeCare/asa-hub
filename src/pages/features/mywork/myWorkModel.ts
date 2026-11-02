// My Work — the answer of /hub-lanes/my-work and the pure decisions the screen draws from it.
// The relay decides whose rows these are (the signed-in account's own, or everyone's for the master's own session)…
import type { HeroFigure } from '@/lib/appHero'
import { ohioDayOf, ohioDayYear, ohioToday } from '@/lib/ohio'
import { safeLocalStorage } from '@/lib/safeStorage'

export const MY_WORK_PATH = '/hub-lanes/my-work'

export type SourceState = 'ready' | 'unreadable' | 'not_attributable'

export type SourceHead = {
  key: string
  label: string
  state: SourceState
  why: string
  as_of: string
  count: number | null
  hidden: number
  capped: boolean
  stale_why: string
  /** set when the mirrored copy read is older than a couple of days: the day it was taken, in words */
  copy_why?: string
  note: string
  /** true when the source's own shape, not this account, is why nothing can be attributed */
  structural?: boolean
  /** what a ready source could not settle: its rows are listed, but the card is not read as whole */
  gap?: string
}

export type Person = { key: string; name: string }
export type Detail = { label: string; value: string }
export type DueTone = 'overdue' | 'soon' | 'later' | ''

export type ActionTarget = {
  label: string
  kind: 'link' | 'upload' | 'decide' | 'book'
  app: string
  page: string
  href: string
  certs: string[]
  upload_for: string
  /** a decide target: the Scheduling item it answers */
  item_id?: string
  /** a decide target: its two words, Approve then Decline */
  words?: string[]
  /** a decide target: the action that answers it (absent = schedulingAnswer); only DECIDE_ACTIONS are called */
  action?: string
  /** a decide target: the item whole, for the decision panel; a book target: the IST record it books */
  item?: DecideItem & Partial<IstBookItem>
}

/** An owed IST record as the booking panel opens it (app/my_work.py `_ist_booking`). */
export type IstBookItem = { id: string; client: string; staff: string; house: string; due: string }
export type IstAnswer = 'confirmed' | 'declined'
export const IST_ANSWERS: { value: IstAnswer; label: string }[] = [
  { value: 'confirmed', label: 'Confirm' }, { value: 'declined', label: 'Decline' },
]
/** What myWorkIstBook answers. */
export type IstBookAnswer = { id: string; ist_id: string; state: string; said: string }

/** The booking a Send carries; '' fields are refused by the panel before it is sent. */
export function istBookPayload(item: IstBookItem, date: string, answer: IstAnswer | '', note: string) {
  return { ist_id: item.id, date: String(date ?? '').trim(), answer, note: String(note ?? '').trim() }
}

/** Send is open once a day and an answer are chosen. */
export function istBookReady(date: string, answer: IstAnswer | ''): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '').trim()) && (answer === 'confirmed' || answer === 'declined')
}

/** An item as the decision panel draws it (server/my_work.py seat decisions, `action.item`); `facts` when the source sends them. */
export type DecideItem = {
  id: string; flow_id?: string; kind?: string; seat?: string; seat_words?: string; title?: string; body?: string
  house_code?: string; house_label?: string; date?: string; day_words?: string; shift_text?: string
  created_at?: string; test_mode?: boolean
  facts?: { label: string; value: string }[]
  /** a redirected support request: the request it opens, and who redirected it */
  ref?: string; note?: string
}

// The only actions a decide cell may call: the relay never picks an arbitrary door.
// timeOffDecide is Time Off's own door (its act()), answered in My Work's panel: never a visit to Time Off
export const DECIDE_ACTIONS = ['schedulingAnswer', 'vehicleCalendarAnswer', 'supportDeskDecide', 'employeeLoanAnswer',
  'timeOffDecide', 'myWorkIstApprove'] as const

/** The request a decide row of Support Requests opens ('' for any other row). */
export function seatRefOf(row: ActionRow | null, cell: ActionCell | null): string {
  if (!row || !cell || cell.kind !== 'decide' || cell.action !== 'supportDeskDecide') return ''
  const ref = String(row.action?.item?.ref ?? '').trim()
  return /^[A-Za-z0-9-]{1,40}$/.test(ref) ? ref : ''
}
export type DecideAction = (typeof DECIDE_ACTIONS)[number]

/** The time off request a Requests row opens in Time Off's own panel, here — never a visit to Time Off ('' for any
 * other row). */
export function timeOffRequestRef(row: Pick<RequestRow, 'id' | 'ref' | 'link'>): string {
  if (!row.id.startsWith('time_off:') && row.link?.app !== 'timeoff') return ''
  return /^TO[A-Za-z0-9-]{1,38}$/i.test(row.ref) ? row.ref.toUpperCase() : ''
}

/** The time off request a decide row opens in Time Off's own panel, here ('' for any other row). */
export function timeOffRefOf(row: ActionRow | null, cell: ActionCell | null): string {
  if (!row || !cell || cell.kind !== 'decide' || cell.action !== 'timeOffDecide') return ''
  return /^TO[A-Za-z0-9-]{1,38}$/i.test(cell.itemId) ? cell.itemId.toUpperCase() : ''
}

export type ActionRow = {
  id: string
  source: string
  person?: Person
  due: string
  due_tone: DueTone
  due_why: string
  condition: string
  flow: string
  phase: string
  family: string
  action: ActionTarget | null
  action_why: string
  details: Detail[]
  /** the folded "Nothing on file for N requirements" row */
  folded?: boolean
  /** a Time off approval row its person may be told the outcome from (myWorkTimeOffMessage) */
  message?: { kind: string; ref: string }
}

/* ---------- a Time off approval row's message ---------- */

// App Control's row for the two buttons; the door asks the same id (app/my_work_writes.py FEATURE)
export const TIME_OFF_MESSAGE_FEATURE = 'my-work.timeOffMessages'
export type TimeOffOutcome = 'approved' | 'not_approved'
/** What myWorkTimeOffMessage answers: what Smart Comms did with the message, in one sentence. */
export type TimeOffMessageAnswer = { ref: string; outcome: TimeOffOutcome; person: string; state: string; held: string; said: string }

/** The request a Time off approval row's message names ('' for any other row). */
export function timeOffMessageRef(row: ActionRow): string {
  const m = row.message
  const ref = m && m.kind === 'time_off' ? String(m.ref ?? '').trim() : ''
  return /^TO[0-9A-F]{10}$/.test(ref) ? ref : ''
}

/** The toast after a press: sent is a success; held, already or not sent is said as it is. */
export function timeOffMessageToast(got: TimeOffMessageAnswer): { type: 'success' | 'warning' | 'info'; title: string; body: string } {
  if (got.state === 'sent') return { type: 'success', title: 'Message sent', body: got.said }
  if (got.state === 'already') return { type: 'info', title: 'Already sent', body: got.said }
  return { type: 'warning', title: got.state === 'held' ? 'Message held' : 'Message not sent', body: got.said }
}

export type StatusClass = 'open' | 'resolved' | 'recorded'

export type RequestRow = {
  id: string
  source: string
  person?: Person
  ref: string
  /** why REQUEST ID is blank, when it is */
  ref_why?: string
  request: string
  submitted: string
  submitted_why: string
  status: { class: StatusClass; word: string }
  details: Detail[]
  link: { app: string; page: string; href: string; label: string } | null
}

export type PersonEntry = { key: string; name: string; open_actions: number; open_requests: number }

/** Settings > My Work: the parts the master hides from every other account. */
export type HideParts = { header: boolean; source_notes: boolean; missing_row: boolean; completed: boolean }

// How this session is shown the page, decided by the relay.
export type MyWorkDisplay = { hidden: HideParts; for_users?: HideParts; readable?: boolean; why?: string }

export type MyWorkView = {
  scope: { mode: 'own' | 'mass'; why: string; person: string; people?: PersonEntry[] }
  me: { name: string; key_why: string; notes?: string[] }
  actions: { sources: SourceHead[]; rows: ActionRow[]; note: string }
  requests: { sources: SourceHead[]; rows: RequestRow[]; note: string }
  totals: { actions: number; overdue: number; open_requests: number; resolved: number }
  read_at: string
  /** absent from a relay that predates the setting: nothing is hidden */
  display?: MyWorkDisplay
}

/** The door's address; the person is the relay's to honour or refuse. */
export function myWorkPath(person?: string): string {
  const p = String(person ?? '').trim()
  return p ? `${MY_WORK_PATH}?person=${encodeURIComponent(p)}` : MY_WORK_PATH
}

/* ---------- colour ---------- */

export const DUE_TONE_CLASS: Record<Exclude<DueTone, ''>, string> = {
  overdue: 'text-[var(--danger)]',
  soon: 'text-[var(--warning)]',
  later: 'text-[var(--success)]',
}

/** Open is GREEN — never the info blue. */
export const STATUS_PILL: Record<StatusClass, string> = {
  open: 'bg-[var(--status-green-soft)] text-[var(--status-green)]',
  resolved: 'bg-surface-2 text-text-2',
  recorded: 'border border-border text-text-2',
}

export function statusLabel(s: RequestRow['status']): string {
  return s.class === 'open' ? 'Open' : s.word || 'Recorded'
}

/* ---------- dates ---------- */

/** 'Mon D, YYYY' for a day or an instant; '' when unreadable (the caller prints the dash and why). */
export function dayWords(value: string): string {
  const v = String(value ?? '').trim()
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return ohioDayYear(`${v}T12:00:00Z`)
  return ohioDayYear(v)
}

/* ---------- the sources ---------- */

/** Ready with nothing left unsettled, or not attributable by the source's own shape: nothing it holds is missing from the count. */
export function landed(s: SourceHead): boolean {
  return (s.state === 'ready' && !s.gap) || (s.state === 'not_attributable' && s.structural === true)
}

export type SourceLine = { key: string; tone: 'danger' | 'warning' | 'muted'; text: string }

/** One line per source that did not simply answer, and per note a ready one carries. */
export function sourceLines(sources: SourceHead[]): SourceLine[] {
  const out: SourceLine[] = []
  for (const s of sources) {
    if (s.state === 'unreadable') out.push({ key: s.key, tone: 'danger', text: `${s.label} could not be read: ${s.why}` })
    else if (s.state === 'not_attributable') out.push({ key: s.key, tone: s.structural ? 'muted' : 'warning', text: `${s.label}: ${s.why}` })
    else {
      if (s.gap) out.push({ key: `${s.key}:gap`, tone: 'warning', text: `${s.label}: ${s.gap}` })
      if (s.stale_why) out.push({ key: `${s.key}:stale`, tone: 'warning', text: `${s.label}: ${s.stale_why}` })
      if (s.copy_why) out.push({ key: `${s.key}:copy`, tone: 'warning', text: `${s.label}: ${s.copy_why}` })
      if (s.note) out.push({ key: `${s.key}:note`, tone: 'muted', text: `${s.label}: ${s.note}` })
    }
  }
  return out
}

export const NO_REF_WHY = 'The source keeps no id for it.'

/** REQUEST ID: the ref, or the dash with the reason there is none (the em-dash law). */
export function refWords(row: Pick<RequestRow, 'ref' | 'ref_why'>): { text: string; why: string } {
  const ref = String(row.ref ?? '').trim()
  return ref ? { text: ref, why: '' } : { text: '—', why: row.ref_why || NO_REF_WHY }
}

// The chosen key kept in the address, after a read: dropped when the door refused it as out of scope (the session…
export function choiceAfter(state: { status: string; reason: string }, chosen: string): string {
  return chosen && state.status === 'refused' && state.reason === 'scope' ? '' : chosen
}

/** The empty sentence is earned only when every source landed. With concluded requests hidden, none is on record here. */
export function emptyWords(part: 'actions' | 'requests', sources: SourceHead[], mass: boolean, completedHidden = false): string {
  if (!sources.every(landed)) return ''
  if (part === 'actions') return mass ? 'Nothing is asked of anyone right now.' : 'Nothing is asked of you right now.'
  if (completedHidden) return mass ? 'No request is still open.' : 'Nothing you have asked for is still open.'
  return mass ? 'No requests are on record.' : 'You have no requests on record.'
}

/* ---------- what the master hides ---------- */

export const SHOWN_ALL: HideParts = { header: false, source_notes: false, missing_row: false, completed: false }

const HIDE_WORDS: Record<keyof HideParts, string> = {
  header: 'the header',
  source_notes: 'the source notes',
  missing_row: 'the “Nothing on file” row',
  completed: 'concluded requests',
}

/** The parts this session leaves out: only a plain true hides, and a relay that sends nothing hides nothing. */
export function hiddenOf(view: Pick<MyWorkView, 'display'> | null | undefined): HideParts {
  const h = view?.display?.hidden
  if (!h) return SHOWN_ALL
  return {
    header: h.header === true,
    source_notes: h.source_notes === true,
    missing_row: h.missing_row === true,
    completed: h.completed === true,
  }
}

/** My Actions without the folded missing row, when it is hidden. */
export function visibleActions(rows: ActionRow[], hidden: HideParts): ActionRow[] {
  return hidden.missing_row ? rows.filter((r) => r.folded !== true) : rows
}

/** 'yyyy-mm-dd' from an ISO day, an ISO instant (its Ohio day; no zone reads as UTC) or M/D/YYYY; else null. */
function dayKeyOf(raw: string): string | null {
  const v = String(raw ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) {
    const iso = v.replace(' ', 'T')
    return ohioDayOf(/(Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`) || null
  }
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(v)
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
}

/** The day a request is about, where the row carries it: a call-off's shift day, an incident's filing day. */
export function eventDayOf(row: RequestRow): string | null {
  const detail = (label: string) => row.details.find((d) => d.label === label)?.value ?? ''
  if (row.source === 'call_offs') return dayKeyOf(detail('Shift day'))
  if (row.source === 'incidents') return dayKeyOf(row.submitted) ?? dayKeyOf(detail('Reported date'))
  return null
}

// Concluded, as Settings › My Work means it (the relay's my_work.is_concluded): resolved, or recorded about a day…
export function isConcluded(row: RequestRow, today: string): boolean {
  if (row.status.class === 'resolved') return true
  if (row.status.class !== 'recorded') return false
  const day = eventDayOf(row)
  return day !== null && day < today
}

/** My Requests without anything concluded, when that is hidden. The relay already drops them; an older one did not. */
export function visibleRequests(rows: RequestRow[], hidden: HideParts, today: string = ohioToday()): RequestRow[] {
  return hidden.completed ? rows.filter((r) => !isConcluded(r, today)) : rows
}

/** The note lines under a card title; with the notes hidden a source that could not be read is still said. */
export function visibleSourceLines(sources: SourceHead[], hidden: HideParts): SourceLine[] {
  const lines = sourceLines(sources)
  return hidden.source_notes ? lines.filter((l) => l.tone === 'danger') : lines
}

/** The master's own session: which parts everyone else does not see, or why nothing is hidden. '' when none is. */
export function forUsersLine(view: MyWorkView | null | undefined): string {
  const d = view?.display
  if (!d || view?.scope.mode !== 'mass') return ''
  if (d.readable === false) {
    return d.why ? sentenceCase(`${d.why}, so nothing is hidden from anyone`) : ''
  }
  const f = d.for_users
  if (!f) return ''
  const parts = (Object.keys(HIDE_WORDS) as (keyof HideParts)[]).filter((k) => f[k] === true).map((k) => HIDE_WORDS[k])
  if (!parts.length) return ''
  const words = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `Hidden from everyone else by Settings › My Work: ${words}. You see everything.`
}

function unlandedNote(sources: SourceHead[]): string {
  const off = sources.filter((s) => !landed(s))
  const unread = off.filter((s) => s.state === 'unreadable').length
  const partial = off.filter((s) => s.state === 'ready').length
  const untied = off.length - unread - partial
  const bits = [
    unread ? `${unread} source${unread === 1 ? '' : 's'} could not be read` : '',
    untied ? `${untied} could not be tied to a person` : '',
    partial ? `${partial} could not settle every row` : '',
  ].filter(Boolean)
  const words = bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits.join('')
  return `${words}, so this is not a count`
}

/** The black header's figures: a count whose sources did not all land is the dash and its sentence. */
export function heroFiguresOf(view: MyWorkView | null): HeroFigure[] {
  const a = view?.actions.sources ?? []
  const r = view?.requests.sources ?? []
  const aLanded = !!view && a.every(landed)
  const rLanded = !!view && r.every(landed)
  const unread = [...a, ...r].filter((s) => s.state === 'unreadable')
  const t = view?.totals
  const whom = view?.scope.mode === 'mass' ? (view.scope.person ? 'Asked of this person' : 'Asked of everyone')
    : 'Asked of you'
  return [
    {
      label: 'Open actions',
      value: aLanded && t ? t.actions : null,
      note: aLanded ? `${whom}, across every source` : unlandedNote(a),
    },
    {
      label: 'Overdue',
      value: aLanded && t ? t.overdue : null,
      note: aLanded ? 'Past their due date' : unlandedNote(a),
      tint: 'danger',
    },
    {
      label: 'Open requests',
      value: rLanded && t ? t.open_requests : null,
      note: !rLanded ? unlandedNote(r)
        : hiddenOf(view).completed ? 'Concluded requests are not listed' : `${t?.resolved ?? 0} resolved on record`,
    },
    {
      label: 'Sources unread',
      value: view ? unread.length : null,
      note: unread.length ? unread.map((s) => s.label).join(', ') : 'Every source answered',
      tint: unread.length ? 'amber' : undefined,
    },
  ]
}

/* ---------- the rows ---------- */

export type ActionCell =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'upload'; label: string; certs: string[]; uploadFor: string }
  | { kind: 'decide'; itemId: string; approve: string; decline: string; action?: DecideAction }
  | { kind: 'book'; label: string; item: IstBookItem }
  | { kind: 'words'; text: string }

// A button only where it leads somewhere open to this viewer; otherwise the words, never a dead door.
export function actionCell(row: ActionRow, opens: (appId: string) => boolean): ActionCell {
  const a = row.action
  if (a && a.kind === 'decide' && a.item_id) {
    const words = a.words ?? []
    const [approve, decline] = words
    if (a.action && !(DECIDE_ACTIONS as readonly string[]).includes(a.action)) return { kind: 'words', text: 'Not open to you here.' }
    // one word is Approve alone: the panel offers no Decline
    return { kind: 'decide', itemId: a.item_id, approve: approve || 'Approve',
      decline: words.length === 1 ? '' : decline || 'Decline', ...(a.action ? { action: a.action as DecideAction } : {}) }
  }
  if (a && a.kind === 'book' && a.item?.id) {
    const it = a.item
    return { kind: 'book', label: a.label || 'Book training',
      item: { id: String(it.id), client: String(it.client ?? ''), staff: String(it.staff ?? ''),
        house: String(it.house ?? ''), due: String(it.due ?? '') } }
  }
  if (a && a.kind === 'upload' && a.certs.length && a.upload_for) {
    return { kind: 'upload', label: a.label || 'Upload asset', certs: a.certs, uploadFor: a.upload_for }
  }
  if (a && a.kind === 'link' && a.href && opens(a.app)) return { kind: 'link', label: a.label, href: a.href }
  return { kind: 'words', text: row.action_why || 'Not open to you here.' }
}

/* ---------- a decision answered in the page ---------- */

export type DecideWord = 'approve' | 'decline'

/** What a decide action (DECIDE_ACTIONS) answers: `changed` false when somebody answered first. */
export type DecideAnswer = { ok?: boolean; said?: string; state?: string; changed?: boolean }

export function decidePayload(itemId: string, word: DecideWord, note = ''): { item_id: string; word: DecideWord; note: string } {
  return { item_id: itemId, word, note: String(note ?? '').trim() }
}

/** The toast an answer earns: the server's own sentence, and whether it changed anything. */
export function decideToast(word: DecideWord, got: DecideAnswer | null | undefined): { type: 'success' | 'info'; title: string; body?: string } {
  const said = String(got?.said ?? '').trim() || undefined
  if (got?.changed === false) return { type: 'info', title: 'Already answered', body: said }
  return { type: 'success', title: word === 'approve' ? 'Approved' : 'Declined', body: said }
}

export const DECIDE_TEST_MODE = 'Made while test mode was on: its texts were held.'

// What the decision panel shows of a decide row: the title, its facts (House, Day, Shift), the item's own words and…
export function decisionView(row: ActionRow): {
  title: string; facts: Detail[]; body: string; testMode: string; phase: string
} {
  const it = row.action?.item
  if (it) {
    const facts: Detail[] = it.facts?.length ? it.facts.filter((d) => d.value) : [
      { label: 'House', value: String(it.house_label || it.house_code || '') },
      { label: 'Day', value: String(it.day_words || it.date || '') },
      { label: 'Shift', value: String(it.shift_text ?? '') },
    ].filter((d) => d.value)
    return {
      title: String(it.title || row.condition), facts, body: String(it.body ?? ''),
      testMode: it.test_mode === true ? DECIDE_TEST_MODE : '', phase: String(it.seat_words || row.phase),
    }
  }
  const facts: Detail[] = []
  let body = ''
  let testMode = ''
  for (const d of row.details ?? []) {
    if (!d.value) continue
    if (d.label === 'Details') body = d.value
    else if (d.label === 'Test mode') testMode = d.value
    else facts.push(d)
  }
  return { title: row.condition, facts, body, testMode, phase: row.phase }
}

/** The rows still drawn: one answered here leaves at once, ahead of the next read. */
export function unanswered(rows: ActionRow[], answered: ReadonlySet<string>): ActionRow[] {
  return answered.size ? rows.filter((r) => !answered.has(r.id)) : rows
}

export function hiddenResolved(rows: RequestRow[]): number {
  return rows.filter((r) => r.status.class === 'resolved').length
}

export function shownRequests(rows: RequestRow[], showResolved: boolean): RequestRow[] {
  return showResolved ? rows : rows.filter((r) => r.status.class !== 'resolved')
}

/** The PERSON cell of a mass row: its name, or the dash when nobody is named. */
export function personWords(p: Person | undefined): { text: string; why: string } {
  if (p && p.name) return { text: p.name, why: '' }
  return { text: '—', why: 'Nobody is named for this' }
}

/** A relay clause as a sentence: capital first, one full stop. */
export function sentenceCase(text: string | undefined): string {
  const t = String(text ?? '').trim()
  if (!t) return ''
  const s = t[0].toUpperCase() + t.slice(1)
  return /[.!?]$/.test(s) ? s : `${s}.`
}

/* ---------- a per-viewer convenience ---------- */

export const SHOW_RESOLVED_KEY = 'asa-my-work-show-resolved'

export function readShowResolved(): boolean {
  try {
    return safeLocalStorage.getItem(SHOW_RESOLVED_KEY) === '1'
  } catch {
    return false
  }
}

export function saveShowResolved(on: boolean): void {
  try {
    void safeLocalStorage.setItem(SHOW_RESOLVED_KEY, on ? '1' : '0')
  } catch {
    /* the page works without it */
  }
}

// Whether this account's last read hid the header, so the paint before its next read does not flash it.
export const HEADER_HIDDEN_KEY = 'asa-my-work-header-hidden'

export function headerHiddenKey(accountId: string): string {
  return `${HEADER_HIDDEN_KEY}:${accountId}`
}

/** No account, nothing remembered: the header shows until the read says otherwise. */
export function readHeaderHidden(accountId: string): boolean {
  const id = String(accountId ?? '').trim()
  if (!id) return false
  try {
    return safeLocalStorage.getItem(headerHiddenKey(id)) === '1'
  } catch {
    return false
  }
}

export function saveHeaderHidden(accountId: string, on: boolean): void {
  const id = String(accountId ?? '').trim()
  if (!id) return
  try {
    void safeLocalStorage.setItem(headerHiddenKey(id), on ? '1' : '0')
  } catch {
    /* the page works without it */
  }
}
