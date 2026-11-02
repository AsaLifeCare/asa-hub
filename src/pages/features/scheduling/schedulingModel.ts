// Scheduling's pure model: the board as schedulingBoard answers it (Scheduling.gs), the order its rows are drawn…
// Nothing here reads or writes.
import { nameKey, weekKeyOf } from '@/pages/features/shifts/houseCalTypes'
import { readRange } from '@/pages/features/shifts/cellClock'
import { codeOf } from '@/pages/features/shifts/shiftTimes'
import { schedHoursHiddenFor } from '@/pages/settings/myWorkDisplay'
import { formatPhoneDisplay } from '@/lib/phoneFormat'

/* ---------- the board ---------- */

export type Period = { id: string; first: string; last: string; state: string }
export type BoardHouse = { code: string; location: string; short: string; staff: number; managers: string[]; open: number }
/** `editions`: the Scheduling editions this viewer makes (Settings › Editions), said only while Scheduling runs on Python. */
/** `drag_move`: the houses where a dropped shift moves at once (House Calendars' drag and drop, a house manager and up). */
export type Viewer = {
  uid: string; name: string; key: string; is_master: boolean; is_director: boolean; editor_of: string[]; can_edit_any: boolean
  editions?: string[]; drag_move?: string[]
}
export type TestMode = { on: boolean; readable: boolean; why: string }
export type Col = { iso: string; date: string; short: string; weekday: string }
export type MedLevel = 0 | 1 | 2 | 3
/** `meds`: every Medication Administration level held, lowest first; `med` the highest of them. */
export type Badges = { hm: boolean; lead: boolean; med: MedLevel; meds?: number[] }
export type RowKind = 'person' | 'open' | 'workshop' | 'other'
export type FlowKind = 'call_off' | 'request_off' | 'time_off' | 'swap' | 'take' | 'phone' | 'training' | 'move'
/** `with`: a swap's mark names whoever is on the other side of that cell. */
export type FlowRef = { id: string; kind: FlowKind | string; state: string; with?: string }
/** `training`: somebody without the house's IST works the shift with the house manager — never counted as the DSP. */
export type CellState =
  'scheduled' | 'open' | 'called_off' | 'requested_off' | 'time_off' | 'swapped_out' | 'swap_in' | 'taken' | 'training'
/** `start`/`end` are decimal hours from the day's midnight (an overnight's end past 24), as schedClassify_ reads them. */
export type Cell = {
  text: string; kind: string; start?: number; end?: number; hours?: number; state: CellState | string
  flow?: FlowRef; echo?: string; time_off?: 'asked' | 'approved'
}
export type GridRow = {
  row_id: string; kind: RowKind; name: string; key: string; designation: string; badges: Badges; me: boolean
  hours?: { period: number; by_week: Record<string, number> }
  cells: (Cell | null)[]
}
export type Grid = { code: string; cols: Col[]; rows: GridRow[]; days: { iso: string; working: number; hours?: number }[] }
// [date, start_min, end_min, house_code, hold]: minutes from that date's midnight, half-open; hold 'work' is a…
export type Busy = [string, number, number, string, ('work' | 'day')?]
export type SeatName = 'staff' | 'house_manager' | 'director'
export type SeatState = 'waiting' | 'approved' | 'declined' | 'superseded' | 'skipped'
/** `house`: an exchange asks one house manager seat per house involved. */
export type Seat = {
  seat: SeatName; to: { uid: string; name: string; email: string }[]; state: SeatState
  by?: string; at?: string; note?: string; why?: string; house?: string; house_label?: string
}
/** The partner's shift an exchange takes back (a swap without it gives the shift away). */
export type ExchangeRef = { house_code: string; house_label?: string; date: string; row_id: string; shift_text: string }
export type Flow = {
  id: string; kind: FlowKind; state: string; house_code: string; date: string; date_to?: string; row_id?: string
  person?: string; person_key?: string; shift_text?: string; start_min?: number; end_min?: number; open_row_id?: string
  replacement?: string; replacement_key?: string; seats?: Seat[] | string; reason?: string; note?: string
  source?: string; created_at?: string; updated_at?: string; test_mode?: string | boolean; exchange?: ExchangeRef
}
/** `flow`, when the answer carries it: the flow the item asks about, with its seats, for the decision panel's steps. */
export type InboxItem = {
  id: string; flow_id: string; box: string; kind: string; seat: string; title: string; body: string
  house_code: string; house_label: string; date: string; shift_text: string; state: string; link: string
  test_mode: string | boolean; created_at: string; flow?: Flow
}
export type LogEntry = {
  id: string; at: string; by_name: string; house_code: string; date: string; row_id: string; was: string; now: string
  via: string; flow_id: string; note: string; undone_at: string
}
export type BoardSettings = {
  min_days_ahead: number; outreach_wait_min: number; cycle_days: number; roll_lead_days: number
  directors: string[]; directors_readable: boolean; next_roll_on: string
}
/** `no_ist`, when the board carries it: the houses where this person has no current IST (placed there, it is a training). */
/** `phone`: the one account's, as the users tab holds it (absent from an engine answer) */
export type Person = { key: string; name: string; has_account: boolean; no_ist?: string[]; phone?: string }

/** Said to somebody below a house manager before their own shift is asked of another person. */
export const SWAP_ASK_STAFF = 'Are you sure you want to swap your shift? This person will be notified to accept the change before it is approved.'

/** A house manager of any house, a director or the master: who is not asked SWAP_ASK_STAFF. */
export function hmOrAbove(board: Pick<Board, 'viewer'>): boolean {
  const v = board.viewer
  return v.is_master || v.is_director || v.can_edit_any || (v.editor_of ?? []).length > 0
}

/** Each person's phone as the screen reads it, by key; nobody without one. */
export function phonesOf(people: Pick<Person, 'key' | 'phone'>[]): Record<string, string> {
  return Object.fromEntries(people.filter((p) => p.phone?.trim()).map((p) => [p.key, formatPhoneDisplay(p.phone)]))
}
export type Board = {
  ok: true; now: string; today: string; period: Period; periods: Period[]; houses: BoardHouse[]; viewer: Viewer
  test_mode: TestMode
  /** `hidden_from_others` is the master's: the switch as everyone else reads it (absent reads as hidden) */
  display: { hidden: { hours: boolean }; hidden_from_others?: { hours?: boolean } }
  settings: BoardSettings; grids: Record<string, Grid>; busy: Record<string, Busy[]>; people: Person[]
  mine: Flow[]; waiting_on_me: InboxItem[]; log?: Record<string, LogEntry[]>
}
// Every write's answer (Scheduling.gs schedAnswer_, SchedulingFlows.gs schedFlowWriteAnswer_).
export type WriteAnswer = {
  ok: true; said: string; flow_id?: string; period_id: string; grids: Record<string, Grid>
  busy: Record<string, Busy[]>; mine?: Flow[]; waiting_on_me?: InboxItem[]; test_mode: TestMode
  warn?: string; reread?: string; log?: Record<string, LogEntry[]>
  /** the write placed somebody without the house's IST: their shift is a training, waiting on two seats */
  training?: { flow_id: string; why: string }
}

