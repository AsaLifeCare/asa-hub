// The shapes the house-calendar lane serves, and the few derivations the screen is allowed to do on its own.
// NOTHING IS RECOMPUTED HERE.
import { dayWords } from '@/pages/features/timeoff/timeOffModel'
import { TEST_MODE_CELL, type PublishedMark } from './publishedMark'

/** The caller's own cell on a call-off; empty for readers not told who called off. */
export type CalledOff = { ref: string; value: string; state: string; filled_by: string }

/** Time off over this day: scheduled for every reader, a pending request for the house's editors only. */
export type TimeOffMark = { state: 'scheduled' | 'pending' | string; ref: string; until: string }

/** What a time-off mark says on the cell; it takes the feed as the relay laid it (timeOffMarks.TimeOffFeed). */
export function timeOffTitle(m: Partial<TimeOffMark>): string {
  return m.state === 'scheduled'
    ? `Time off (${m.ref}) until ${dayWords(m.until ?? '')} — nobody can be put on a shift this day`
    : `Time off asked (${m.ref}), waiting for approval — a draft here is allowed`
}

/** A Builder draft: `base` is the workbook value at draft time; `ist` is set when it is a training. */
export type CellDraft = { base: string; note: string; by: string; at: string; ist: string }

export type Cell = {
  text?: string
  color?: string
  edited?: boolean
  /** Published, not yet read back by the mirror. */
  pending?: boolean
  /** Held by test mode: shown here, never written to the workbook. */
  test_mode?: boolean
  /** THE MARK, from the relay (house_cal_live.lay_published): the staff-answers rehearsal wrote it. */
  rehearsal?: boolean
  /** Drafted on the Calendar Builder (only on the Builder's grid). */
  draft?: CellDraft
  /** On an 'OPEN · call-off' line: the pool handle every action posts back. */
  ref?: string
  kind_of_open?: string
  /** Who called it off — present only for a reader who may know. */
  called_off_by?: string
  /** On the caller's own cell (drawn C/O), for a reader who may know. */
  called_off?: CalledOff
  /** How the cell got here: its last publish (effective_roster.lay_marks); never on a draft. */
  published?: PublishedMark
  /** Time off over this day, as the relay lays it for the Time Off app (server/time_off.grid_marks; timeOffMarks reads it). */
  time_off?: import('./timeOffMarks').TimeOffFeed
}
export type Col = { label?: string; iso?: string; date?: string; short?: string; weekday?: string }
/** `open_row`: the relay says this row is nobody; `call_off_row`: a drawn line, not a workbook row. */
export type Row = {
  employee: string
  cells: Cell[]
  open_row?: boolean
  sheet_name?: string
  call_off_row?: boolean
  /** Drafted into a house they have no row in yet; the row lands on publish. */
  draft_row?: boolean
  /** A row the workbook gained on a publish the mirror has not read yet. */
  pending_row?: boolean
}

/** Where a shift is on the clock, said by the relay in Ohio's time. */
export type ShiftState = 'past' | 'in_progress' | 'upcoming'

export type CellFact = {
  employee: string
  col_iso: string
  raw: string
  kind: string
  code: string
  start: number | null
  end: number | null
  token: string | null
  hours: number
  overnight: boolean
  edited: boolean
  transfer?: boolean
  state?: ShiftState
  starts_at?: string
  ends_at?: string
  draft?: boolean
  pending?: boolean
}

export type PersonTotals = {
  employee: string
  hours: number
  shifts: number
  off: number
  elsewhere: number
  by_week: Record<string, number>
  conflicts: string[]
}

export type DayTotals = {
  col_iso: string
  working: number
  off: number
  elsewhere: number
  hours: number
  names: string[]
}

export type Conflict = {
  key: string
  employee: string
  col_iso: string
  kind: 'two-houses' | 'back-to-back' | 'over-week' | string
  why: string
}

