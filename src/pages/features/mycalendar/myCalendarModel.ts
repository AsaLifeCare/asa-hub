// My Calendar — the answer of /hub-lanes/my-calendar, and the pure words the screen draws from it.
// The relay decides whose calendar this is and cuts it to that one person before it arrives; every day state, pill…
import { ohioDateTime, ohioDayYear, ohioTime } from '@/lib/ohio'
import { STATUS_TINT, daysWords } from '@/pages/features/timeoff/timeOffModel'

export { daysWords }

export const MY_CALENDAR_PATH = '/hub-lanes/my-calendar'
export const CHECK_PATH = '/hub-lanes/my-calendar/check'

/* ---------- the answer ---------- */

export type PartState = 'ready' | 'unreadable' | 'not_attributable'
export type DayState = 'shifts' | 'off' | 'none' | 'not_drawn' | 'not_listed' | 'unreadable'
export type MarkKind =
  | 'pending_publish' | 'test_mode' | 'rehearsal' | 'called_off' | 'covered' | 'offered' | 'off_scheduled' | 'off_asked'

export type Mark = { kind: MarkKind | string; words: string; ref?: string }

export type ShiftCard = {
  id: string
  iso: string
  kind: 'day' | 'morning' | 'afternoon' | 'evening' | 'overnight' | 'alias' | 'ro' | string
  house: string
  house_name: string
  code: string
  address: string
  shift_code: string
  /** ISO instants with the Ohio offset, or '' when no hours can be read */
  shift_start: string
  shift_end: string
  /** real elapsed hours, or null */
  hours: number | null
  hours_known: boolean
  overnight: boolean
  manager: string
  managers: string[]
  managers_readable: boolean
  also: { house: string; token: string }[]
  marks: Mark[]
}

export type DayOff = { state: 'scheduled' | 'asked'; ref: string } | null

export type Day = { iso: string; state: DayState | string; why: string; cards: ShiftCard[]; off: DayOff; notes: string[] }

export type WeekHead = { state: PartState; why: string; copied_at: string; stale: boolean; stale_why: string }

export type Week = {
  from: string
  to: string
  /** the Monday of the Ohio today's week */
  this: string
  /** '' at the edge of what may be read */
  prev: string
  next: string
  head: WeekHead
  days: Day[]
  notes: string[]
}

export type RequestGroup = 'pending' | 'ongoing' | 'upcoming' | 'concluded'

export type RequestMay = {
  withdraw: boolean
  withdraw_why: string
  withdraw_warns: string
  edit: boolean
  edit_why: string
  /** said before new dates are saved: an approved request's dates go for approval again */
  edit_warns?: string
}

export type RequestRow = {
  ref: string
  status: string
  /** the pill: Waiting, Needs review, On now, Approved, Taken, Denied, Withdrawn, Cancelled, Expired, On record */
  word: string
  group: RequestGroup | string
  start: string
  end: string
  days: number
  houses: { code: string; label: string }[]
  status_why: string
  filed_by_other: boolean
  test_mode: boolean
  details: { label: string; value: string }[]
  may: RequestMay
}

export type Figure = { year: number; approved_days: number; waiting_days: number; on_record_days: number }

export type Requests = { state: PartState; why: string; rows: RequestRow[]; figure: Figure | null; as_of: string }

export type FormFacts = {
  may_file: boolean
  may_file_why: string
  /** on a chosen person's calendar: the spelling the request door files them under ('' on your own) */
  file_for?: string
  reason_max: number
  max_days: number
  earliest: string
}

export type PersonEntry = { key: string; name: string; status: string; kind?: 'staff' }

export type TestMode = { on: boolean; readable: boolean; why: string }

export type MyCalendarView = {
  /** `edition`: the Settings › Editions key that opened any person's calendar to a session beside the master's */
  scope: { mode: 'own' | 'mass'; why: string; person: string; people?: PersonEntry[]; people_why?: string; edition?: string }
  person: { own: boolean; name: string; key_why: string }
  today: string
  week: Week
  requests: Requests
  form: FormFacts
  test_mode: TestMode
  read_at: string
}

export type CheckAnswer = { ref: string; start: string; end: string; days: number; dates: string; ok: boolean; refusals: string[] }