/** A test mode that was not said holds: the switch fails closed. */
export const TEST_MODE_UNREAD: TestMode = { on: true, readable: false, why: 'test mode was not in the answer' }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : [])
/** A count of days the settings may hold as 0; anything unsaid or unreadable is the default. */
const daysOr = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function testModeOf(v: unknown): TestMode {
  const t = obj(v)
  if (typeof t.on !== 'boolean') return TEST_MODE_UNREAD
  // an unreadable switch holds whatever it says
  const readable = t.readable !== false
  return { on: t.on || !readable, readable, why: String(t.why ?? '') }
}

/** The board as the screen draws it: every list present, test mode fail-closed, the hours hidden unless said shown. */
export function boardFrom(raw: unknown): Board {
  const b = obj(raw)
  const viewer = obj(b.viewer)
  const settings = obj(b.settings)
  const display = obj(b.display)
  const hidden = obj(display.hidden)
  const others = obj(display.hidden_from_others)
  return {
    ok: true,
    now: String(b.now ?? ''),
    today: String(b.today ?? ''),
    period: { id: '', first: '', last: '', state: '', ...obj(b.period) } as Period,
    periods: arr<Period>(b.periods),
    houses: arr<BoardHouse>(b.houses),
    viewer: {
      uid: String(viewer.uid ?? ''), name: String(viewer.name ?? ''), key: String(viewer.key ?? ''),
      is_master: viewer.is_master === true, is_director: viewer.is_director === true,
      editor_of: arr<string>(viewer.editor_of), can_edit_any: viewer.can_edit_any === true,
      editions: arr<unknown>(viewer.editions).map((e) => String(e ?? '').trim()).filter((e) => SCHED_EDITIONS.includes(e)),
      ...(arr<unknown>(viewer.drag_move).length
        ? { drag_move: arr<unknown>(viewer.drag_move).map((c) => String(c ?? '').trim()).filter(Boolean) } : {}),
    },
    test_mode: testModeOf(b.test_mode),
    display: {
      hidden: { hours: hidden.hours !== false },
      ...(typeof others.hours === 'boolean' ? { hidden_from_others: { hours: others.hours } } : {}),
    },
    settings: {
      min_days_ahead: daysOr(settings.min_days_ahead, MIN_DAYS_AHEAD),
      outreach_wait_min: Number(settings.outreach_wait_min ?? 7) || 7,
      cycle_days: Number(settings.cycle_days ?? 28) || 28,
      roll_lead_days: daysOr(settings.roll_lead_days, 7),
      directors: arr<string>(settings.directors),
      directors_readable: settings.directors_readable === true,
      next_roll_on: String(settings.next_roll_on ?? ''),
    },
    grids: obj(b.grids) as Record<string, Grid>,
    busy: obj(b.busy) as Record<string, Busy[]>,
    people: arr<Person>(b.people),
    mine: arr<Flow>(b.mine),
    waiting_on_me: arr<InboxItem>(b.waiting_on_me),
    ...(b.log ? { log: obj(b.log) as Record<string, LogEntry[]> } : {}),
  }
}

// A write's answer laid over the board: the houses it re-read, the people it re-read, the viewer's own flows and…
export function mergeWrite(board: Board, answer: WriteAnswer): Board {
  const samePeriod = !answer.period_id || answer.period_id === board.period.id
  const log = obj(answer.log) as Record<string, LogEntry[]>
  return {
    ...board,
    grids: samePeriod ? { ...board.grids, ...obj(answer.grids) as Record<string, Grid> } : board.grids,
    busy: samePeriod ? { ...board.busy, ...obj(answer.busy) as Record<string, Busy[]> } : board.busy,
    mine: Array.isArray(answer.mine) ? answer.mine : board.mine,
    waiting_on_me: Array.isArray(answer.waiting_on_me) ? answer.waiting_on_me : board.waiting_on_me,
    test_mode: answer.test_mode ? testModeOf(answer.test_mode) : board.test_mode,
    ...(Object.keys(log).length ? { log: { ...(board.log ?? {}), ...log } } : {}),
  }
}

/** The toast a write answer gives: its sentence, and the 40-hour line or a failed read-back beneath it. */
export function writeToast(answer: Pick<WriteAnswer, 'said' | 'warn' | 'reread'>): { type: 'success' | 'warning'; title: string; body?: string } {
  const body = [answer.warn, answer.reread].filter((s) => typeof s === 'string' && s).join(' ')
  return body ? { type: 'warning', title: answer.said || 'Saved.', body } : { type: 'success', title: answer.said || 'Saved.' }
}

/* ---------- the rows: OPEN first ---------- */

/** 'OPEN:3' → 3; any other id → 0. */
export function openNumber(rowId: string): number {
  const m = /^OPEN:(\d+)$/.exec(String(rowId ?? ''))
  return m ? Number(m[1]) : 0
}

const ROW_RANK: Record<RowKind, number> = { open: 0, person: 1, workshop: 2, other: 2 }

/** OPEN rows above the first person (by their number), then the people in roster order, then WORKSHOP and the rest. */
export function orderRows(rows: GridRow[]): GridRow[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (ROW_RANK[a.r.kind] ?? 2) - (ROW_RANK[b.r.kind] ?? 2)
      || (a.r.kind === 'open' && b.r.kind === 'open' ? openNumber(a.r.row_id) - openNumber(b.r.row_id) : 0)
      || a.i - b.i)
    .map((x) => x.r)
}

/** 'OPEN:2' → 'OPEN · 2'; the first OPEN row is plain 'OPEN'. */
export function openLabel(rowId: string): string {
  const n = openNumber(rowId)
  return n > 1 ? `OPEN · ${n}` : 'OPEN'
}

/* ---------- the symbol badges ---------- */

export type MedTone = 'bronze' | 'silver' | 'gold'
/** Medication Administration 1 / 2 / 3: bronze, silver, gold — 3 is the highest. */
export const MED_TONE: Record<1 | 2 | 3, MedTone> = { 1: 'bronze', 2: 'silver', 3: 'gold' }
/** The tones from the theme's own colours, so they turn with it; peach and amber are one colour, so bronze is mixed. */
export const MED_CLASS: Record<MedTone, string> = {
  bronze: 'bg-[color-mix(in_srgb,var(--danger)_12%,var(--tint-warning))] text-[color-mix(in_srgb,var(--danger)_45%,var(--warning))]',
  silver: 'bg-tint-slate text-tint-fg-slate',
  gold: 'bg-tint-amber text-tint-fg-amber',
}

export type BadgeView =
  | { id: 'hm'; label: 'House manager' }
  | { id: 'med'; level: 1 | 2 | 3; tone: MedTone; label: string }
  | { id: 'lead'; label: 'Team leader' }

