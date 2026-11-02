// Support Requests' doors: the list, one redirected request's seat and the two writes, each a literal Apps Script…
// The list is held in this tab's memory per Show completed, and kept for the account and the place it was read for…
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
import { gasAction } from '@/features/hiring/shared'
import { onMemoryBoundary } from '@/lib/appPack'
import { forgetKept, keep, keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { placeScope } from '@/lib/placeKey'
import { onLiveEvent } from '@/lib/snapshotClient'
import {
  answerRow, boardFrom, replaceRow, seatFrom, type Board, type DecideAnswer, type Row, type Seat, type Verdict,
} from './supportDeskModel'

/** Every action this screen and My Work's redirected requests call, as the backend declares them. */
export const SUPPORT_DESK_ACTIONS = ['supportDeskList', 'supportDeskDecide', 'supportDeskAdp', 'supportDeskSeat'] as const

/** The relay's ring after a Support Requests write landed (server/snapshot_service.py SUPPORT_DESK_EVENT). */
export const SUPPORT_DESK_LIVE_EVENT = 'support-desk'
/** Scheduling's rows are listed here too: its ring is heard as well. */
export const SUPPORT_DESK_SCHED_EVENT = 'scheduling'
/** So are Transportation's (server/snapshot_service.py _VIEWER_CACHE_RINGS). */
export const SUPPORT_DESK_VEHICLE_EVENT = 'vehicle-calendar'
/** A return to the tab reads the list again at most this often. */
export const DESK_FOCUS_GAP_MS = 20_000

type Held = { at: number; board: Board }
const held = new Map<string, Held>()
const inflight = new Map<string, Promise<Board>>()
const listeners = new Set<() => void>()
const rereaders = new Set<() => void>()
let crossings = 0
let writing = 0
let writesSent = 0
let owed = false

const keyOf = (completed: boolean) => (completed ? 'all' : 'open')

/* the kept copy: one per account, place and Show completed, and only ever drawn for that account at that place */
export const KEPT_DESK_PREFIX = 'asa:sdesk:list:'
type KeptDesk = { owner: string; board: Board }

function ownerNow(): string {
  const uid = useAuthStore.getState().user?.id ?? ''
  return uid ? placeScope(uid) : ''
}

const keptKeyOf = (owner: string, key: string) => `${KEPT_DESK_PREFIX}${owner}|${key}`

function keptBoard(key: string): Board | null {
  const owner = ownerNow()
  if (!owner) return null
  const got = readKept<KeptDesk>(keptKeyOf(owner, key))
  return got && got.owner === owner && got.board ? boardFrom(got.board) : null
}

function keepBoard(key: string, board: Board, generation?: string): void {
  const owner = ownerNow()
  if (!owner) return
  const copy: KeptDesk = { owner, board }
  if (generation === undefined) keep(keptKeyOf(owner, key), copy)
  else keepIfCurrent(keptKeyOf(owner, key), copy, generation)
}

/** Every kept list but the current owner's (all of them when nobody is signed in). */
function forgetOtherLists(): void {
  const owner = ownerNow()
  const mine = keptKeyOf(owner, '')
  const doomed: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(KEPT_DESK_PREFIX) && (!owner || !k.startsWith(mine))) doomed.push(k)
    }
  } catch { /* a shelf that cannot be walked: the owner check still refuses them */ }
  doomed.forEach(forgetKept)
}

onMemoryBoundary(() => {
  crossings++
  held.clear()
  inflight.clear()
  forgetOtherLists()
  for (const fn of [...listeners]) fn()
})

/** Tests only: forget what was held in memory (the kept copies stay, as a reload leaves them). */
export function forgetHeld(): void {
  held.clear()
  inflight.clear()
}

/** What is held, else its kept copy — drawn at once and never fresh, so it is read again behind. */
export function heldBoard(completed: boolean): Held | null {
  const key = keyOf(completed)
  const hit = held.get(key)
  if (hit) return hit
  const kept = keptBoard(key)
  if (!kept) return null
  const h: Held = { at: 0, board: kept }
  held.set(key, h)
  return h
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

// One read per Show completed at a time: completed rows only when asked for.
export function readBoard(completed: boolean): Promise<Board> {
  const key = keyOf(completed)
  const running = inflight.get(key)
  if (running) return running
  const asked = crossings
  const sent = writing ? -1 : writesSent
  const generation = keptGeneration()
  const p = gasAction<unknown>('supportDeskList', completed ? { completed: true } : {})
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
      held.set(key, { at: Date.now(), board })
      keepBoard(key, board, generation)
      return board
    })
    .finally(() => { if (inflight.get(key) === p) inflight.delete(key) })
  inflight.set(key, p)
  return p
}

