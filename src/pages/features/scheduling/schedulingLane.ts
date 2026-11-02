// Scheduling's doors: the board read and every write, each a literal Apps Script action (Scheduling.gs…
// The board is held in this tab's memory per period, and kept for the account and the place it was read for…
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
import { gasAction } from '@/features/hiring/shared'
import { onMemoryBoundary } from '@/lib/appPack'
import { forgetKept, keep, keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { placeScope } from '@/lib/placeKey'
import { onLiveEvent } from '@/lib/snapshotClient'
import { boardFrom, mergeWrite, previewFrom, type Badges, type Board, type FlowRef, type WriteAnswer } from './schedulingModel'
import { builderFrom, type Draft, type SaveAnswer } from './builderModel'
import type { ApprovedFacts } from '@/pages/features/timeoff/approvedModel'

/** Every action this screen calls, as the backend declares them. */
export const SCHEDULING_ACTIONS = [
  'schedulingBoard', 'schedulingCellSave', 'schedulingAddPerson', 'schedulingUndo', 'schedulingCallOff',
  'schedulingRequestOff', 'schedulingTimeOff', 'schedulingSwapPropose', 'schedulingTake', 'schedulingWithdraw',
  'schedulingAnswer', 'schedulingSettingsSet', 'schedulingSeed', 'schedulingRoll',
  'schedulingStaffShifts', 'schedulingTimeOffList', 'schedulingTimeOffImport',
  'schedulingBuilderRead', 'schedulingBuilderSave', 'schedulingBuilderPublish',
] as const

/** The relay's ring after a Scheduling write landed (server/snapshot_service.py SCHEDULING_EVENT). */
export const SCHEDULING_LIVE_EVENT = 'scheduling'

/* ---------- the board, held and kept ---------- */

export const BOARD_FRESH_MS = 60_000
/** A return to the tab reads the board again at most this often. */
export const BOARD_FOCUS_GAP_MS = 20_000

/** `alias`: the current period's board under its own id too — kept once, under 'current'. */
type Held = { at: number; board: Board; alias?: boolean }
const held = new Map<string, Held>()
const inflight = new Map<string, Promise<Board>>()
const listeners = new Set<() => void>()
const rereaders = new Set<() => void>()
let crossings = 0
let writing = 0
let writesSent = 0
let owed = false

const keyOf = (periodId: string) => periodId || 'current'

/* the kept copy: one per account, place and period, and only ever drawn for that account at that place */
export const KEPT_BOARD_PREFIX = 'asa:sched:board:'
type KeptBoard = { owner: string; board: Board }
/* the screens beside the calendars (Staff Calendars, Time Off Requests): held and kept the same way, per view */
export const KEPT_VIEW_PREFIX = 'asa:sched:view:'
type KeptView = { owner: string; data: unknown }
type ViewHeld = { at: number; data: unknown }
const viewHeld = new Map<string, ViewHeld>()
const viewInflight = new Map<string, Promise<unknown>>()

function ownerNow(): string {
  const uid = useAuthStore.getState().user?.id ?? ''
  return uid ? placeScope(uid) : ''
}

const keptKeyOf = (owner: string, key: string) => `${KEPT_BOARD_PREFIX}${owner}|${key}`

function keptBoard(key: string): Board | null {
  const owner = ownerNow()
  if (!owner) return null
  const got = readKept<KeptBoard>(keptKeyOf(owner, key))
  return got && got.owner === owner && got.board ? boardFrom(got.board) : null
}

function keepBoard(key: string, board: Board, generation?: string): void {
  const owner = ownerNow()
  if (!owner) return
  const copy: KeptBoard = { owner, board }
  if (generation === undefined) keep(keptKeyOf(owner, key), copy)
  else keepIfCurrent(keptKeyOf(owner, key), copy, generation)
}

/** Every kept copy under the prefix but the current owner's (all of them when nobody is signed in). */
function forgetOthers(prefix: string): void {
  const owner = ownerNow()
  const mine = `${prefix}${owner}|`
  const doomed: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(prefix) && (!owner || !k.startsWith(mine))) doomed.push(k)
    }
  } catch { /* a shelf that cannot be walked: the owner check still refuses them */ }
  doomed.forEach(forgetKept)
}