/** A person's badges in the order they are drawn: house manager, every Med level held, team leader. */
export function badgeList(b: Partial<Badges> | null | undefined): BadgeView[] {
  const out: BadgeView[] = []
  if (b?.hm) out.push({ id: 'hm', label: 'House manager' })
  // a board without `meds` names the highest level alone
  const meds = Array.isArray(b?.meds) ? b.meds.map(Number) : [Number(b?.med ?? 0)]
  for (const med of meds) {
    if (med === 1 || med === 2 || med === 3) {
      out.push({ id: 'med', level: med, tone: MED_TONE[med], label: `Medication Administration ${med}` })
    }
  }
  if (b?.lead) out.push({ id: 'lead', label: 'Team leader' })
  return out
}

/* ---------- the hours gate ---------- */

// The hours column and every figure in hours.
export function hoursShown(board: Pick<Board, 'viewer' | 'display'> | null, sessionMaster: boolean): boolean {
  if (!board) return false
  return !schedHoursHiddenFor(sessionMaster && board.viewer.is_master, board.display.hidden.hours)
}

export const HOURS_HIDDEN_LINE = 'Hidden from everyone else by Settings › My Work: the hours column. You see everything.'

/** The master's muted line, while the switch hides the hours from everyone else (unsaid reads as hidden). */
export function hoursHiddenLine(board: Pick<Board, 'viewer' | 'display'> | null, sessionMaster: boolean): string {
  if (!board || !(sessionMaster && board.viewer.is_master)) return ''
  return board.display.hidden_from_others?.hours === false ? '' : HOURS_HIDDEN_LINE
}

/* ---------- test mode ---------- */

export const TEST_MODE_WORDS =
  'TEST MODE — texts are held: nothing leaves the platform. Calendar changes and My Work / My Inbox items happen here.'
export const TEST_MODE_UNREAD_WORDS = 'Test mode could not be read, so it holds'

// The banner: drawn while test mode is on or unreadable, and until the board has said otherwise — while it is still…
export function testModeBanner(board: Pick<Board, 'test_mode'> | null, failed: boolean): { show: boolean; unread: boolean } {
  if (!board) return { show: true, unread: failed }
  const unread = !board.test_mode.readable
  return { show: board.test_mode.on || unread, unread }
}

/* ---------- days and weeks (Saturday start) ---------- */

/** Whole days since 1970-01-01 for an ISO date; NaN when it is not one. */
export function dayIndex(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''))
  return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000) : NaN
}

export function addDays(iso: string, n: number): string {
  const d = dayIndex(iso)
  return Number.isNaN(d) ? iso : new Date((d + n) * 86_400_000).toISOString().slice(0, 10)
}

/** The Saturdays whose weeks touch the period, in order. */
export function periodWeeks(period: Pick<Period, 'first' | 'last'>): string[] {
  if (!period.first || !period.last) return []
  const out: string[] = []
  for (let w = weekKeyOf(period.first); w <= period.last; w = addDays(w, 7)) out.push(w)
  return out
}

/** The seven days of the week that starts on `saturday`. */
export function weekDays(saturday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(saturday, i))
}

export type SchedRange = 'week' | 'period'
export type Drawn = { from: string; to: string; range: SchedRange }

/** The days drawn: one Saturday week (a week may run past the period's edge; those days have no column) or the whole period. */
export function drawnDays(range: SchedRange, week: string, period: Pick<Period, 'first' | 'last'>): Drawn {
  if (range === 'period' || !week) return { from: period.first, to: period.last, range: 'period' }
  return { from: week, to: addDays(week, 6), range: 'week' }
}

/** The id of the period holding `day` when that is not the period drawn ('' when it is, or no period holds it). */
export function otherPeriodOf(board: Pick<Board, 'period' | 'periods'> | null, day: string): string {
  if (!board || !day) return ''
  return board.periods.find((p) => day >= p.first && day <= p.last && p.id !== board.period.id)?.id ?? ''
}

/** The week that holds today, when the period draws today; else null. */
export function thisWeekOf(today: string, period: Pick<Period, 'first' | 'last'>): string | null {
  if (!today || !period.first || today < period.first || today > period.last) return null
  return weekKeyOf(today)
}

/* ---------- the notice rule ---------- */

export const MIN_DAYS_AHEAD = 7

/** Whole days from today to the date (0 = today). */
export function daysAhead(today: string, date: string): number {
  return dayIndex(date) - dayIndex(today)
}

/** Request Off and Time off need the notice; inside it only Call Off and Swap are offered. */
export function mayAskAhead(today: string, date: string, minDays = MIN_DAYS_AHEAD): boolean {
  const d = daysAhead(today, date)
  return !Number.isNaN(d) && d >= minDays
}