/** What the right panel holds: a shift, one request in one mode, or a new request (prefilled after a change half landed). */
export type PanelAsk =
  | { kind: 'shift'; card: ShiftCard }
  | { kind: 'request'; mode: 'detail' | 'edit' | 'withdraw'; ref: string }
  | { kind: 'add'; start?: string; end?: string; reason?: string; note?: string }

/* ---------- the doors ---------- */

const q = (v: string) => encodeURIComponent(v)

/** The door's address; the person is the relay's to honour or refuse, the week its to snap to a Monday. */
export function myCalendarPath({ week = '', person = '' }: { week?: string; person?: string } = {}): string {
  const parts = [
    ...(String(week).trim() ? [`week=${q(String(week).trim())}`] : []),
    ...(String(person).trim() ? [`person=${q(String(person).trim())}`] : []),
  ]
  return parts.length ? `${MY_CALENDAR_PATH}?${parts.join('&')}` : MY_CALENDAR_PATH
}

// The pencil's read-only check, with the chosen roster row on a chosen person's calendar.
export function checkPath(ref: string, start: string, end: string, person = ''): string {
  const who = String(person).trim() ? `&person=${q(String(person).trim())}` : ''
  return `${CHECK_PATH}?ref=${q(ref)}&start=${q(start)}&end=${q(end || start)}${who}`
}

/** The chosen person kept in the address after a read: dropped when the door refused it as out of scope or as no roster row. */
export function choiceAfter(state: { status: string; reason: string }, chosen: string): string {
  return chosen && state.status === 'refused' && (state.reason === 'scope' || state.reason === 'person') ? '' : chosen
}

/** The week kept in the address after a read: dropped when the door could not read it. */
export function weekAfter(state: { status: string; reason: string }, week: string): string {
  return week && (state.status === 'failed' || state.status === 'refused') && state.reason === 'week' ? '' : week
}

/* ---------- days ---------- */

const DAY_MS = 86_400_000
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Noon UTC of a calendar day, or null: a day is never parsed as an instant. */
function noonOf(iso: string): number | null {
  const m = DAY_RE.exec(String(iso ?? '').trim())
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  return isoOf(t) === m[0] ? t : null
}

function isoOf(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** The day `n` days away; '' for anything that is not a day. */
export function dayShift(iso: string, n: number): string {
  const t = noonOf(iso)
  return t === null ? '' : isoOf(t + n * DAY_MS)
}

/** The same weekday `n` weeks away; '' for anything that is not a day. */
export function weekShift(iso: string, n: number): string {
  return dayShift(iso, n * 7)
}

/** The Monday of the week holding a day; '' for anything that is not a day. */
export function mondayOf(iso: string): string {
  const t = noonOf(iso)
  if (t === null) return ''
  return isoOf(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS)
}

/** 'Sep 21, 2026' — a calendar day with its year, in Ohio. */
export function dayHead(iso: string): string {
  const t = noonOf(iso)
  return t === null ? '' : ohioDayYear(new Date(t))
}

/** 'Monday' — the weekday a calendar day falls on. */
export function weekdayOf(iso: string): string {
  const t = noonOf(iso)
  return t === null ? '' : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(t).getUTCDay()]
}

/** 'Sep 21, 2026 – Sep 27, 2026', or one day alone. */
export function rangeWords(from: string, to: string): string {
  return !to || from === to ? dayHead(from) : `${dayHead(from)} – ${dayHead(to)}`
}

/** A day's own words: "No shifts" only where a calendar shows the day empty, the relay's sentence otherwise. */
export const DAY_WORDS: Record<DayState, string> = {
  shifts: '',
  off: 'Off',
  none: 'No shifts',
  not_drawn: '',
  not_listed: '',
  unreadable: '',
}

const DAY_FALLBACK: Record<string, string> = {
  not_drawn: 'No house calendar shows this day.',
  not_listed: 'Not on any house calendar.',
  unreadable: 'This day could not be read.',
}

export function dayLine(day: Pick<Day, 'state' | 'why'>): string {
  if (day.state === 'shifts') return ''
  const fixed = (DAY_WORDS as Record<string, string>)[day.state]
  return fixed || sentence(day.why) || DAY_FALLBACK[day.state] || 'This day could not be read.'
}

