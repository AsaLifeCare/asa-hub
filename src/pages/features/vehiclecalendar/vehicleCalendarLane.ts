// Transportation's doors: the board read and every write, each a literal Apps Script action (VehicleCalendar.gs…
// The board paints at once from what is held — this tab's memory, else the copy kept for this account at this place…
import { useCallback, useEffect, useRef, useState } from 'react'
import { gasAction, isRelayReceipt } from '@/features/hiring/shared'
import { onMemoryBoundary } from '@/lib/appPack'
import { EDITION_ROLES } from '@/lib/editions'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { forgetKept, keep, keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { placeScope } from '@/lib/placeKey'
import { safeLocalStorage } from '@/lib/safeStorage'
import { onLiveEvent } from '@/lib/snapshotClient'
import { useAuthStore } from '@/auth/useAuthStore'
import { TRANSPORT_EDITION_IDS, boardFrom, writeFrom, type Board, type WriteAnswer } from './vehicleCalendarModel'

/** Every action this screen calls, as the backend declares them. */
export const VEHICLE_CALENDAR_ACTIONS = [
  'vehicleCalendarBoard', 'vehicleCalendarRequest', 'vehicleCalendarAnswer', 'vehicleCalendarWithdraw',
  'vehicleCalendarTripSave', 'vehicleCalendarVehicleSave', 'vehicleCalendarSettingsSet', 'vehicleCalendarSeed',
  'vehicleCalendarImport', 'vehicleCalendarClientTrips', 'vehicleCalendarStaffTrips',
] as const

/** The name the relay rings after each of this app's writes. */
export const VEHICLE_CALENDAR_EVENT = 'vehicle-calendar'
/** The app's id, as Settings › Editions files its editions. */
export const VEHICLE_CALENDAR_APP = 'vehicle-calendar'

export const KEPT_VEHICLE_PREFIX = 'asa:vcal:board:'
/** A kept copy older than this is not painted (the relay keeps its own as long). */
export const KEPT_MS = 6 * 3_600_000
/** Coming back into view reads again at most this often. */
export const FOCUS_GAP_MS = 5_000

/* ---------- whose board ---------- */

/** The account the board is cut for, at the place it is read in: a visit, a tenant and a world are each their own. */
export function ownerKey(): string {
  const me = String(useAuthStore.getState().user?.id ?? '')
  return me ? placeScope(me) : ''
}

const keptKeyOf = (owner: string) => `${KEPT_VEHICLE_PREFIX}${owner}`

/* ---------- the board, held ---------- */

type Held = { board: Board; at: number; owner: string }
type KeptVehicle = { owner: string; at: number; board: Board }
let held: Held | null = null
let inflight: Promise<Board> | null = null
let crossings = 0
let writing = 0
let writesSent = 0
let owed = false
const listeners = new Set<() => void>()
const rereaders = new Set<() => void>()

/** The copies this lane once kept on the shelf itself, under its old name: taken off. */
const RETIRED_PREFIX = 'asa-vehicle-calendar:board:'
function retireShelfCopies(): void {
  const doomed: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(RETIRED_PREFIX)) doomed.push(k)
    }
  } catch { /* no shelf, nothing on it */ }
  for (const k of doomed) safeLocalStorage.removeItem(k)
}
retireShelfCopies()

/** Every kept board but the current owner's (all of them when nobody is signed in). */
function forgetOtherBoards(): void {
  const owner = ownerKey()
  const doomed: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(KEPT_VEHICLE_PREFIX) && (!owner || k !== keptKeyOf(owner))) doomed.push(k)
    }
  } catch { /* a shelf that cannot be walked: the owner check still refuses them */ }
  doomed.forEach(forgetKept)
}

/** Drops the board from memory, and every kept board but the current owner's. */
export function forgetBoards(): void {
  crossings++
  held = null
  inflight = null
  forgetOtherBoards()
  retireShelfCopies()
  for (const fn of [...listeners]) fn()
}

onMemoryBoundary(forgetBoards)

/** This account's kept copy at this place, when it is its own and young enough. */
export function keptBoard(owner: string, now = Date.now()): Held | null {
  if (!owner) return null
  try {
    const o = readKept<KeptVehicle>(keptKeyOf(owner))
    if (!o || o.owner !== owner || typeof o.at !== 'number' || now - o.at > KEPT_MS || now < o.at - 60_000) return null
    return { board: boardFrom(o.board), at: o.at, owner }
  } catch {
    return null
  }
}

/** What paints first: memory when it is this owner's, else this owner's kept copy. */
export function heldBoard(owner = ownerKey()): Held | null {
  if (held && held.owner === owner) return held
  const kept = keptBoard(owner)
  if (kept) held = kept
  return kept
}