// A shift on a row named OPEN — the estate's own way of writing "nobody is on this", in these tabs since before the…
export type OpenShift = {
  key: string
  location: string
  open_row: string
  col_iso: string
  raw: string
  code: string
  start: number | null
  end: number | null
  hours: number
  kind: string
  overnight: boolean
  claimed_by: string | null
  claimed_via: string | null
  claimed_at: string | null
  /** When it begins (Ohio), and whether it has started, per the relay. */
  starts_at?: string
  started?: boolean
  // WHAT STATE THIS SHIFT IS IN, decorated on the row by the relay (server/shift_requests.decorate_open_shifts).
  window?: import('./requestsLogic').ShiftWindow
  pool_state?: string
  applicants?: number
  kind_of_open?: string
  /** The pool handle; a call-off travels by it alone, its row being the caller's. */
  ref?: string
  /** Who called it off — only for a reader who may know (never staff). */
  called_off_by?: string
  /** The house's street, from the houses directory. */
  address?: string
  /** Where THIS reader stands on it (shift_requests.standing). */
  mine?: Standing
  /** Who applied, earliest first — only to a reader who edits the house. */
  applicant_list?: PanelApplicant[]
  /** A first shift here: who would train and whether they are free (training_verdict). */
  training?: import('./requestsLogic').Training
}

/** One reader's standing on one open shift, per the relay; `ist.ok` false makes it a training. */
export type Standing = {
  may: boolean
  code: string
  why: string
  window?: import('./requestsLogic').ShiftWindow
  ist?: { ok: boolean; state?: string; why: string }
  request_id?: string
  state?: string
}

export type PanelApplicant = {
  id: string
  person: string
  state: string
  why: string
  via: string
  at: string
  week_hours: number
  /** false when they have no IST for the house — choosing them is a training */
  ist_ok?: boolean
  /** …and then who would train them, and whether they are free */
  training?: import('./requestsLogic').Training
  /** THE MARK, from the relay: this application was played by the staff-answers rehearsal. */
  rehearsal?: boolean
}

/** What the grid actually draws; a tab that is not a roster must not read as a quiet week. */
export type Window = { first: string; last: string; days: number; covers_today: boolean; today?: string }

export type Computed = {
  cells: Record<string, CellFact>
  people: PersonTotals[]
  days: DayTotals[]
  conflicts: Conflict[]
  open_shifts: OpenShift[]
  window: Window
  weekly_ot_hours: number
  totals: { hours: number; shifts: number; people: number; open: number }
  /** Ohio's now as the relay read it, and the cells running at that moment. */
  now?: string
  running?: string[]
}

/** One drafted cell of a house, as the Builder's grid door lists them. */
export type DraftEntry = {
  employee: string
  col_iso: string
  value: string
  base: string
  note: string
  by: string
  at: string
  ist: string
}

/** One change in a cell's history, newest first (calendar_builder_houses.history). */
export type HistoryEntry = {
  id: number
  was: string
  now: string
  via: string
  by: string
  at: string
  stage: 'draft' | 'published' | 'call_off' | 'override' | string
  note: string
  undone: boolean
}

/** This reader's access to this house (shift_requests.calendar_access), never re-derived. */
export type CalendarAccess = { view: boolean; edit: boolean; why: string; me: string }

/** The house's managers (latest ** rows); `why` when there is nobody or it was unreadable. */
export type HouseManager = { name: string; names: string[]; readable: boolean; why: string }

/** One cell test mode held (calendar_builder_houses.held_cells). */
export type HeldCell = {
  employee: string
  col_iso: string
  value: string
  base: string
  by: string
  at: string
  via: string
  note: string
}