onMemoryBoundary(() => {
  crossings++
  held.clear()
  inflight.clear()
  viewHeld.clear()
  viewInflight.clear()
  forgetOthers(KEPT_BOARD_PREFIX)
  forgetOthers(KEPT_VIEW_PREFIX)
  for (const fn of [...listeners]) fn()
})

/** The boards this tab holds in memory, dropped as a reload drops them; the kept copies stay. */
export function forgetHeldBoards(): void {
  held.clear()
  inflight.clear()
}

/** What is held for the period, else its kept copy — drawn at once and never fresh, so it is read again behind. */
export function heldBoard(periodId = ''): Held | null {
  const key = keyOf(periodId)
  const hit = held.get(key)
  if (hit) return hit
  const kept = keptBoard(key)
  if (!kept) return null
  const h: Held = { at: 0, board: kept }
  held.set(key, h)
  return h
}

/** Keeps a board for the period (and for the current one, when it is that). */
export function holdBoard(board: Board, periodId = '', generation?: string): void {
  const at = Date.now()
  const key = keyOf(periodId)
  held.set(key, { at, board })
  if (!periodId && board.period.id) held.set(board.period.id, { at, board, alias: true })
  keepBoard(key, board, generation)
}

/** A read owed to every screen once no write is out. */
function oweReread(): void {
  owed = true
  if (!writing) settleWrites()
}

function settleWrites(): void {
  if (!owed) return
  owed = false
  for (const fn of [...rereaders]) fn()
}

// One read per period at a time; an answer asked for before a memory boundary is never held after it, and one asked…
export function readBoard(periodId = ''): Promise<Board> {
  const key = keyOf(periodId)
  const running = inflight.get(key)
  if (running) return running
  const asked = crossings
  const sent = writing ? -1 : writesSent
  const generation = keptGeneration()
  const p = gasAction<unknown>('schedulingBoard', periodId ? { period_id: periodId } : {})
    .then((raw) => {
      const board = boardFrom(raw)
      if (asked !== crossings) return board
      const h = held.get(key)
      if (sent !== writesSent && h) {
        // the owed read is a new one, never this one again
        if (inflight.get(key) === p) inflight.delete(key)
        oweReread()
        return h.board
      }
      holdBoard(board, periodId, generation)
      return board
    })
    .finally(() => { if (inflight.get(key) === p) inflight.delete(key) })
  inflight.set(key, p)
  return p
}

/** A write's answer laid over every held board of its period, and over its kept copy. */
export function absorbWrite(answer: WriteAnswer): void {
  for (const [key, h] of held) {
    if (key === 'current' ? h.board.period.id === answer.period_id || !answer.period_id : key === answer.period_id) {
      const board = mergeWrite(h.board, answer)
      held.set(key, { ...h, board })
      if (!h.alias) keepBoard(key, board)
    }
  }
}

export type BoardState = {
  status: 'loading' | 'ready' | 'failed'
  board: Board | null
  error: string
  refreshing: boolean
}