/** The band a day under time off wears. */
export function offBand(off: DayOff): string {
  if (!off) return ''
  return off.state === 'scheduled' ? 'Time off · Approved' : 'Time off · Asked'
}

/* ---------- a shift ---------- */

/** The house as a card names it: its directory name without " home", else the calendar's short name. */
export function houseLabel(card: Pick<ShiftCard, 'house_name' | 'house' | 'code'>): string {
  return String(card.house_name ?? '').replace(/\s+home$/i, '').trim() || card.house || card.code
}

/** R/O, C/O, NCNS and a rehearsal square are drawn muted. */
export function mutedCard(card: Pick<ShiftCard, 'kind' | 'marks'>): boolean {
  return card.kind === 'ro' || card.marks.some((m) => m.kind === 'rehearsal')
}

/** 'Sep 24, 2026 · 11:00 PM – Sep 25, 2026 · 7:00 AM · Eastern Time'; one date when it ends the day it starts. */
export function spanLine(card: Pick<ShiftCard, 'iso' | 'shift_start' | 'shift_end' | 'shift_code'>): string {
  const [da, db, ta, tb] = [ohioDayYear(card.shift_start), ohioDayYear(card.shift_end), ohioTime(card.shift_start), ohioTime(card.shift_end)]
  if (!card.shift_start || !card.shift_end || !da || !db || !ta || !tb) {
    return `${dayHead(card.iso)} · Hours not written on the calendar`
  }
  return da === db ? `${da} · ${ta} – ${tb} · Eastern Time` : `${da} · ${ta} – ${db} · ${tb} · Eastern Time`
}

/** An overnight is drawn on the day it starts, and says so. */
export function overnightLine(card: Pick<ShiftCard, 'overnight' | 'shift_start' | 'shift_end'>): string {
  const [ta, tb] = [ohioTime(card.shift_start), ohioTime(card.shift_end)]
  return card.overnight && ta && tb ? `Overnight coverage ${ta} – ${tb} (shown on the day it starts).` : ''
}

export function hoursLine(card: Pick<ShiftCard, 'hours' | 'hours_known'>): string {
  if (!card.hours_known || card.hours === null || !Number.isFinite(card.hours)) return 'Hours not written on the calendar'
  const n = Math.round(card.hours * 100) / 100
  return `${n} hour${n === 1 ? '' : 's'}`
}

export function addressLine(card: Pick<ShiftCard, 'address'>): string {
  return card.address || 'No address is on file for this house.'
}

export function managerLine(card: Pick<ShiftCard, 'manager' | 'managers' | 'managers_readable'>): string {
  if (!card.managers_readable) return 'Who manages this house could not be read.'
  const names = card.managers.length ? card.managers : card.manager ? [card.manager] : []
  return names.length ? names.join(', ') : 'No house manager is on file for this house.'
}

/** The small word a card's chip wears for each mark. */
export const MARK_CHIP: Record<string, string> = {
  pending_publish: 'Just published',
  test_mode: 'Test mode',
  rehearsal: 'Rehearsal',
  called_off: 'Called off',
  covered: 'Covered',
  offered: 'Offered',
  off_scheduled: 'Time off',
  off_asked: 'Time off asked',
}

export const MARK_TONE: Record<string, string> = {
  pending_publish: 'bg-tint-blue text-tint-fg-blue',
  test_mode: 'bg-tint-amber text-tint-fg-amber',
  rehearsal: 'bg-tint-slate text-tint-fg-slate',
  called_off: 'bg-tint-danger text-tint-fg-danger',
  covered: 'bg-tint-mint text-tint-fg-mint',
  offered: 'bg-tint-lavender text-tint-fg-lavender',
  off_scheduled: 'bg-tint-danger text-tint-fg-danger',
  off_asked: 'bg-tint-violet text-tint-fg-violet',
}

const MARK_LABEL: Record<string, string> = {
  pending_publish: 'Just published',
  test_mode: 'Held by test mode',
  rehearsal: 'Rehearsal',
  offered: 'Offered to transfer',
  off_scheduled: 'On approved time off',
  off_asked: 'Time off asked',
}

export type MarkLine = { kind: string; label: string; words: string }