/** Why Request Off and Time off are not offered on this shift. */
export function noticeLine(today: string, date: string, minDays = MIN_DAYS_AHEAD): string {
  const d = daysAhead(today, date)
  const when = d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`
  return `Request Off and Time off need ${minDays} days’ notice. This shift is ${when}, so only Call Off and Swap are offered.`
}

/* ---------- a shift's minutes ---------- */

/** A cell's text read the way the server reads it: the first range of a chain ('8A-4P > 48TH (B)' → 8–16). */
export function firstRange(text: string | null | undefined): { start: number; end: number } | null {
  const first = String(text ?? '').split(/[<>]/)[0]?.replace(/^\*/, '').trim() ?? ''
  return first ? readRange(first) : null
}

/** A cell's span in minutes from its day's midnight, or null when it carries no readable time. */
export function cellMinutes(cell: Pick<Cell, 'text' | 'start' | 'end'> | null | undefined): [number, number] | null {
  if (!cell) return null
  if (typeof cell.start === 'number' && typeof cell.end === 'number' && cell.end > cell.start) {
    return [Math.round(cell.start * 60), Math.round(cell.end * 60)]
  }
  const r = firstRange(cell.text)
  return r ? [Math.round(r.start * 60), Math.round(r.end * 60)] : null
}

/** A kind that holds no time: OFF and R/O never clash; a cell with words and no time holds the whole day. */
export function spanOfValue(text: string): [number, number] | null | 'none' {
  const t = String(text ?? '').trim()
  if (!t) return 'none'
  if (/^(off|r\/o|ro|r\\o|r\/0|c\/o|ncns)$/i.test(t)) return 'none'
  const r = firstRange(t)
  return r ? [Math.round(r.start * 60), Math.round(r.end * 60)] : null
}

/** Two decimal hours → minutes, an end at or before the start carried past midnight. */
export function minutesOf(start: number, end: number): [number, number] {
  const s = Math.round(start * 60)
  let e = Math.round(end * 60)
  if (e <= s) e += 1440
  return [s, e]
}

/** Minutes → the houses' code: (480, 960) → '8A-4P'. */
export const codeOfMinutes = (s: number, e: number): string => codeOf(s / 60, e / 60)

/* ---------- who is free ---------- */

export type Clash = { house_code: string; house: string; text: string; why: string }

export const houseLabel = (board: Pick<Board, 'houses'>, code: string): string =>
  board.houses.find((h) => h.code === code)?.short || code

/** The text a person has at a house on a day, read from the grid when it is drawn. */
function textAt(board: Pick<Board, 'grids'>, code: string, key: string, date: string): string {
  const grid = board.grids[code]
  if (!grid) return ''
  const ci = grid.cols.findIndex((c) => c.iso === date)
  if (ci < 0) return ''
  const row = grid.rows.find((r) => r.kind === 'person' && r.key === key)
  return row?.cells[ci]?.text ?? ''
}

const OFF_STATES = new Set(['called_off', 'requested_off', 'time_off'])

export type Ignore = { house_code: string; date: string; start: number; end: number }

// Whether a person is free for [start, end) minutes of `date`, across every house: the busy index's half-open…
export function clashFor(board: Pick<Board, 'busy' | 'grids' | 'houses'>, key: string, date: string,
  start: number, end: number, ignore?: Ignore | null): Clash | null {
  const k = String(key ?? '')
  if (!k) return null
  for (const grid of Object.values(board.grids)) {
    const ci = grid.cols.findIndex((c) => c.iso === date)
    if (ci < 0) continue
    const row = grid.rows.find((r) => r.kind === 'person' && r.key === k)
    const cell = row?.cells[ci]
    if (!cell) continue
    if (cell.kind === 'ro' || OFF_STATES.has(String(cell.state)) || cell.time_off === 'approved') {
      const house = houseLabel(board, grid.code)
      const text = cell.state === 'called_off' ? 'C/O' : cell.text || 'R/O'
      return { house_code: grid.code, house, text, why: `off that day (${text} at ${house})` }
    }
  }
  const day = dayIndex(date)
  if (Number.isNaN(day)) return null
  const a0 = day * 1440 + start
  const a1 = day * 1440 + end
  for (const [d, s, e, code] of board.busy[k] ?? []) {
    if (ignore && ignore.house_code === code && ignore.date === d && ignore.start === s && ignore.end === e) continue
    const b0 = dayIndex(d) * 1440 + Number(s)
    const b1 = dayIndex(d) * 1440 + Number(e)
    if (!(a0 < b1 && b0 < a1)) continue
    // somebody else's call-off or time off: only that they are not free, never where or why
    if (!code) return { house_code: '', house: '', text: '', why: `not free ${d === date ? 'that day' : `on ${d}`}` }
    const house = houseLabel(board, code)
    const text = textAt(board, code, k, d) || codeOfMinutes(Number(s), Number(e))
    return { house_code: code, house, text, why: `already at ${house} ${text}${d === date ? ' that day' : ` on ${d}`}` }
  }
  return null
}

/** What a person already works at this house that day (OFF is nothing): a row holds one shift a day. */
export function sameHouseText(board: Pick<Board, 'grids'>, house: string, key: string, date: string): string {
  const text = textAt(board, house, key, date).trim()
  return text && spanOfValue(text) !== 'none' ? text : ''
}

/** Hours a person's busy days add up to in a Saturday week: shifts only, never a whole day off. */
export function busyWeekMinutes(busy: Busy[] | undefined, week: string, ignore: Ignore | null = null): number {
  let min = 0
  for (const [d, s, e, code, hold] of busy ?? []) {
    if (hold === 'day' || weekKeyOf(d) !== week) continue
    if (ignore && ignore.house_code === code && ignore.date === d && ignore.start === s && ignore.end === e) continue
    min += Number(e) - Number(s)
  }
  return min
}

/** The bottom warning of Add shift: 'Not possible: <name> is already at <house> <shift> that day.' */
export function notPossibleLine(name: string, clash: Clash): string {
  return `Not possible: ${name} is ${clash.why}.`
}

export type FreeSplit = { free: Person[]; blocked: { person: Person; why: string }[] }

// The people free for the span, and those who are not with why; `except` (the shift's own holder) is in neither.
export function freePeople(board: Pick<Board, 'busy' | 'grids' | 'houses' | 'people'>, date: string,
  span: [number, number] | null, opts: { except?: string; query?: string; house?: string; needsAccount?: boolean } = {}): FreeSplit {
  const q = nameKey(opts.query ?? '')
  const out: FreeSplit = { free: [], blocked: [] }
  const people = [...board.people].sort((a, b) => a.name.localeCompare(b.name))
  for (const p of people) {
    if (opts.except && p.key === opts.except) continue
    if (q && !nameKey(p.name).includes(q)) continue
    const clash = span ? clashFor(board, p.key, date, span[0], span[1]) : null
    const there = opts.house ? sameHouseText(board, opts.house, p.key, date) : ''
    if (clash) out.blocked.push({ person: p, why: `${clash.why}` })
    else if (there) out.blocked.push({ person: p, why: `already has ${there} at ${houseLabel(board, opts.house ?? '')} that day` })
    else if (opts.needsAccount && !p.has_account) out.blocked.push({ person: p, why: 'no platform account — they could not answer in My Work' })
    else out.free.push(p)
  }
  return out
}

/* ---------- the exchange: two people's shifts change hands ---------- */

/** One person's timed shift, as the Swap shifts panel lists it; `start`/`end` in minutes from its day's midnight. */
export type ShiftRef = {
  house: string; short: string; rowId: string; key: string; name: string; iso: string; day: string
  text: string; start: number; end: number; state: string; flow?: FlowRef
}

const GIVEN_UP = new Set(['called_off', 'requested_off', 'time_off', 'swapped_out'])

/** An Ohio instant as the day and the minute of that day. */
export function ohioNow(ms: number): { iso: string; min: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0'
  return { iso: `${get('year')}-${get('month')}-${get('day')}`, min: (Number(get('hour')) % 24) * 60 + Number(get('minute')) }
}

/** The clock the panel judges "already begun" by: the board's own reading time, or now when it carries none. */
export const boardNowMs = (board: Pick<Board, 'now'>): number => {
  const t = Date.parse(board.now)
  return Number.isNaN(t) ? Date.now() : t
}

// The people's timed shifts still to come and not yet begun, at every house drawn (only `key`'s when given): never…
export function upcomingShifts(board: Pick<Board, 'houses' | 'grids' | 'today'>, nowMs: number, key = ''): ShiftRef[] {
  const now = ohioNow(nowMs)
  const out: ShiftRef[] = []
  for (const h of board.houses) {
    const g = board.grids[h.code]
    if (!g) continue
    for (const r of g.rows) {
      if (r.kind !== 'person' || !r.key || (key && r.key !== key)) continue
      r.cells.forEach((c, i) => {
        const col = g.cols[i]
        const span = cellMinutes(c)
        if (!c || !col || !c.text || !span || col.iso < board.today || GIVEN_UP.has(String(c.state))) return
        if (col.iso < now.iso || (col.iso === now.iso && span[0] <= now.min)) return
        out.push({ house: h.code, short: h.short || h.code, rowId: r.row_id, key: r.key, name: r.name, iso: col.iso,
          day: `${col.weekday} ${col.short}`.trim(), text: c.text, start: span[0], end: span[1], state: String(c.state || 'scheduled'),
          ...(c.flow ? { flow: c.flow } : {}) })
      })
    }
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso) || a.short.localeCompare(b.short) || a.name.localeCompare(b.name))
}

/** Why a shift itself cannot be swapped (a request or a training still waits on it), or ''. */
export function shiftBlock(s: Pick<ShiftRef, 'flow'>): string {
  if (s.flow && trainingWaiting(s.flow)) return 'it waits on a training approval'
  if (s.flow && withdrawable(s.flow)) return 'a request is already waiting on it'
  return ''
}

// Why `b`'s shift cannot be taken in exchange for `a`'s, or '' when it can: afterwards a's person works b's shift…
export function exchangeBlock(board: Pick<Board, 'busy' | 'grids' | 'houses' | 'people'>, a: ShiftRef, b: ShiftRef): string {
  if (a.key === b.key) return `it is ${a.name}’s own shift`
  const own = shiftBlock(b)
  if (own) return own
  if (board.people.find((p) => p.key === b.key)?.has_account === false) return 'no platform account — they could not answer in My Work'
  const sameCell = a.house === b.house && a.iso === b.iso
  for (const [me, take] of [[a, b], [b, a]] as const) {
    const clash = clashFor(board, me.key, take.iso, take.start, take.end,
      { house_code: me.house, date: me.iso, start: me.start, end: me.end })
    if (clash) return `${me.name} is ${clash.why}`
    const there = sameCell ? '' : sameHouseText(board, take.house, me.key, take.iso)
    if (there) return `${me.name} already has ${there} at ${take.short} that day`
  }
  return ''
}

/** The training an exchange would make: who lands at a house without its IST (a warning — never a refusal). */
export function exchangeTraining(board: Pick<Board, 'people'>, a: ShiftRef, b: ShiftRef): string[] {
  const out: string[] = []
  if (istMissingAt(board, b.house, a.key)) out.push(`${a.name} has no IST at ${b.short}: it becomes a training with the house manager.`)
  if (istMissingAt(board, a.house, b.key)) out.push(`${b.name} has no IST at ${a.short}: it becomes a training with the house manager.`)
  return out
}

/** The shift as one line: 'BM · Tue Oct 6 · 8A-4P'. */
export const shiftLine = (s: Pick<ShiftRef, 'short' | 'day' | 'text'>): string => `${s.short} · ${s.day} · ${s.text}`

/* ---------- Swap shifts, picked on the grid ---------- */

// A cell in pick mode: `pick` is a first shift that may be given, `given` the one picked, `valid` a partner shift…
export type PickMark = { state: 'pick' | 'given' | 'valid' | 'blocked'; why: string; training: string[] }

export const pickKey = (rowId: string, iso: string): string => `${rowId}|${iso}`

// The marks of one house's cells while Swap shifts is picking.
export function pickMarks(board: Pick<Board, 'busy' | 'grids' | 'houses' | 'people' | 'today' | 'viewer'>, house: string,
  give: ShiftRef | null, nowMs: number): Record<string, PickMark> {
  const out: Record<string, PickMark> = {}
  const here = upcomingShifts(board, nowMs).filter((s) => s.house === house)
  for (const s of here) {
    const id = pickKey(s.rowId, s.iso)
    if (!give) {
      if (!board.viewer.is_master && !board.viewer.is_director && s.key !== board.viewer.key) continue
      const why = shiftBlock(s)
      out[id] = { state: why ? 'blocked' : 'pick', why, training: [] }
    } else if (s.house === give.house && s.rowId === give.rowId && s.iso === give.iso) {
      out[id] = { state: 'given', why: '', training: [] }
    } else {
      const why = exchangeBlock(board, give, s)
      out[id] = why ? { state: 'blocked', why, training: [] } : { state: 'valid', why: '', training: exchangeTraining(board, give, s) }
    }
  }
  return out
}

/** The shift a cell holds as pick mode reads it (its house's upcoming shifts), or null. */
export function shiftAt(board: Pick<Board, 'houses' | 'grids' | 'today'>, house: string, rowId: string, iso: string,
  nowMs: number): ShiftRef | null {
  return upcomingShifts(board, nowMs).find((s) => s.house === house && s.rowId === rowId && s.iso === iso) ?? null
}

/* ---------- drag and drop on the grid ---------- */

type At = { rowId: string; iso: string }
/** What a shift dropped on another cell opens: never a write, always a workflow's own panel with the pair picked. */
export type DropPlan =
  /** an OPEN shift on somebody's row: the editor's Assign, them picked */
  | { kind: 'assign'; open: At; key: string }
  /** an OPEN shift on the viewer's own row: Take this shift */
  | { kind: 'take'; open: At }
  /** a shift on another shift: Swap shifts, both picked */
  | { kind: 'exchange'; give: ShiftRef; take: ShiftRef }
  /** a shift on somebody's same day without one: give it away, them picked */
  | { kind: 'away'; give: ShiftRef; key: string }
  /** a shift on an OPEN row: its own panel, where Request Off and Call Off open it */
  | { kind: 'release'; from: At }
  | { kind: 'refused'; why: string }

type DropBoard = Pick<Board, 'busy' | 'grids' | 'houses' | 'people' | 'today' | 'viewer'>

/** An OPEN cell still open, from today on. */
function openAt(board: DropBoard, house: string, at: At): boolean {
  const g = board.grids[house]
  const r = g?.rows.find((x) => x.row_id === at.rowId)
  const i = g ? g.cols.findIndex((c) => c.iso === at.iso) : -1
  const c = r && i >= 0 ? r.cells[i] : null
  return Boolean(r?.kind === 'open' && c?.text && c.state === 'open' && at.iso >= board.today)
}

/** A house where a dropped shift moves at once, auto-approved (a house manager at their own house, a director anywhere):
 *  the server's word on the board (viewer.drag_move), never worked out here. */
export const movesHouse = (board: Pick<Board, 'viewer'> | null, house: string): boolean =>
  Boolean(board && house && board.viewer.drag_move?.includes(house))

/** The cells (pickKey) the viewer may pick up: an OPEN shift (to give or take), or a shift Swap shifts lets them give;
 *  where the viewer moves shifts (movesHouse), every OPEN shift and every person's shift not yet begun. */
export function dragKeys(board: DropBoard, house: string, nowMs: number): Set<string> {
  const out = new Set<string>()
  const g = board.grids[house]
  if (!g) return out
  const mover = movesHouse(board, house)
  if (mover || editsHouse(board, house) || board.viewer.key) {
    for (const r of g.rows) {
      if (r.kind !== 'open') continue
      for (const c of g.cols) if (openAt(board, house, { rowId: r.row_id, iso: c.iso })) out.add(pickKey(r.row_id, c.iso))
    }
  }
  for (const s of upcomingShifts(board, nowMs)) {
    if (s.house !== house) continue
    // a mover picks up a shift something waits on too: the drop's panel says it is cancelled with the move
    if (mover) out.add(pickKey(s.rowId, s.iso))
    else if (shiftBlock(s)) continue
    else if (board.viewer.is_master || board.viewer.is_director || s.key === board.viewer.key) out.add(pickKey(s.rowId, s.iso))
  }
  return out
}

/* ---------- drag and drop that moves at once (a house manager and up) ---------- */

/** One cell a move changes: `was` → `now` ('' is an empty cell). */
export type MoveChange = { row_id: string; name: string; date: string; day: string; was: string; now: string }
/** `block` stops the move; `warn` is said and confirmed over; `info` only says. */
export type MoveNote = { tone: 'block' | 'warn' | 'info'; text: string }
/** What one drop does, as the server worked it out before writing anything (scheduling_drag.preview_of). */
export type MovePreview = {
  kind: 'move' | 'exchange' | 'assign' | 'release' | ''
  title: string; changes: MoveChange[]; notes: MoveNote[]
  /** the first thing that stops it, '' when it may be confirmed */
  blocked: string
  /** Staff Preferences speak against it: confirming overrides them (logged) */
  needs_override: boolean
  /** the two cells as the preview read them: a cell changed since is refused, never written over */
  seen_from: string; seen_to: string
}

export function previewFrom(raw: unknown): MovePreview {
  const p = obj(obj(raw).preview)
  const tone = (t: unknown): MoveNote['tone'] => (t === 'block' || t === 'warn' ? t : 'info')
  const kind = String(p.kind ?? '')
  return {
    kind: (['move', 'exchange', 'assign', 'release'].includes(kind) ? kind : '') as MovePreview['kind'],
    title: String(p.title ?? '') || 'Move shift',
    changes: arr<Record<string, unknown>>(p.changes).map((c) => ({
      row_id: String(c.row_id ?? ''), name: String(c.name ?? ''), date: String(c.date ?? ''), day: String(c.day ?? ''),
      was: String(c.was ?? ''), now: String(c.now ?? ''),
    })),
    notes: arr<Record<string, unknown>>(p.notes).map((n) => ({ tone: tone(n.tone), text: String(n.text ?? '') })).filter((n) => n.text),
    blocked: String(p.blocked ?? ''),
    needs_override: p.needs_override === true,
    seen_from: String(p.seen_from ?? ''), seen_to: String(p.seen_to ?? ''),
  }
}

/** What dropping `from` on `to` opens; null when the drop means nothing (the same cell, the same person). */
export function dropPlan(board: DropBoard, house: string, from: At, to: At, nowMs: number): DropPlan | null {
  if (from.rowId === to.rowId && from.iso === to.iso) return null
  const rows = board.grids[house]?.rows ?? []
  const dst = rows.find((r) => r.row_id === to.rowId)
  if (!dst) return null
  const refused = (why: string): DropPlan => ({ kind: 'refused', why })
  if (openAt(board, house, from)) {
    if (dst.kind !== 'person') return refused('An OPEN shift is dropped on somebody’s row.')
    if (to.iso !== from.iso) return refused('An OPEN shift stays on its own day: drop it on that day.')
    if (editsHouse(board, house)) return { kind: 'assign', open: from, key: dst.key }
    if (dst.me) return { kind: 'take', open: from }
    return refused('Drop an OPEN shift on your own row to take it; the house’s editors give it to somebody else.')
  }
  const give = shiftAt(board, house, from.rowId, from.iso, nowMs)
  if (!give) return null
  if (dst.kind === 'open') return { kind: 'release', from }
  if (dst.kind !== 'person' || !dst.key) return refused('A shift is dropped on somebody’s row.')
  const take = shiftAt(board, house, to.rowId, to.iso, nowMs)
  if (take) {
    const why = exchangeBlock(board, give, take)
    return why ? refused(`Not possible: ${why}.`) : { kind: 'exchange', give, take }
  }
  if (dst.key === give.key) return null
  if (to.iso !== from.iso) return refused(`A shift is given on its own day: drop it on somebody’s ${give.day}.`)
  const { free, blocked } = freePeople(board, give.iso, [give.start, give.end], { except: give.key, house, needsAccount: true })
  if (free.some((p) => p.key === dst.key)) return { kind: 'away', give, key: dst.key }
  const why = blocked.find((b) => b.person.key === dst.key)?.why
  return refused(`${dst.name} cannot take it${why ? `: ${why}` : ''}.`)
}

/** The cross-checks a valid pair has passed, as the ask panel lists them. */
export const EXCHANGE_CHECKS = [
  'Each of you is free for the other’s shift at every house, your own given shift set aside',
  'Nobody is off, on R/O or on time off that day',
  'No request or training waits on either shift',
  'Nobody ends up with two shifts at one house that day',
]

/* ---------- editors and the flows waiting on a cell ---------- */

// The sentence an editor reads over a cell a swap (either side), a Request Off or a training still waits on — the…
export function pendingFlowLine(cell: Pick<Cell, 'flow'> | null | undefined): string {
  const f = cell?.flow
  if (!f || !(f.state === 'waiting' || f.state.startsWith('waiting_'))) return ''
  const what = f.kind === 'training' ? 'training' : f.kind === 'request_off' ? 'Request Off'
    : f.kind === 'swap' ? (f.with ? `swap with ${f.with}` : 'swap') : ''
  return what ? `This shift has a pending ${what}: answer it or cancel it first.` : ''
}

/** A refusal that is that sentence: the board was older than the flow, and the form offers the cancel all the same. */
export const isPendingRefusal = (said: string): boolean => /^This shift has a pending .+: answer it or cancel it first\.$/.test(said)

/** A swap flow's partner shift as one line, or '' for a one-sided swap. */
export function exchangeLine(board: Pick<Board, 'houses'>, f: Pick<Flow, 'exchange'>): string {
  const ex = f.exchange
  if (!ex || !ex.house_code) return ''
  return [ex.house_label || houseLabel(board, ex.house_code), ex.date, ex.shift_text].filter(Boolean).join(' · ')
}

/* ---------- training: no IST at the house ---------- */

export const TRAINING_PICK_LINE =
  'New to this house without its IST: this becomes training with the house manager — the house manager and a director must approve.'

/** Whether the board says this person has no IST at this house (unsaid is not known — the server then decides). */
export function istMissingAt(board: Pick<Board, 'people'>, house: string, key: string): boolean {
  if (!house || !key) return false
  const p = board.people.find((x) => x.key === key)
  return Array.isArray(p?.no_ist) && p.no_ist.includes(house)
}

/** The line a training cell carries everywhere it is drawn. */
export const trainingTitle = (house: string): string =>
  `Training at ${house} with the house manager — not counted as DSP`

/** The open shifts still to come on a house's OPEN rows, as its grid draws them (Scheduling.gs schedBoard_). */
export function openCount(grid: Pick<Grid, 'rows' | 'cols'> | null | undefined, today: string): number {
  if (!grid) return 0
  let n = 0
  for (const r of grid.rows) {
    if (r.kind !== 'open') continue
    r.cells.forEach((c, i) => {
      if (c && c.state === 'open' && typeof c.start === 'number' && (grid.cols[i]?.iso ?? '') >= today) n++
    })
  }
  return n
}

/* ---------- who edits, and which panel a press opens ---------- */

/** The Scheduling editions (Editions.gs); their doors are Python's, so a board Apps Script answered names none. */
export const CALENDAR_EDITION = 'scheduling.calendar'
export const BUILDER_EDITION = 'scheduling.builder'
export const SETTINGS_EDITION = 'scheduling.settings'
/** Who answers a time off ask beside the listed directors (Settings › Editions › Time off approvals). */
export const TIME_OFF_EDITION = 'scheduling.timeOffApprove'
/** a swap asked on anybody's shift (Python files it: Apps Script's own gate never reads an edition) */
export const SWAPS_EDITION = 'scheduling.swaps'
export const SCHED_EDITIONS: readonly string[] = [CALENDAR_EDITION, BUILDER_EDITION, SETTINGS_EDITION, TIME_OFF_EDITION,
  SWAPS_EDITION]

export const holdsEdition = (board: Pick<Board, 'viewer'> | null, id: string): boolean =>
  Boolean(board?.viewer.editions?.includes(id))

/** Who asks a swap on somebody else's shift: the master, a Scheduling director, or Settings › Editions › Swaps. */
export const swapsAnybody = (board: Pick<Board, 'viewer'>): boolean =>
  board.viewer.is_master || board.viewer.is_director || holdsEdition(board, SWAPS_EDITION)

/** A house's own editors (the master, a director, its house manager): the flows on Apps Script answer them alone. */
export function editsHouseOwn(board: Pick<Board, 'viewer'> | null, code: string): boolean {
  if (!board) return false
  const v = board.viewer
  return v.can_edit_any || v.is_master || v.is_director || v.editor_of.includes(code)
}

/** Who edits a house's cells and people: its own editors, and every house for the calendar edition. */
export function editsHouse(board: Pick<Board, 'viewer'> | null, code: string): boolean {
  return editsHouseOwn(board, code) || holdsEdition(board, CALENDAR_EDITION)
}

/** The Scheduling settings: the master's whole setup, or the settings edition's waits and cycle. */
export const editsSettings = (board: Pick<Board, 'viewer'> | null, sessionMaster: boolean): boolean =>
  Boolean(board && ((sessionMaster && board.viewer.is_master) || holdsEdition(board, SETTINGS_EDITION)))

/** A shift that is somebody's and still to come or running. */
const holdsShift = (cell: Cell | null | undefined): boolean =>
  Boolean(cell && cell.text && cellMinutes(cell) && !['called_off', 'swapped_out', 'requested_off', 'time_off'].includes(String(cell.state)))

// own: the viewer's own shift (Request Off, Call Off, Swap, Time off) · take: an OPEN shift a staff member may take…
export type PanelMode = 'own' | 'take' | 'assign' | 'edit' | 'read'

export function panelMode(a: { row: Pick<GridRow, 'kind' | 'me'>; cell: Cell | null; editor: boolean; date: string; today: string }): PanelMode {
  const past = Boolean(a.today) && a.date < a.today
  if (a.row.kind === 'open') {
    if (a.cell?.text && !past) return a.editor ? 'assign' : 'take'
    return a.editor ? 'edit' : 'read'
  }
  if (a.row.kind === 'person' && a.row.me && !past && holdsShift(a.cell)) return 'own'
  return a.editor ? 'edit' : 'read'
}

/* ---------- a flow's steps ---------- */

export type StepState = 'done' | 'waiting' | 'refused' | 'na'
export type Step = { id: string; label: string; state: StepState; note?: string }

export const FLOW_LABEL: Record<FlowKind, string> = {
  call_off: 'Call off', request_off: 'Request off', time_off: 'Time off', swap: 'Swap', take: 'Taken', phone: 'Phone call-off',
  training: 'Training', move: 'Schedule change',
}

/** A flow's name as the cards say it: a shift reopened by a declined training is never read as the trainee's call-off. */
export function flowLabel(flow: Pick<Flow, 'kind' | 'source'>): string {
  if (flow.kind === 'call_off' && flow.source === 'training') return 'Shift reopened (training not approved)'
  return FLOW_LABEL[flow.kind] ?? String(flow.kind)
}

/** The flow an item waiting on the viewer asks about, when the answer carries it or it is the viewer's own. */
export function itemFlow(board: Pick<Board, 'mine'>, item: Pick<InboxItem, 'flow_id' | 'flow'>): Flow | null {
  if (item.flow && typeof item.flow === 'object' && item.flow.kind) return item.flow
  return (item.flow_id && board.mine.find((f) => f.id === item.flow_id)) || null
}

/** The seats, whether the answer sent them parsed or as their stored JSON. */
export function seatsOf(flow: Pick<Flow, 'seats'>): Seat[] {
  if (Array.isArray(flow.seats)) return flow.seats
  if (typeof flow.seats === 'string' && flow.seats.trim()) {
    try {
      const got = JSON.parse(flow.seats)
      return Array.isArray(got) ? got as Seat[] : []
    } catch {
      return []
    }
  }
  return []
}

const SWAP_ORDER: SeatName[] = ['staff', 'house_manager', 'director']
const SWAP_WAITING: Record<string, SeatName> = {
  waiting_staff: 'staff', waiting_manager: 'house_manager', waiting_director: 'director',
}
const SEAT_LABEL: Record<SeatName, string> = { staff: 'Staff', house_manager: 'House manager', director: 'Director' }

function seatState(s: Seat | undefined): StepState | null {
  if (!s) return null
  if (s.state === 'approved') return 'done'
  if (s.state === 'declined') return 'refused'
  if (s.state === 'waiting') return 'waiting'
  return 'na'
}

/** Proposed → Staff → House manager (one per house in an exchange) → Director → Swapped. */
export function swapSteps(flow: Pick<Flow, 'state' | 'seats'>): Step[] {
  const seats = seatsOf(flow)
  const waitingAt = SWAP_WAITING[flow.state]
  const at = waitingAt ? SWAP_ORDER.indexOf(waitingAt) : flow.state === 'done' ? SWAP_ORDER.length : -1
  const steps: Step[] = [{ id: 'proposed', label: 'Proposed', state: 'done' }]
  SWAP_ORDER.forEach((name, i) => {
    const named = seats.filter((s) => s.seat === name)
    const list: (Seat | undefined)[] = name === 'house_manager' && named.length > 1 ? named : [named[0]]
    list.forEach((seat) => {
      const fromSeat = seatState(seat)
      const derived: StepState = at < 0 ? 'na' : i < at ? 'done' : i === at ? 'waiting' : 'na'
      // one house's seat may have said yes while the other house's still waits
      const state = flow.state === 'declined' ? (fromSeat ?? 'na')
        : fromSeat === 'refused' ? 'refused' : fromSeat === 'done' && derived === 'waiting' ? 'done' : derived
      const house = list.length > 1 && seat ? seat.house_label || seat.house || '' : ''
      steps.push({
        id: house ? `${name}:${seat?.house}` : name, label: house ? `${SEAT_LABEL[name]} · ${house}` : SEAT_LABEL[name],
        state: seat?.state === 'skipped' ? 'na' : state,
        note: seat?.state === 'skipped' ? (seat.why || 'passed to the directors') : seat?.by ? `${seat.by}${seat.note ? ` — ${seat.note}` : ''}` : undefined,
      })
    })
  })
  steps.push({ id: 'swapped', label: 'Swapped', state: flow.state === 'done' ? 'done' : 'na' })
  return steps
}

/** An exchange's steps before it is asked: the partner, the house manager of each house, a director. */
export function exchangePlanSteps(a: Pick<ShiftRef, 'house' | 'short'>, b: Pick<ShiftRef, 'house' | 'short' | 'name'>): Step[] {
  const houses = a.house === b.house ? [a] : [a, b]
  return [
    { id: 'proposed', label: 'Proposed', state: 'na' },
    { id: 'staff', label: b.name.split(' ')[0] || b.name, state: 'na' },
    ...houses.map((h) => ({ id: `house_manager:${h.house}`, label: `House manager · ${h.short}`, state: 'na' as const })),
    { id: 'director', label: 'Director', state: 'na' },
    { id: 'swapped', label: 'Swapped', state: 'na' },
  ]
}

/** Asked → Director → the outcome, for Request Off and Time off. */
export function askSteps(flow: Pick<Flow, 'kind' | 'state'>): Step[] {
  const end = flow.kind === 'request_off' ? 'Called off' : 'Approved'
  const approved = flow.state === 'approved' || flow.state === 'approved_future'
  const declined = flow.state === 'declined'
  return [
    { id: 'asked', label: 'Asked', state: 'done' },
    { id: 'director', label: 'Director', state: approved ? 'done' : declined ? 'refused' : flow.state === 'waiting' ? 'waiting' : 'na' },
    { id: 'end', label: end, state: approved ? 'done' : 'na' },
  ]
}

// Placed → House manager → Director → Training: both seats are asked at once and both must approve; one decline…
export function trainingSteps(flow: Pick<Flow, 'state' | 'seats'>): Step[] {
  const seats = seatsOf(flow)
  const approved = flow.state === 'approved'
  const declined = flow.state === 'declined'
  const seat = (name: SeatName, label: string): Step => {
    const s = seats.find((x) => x.seat === name)
    if (s?.state === 'skipped') return { id: name, label, state: 'na', note: s.why || 'passed to the directors' }
    let st = seatState(s) ?? (approved ? 'done' : flow.state === 'waiting' ? 'waiting' : 'na')
    // a seat still open on a flow already decided was never needed
    if (st === 'waiting' && flow.state !== 'waiting') st = 'na'
    return { id: name, label, state: st, note: s?.by ? `${s.by}${s.note ? ` — ${s.note}` : ''}` : undefined }
  }
  return [
    { id: 'placed', label: 'Placed', state: 'done' },
    seat('house_manager', 'House manager'),
    seat('director', 'Director'),
    { id: 'training', label: 'Training', state: approved ? 'done' : declined ? 'refused' : 'na' },
  ]
}

export function flowSteps(flow: Pick<Flow, 'kind' | 'state' | 'seats'>): Step[] {
  if (flow.kind === 'swap') return swapSteps(flow)
  if (flow.kind === 'request_off' || flow.kind === 'time_off') return askSteps(flow)
  if (flow.kind === 'training') return trainingSteps(flow)
  return []
}

/** A flow its requester may still withdraw; a training is never withdrawn (Call Off gives the shift up). */
export const withdrawable = (flow: Pick<Flow, 'state'> & { kind?: string }): boolean =>
  flow.kind !== 'training' && (flow.state === 'waiting' || flow.state.startsWith('waiting_'))

/** A training still waiting on its seats. */
export const trainingWaiting = (flow: { kind?: string; state?: string } | null | undefined): boolean =>
  Boolean(flow && flow.kind === 'training' && flow.state === 'waiting')

/** Withdraw is offered to whoever asked (the server judges it again); somebody else's flow is only read. */
export function mayWithdraw(board: Pick<Board, 'viewer'>, flow: Pick<Flow, 'state' | 'kind' | 'person'>): boolean {
  if (!withdrawable(flow)) return false
  return !board.viewer.key || !flow.person || nameKey(flow.person) === board.viewer.key
}

/** A flow still moving: the ones the "Your requests" card leads with. */
export const flowOpen = (flow: Pick<Flow, 'state'> & { kind?: string }): boolean =>
  withdrawable(flow) || trainingWaiting(flow)
  || ['outreach_1', 'outreach_wait', 'outreach_2', 'approved_future', 'needs_human'].includes(flow.state)

/* ---------- a cell's marks (the grid draws them, the legend lists those present) ---------- */

export type MarkId =
  | 'open' | 'called-off' | 'request-waiting' | 'swap-waiting' | 'time-off-asked' | 'time-off' | 'echo' | 'taken'
  | 'training' | 'training-waiting'

/** The marks one cell carries. */
export function cellMarks(row: Pick<GridRow, 'kind'>, cell: Cell | null | undefined): MarkId[] {
  if (!cell) return []
  const out: MarkId[] = []
  if (row.kind === 'open' && cell.text && cell.state !== 'taken') out.push('open')
  if (cell.state === 'taken') out.push('taken')
  if (cell.state === 'training') out.push(trainingWaiting(cell.flow) ? 'training-waiting' : 'training')
  if (cell.state === 'called_off') out.push('called-off')
  const waiting = Boolean(cell.flow && withdrawable(cell.flow))
  if (waiting && cell.flow?.kind === 'swap') out.push('swap-waiting')
  if (waiting && cell.flow?.kind === 'request_off') out.push('request-waiting')
  if (cell.time_off === 'asked') out.push('time-off-asked')
  if (cell.time_off === 'approved' || cell.state === 'time_off') out.push('time-off')
  if (cell.echo) out.push('echo')
  return out
}

/** The marks present in the days drawn of a grid, in the legend's order. */
export function marksPresent(grid: Pick<Grid, 'rows' | 'cols'> | null | undefined, drawn?: Pick<Drawn, 'from' | 'to'>): MarkId[] {
  if (!grid) return []
  const seen = new Set<MarkId>()
  const cols = grid.cols.map((c, i) => ({ c, i })).filter(({ c }) => !drawn || (c.iso >= drawn.from && c.iso <= drawn.to))
  for (const r of grid.rows) for (const { i } of cols) for (const m of cellMarks(r, r.cells[i])) seen.add(m)
  return MARK_ORDER.filter((m) => seen.has(m))
}

export const MARK_ORDER: MarkId[] = [
  'open', 'taken', 'training', 'training-waiting', 'called-off', 'request-waiting', 'swap-waiting', 'time-off-asked', 'time-off', 'echo',
]

/** The legend's marks that are always drawn, whether or not a cell in view carries them. */
export const ALWAYS_MARKS: MarkId[] = ['training']