// The board for a period ('' = the current one): held or kept, drawn at once, and read again behind it past fresh…
export function useSchedulingBoard(periodId: string): BoardState & { reload: () => void; absorb: (a: WriteAnswer) => void } {
  const [state, setState] = useState<BoardState & { key: string }>(() => {
    const first = heldBoard(periodId)
    return { key: periodId, status: first ? 'ready' : 'loading', board: first?.board ?? null, error: '', refreshing: false }
  })
  const [tick, setTick] = useState(0)
  const handled = useRef(0)

  useEffect(() => {
    const fn = () => {
      setState({ key: periodId, status: 'loading', board: null, error: '', refreshing: false })
      setTick((t) => t + 1)
    }
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [periodId])

  // read again quietly: on the ring, when the stream comes back, on a return to the tab; never with a write out
  useEffect(() => {
    const reread = () => setTick((t) => t + 1)
    const quiet = () => {
      if (writing) owed = true
      else reread()
    }
    let lastFocus = Date.now()
    const onFocus = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastFocus < BOARD_FOCUS_GAP_MS) return
      lastFocus = Date.now()
      quiet()
    }
    rereaders.add(reread)
    const offRing = onLiveEvent(SCHEDULING_LIVE_EVENT, quiet)
    const offOpen = onLiveEvent('open', quiet)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      rereaders.delete(reread)
      offRing()
      offOpen()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  useEffect(() => {
    const forced = tick !== handled.current
    handled.current = tick
    const hit = heldBoard(periodId)
    if (hit) setState((s) => (s.key === periodId && s.board === hit.board ? s
      : { key: periodId, status: 'ready', board: hit.board, error: '', refreshing: false }))
    if (hit && !forced && Date.now() - hit.at < BOARD_FRESH_MS) return
    // another period's board is never drawn under this one
    setState((s) => (s.key === periodId ? { ...s, refreshing: Boolean(s.board) }
      : { key: periodId, status: 'loading', board: null, error: '', refreshing: false }))
    let live = true
    readBoard(periodId)
      .then((board) => { if (live) setState({ key: periodId, status: 'ready', board, error: '', refreshing: false }) })
      .catch((err: unknown) => {
        if (!live) return
        const error = err instanceof Error ? err.message : String(err)
        // a board already drawn stays, and says it could not be read again
        setState((s) => ({ ...s, key: periodId, status: s.board && s.key === periodId ? 'ready' : 'failed', error, refreshing: false }))
      })
    return () => { live = false }
  }, [periodId, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  const absorb = useCallback((a: WriteAnswer) => {
    absorbWrite(a)
    setState((s) => (s.board ? { ...s, board: mergeWrite(s.board, a) } : s))
  }, [])

  const shown = state.key === periodId ? state : { key: periodId, status: 'loading' as const, board: null, error: '', refreshing: false }
  return { status: shown.status, board: shown.board, error: shown.error, refreshing: shown.refreshing, reload, absorb }
}

/* ---------- the writes (lane tool: the answer re-reads the houses touched) ---------- */

const WRITE = { retry: false } as const

/** A write on its way, counted while out: no board read starts until every write is back. */
function out<T>(sent: Promise<T>): Promise<T> {
  writing++
  writesSent++
  return sent.finally(() => {
    writing--
    if (!writing) settleWrites()
  })
}

// `open_row_id` gives that OPEN row's shift to the person, in one write (the OPEN cell cleared with it);
// `from_row_id` gives a person's shift to another of the house's staff the same way (their own shift cleared with it).
export type CellSave = {
  house: string; row_id?: string; person?: string; date: string; value?: string; note?: string
  via: 'add' | 'edit' | 'delete'; open_row_id?: string; from_row_id?: string; cancel_pending?: boolean; override?: boolean
  /** an edition holder's witness, the cell's text as the panel showed it: Python's door refuses a cell changed since */
  seen?: string
}

/** A write refused only because Staff Preferences speak against it: the reason; '' for any other refusal. */
export function prefsReasonOf(err: unknown): string {
  const env = (err as { envelope?: { data?: { needs_override?: boolean; reason?: string } } } | null)?.envelope
  return env?.data?.needs_override ? String(env.data.reason || 'Staff Preferences speak against this.') : ''
}

const over = (override: boolean) => (override ? { override: true } : {})

export const saveCell = (p: CellSave) => out(gasAction<WriteAnswer>('schedulingCellSave', p, WRITE))

/** A shift dragged on another cell of the same house (schedulingCellSave, via move). */
export type MoveAt = { house: string; from_row_id: string; from_date: string; to_row_id: string; to_date: string }
/** What the drop would do, worked out by the server; nothing is written. */
export const previewMove = (at: MoveAt) =>
  gasAction<unknown>('schedulingCellSave', { ...at, via: 'move', preview: true }, WRITE).then(previewFrom)
/** The drop written at once, auto-approved; `seen_*` are the cells as the preview read them. */
export const moveShift = (at: MoveAt, seen: { seen_from: string; seen_to: string }, override = false) =>
  out(gasAction<WriteAnswer>('schedulingCellSave', { ...at, via: 'move', ...seen, ...over(override) }, WRITE))
export const addPerson = (house: string, person: string, override = false) =>
  out(gasAction<WriteAnswer>('schedulingAddPerson', { house, person, ...over(override) }, WRITE))
export const undoLast = (house: string) => out(gasAction<WriteAnswer>('schedulingUndo', { house }, WRITE))

export type ShiftAt = { house: string; row_id: string; date: string }

export const callOff = (at: ShiftAt, reason = '') =>
  out(gasAction<WriteAnswer>('schedulingCallOff', { ...at, ...(reason ? { reason } : {}) }, WRITE))
export const requestOff = (at: ShiftAt, note = '') =>
  out(gasAction<WriteAnswer>('schedulingRequestOff', { ...at, ...(note ? { note } : {}) }, WRITE))
export const timeOff = (from: string, to: string, reason = '') =>
  out(gasAction<WriteAnswer>('schedulingTimeOff', { from, to, ...(reason ? { reason } : {}) }, WRITE))
export const proposeSwap = (at: ShiftAt, replacement: string, note = '', override = false) =>
  out(gasAction<WriteAnswer>('schedulingSwapPropose', { ...at, replacement, ...(note ? { note } : {}), ...over(override) }, WRITE))
/** The two-shift exchange: `at` is given, `partner` (somebody else's shift, at any house) comes back. */
export const proposeExchange = (at: ShiftAt, partner: ShiftAt, note = '', override = false) =>
  out(gasAction<WriteAnswer>('schedulingSwapPropose', {
    ...at, partner_house: partner.house, partner_row_id: partner.row_id, partner_date: partner.date, ...(note ? { note } : {}),
    ...over(override),
  }, WRITE))
export const takeShift = (at: ShiftAt, override = false) =>
  out(gasAction<WriteAnswer>('schedulingTake', { ...at, ...over(override) }, WRITE))
export const withdrawFlow = (flowId: string) => out(gasAction<WriteAnswer>('schedulingWithdraw', { flow_id: flowId }, WRITE))

export type AnswerWord = 'approve' | 'decline' | 'seen'
export type AnswerSaid = { ok: boolean; said: string; state?: string; changed?: boolean }

export const answerItem = (itemId: string, word: AnswerWord, note = '') =>
  out(gasAction<AnswerSaid>('schedulingAnswer', { item_id: itemId, word, ...(note ? { note } : {}) }, WRITE))

/* ---------- the master's setup ---------- */

export type SetupReport = { ok: boolean; dry_run: boolean; report: unknown }

/** `seen`: the settings edition's witness, each changed value as the panel showed it; Python's door refuses a moved one. */
export const setSettings = (values: Record<string, string>, seen: Record<string, string> = {}) =>
  out(gasAction<{ ok: boolean; settings: unknown }>('schedulingSettingsSet',
    { values, ...(Object.keys(seen).length ? { seen } : {}) }, WRITE))
export const seedCalendars = (dryRun: boolean, first = '', last = '') =>
  out(gasAction<SetupReport>('schedulingSeed', { dry_run: dryRun, ...(first ? { first } : {}), ...(last ? { last } : {}) }, WRITE))
/** A real roll names the period its dry run copied (`from`): pressed twice, or sent twice, it rolls once. */
export const rollForward = (dryRun: boolean, from = '') =>
  out(gasAction<SetupReport>('schedulingRoll', { dry_run: dryRun, ...(from ? { from } : {}) }, WRITE))

/** One Time Off house request as the carry-over reads it (Scheduling.gs schedulingTimeOffImport). */
export type TimeOffImportLine = {
  ref: string; person: string; status: string; from: string; to: string; houses: string[]; houses_unknown: string[]
  matched: string; as: '' | 'approved' | 'waiting'
  outcome: 'would_import' | 'imported' | 'already_imported' | 'unmatched' | 'skipped'
  why: string; conflicts: string[]; flow_id?: string
}
export type TimeOffImportReport = {
  ok: boolean; dry_run: boolean; said: string
  report: {
    counts: {
      rows: number; by_status: Record<string, number>; imported: number; approved: number; waiting: number
      already_imported: number; unmatched: number; skipped: number; with_conflicts: number
    }
    lines: TimeOffImportLine[]
  }
}

/** The Time Off house's approved and pending requests carried into Scheduling; a dry run unless `apply`. */
export const importTimeOff = (apply: boolean) =>
  out(gasAction<TimeOffImportReport>('schedulingTimeOffImport', { apply }, WRITE))

/** The period a roll report copied from. */
export function rolledFrom(report: unknown): string {
  const r = report && typeof report === 'object' ? report as { from?: { id?: unknown } } : {}
  return typeof r.from?.id === 'string' ? r.from.id : ''
}

/* ---------- the screens beside the calendars (SchedulingViews.gs) ---------- */

/** One shift of Staff Calendars: a grid cell as the board cuts it, with where and when it is. */
export type StaffShift = {
  period_id: string; house_code: string; row_id: string; date: string; text: string; kind: string; state: string
  start?: number; end?: number; flow?: FlowRef; time_off?: 'asked' | 'approved'
  /** absent while hours are hidden from this viewer */
  hours?: number
  /** the row's badges at that house */
  badges?: Badges
}
/** A house Staff's Calendar section names: `clients` null when they could not be read. */
export type StaffShiftHouse = { code: string; short: string; location: string; clients: string[] | null }
export type StaffShifts = {
  ok: true; today: string; person: string; name: string; anyone: boolean
  periods: { id: string; first: string; last: string }[]; shifts: StaffShift[]
  /** only on Staff's read */
  houses?: StaffShiftHouse[]
  /** Staff Calendars, to a viewer who chooses anybody: the board's people Staff's roster holds as active staff (null
   *  when the roster could not be read, with why; why also says when the list may be short) */
  active_staff?: string[] | null
  active_staff_why?: string
}
/** One seat of an ask: whom it waits on, and who answered, when and with what words (`note` only where the reason goes). */
export type AskSeat = { seat: string; state: string; by: string; at: string; note: string; why: string; asked: string[] }
/** A time-off or Request Off ask. `item`: the decision waiting on this viewer's own seat; `reason` only to who may read it. */
export type TimeOffAsk = {
  id: string; kind: 'time_off' | 'request_off'; state: string; person: string; house_code: string; house_label: string
  from: string; to: string; days: number; shift_text: string; requested_at: string; decided_by: string; decided_at: string
  own: boolean; ended: boolean; reason?: string
  item?: { id: string; title: string; body: string; test_mode: string | boolean; created_at: string }
  houses?: { code: string; label: string }[]
  filed_by?: string
  filed_via?: string
  seats?: AskSeat[]
  /** the person's shifts on those days that are still theirs */
  holds?: { date: string; house_code: string; house_label: string; text: string }[]
  /** the shifts approval already put up as open shifts */
  applied?: { date: string; house_label: string }[]
  /** days past the last period, applied when the roll makes it */
  future_days?: number
  /** an approved time off's Edit: whoever answers a time off (master, listed director, Time off approvals), never its person */
  may_edit?: boolean
  /** an approved time off's panel: its shifts and the person's approved days that year (app/time_off_approved.py) */
  approved?: ApprovedFacts
}
export type TimeOffList = {
  ok: true; today: string; past: boolean; pending: TimeOffAsk[]; approved: TimeOffAsk[]; past_hidden: number; sees_all: boolean
}

/** `person`: a person key, 'open', or '' for the viewer. */
export const readStaffShifts = (person: string) =>
  gasAction<StaffShifts>('schedulingStaffShifts', person ? { person } : {})
/** Staff's Calendar section: one staff member's shifts, for any viewer Staff shows whole. */
export const readStaffCalendar = (person: string) =>
  gasAction<StaffShifts>('schedulingStaffShifts', { person, via: 'staff' })
export const readTimeOffList = (past: boolean) =>
  gasAction<TimeOffList>('schedulingTimeOffList', past ? { past: true } : {})

/* ---------- the Builder (SchedulingBuilder.gs) ---------- */

/** The draft for a house and first Monday ('' = the server's pick), and what its checks read. */
export const readBuilder = (house: string, first: string, last: string) =>
  gasAction<unknown>('schedulingBuilderRead', {
    ...(house ? { house } : {}), ...(first ? { first } : {}), ...(last ? { last } : {}),
  }).then(builderFrom)

export type BuilderSave = { house: string; first: string; last: string; draft: Draft; state: 'pattern' | 'approved'; rev: string }
export const saveBuilder = (p: BuilderSave) => out(gasAction<SaveAnswer>('schedulingBuilderSave', p, WRITE))

export type PublishReport = {
  written: number; cleared: number; skipped_count: number; period_added: string
  skipped: { name: string; date: string; text: string; why: string }[]
}
export const publishBuilder = (house: string, first: string, rev: number) =>
  out(gasAction<WriteAnswer & { builder?: PublishReport }>('schedulingBuilderPublish', { house, first, rev: String(rev) }, WRITE))

/** The Builder's read, held and kept as the other screens' are. */
export const builderKey = (house: string, first: string, last: string) => `builder|${house}|${first}|${last}`

const keptViewKeyOf = (owner: string, key: string) => `${KEPT_VIEW_PREFIX}${owner}|${key}`

/** What is held for a view, else its kept copy — drawn at once and never fresh, so it is read again behind. */
export function heldView<T>(key: string): { at: number; data: T } | null {
  const hit = viewHeld.get(key)
  if (hit) return hit as { at: number; data: T }
  const owner = ownerNow()
  if (!owner) return null
  const got = readKept<KeptView>(keptViewKeyOf(owner, key))
  if (!got || got.owner !== owner || got.data === null || got.data === undefined) return null
  const h: ViewHeld = { at: 0, data: got.data }
  viewHeld.set(key, h)
  return h as { at: number; data: T }
}

function holdView(key: string, data: unknown, generation: string): void {
  viewHeld.set(key, { at: Date.now(), data })
  const owner = ownerNow()
  if (owner) keepIfCurrent(keptViewKeyOf(owner, key), { owner, data } satisfies KeptView, generation)
}

// One read per view at a time; an answer asked for before a memory boundary is never held after it, and one asked…
function readView<T>(key: string, read: () => Promise<T>): Promise<T> {
  const running = viewInflight.get(key)
  if (running) return running as Promise<T>
  const asked = crossings
  const sent = writing ? -1 : writesSent
  const generation = keptGeneration()
  const p: Promise<T> = read()
    .then((data) => {
      if (asked !== crossings) return data
      const h = viewHeld.get(key)
      if (sent !== writesSent && h) {
        // the owed read is a new one, never this one again
        if (viewInflight.get(key) === p) viewInflight.delete(key)
        oweReread()
        return h.data as T
      }
      holdView(key, data, generation)
      return data
    })
    .finally(() => { if (viewInflight.get(key) === p) viewInflight.delete(key) })
  viewInflight.set(key, p)
  return p
}

/** What `from` holds, held under `to` too when it asks for the same (the server's own pick, named); never over a newer one. */
export function holdViewAs(from: string, to: string): void {
  const h = viewHeld.get(from)
  const t = viewHeld.get(to)
  if (!h || from === to || (t && t.at >= h.at)) return
  viewHeld.set(to, { ...h })
  const owner = ownerNow()
  if (owner) keepIfCurrent(keptViewKeyOf(owner, to), { owner, data: h.data } satisfies KeptView, keptGeneration())
}

/** The views this tab holds in memory, dropped as a reload drops them; the kept copies stay. */
export function forgetHeldViews(): void {
  viewHeld.clear()
  viewInflight.clear()
}

export type ViewRead<T> = { data: T | null; status: 'loading' | 'ready' | 'failed'; error: string; reload: () => void }

// A screen's read: held or kept, drawn at once — after a reload too — and read again behind it past fresh, on the…
export function useSchedulingRead<T>(key: string, read: () => Promise<T>, tick = 0): ViewRead<T> {
  const [state, setState] = useState<{ key: string; data: T | null; status: ViewRead<T>['status']; error: string }>(() => {
    const hit = heldView<T>(key)
    return { key, data: hit?.data ?? null, status: hit ? 'ready' : 'loading', error: '' }
  })
  const [again, setAgain] = useState(0)
  const reader = useRef(read)
  reader.current = read
  const handled = useRef({ again: 0, tick })

  useEffect(() => {
    const reread = () => setAgain((n) => n + 1)
    const quiet = () => {
      if (writing) owed = true
      else reread()
    }
    let lastFocus = Date.now()
    const onFocus = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastFocus < BOARD_FOCUS_GAP_MS) return
      lastFocus = Date.now()
      quiet()
    }
    rereaders.add(reread)
    const offRing = onLiveEvent(SCHEDULING_LIVE_EVENT, quiet)
    const offOpen = onLiveEvent('open', quiet)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      rereaders.delete(reread)
      offRing()
      offOpen()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  useEffect(() => {
    const forced = again !== handled.current.again || tick !== handled.current.tick
    handled.current = { again, tick }
    let live = true
    const hit = heldView<T>(key)
    setState((s) => (s.key === key ? s : { key, data: hit?.data ?? null, status: hit ? 'ready' : 'loading', error: '' }))
    if (hit && !forced && Date.now() - hit.at < BOARD_FRESH_MS) return
    // an answer asked for before a memory boundary is never drawn after it
    const asked = crossings
    readView(key, reader.current)
      .then((data) => { if (live && asked === crossings) setState({ key, data, status: 'ready', error: '' }) })
      .catch((err: unknown) => {
        if (!live || asked !== crossings) return
        const error = saidOf(err)
        // what is drawn stays, and says it could not be read again
        setState((s) => ({ ...s, key, status: s.key === key && s.data ? 'ready' : 'failed', error }))
      })
    return () => { live = false }
  }, [key, again, tick])

  const reload = useCallback(() => setAgain((n) => n + 1), [])
  // another key draws what is held for it on the same frame
  const held = state.key === key ? null : heldView<T>(key)
  const shown = state.key === key ? state
    : { key, data: held?.data ?? null, status: held ? 'ready' as const : 'loading' as const, error: '' }
  return { data: shown.data, status: shown.status, error: shown.error, reload }
}

export type ReadJob = { key: string; read: () => Promise<unknown> }
const READ_AHEAD_SLOTS = 2
const READ_AHEAD_QUIET_MS = 15_000

/** Reads `jobs` in the background, a few at a time, each held as its screen's own read holds it; fresh ones are skipped unless `again`. */
function readAhead(jobs: ReadJob[], again: boolean): () => void {
  let stopped = false
  const asked = crossings
  const queue = jobs.filter(({ key }) => {
    const h = heldView(key)
    return again || !h || Date.now() - h.at >= BOARD_FRESH_MS
  })
  const next = (): Promise<void> => {
    const job = queue.shift()
    if (!job || stopped || asked !== crossings) return Promise.resolve()
    return readView(job.key, job.read).then(() => undefined, () => undefined).then(next)
  }
  for (let i = 0; i < READ_AHEAD_SLOTS; i++) void next()
  return () => { stopped = true }
}

// The views a screen may switch to, read ahead when it opens and again once the `scheduling` ring (or the stream…
export function useReadAhead(jobs: ReadJob[], skip = ''): void {
  const ref = useRef({ jobs, skip })
  ref.current = { jobs, skip }
  const sig = jobs.map((j) => j.key).join('\n')
  useEffect(() => {
    if (!sig) return
    const pending = () => ref.current.jobs.filter((j) => j.key !== ref.current.skip)
    let stop = readAhead(pending(), false)
    let quiet: ReturnType<typeof setTimeout> | undefined
    const again = () => {
      clearTimeout(quiet)
      quiet = setTimeout(() => { stop(); stop = readAhead(pending(), true) }, READ_AHEAD_QUIET_MS)
    }
    const offRing = onLiveEvent(SCHEDULING_LIVE_EVENT, again)
    const offOpen = onLiveEvent('open', again)
    return () => { stop(); offRing(); offOpen(); clearTimeout(quiet) }
  }, [sig])
}

/** A refusal's sentence, as the panel shows it. */
export const saidOf =(err: unknown): string => (err instanceof Error ? err.message : String(err)) || 'Try again.'