/** One line per mark for the panel; a call-off says whether it is covered, never by whom. */
export function markLines(card: Pick<ShiftCard, 'marks'>): MarkLine[] {
  const covered = card.marks.some((m) => m.kind === 'covered')
  const out: MarkLine[] = []
  for (const m of card.marks) {
    if (m.kind === 'covered' && card.marks.some((x) => x.kind === 'called_off')) continue
    if (m.kind === 'called_off' || m.kind === 'covered') {
      out.push({ kind: 'called_off', label: 'Called off', words: covered ? 'Covered by another staff member.' : 'Not yet covered.' })
      continue
    }
    out.push({ kind: String(m.kind), label: MARK_LABEL[m.kind] ?? sentence(String(m.kind).replace(/_/g, ' ')), words: sentence(m.words) })
  }
  return out
}

/** Where the week came from, in Ohio time. */
export function copiedLine(head: Pick<WeekHead, 'copied_at'>): string {
  const at = head.copied_at ? ohioDateTime(head.copied_at) : ''
  return at ? `From the house calendar, copied ${at}` : ''
}

/* ---------- the requests ---------- */

export const GROUP_ORDER: RequestGroup[] = ['pending', 'ongoing', 'upcoming', 'concluded']

export const GROUP_LABEL: Record<RequestGroup, string> = {
  pending: 'Pending',
  ongoing: 'On now',
  upcoming: 'Approved',
  concluded: 'Concluded',
}

/** Concluded requests drawn before "Show more". */
export const CONCLUDED_SHOWN = 5

/** The rows by group, in the relay's order; a row in a group this screen does not know is kept with the concluded ones. */
export function groupsOf(rows: RequestRow[]): { group: RequestGroup; rows: RequestRow[] }[] {
  const known = new Set<string>(GROUP_ORDER)
  return GROUP_ORDER
    .map((group) => ({
      group,
      rows: rows.filter((r) => r.group === group || (group === 'concluded' && !known.has(r.group))),
    }))
    .filter((g) => g.rows.length > 0)
}

export const TINT_PILL: Record<string, string> = {
  mint: 'bg-tint-mint text-tint-fg-mint',
  amber: 'bg-tint-amber text-tint-fg-amber',
  lavender: 'bg-tint-lavender text-tint-fg-lavender',
  slate: 'bg-tint-slate text-tint-fg-slate',
  pink: 'bg-tint-pink text-tint-fg-pink',
  danger: 'bg-tint-danger text-tint-fg-danger',
}

/** Time Off's own tints; a scheduled request that has ended wears Past's. */
export function pillClass(row: Pick<RequestRow, 'status' | 'group'>): string {
  const tint = row.status === 'scheduled' ? (row.group === 'concluded' ? STATUS_TINT.past : STATUS_TINT.scheduled)
    : STATUS_TINT[row.status] ?? 'slate'
  return TINT_PILL[tint] ?? TINT_PILL.slate
}

/** 'Days off approved · 2026: 12' — scheduled days in the year; nothing is counted against an allowance. */
export function figureLine(f: Figure | null): string {
  return f ? `Days off approved · ${f.year}: ${f.approved_days}` : ''
}

export function waitingWords(f: Figure | null): string {
  return f && f.waiting_days > 0 ? `+ ${f.waiting_days} waiting` : ''
}

export function onRecordNote(f: Figure | null): string {
  return f && f.on_record_days > 0
    ? `${daysWords(f.on_record_days)} on record from the earlier time off form ${f.on_record_days === 1 ? 'is' : 'are'} not counted here.`
    : ''
}

/* ---------- who may press what ---------- */

/** The relay's own sentence for a write asked from a switched session. */
export const ACTING_SENTENCE = 'Press Be Back to do this as yourself.'

export type Allowed = { allowed: boolean; why: string }

/** Said when a chosen person's calendar carries no spelling to file them under. */
export const NO_FILE_FOR = 'Whom this request would be filed for could not be settled here, so file it in Time Off.'

// The person a request filed here is FOR: '' on your own calendar (the relay files for the session's own name); on…
export function fileFor(view: Pick<MyCalendarView, 'person' | 'form'>): string {
  return view.person.own ? '' : String(view.form.file_for ?? '').trim()
}