/** Keeps a board in memory and as this owner's copy; `generation`: a read's, which keeps nothing past a forget. */
export function holdBoard(board: Board, owner = ownerKey(), at = Date.now(), generation?: string): void {
  if (!owner) return
  held = { board, at, owner }
  const copy: KeptVehicle = { owner, at, board }
  if (generation === undefined) keep(keptKeyOf(owner), copy)
  else keepIfCurrent(keptKeyOf(owner), copy, generation)
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

// One read at a time; an answer asked for before a memory boundary is never held after it, and one asked for while…
export function readBoard(): Promise<Board> {
  if (inflight) return inflight
  const asked = crossings
  const owner = ownerKey()
  const sent = writing ? -1 : writesSent
  const generation = keptGeneration()
  const p = gasAction<unknown>('vehicleCalendarBoard', {})
    .then((raw) => {
      const board = boardFrom(raw)
      if (asked !== crossings) return board
      if (sent !== writesSent && held && held.owner === owner) {
        // the owed read is a new one, never this one again
        if (inflight === p) inflight = null
        oweReread()
        return held.board
      }
      holdBoard(board, owner, Date.now(), generation)
      return board
    })
    .finally(() => { if (inflight === p) inflight = null })
  inflight = p
  return p
}

/** A write's fresh board replaces what is held. */
export function absorbWrite(answer: WriteAnswer): void {
  if (answer.board) holdBoard(answer.board)
}

export type BoardState = {
  status: 'loading' | 'ready' | 'failed'
  board: Board | null
  error: string
  refreshing: boolean
}

// The board: painted at once from what is held, read again quietly on mount, on the app's live event, on the…
export function useVehicleBoard(): BoardState & { reload: () => void; absorb: (a: WriteAnswer) => void } {
  const [state, setState] = useState<BoardState>(() => {
    const first = heldBoard()
    return { status: first ? 'ready' : 'loading', board: first?.board ?? null, error: '', refreshing: Boolean(first) }
  })
  const lastRead = useRef(0)
  const live = useRef(true)

  const read = useCallback(() => {
    lastRead.current = Date.now()
    // an answer asked for before a memory boundary is never drawn after it
    const asked = crossings
    setState((s) => (s.board ? { ...s, refreshing: true } : { ...s, status: 'loading', error: '' }))
    readBoard()
      .then((board) => { if (live.current && asked === crossings) setState({ status: 'ready', board, error: '', refreshing: false }) })
      .catch((err: unknown) => {
        if (!live.current || asked !== crossings) return
        const error = err instanceof Error ? err.message : String(err)
        setState((s) => ({ ...s, status: s.board ? 'ready' : 'failed', error: error || 'the server did not answer', refreshing: false }))
      })
  }, [])

  useEffect(() => {
    live.current = true
    read()
    const quiet = () => {
      if (writing) owed = true
      else read()
    }
    rereaders.add(read)
    const offRing = onLiveEvent(VEHICLE_CALENDAR_EVENT, quiet)
    const offOpen = onLiveEvent('open', quiet)
    const onCrossing = () => {
      setState({ status: 'loading', board: null, error: '', refreshing: false })
      read()
    }
    listeners.add(onCrossing)
    const onSeen = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (Date.now() - lastRead.current < FOCUS_GAP_MS) return
      quiet()
    }
    const w = typeof window !== 'undefined' ? window : null
    w?.addEventListener?.('focus', onSeen)
    if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', onSeen)
    return () => {
      live.current = false
      rereaders.delete(read)
      offRing()
      offOpen()
      listeners.delete(onCrossing)
      w?.removeEventListener?.('focus', onSeen)
      if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', onSeen)
    }
  }, [read])

  const absorb = useCallback((a: WriteAnswer) => {
    absorbWrite(a)
    if (a.board) setState({ status: 'ready', board: a.board, error: '', refreshing: false })
  }, [])

  return { ...state, reload: read, absorb }
}

/* ---------- the writes ---------- */

// every call names its action literally, so the client contract check can hold each one to the backend
const WRITE = { retry: false } as const

/** A write on its way, counted while out: no board read lands over it until every write is back. */
function out<T>(sent: Promise<T>): Promise<T> {
  writing++
  writesSent++
  return sent.finally(() => {
    writing--
    if (!writing) settleWrites()
  })
}

export type RequestPayload = {
  vehicle_id: string
  staff_key: string
  start: string
  end: string
  client_key?: string
  trip_type: string
  details?: string
  wheelchair_required?: boolean
}