export type Grid = {
  location: string
  updated_at?: string
  cols: Col[]
  rows: Row[]
  computed?: Computed
  access?: CalendarAccess
  house_manager?: HouseManager
  /** Unreadable pool: the screen says so rather than drawing the house as covered. */
  pool?: { readable: boolean; why: string }
  /** Builder only: the draft, and weekly hours across every house (`estate_readable`). */
  drafts?: DraftEntry[]
  draft_count?: number
  estate_weeks?: Record<string, Record<string, number>>
  estate_readable?: boolean
  /** Whether test mode holds roster writes now (unreadable holds); both doors say it. */
  test_mode?: { on: boolean; readable: boolean; why: string }
  /** Builder only: what test mode held here, and whether that could be read. */
  held?: HeldCell[]
  held_readable?: boolean
  /** Set when the cells' published marks could not be read; the cells still draw. */
  published_why?: string
  /** This reader's waiting transfers here (shift_handoff.for_house); `handoffs_why` when unreadable. */
  handoffs?: import('./requestsLogic').HandoffView[]
  handoffs_why?: string
  /** Whether time off could be laid on this grid; unreadable is said, never drawn as nobody off. */
  time_off?: { readable: boolean; why: string }
}

/** The transfer still waiting on one cell — the giver's own shift that day. */
export function handoffAt(list: import('./requestsLogic').HandoffView[] | undefined, employee: string,
                          colIso: string): import('./requestsLogic').HandoffView | undefined {
  return (list ?? []).find((h) => h.state === 'pending' && h.col_iso === colIso
    && sameName(h.from_staff, employee))
}

/** One house on the rail, with the relay's answer about it. */
export type House = {
  location: string
  staff: number
  updated_at: string
  may_edit?: boolean
  manager?: string
  managers?: string[]
  /** The Builder's unpublished cells here; sent only on a house this reader builds. */
  drafts?: number
}

/** The cell's name, everywhere: the same triple the overrides table keys on. */
export const cellKey = (employee: string, colIso: string) => `${employee}|${colIso}`