/** A write on its way, counted while out: no list read lands until every write is back. */
function out<T>(sent: Promise<T>): Promise<T> {
  writing++
  writesSent++
  return sent.finally(() => {
    writing--
    if (!writing) settleWrites()
  })
}

const WRITE = { retry: false } as const

// A verdict on one row; Scheduling rows are answered by Scheduling's own door, behind this one.
export function decide(ref: string, verdict: Verdict, note = '', to = ''): Promise<DecideAnswer> {
  const n = note.trim()
  const t = verdict === 'redirect' ? to.trim() : ''
  return out(gasAction<DecideAnswer>('supportDeskDecide', { ref, verdict, ...(n ? { note: n } : {}), ...(t ? { to: t } : {}) }, WRITE))
}

/** One request redirected to this account, read for My Work's panel, with the people it may be redirected on to. */
export function readSeat(ref: string): Promise<Seat> {
  return gasAction<unknown>('supportDeskSeat', { ref }).then(seatFrom)
}

export type AdpOp = 'approve' | 'undo'

// The ADP change on one row; the server re-derives it and refuses when `proof` is no longer the one on file.
export function adpAct(ref: string, op: AdpOp, proof: string): Promise<DecideAnswer> {
  return out(gasAction<DecideAnswer>('supportDeskAdp', { ref, op, proof }, WRITE))
}

/** A row an answer carried, laid over every held list and its kept copy. */
export function absorbRow(row: Row): void {
  for (const [key, h] of held) {
    const board = replaceRow(h.board, row)
    held.set(key, { at: h.at, board })
    keepBoard(key, board)
  }
}

export type DeskState = {
  status: 'loading' | 'ready' | 'failed'
  board: Board | null
  /** why the last read failed; with a board, it is the last good answer that is drawn */
  error: string
  refreshing: boolean
}

export const DESK_LOADING: DeskState = { status: 'loading', board: null, error: '', refreshing: false }

// The list for Show completed on or off: held or kept, drawn at once, always read again behind it, and quietly on…
export function useSupportDesk(completed: boolean): DeskState & { reload: () => void; absorb: (a: DecideAnswer) => Row | null } {
  const [state, setState] = useState<DeskState & { key: boolean }>(() => {
    const first = heldBoard(completed)
    return { key: completed, status: first ? 'ready' : 'loading', board: first?.board ?? null, error: '', refreshing: false }
  })
  const [tick, setTick] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    const fn = () => {
      setState({ key: completed, ...DESK_LOADING })
      setTick((t) => t + 1)
    }
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [completed])

  // read again quietly: on the rings, when the stream comes back, on a return to the tab; never with a write out
  useEffect(() => {
    const reread = () => setTick((t) => t + 1)
    const quiet = () => {
      if (writing) owed = true
      else reread()
    }
    let lastFocus = Date.now()
    const onFocus = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastFocus < DESK_FOCUS_GAP_MS) return
      lastFocus = Date.now()
      quiet()
    }
    rereaders.add(reread)
    const offRing = onLiveEvent(SUPPORT_DESK_LIVE_EVENT, quiet)
    const offSched = onLiveEvent(SUPPORT_DESK_SCHED_EVENT, quiet)
    const offVehicle = onLiveEvent(SUPPORT_DESK_VEHICLE_EVENT, quiet)
    const offOpen = onLiveEvent('open', quiet)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      rereaders.delete(reread)
      offRing()
      offSched()
      offVehicle()
      offOpen()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  useEffect(() => {
    const mine = ++seq.current
    const hit = heldBoard(completed)
    setState((s) => (s.key === completed
      ? { ...s, status: s.board ? 'ready' : 'loading', refreshing: true }
      : { key: completed, status: hit ? 'ready' : 'loading', board: hit?.board ?? null, error: '', refreshing: true }))
    readBoard(completed)
      .then((board) => { if (mine === seq.current) setState({ key: completed, status: 'ready', board, error: '', refreshing: false }) })
      .catch((err: unknown) => {
        if (mine !== seq.current) return
        const error = (err instanceof Error ? err.message : String(err)) || 'no answer'
        setState((s) => ({ ...s, key: completed, status: s.board && s.key === completed ? 'ready' : 'failed', error, refreshing: false }))
      })
  }, [completed, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  const absorb = useCallback((a: DecideAnswer) => {
    const row = answerRow(a)
    if (!row) return null
    absorbRow(row)
    setState((s) => (s.board ? { ...s, board: replaceRow(s.board, row) } : s))
    return row
  }, [])

  const shown = state.key === completed ? state : { ...DESK_LOADING, board: heldBoard(completed)?.board ?? null }
  return { status: shown.board && shown.status === 'loading' ? 'ready' : shown.status, board: shown.board, error: shown.error, refreshing: shown.refreshing, reload, absorb }
}