export const requestTrip = (p: RequestPayload) => out(gasAction<unknown>('vehicleCalendarRequest', p, WRITE)).then(writeFrom)

export type AnswerWord = 'approve' | 'decline'
export const answerTrip = (itemId: string, word: AnswerWord, note = '') =>
  out(gasAction<unknown>('vehicleCalendarAnswer', { item_id: itemId, word, ...(note.trim() ? { note: note.trim() } : {}) }, WRITE)).then(writeFrom)

export const withdrawTrip = (tripId: string) => out(gasAction<unknown>('vehicleCalendarWithdraw', { trip_id: tripId }, WRITE)).then(writeFrom)

export type TripSavePayload = {
  trip_id: string
  status?: 'scheduled' | 'needs_assignment' | 'cancelled'
  vehicle_id?: string
  staff_key?: string
  driver_key?: string
  start?: string
  end?: string
  wheelchair_required?: boolean
  trip_type?: string
  purpose?: string
  destination?: string
  details?: string
  client_key?: string
  note?: string
  /** the client whose page opened the trip: the door changes only that client's trip */
  client?: string
}
/** The trip save's own answer, the Apply strip's steps kept (writeFrom reads it as the panel does). */
export const saveTripAnswer = (p: TripSavePayload) => out(gasAction<unknown>('vehicleCalendarTripSave', p, WRITE))
export const saveTrip = (p: TripSavePayload) => saveTripAnswer(p).then(writeFrom)

export type VehicleSavePayload = {
  vehicle_id?: string
  name: string
  description: string
  seats: number
  wheelchair_accessible: boolean
  availability: 'available' | 'maintenance' | 'out_of_service'
  note?: string
}
export const saveVehicle = (p: VehicleSavePayload) => out(gasAction<unknown>('vehicleCalendarVehicleSave', p, WRITE)).then(writeFrom)

/* ---------- the master's setup ---------- */

export type SettingsValues = { directors?: string; trip_types?: string[]; text_to?: Record<string, string>; import_minutes?: number }
export type SetupAnswer = { ok: boolean; dry_run: boolean; report: Record<string, unknown>; said: string }

type SetupRaw = { ok?: boolean; dry_run?: boolean; report?: unknown; said?: string } | null

const setupFrom = (o: SetupRaw): SetupAnswer => ({
  ok: o?.ok !== false,
  dry_run: o?.dry_run !== false,
  report: (o?.report && typeof o.report === 'object' ? o.report : {}) as Record<string, unknown>,
  said: String(o?.said ?? ''),
})

export const seedVehicles = (dryRun: boolean): Promise<SetupAnswer> =>
  out(gasAction<SetupRaw>('vehicleCalendarSeed', { dry_run: dryRun }, WRITE)).then(setupFrom)
export const importVanCalendar = (dryRun: boolean): Promise<SetupAnswer> =>
  out(gasAction<SetupRaw>('vehicleCalendarImport', { dry_run: dryRun }, WRITE)).then(setupFrom)
export const setSettings = (values: SettingsValues) =>
  out(gasAction<{ ok?: boolean; said?: string }>('vehicleCalendarSettingsSet', { values }, WRITE))

/** A refusal's sentence, as the panel shows it. */
export const saidOf = (err: unknown): string => (err instanceof Error ? err.message : String(err)) || 'Try again.'

/* ---------- the editions this viewer makes here (Settings › Editions) ---------- */

const editionsAsked = new Map<string, Promise<string[]>>()

onMemoryBoundary(() => {
  editionsAsked.clear()
})

/** editionsMine for Transportation; an answer without its list is "not confirmed", never "none", and is asked again. */
export async function readTransportEditions(): Promise<string[]> {
  const d = await gasAction<{ editions?: unknown }>('editionsMine', { app: VEHICLE_CALENDAR_APP })
  if (isRelayReceipt(d) || !Array.isArray(d?.editions)) throw new Error('The editions were not confirmed.')
  return d.editions.map((x) => String(x ?? '').trim()).filter((x) => TRANSPORT_EDITION_IDS.includes(x))
}

function editionsOnce(who: string): Promise<string[]> {
  const held = editionsAsked.get(who)
  if (held) return held
  const p = readTransportEditions()
  p.catch(() => { if (editionsAsked.get(who) === p) editionsAsked.delete(who) })
  editionsAsked.set(who, p)
  return p
}

const NO_EDITIONS: readonly string[] = []