// Add: always drawn.
export function addFor(view: Pick<MyCalendarView, 'person' | 'form'>, acting: boolean): Allowed {
  if (!view.form.may_file) return { allowed: false, why: sentence(view.form.may_file_why) || 'Time off cannot be filed here.' }
  if (acting) return { allowed: false, why: ACTING_SENTENCE }
  if (!view.person.own && !fileFor(view)) return { allowed: false, why: NO_FILE_FOR }
  return { allowed: true, why: '' }
}

// The pencil and the trash: the relay's `may`, never in a switched session; with a view, new dates for a chosen…
export function rowActs(row: Pick<RequestRow, 'may'>, acting: boolean,
  view?: Pick<MyCalendarView, 'person' | 'form'>): { edit: Allowed; withdraw: Allowed } {
  const one = (ok: boolean, why: string, fallback: string): Allowed =>
    !ok ? { allowed: false, why: sentence(why) || fallback } : acting ? { allowed: false, why: ACTING_SENTENCE } : { allowed: true, why: '' }
  const edit = one(row.may.edit, row.may.edit_why, 'Its dates are not changed here.')
  return {
    edit: edit.allowed && view && !view.person.own && !fileFor(view) ? { allowed: false, why: NO_FILE_FOR } : edit,
    withdraw: one(row.may.withdraw, row.may.withdraw_why, 'It is not withdrawn here.'),
  }
}

/* ---------- filing ---------- */

/** The strip under the chooser: test mode on, or a switch that could not be read. */
export function testModeLine(t: TestMode | null | undefined): string {
  if (!t) return ''
  if (!t.readable) return `Whether test mode is on could not be read${t.why ? ` (${stripStop(t.why)})` : ''}.`
  return t.on ? 'Test mode is on: a request filed here is marked as a test, and nobody is messaged about it.' : ''
}

export const TEST_MODE_FILE = 'Test mode is on: the request is written to the Time Off book marked as a test and nobody is ' +
  'messaged. If it is approved it still holds the calendar.'
export const TEST_MODE_UNREAD = 'Whether test mode is on could not be read, so this screen cannot say whether anybody is messaged.'

export function fileTestLine(t: TestMode | null | undefined): string {
  if (!t) return ''
  if (!t.readable) return TEST_MODE_UNREAD
  return t.on ? TEST_MODE_FILE : ''
}

export type FileBody = { start: string; end: string; reason: string; houses: string[]; person?: string }

// A request as it is sent: no house, so the relay files for the drawn houses; no person on your own calendar, so it…
export function fileBody(start: string, end: string, reason: string, person = ''): FileBody {
  const body: FileBody = { start, end: end || start, reason: reason.trim(), houses: [] }
  if (String(person).trim()) body.person = String(person).trim()
  return body
}

/** The panel's first line: whose days are chosen. */
export function whoseDays(view: Pick<MyCalendarView, 'person'>): string {
  return view.person.own ? 'Choose the first and last day of your time off.'
    : `Choose the first and last day of ${view.person.name || 'this person'}'s time off.`
}

/** The preview's line on a chosen person's calendar: whom it is filed for, and by whom. */
export function filedForLine(person: string): string {
  const p = String(person ?? '').trim()
  return p ? `Filed for ${p} by you.` : ''
}

export function reasonRefusal(reason: string, max: number): string {
  return max > 0 && reason.length > max ? `The reason is longer than ${max} characters.` : ''
}

/** The note a withdrawal made by the pencil carries. */
export const CHANGE_NOTE = 'Dates changed in My Calendar'

/** A change whose first half landed and second did not: said, never lost. */
export function orphanLine(ref: string, why: string): string {
  return `${ref} was withdrawn; the new dates were not filed: ${stripStop(why) || 'no reason was given'}. Press File to try again.`
}

/* ---------- words ---------- */

function stripStop(text: string): string {
  return String(text ?? '').trim().replace(/[.\s]+$/, '')
}

/** A sentence: capitalised, ending in a stop. */
export function sentence(text: string | null | undefined): string {
  const t = String(text ?? '').trim()
  if (!t) return ''
  const s = t.charAt(0).toUpperCase() + t.slice(1)
  return /[.!?…]$/.test(s) ? s : `${s}.`
}

export function choiceLabel(p: PersonEntry): string {
  return `${p.name}${p.status ? ` · ${p.status}` : ''}`
}