// A decimal hour as the estate reads it.
export function hhmm(h: number): string {
  const wrapped = ((h % 24) + 24) % 24
  const hour = Math.floor(wrapped)
  const min = Math.round((wrapped - hour) * 60)
  const ap = hour >= 12 ? 'PM' : 'AM'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:${String(min).padStart(2, '0')} ${ap}`
}

// The week a day belongs to, keyed by ITS SATURDAY (a Monday maps to the Saturday two days before).
export function weekKeyOf(iso: string): string {
  const parts = iso.split('-')
  if (parts.length < 3) return iso
  const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])))
  if (Number.isNaN(d.getTime())) return iso
  // getUTCDay: 0=Sun … 6=Sat. Days back to the Saturday on or before this day.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7))
  return d.toISOString().slice(0, 10)
}

export const KIND_LABEL: Record<string, string> = {
  day: 'Day', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening',
  overnight: 'Overnight', off: 'Off', ro: 'Not working', alias: 'Another house',
}

// The conflicts that name THIS cell, plus the person's week-level ones — a week over the line has no column of its…
export function conflictsFor(computed: Computed, employee: string, colIso: string): Conflict[] {
  const key = cellKey(employee, colIso)
  const week = weekKeyOf(colIso)
  return computed.conflicts.filter(
    (c) => c.key === key || (c.employee === employee && c.key === `${employee}|${week}`),
  )
}

// Cell keys the grid should ring.
export function ringedCells(computed: Computed | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const c of computed?.conflicts ?? []) {
    if (c.kind !== 'over-week') out.add(c.key)
  }
  return out
}

/** The open shifts, by cell key, so the grid can paint one without scanning. */
export function openByCell(computed: Computed | null | undefined): Map<string, OpenShift> {
  const m = new Map<string, OpenShift>()
  for (const s of computed?.open_shifts ?? []) m.set(s.key, s)
  return m
}

/** Everything one grid cell's title says, in the order it matters; the one reader every house grid uses. */
export function cellTitle(a: {
  cell: Cell
  /** the Time switch is showing a spelling, so the code itself is said */
  spelled: boolean
  open?: OpenShift
  running: boolean
  mode: 'operations' | 'builder'
  editor: boolean
  canDrag: boolean
  /** the time-off sentence, when the cell carries one (timeOffMarks) */
  timeOff?: string
  /** a transfer waits on this shift */
  transfer?: boolean
}): string {
  const c = a.cell
  const open = a.open
  const co = c.called_off
  return [
    a.spelled ? c.text : '',
    c.draft ? `Draft — the workbook says ${c.draft.base || 'nothing'} here until the house is published`
      : open
      ? (open.claimed_by ? `Taken by ${open.claimed_by}`
        : open.started ? 'OPEN SHIFT — already started, nobody is on it'
        : a.mode === 'builder' ? 'OPEN SHIFT — given in Live'
        : a.editor ? 'OPEN SHIFT — click to see who applied and give it'
        : 'OPEN SHIFT — click to see it and apply')
      : co ? (co.filled_by ? `Called off — given to ${co.filled_by}`
        : 'Called off — the shift waits on its red cell on the call-off line')
      : a.running ? 'Running now'
      : c.rehearsal ? 'Played by the shift rehearsal — nobody really works this square, and it is never published'
      : c.test_mode ? `Recorded while test mode was on — ${TEST_MODE_CELL}`
      : c.pending ? 'Just published — the copy of the workbook catches up within half an hour'
      : c.edited ? 'An old override over the workbook, waiting for its migration'
      : a.canDrag ? 'Click to open · drag to move · hold Shift to swap'
      : 'Click to open',
    a.timeOff ?? '',
    a.transfer ? 'A transfer is waiting on this shift' : '',
  ].filter(Boolean).join(' · ')
}

// BLOOD RED, and only for a shift nobody has taken.
export const OPEN_RED = 'bg-[#8b0000] text-white hover:bg-[#a50f0f]'
export const OPEN_CLAIMED = 'bg-[#8b0000]/15 text-[#8b0000] line-through'

/** The platform's name key (`clientNameKey_`, shift_requests.fold). */
export function nameKey(name: string | null | undefined): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  nameKey(a) !== '' && nameKey(a) === nameKey(b)

/** Editable houses first, then the rest, each group by name. */
export function sortHouses(houses: House[]): House[] {
  return [...houses].sort((a, b) =>
    Number(Boolean(b.may_edit)) - Number(Boolean(a.may_edit)) || a.location.localeCompare(b.location))
}

/** The one line the house bar says about who manages the house. */
export function managerLine(hm: HouseManager | null | undefined): string {
  if (!hm) return ''
  const names = (hm.names?.length ? hm.names : [hm.name]).filter(Boolean)
  if (names.length === 0) return hm.why
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** What a drop means: replacing a filled cell asks first, Shift swaps, OPEN rows never move. */
export type DropVerdict =
  | { kind: 'none' }
  | { kind: 'refuse'; why: string }
  | { kind: 'move' }
  | { kind: 'swap' }
  | { kind: 'confirm'; displaced: string }

export function dropVerdict(a: {
  mayEdit: boolean
  sameCell: boolean
  fromOpenRow: boolean
  toOpenRow: boolean
  moving: string
  landing: string
  swap: boolean
  /** a transfer waits on the shift dragged, or on the one it lands on */
  transferWaiting?: boolean
}): DropVerdict {
  if (!a.mayEdit) return { kind: 'refuse', why: 'Only this house\'s manager, and those above, move its shifts.' }
  if (a.sameCell) return { kind: 'none' }
  if (a.fromOpenRow || a.toOpenRow) {
    return { kind: 'refuse', why: 'An open shift is assigned from its panel — it is never dragged, and nothing is dropped on it.' }
  }
  if (a.transferWaiting) {
    return { kind: 'refuse', why: 'A transfer is waiting on this shift: answer it or withdraw it in Live first.' }
  }
  if (!a.moving.trim()) return { kind: 'none' }
  if (a.swap) return { kind: 'swap' }
  if (a.landing.trim()) return { kind: 'confirm', displaced: a.landing }
  return { kind: 'move' }
}

/* ── one shift, followed everywhere ──────────────────────────────────────── */

/** The one shift link shape; shift_requests.deep_link spells it the same way. */
export const HOUSE_CAL_PATH = '/app/calendarbuilder/house-cal'

export const REQUESTS_PATH = '/app/calendarbuilder/requests'

/** Live, on one house; a ref or a cell opens in the panel, a day comes into view (web_notices spells the same). */
export function houseCalLink(location: string, at: { ref?: string; open?: string; day?: string } = {}): string {
  const parts: string[] = []
  if (location) parts.push(`house=${encodeURIComponent(location)}`)
  if (at.ref) parts.push(`ref=${encodeURIComponent(at.ref)}`)
  else if (at.open) parts.push(`open=${encodeURIComponent(at.open)}`)
  if (at.day) parts.push(`day=${encodeURIComponent(at.day)}`)
  return parts.length ? `${HOUSE_CAL_PATH}?${parts.join('&')}` : HOUSE_CAL_PATH
}

/** Where a calendar is changed; calendar_builder_houses.builder_link spells the same path. */
export const BUILDER_PATH = '/app/calendarbuilder/builder'

export function builderLink(location: string, at: { day?: string; employee?: string } = {}): string {
  const parts: string[] = []
  if (location) parts.push(`house=${encodeURIComponent(location)}`)
  if (at.day) parts.push(`day=${encodeURIComponent(at.day)}`)
  if (at.employee) parts.push(`employee=${encodeURIComponent(at.employee)}`)
  return parts.length ? `${BUILDER_PATH}?${parts.join('&')}` : BUILDER_PATH
}

/** Said instead of a dead button when App Access does not open Calendar Builder to an editor. */
export function builderClosedLine(): string {
  return 'This calendar is yours to edit, in Calendar Builder — which is not opened to your badge yet. The master grants it in App Control → Matrix.'
}

/** An open shift's link: by handle when it has one, else by cell. */
export function linkForShift(s: Pick<OpenShift, 'location' | 'key'> & { ref?: string }): string {
  return houseCalLink(s.location, s.ref ? { ref: s.ref } : { open: s.key })
}

/** The open shift a handle names on this grid, if the grid draws it. */
export function openShiftByRef(computed: Computed | null | undefined, ref: string): OpenShift | undefined {
  const want = String(ref || '').trim().toUpperCase()
  if (!want) return undefined
  return (computed?.open_shifts ?? []).find((s) => String(s.ref || '').toUpperCase() === want)
}

/** The ledger's road word as the list says it. */
export function takenHow(via: string | null | undefined): string {
  switch (String(via ?? '')) {
    case '': case 'app': return ''
    case 'approved': return 'applied and approved'
    case 'assigned': return 'assigned by the house manager'
    case 'sms': return 'by text'
    default: return `by ${via}`
  }
}

/** What the panel offers on an open shift, from the relay's words: taken · started · assign · apply · applied · blocked */
export type OpenAction =
  | { kind: 'taken'; by: string; how: string }
  | { kind: 'started' }
  | { kind: 'assign' }
  | { kind: 'apply'; training: string }
  | { kind: 'applied'; requestId: string; why: string }
  | { kind: 'blocked'; why: string }

export function openAction(s: OpenShift, mayEdit: boolean): OpenAction {
  if (s.claimed_by) return { kind: 'taken', by: s.claimed_by, how: takenHow(s.claimed_via) }
  if (s.started) return { kind: 'started' }
  if (mayEdit) return { kind: 'assign' }
  const m = s.mine
  // no answer is not "no": say why there is no button
  if (!m) {
    return { kind: 'blocked', why: s.pool_state
      ? 'whether you may apply could not be worked out — try again in a minute'
      : 'this shift is not open for applications yet — it opens within the minute, and this screen shows it when it does' }
  }
  if (m.code === 'applied') return { kind: 'applied', requestId: m.request_id ?? '', why: m.why }
  if (m.may) return { kind: 'apply', training: m.ist && !m.ist.ok ? (m.ist.why || 'no IST for this house is on record') : '' }
  return { kind: 'blocked', why: m.why }
}

/* ── following one shift across screens and re-reads ────────────────────── */

/** Live-stream event name (snapshot_service.HOUSECAL_EVENT); carries nothing, screens re-read. */
export const HOUSECAL_LIVE_EVENT = 'housecal'

/** 'CAN - 48TH (B) - ABD1711' → 'ABD1711'; a bare code comes back as itself. */
export function houseCode(location: string): string {
  const parts = String(location ?? '').split(' - ')
  return (parts[parts.length - 1] ?? '').trim().toUpperCase()
}

/** 'CAN - 48TH (B) - ABD1711' → '48TH (B)', the house as people say it; a bare name comes back as itself. */
export function houseShort(location: string): string {
  const parts = String(location ?? '').split(' - ')
  return (parts.length >= 3 ? parts.slice(1, -1).join(' - ') : parts.length === 2 ? parts[1] : parts[0]).trim()
}

/** The rail's house for a link's location, code or short name (the old board's key), or ''. */
export function resolveHouse(houses: House[] | null | undefined, want: string): string {
  const w = String(want ?? '').trim()
  if (!w) return ''
  const list = houses ?? []
  if (list.some((h) => h.location === w)) return w
  const code = houseCode(w)
  const byCode = list.find((h) => houseCode(h.location) === code)?.location
  if (byCode) return byCode
  const short = w.toUpperCase()
  return list.find((h) => houseShort(h.location).toUpperCase() === short)?.location ?? ''
}

/** OPEN and WORKSHOP rows, and any row of a workshop house, are nobody (house_cal_live.not_a_person). */
export function notAPerson(name: string | null | undefined, location = ''): boolean {
  const low = String(name ?? '').trim().toLowerCase()
  return !low || /^open(?![a-z])/.test(low) || low.includes('workshop') || location.toLowerCase().includes('workshop')
}

/** A person's row by name key; OPEN and call-off lines are nobody's. */
export function rowNamed(rows: Row[], name: string): Row | undefined {
  return rows.find((r) => r.employee === name)
    ?? rows.find((r) => !r.open_row && sameName(r.employee, name))
}

/** The panel follows a pooled shift's handle, since call-off lines renumber on re-read. */
export function followTarget<T extends { employee: string; colIso: string; ref?: string }>(
  target: T | null, computed: Computed | null | undefined,
): T | null {
  if (!target?.ref) return target
  const s = openShiftByRef(computed, target.ref)
  if (!s || (s.open_row === target.employee && s.col_iso === target.colIso)) return target
  return { ...target, employee: s.open_row, colIso: s.col_iso }
}

/** Ms until the first open window closes (the screen re-reads then), or null. */
export function nextWindowClose(computed: Computed | null | undefined, nowMs: number): number | null {
  let best: number | null = null
  for (const s of computed?.open_shifts ?? []) {
    if (s.claimed_by || s.pool_state !== 'open' || !s.window?.closes_at) continue
    const at = Date.parse(s.window.closes_at)
    if (!Number.isFinite(at) || at <= nowMs) continue
    if (best === null || at - nowMs < best) best = at - nowMs
  }
  return best
}

/** The pooled call-off a punch-board row is about (same house, day, person), or none. */
export function matchCallOff(
  shifts: OpenShift[] | null | undefined, row: { house: string; day: string; person: string },
): OpenShift | undefined {
  const code = houseCode(row.house)
  return (shifts ?? []).find((s) => s.kind_of_open === 'call_off' && s.col_iso === row.day
    && houseCode(s.location) === code && sameName(s.called_off_by, row.person))
}

/** A punch-board call-off's link: its red cell, else the caller's own cell. */
export function linkForCallOff(
  shifts: OpenShift[] | null | undefined, row: { house: string; day: string; person: string },
): string {
  const hit = matchCallOff(shifts, row)
  return hit ? linkForShift(hit) : houseCalLink(row.house, { open: `${row.person}|${row.day}` })
}

/** Call-offs for tomorrow and later, nearest first. */
export function callOffsAhead(shifts: OpenShift[] | null | undefined, today: string): OpenShift[] {
  return (shifts ?? [])
    .filter((s) => s.kind_of_open === 'call_off' && s.col_iso > today)
    .sort((a, b) => a.col_iso.localeCompare(b.col_iso) || a.location.localeCompare(b.location)
      || String(a.starts_at ?? '').localeCompare(String(b.starts_at ?? '')))
}