// The editions this viewer makes here, once a session; none asked in a visit or by an account no edition lists. An
// unconfirmed read is asked again on the app's ring, the stream's open or the tab coming back — never on a clock.
export function useTransportEditions(): readonly string[] {
  const viewer = useEffectiveUser()
  const asks = !!viewer && !viewer.visiting && EDITION_ROLES.includes(String(viewer.role ?? '').toLowerCase())
  const who = asks && viewer ? viewer.id : ''
  const [got, setGot] = useState<{ who: string; editions: string[] }>({ who: '', editions: [] })
  useEffect(() => {
    if (!who) return
    let live = true
    let held = false
    const ask = () => {
      if (held) return
      editionsOnce(who)
        .then((editions) => { if (live) { held = true; setGot({ who, editions }) } })
        .catch(() => {})
    }
    ask()
    const offRing = onLiveEvent(VEHICLE_CALENDAR_EVENT, ask)
    const offOpen = onLiveEvent('open', ask)
    const onBack = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      ask()
    }
    const w = typeof window !== 'undefined' ? window : null
    w?.addEventListener?.('focus', onBack)
    if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', onBack)
    return () => {
      live = false
      offRing()
      offOpen()
      w?.removeEventListener?.('focus', onBack)
      if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', onBack)
    }
  }, [who])
  return who && got.who === who ? got.editions : NO_EDITIONS
}

/* ---------- the trips other apps show (Clients › Appointments, Staff › Calendar) ---------- */

/** One client's trips, by the client key Clients names them by. */
export const readClientTrips = (client: string) => gasAction<unknown>('vehicleCalendarClientTrips', { client })
/** One staff member's trips as driver or companion, by the staff key Staff names them by. */
export const readStaffTrips = (person: string) => gasAction<unknown>('vehicleCalendarStaffTrips', { person })

/* ---------- the board asked for one client (Clients › Transportation opens the trip panel) ---------- */

/** vehicleCalendarBoard naming a client: that client's trips whole to whoever may change them; never the board held above. */
export function readClientBoard(client: string): Promise<Board> {
  return gasAction<unknown>('vehicleCalendarBoard', { client }).then((raw) => {
    // an answer without its trips is not confirmed, never an empty calendar
    if (isRelayReceipt(raw) || !raw || typeof raw !== 'object' || !Array.isArray((raw as { trips?: unknown }).trips)) {
      throw new Error('The vehicle calendar did not confirm the trips — try again.')
    }
    return boardFrom(raw)
  })
}

export type ClientBoardState = { status: 'loading' | 'ready' | 'failed'; board: Board | null; error: string }

// every client board on screen, told of a write made for its client in another panel
const clientWrites = new Set<(client: string, answer: WriteAnswer) => void>()

/** A write for this client landed (a new trip asked for, a trip changed): every board held for the client takes the
 * answer's board, or reads again when it carries none. */
export function clientBoardWrote(client: string, answer: WriteAnswer): void {
  for (const told of [...clientWrites]) told(client, answer)
}

/** The client's board for the trip panel: read on open and on the app's ring; a write's fresh board replaces it. */
export function useClientTripBoard(client: string): ClientBoardState & { reload: () => void; absorb: (a: WriteAnswer) => void } {
  const [state, setState] = useState<ClientBoardState>({ status: 'loading', board: null, error: '' })
  const live = useRef(true)
  const read = useCallback(() => {
    // an answer asked for before a memory boundary is never drawn after it
    const asked = crossings
    setState((s) => (s.board ? s : { status: 'loading', board: null, error: '' }))
    readClientBoard(client)
      .then((board) => { if (live.current && asked === crossings) setState({ status: 'ready', board, error: '' }) })
      .catch((err: unknown) => {
        if (!live.current || asked !== crossings) return
        setState((s) => ({ ...s, status: s.board ? 'ready' : 'failed', error: saidOf(err) }))
      })
  }, [client])
  useEffect(() => {
    live.current = true
    read()
    // a write of this tab answers with its own board; the ring then reads again once it is back
    const offRing = onLiveEvent(VEHICLE_CALENDAR_EVENT, () => { if (!writing) read() })
    const onCrossing = () => {
      setState({ status: 'loading', board: null, error: '' })
      read()
    }
    listeners.add(onCrossing)
    const onWrote = (who: string, a: WriteAnswer) => {
      if (who !== client) return
      if (a.board) setState({ status: 'ready', board: a.board, error: '' })
      else read()
    }
    clientWrites.add(onWrote)
    return () => {
      live.current = false
      offRing()
      listeners.delete(onCrossing)
      clientWrites.delete(onWrote)
    }
  }, [read, client])
  const absorb = useCallback((a: WriteAnswer) => {
    if (a.board) setState({ status: 'ready', board: a.board, error: '' })
  }, [])
  return { ...state, reload: read, absorb }
}
