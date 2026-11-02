// THE PROFILE APPS' SECTION READS, HELD — one keyed cache per app (Clients, Staff, Locations, SSA), in this tab's…
// A section already read draws at once — opened again, the switcher back on its owner, its tab picked again — and…
import { useCallback, useEffect, useRef, useState } from 'react'
import { SESSION_EXPIRED } from '@/features/hiring/shared'
import { PACK_FRESH_MS, heardWrite, heldFresh, onAppRing, onMemoryBoundary } from '@/lib/appPack'

// Past this an answer is still drawn at once, and read again behind it; the pack's own fresh window, and the same…
export const READ_FRESH_MS = PACK_FRESH_MS
/** Past this an answer is not drawn: the section reads before it draws. */
export const READ_USABLE_MS = 60 * 60_000
/** Keys held per app; past it the least recently used goes. */
export const READ_MAX_KEYS = 160

export type ReadState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  data: T | null
  error: string
  refreshing: boolean
  /** when what is drawn was made: the slice's or the pack's own stamp, else when it was read live */
  updatedAt?: string
}

export const IDLE: ReadState<never> = { status: 'idle', data: null, error: '', refreshing: false }

/** The key an answer is held under: the action, the owner, then any parameter. */
export const readKey = (action: string, owner: string, ...rest: (string | boolean)[]): string =>
  [action, owner, ...rest.map(String)].join('|')

export const ownerOfKey = (key: string): string => key.split('|')[1] ?? ''

export type ReadCacheOptions = {
  /** when an answer's source was made ('' for one read live): the state then carries `updatedAt` */
  stamp?: (raw: unknown) => string
  /** a refusal: what was held for the key is dropped, and nothing is drawn in its place */
  refused?: (err: unknown) => boolean
  /** the roster (owner '*') reads again when any owner is written */
  rosterFollows?: boolean
  /** keys held at most */
  max?: number
  /** the app whose ring (appPack onAppRing) makes every held answer past fresh and every reader on screen read again */
  app?: string
}

type Held = { at: number; raw: unknown }

export type ReadCache = {
  readonly options: ReadCacheOptions
  /** the held answer while it is usable, marked as just used; null when none */
  held: (key: string) => Held | null
  /** one request per key at a time; its answer is held unless a forget that covers it came first */
  read: (key: string, load: () => Promise<unknown>) => Promise<unknown>
  /** one key's answer */
  drop: (key: string) => void
  /** an owner's keys, or every key; the reads on their way are never held */
  forget: (owner?: string) => void
  // a write landed for the owner: every reader of its keys on screen reads again, and in every app nothing read…
  written: (owner: string) => void
  onWritten: (fn: (owner: string) => void) => () => void
  size: () => number
}

const caches = new Set<{ forget: (owner?: string) => void }>()
// bumped at a memory boundary: an answer asked for before it is never drawn after it
let crossings = 0

onMemoryBoundary(() => {
  crossings++
  for (const c of caches) c.forget()
})

export function createReadCache(options: ReadCacheOptions = {}): ReadCache {
  const max = Math.max(1, options.max ?? READ_MAX_KEYS)
  const entries = new Map<string, Held>()
  const inflight = new Map<string, Promise<unknown>>()
  const owners = new Map<string, number>()
  const listeners = new Set<(owner: string) => void>()
  let generation = 0
  const tagOf = (key: string) => `${generation}:${owners.get(ownerOfKey(key)) ?? 0}`

  const held = (key: string): Held | null => {
    const hit = entries.get(key)
    if (!hit) return null
    entries.delete(key)
    if (Date.now() - hit.at >= READ_USABLE_MS) return null
    entries.set(key, hit)
    return hit
  }

  const keep = (key: string, raw: unknown) => {
    entries.delete(key)
    entries.set(key, { at: Date.now(), raw })
    for (const k of entries.keys()) {
      if (entries.size <= max) break
      entries.delete(k)
    }
  }

  const read = (key: string, load: () => Promise<unknown>): Promise<unknown> => {
    const running = inflight.get(key)
    if (running) return running
    const asked = tagOf(key)
    let started: Promise<unknown>
    try {
      started = load()
    } catch (err) {
      started = Promise.reject(err)
    }
    const p: Promise<unknown> = started
      .then((raw) => {
        if (asked === tagOf(key)) keep(key, raw)
        return raw
      })
      .finally(() => {
        if (inflight.get(key) === p) inflight.delete(key)
      })
    inflight.set(key, p)
    return p
  }

  const forget = (owner?: string) => {
    if (!owner) {
      generation++
      entries.clear()
      inflight.clear()
      owners.clear()
      return
    }
    owners.set(owner, (owners.get(owner) ?? 0) + 1)
    for (const k of [...entries.keys()]) if (ownerOfKey(k) === owner) entries.delete(k)
    for (const k of [...inflight.keys()]) if (ownerOfKey(k) === owner) inflight.delete(k)
  }

  const cache: ReadCache = {
    options,
    held,
    read,
    drop: (key) => { entries.delete(key) },
    forget,
    written: (owner) => {
      heardWrite()
      for (const fn of [...listeners]) fn(owner)
    },
    onWritten: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    size: () => entries.size,
  }
  caches.add(cache)
  if (options.app) {
    onAppRing(options.app, () => {
      const past = Date.now() - READ_FRESH_MS
      for (const hit of entries.values()) hit.at = Math.min(hit.at, past)
    })
  }
  return cache
}

/** A refusal says this session may not see the owner: nothing held is drawn in its place. */
export function readRefused(err: unknown): boolean {
  const status = err && typeof err === 'object' ? (err as { status?: unknown }).status : undefined
  if (status === 401 || status === 403 || status === 404) return true
  const said = err instanceof Error ? err.message : String(err)
  return said === SESSION_EXPIRED || /unknown action/i.test(said)
}

/* ---------- a write's answer ---------- */

// The relay's ledger took the write without running it yet: {accepted:true, queued|confirmed:false} and no record…
export function writeQueued(answer: unknown): boolean {
  if (!answer || typeof answer !== 'object') return false
  const o = answer as Record<string, unknown>
  if (typeof o.id === 'string' && o.id.startsWith('pending-')) return true
  return o.accepted === true && Object.keys(o).length <= 2
}

/** Long enough for the ledger to run a queued write before its owner is read once more. */
export const QUEUED_REREAD_MS = 8_000

/** The toast's second line for a write the ledger holds. */
export const QUEUED_WORDS = 'Accepted — it shows here once the server has written it.'

/** A write answered and `written` ran: once more after a queued write has had time to run. True when it was queued. */
export function writtenAgainIfQueued(answer: unknown, written: () => void): boolean {
  const queued = writeQueued(answer)
  if (queued) {
    const t = setTimeout(written, QUEUED_REREAD_MS) as unknown as { unref?: () => void }
    t.unref?.()
  }
  return queued
}

/* ---------- the hook ---------- */

/** When an answer was made, for a cache that says so: its source's own stamp, else when it was read (now, unsaid). */
const stampedBy = (cache: ReadCache, raw: unknown, at?: number): { updatedAt?: string } =>
  (cache.options.stamp ? { updatedAt: cache.options.stamp(raw) || new Date(at ?? Date.now()).toISOString() } : {})

/** Past fresh — by age, or read before or while this tab's latest write settled: drawn, and read again behind it. */
const pastFresh = (hit: Held): boolean => !heldFresh(hit.at, READ_FRESH_MS)

const readyFrom = <T>(cache: ReadCache, hit: Held, shape: (raw: unknown) => T, refreshing: boolean): ReadState<T> =>
  ({ status: 'ready', data: shape(hit.raw), error: '', refreshing, ...stampedBy(cache, hit.raw, hit.at) })

// One read, keyed; a null key reads nothing.
export function useCachedRead<T>(cache: ReadCache, key: string | null, load: () => Promise<unknown>,
  shape: (raw: unknown) => T, first?: () => unknown): ReadState<T> & { reload: () => void } {
  const loadRef = useRef(load)
  const shapeRef = useRef(shape)
  useEffect(() => {
    loadRef.current = load
    shapeRef.current = shape
  })
  const [tick, setTick] = useState(0)
  const handled = useRef(0)
  const [slot, setSlot] = useState<{ key: string | null; state: ReadState<T> }>({ key: null, state: IDLE })
  const rosterFollows = cache.options.rosterFollows

  // asked again: what is drawn stays, marked as being read
  const again = useCallback(() => {
    setSlot((s) => (s.key === key ? { key, state: { ...s.state, refreshing: true } } : s))
    setTick((t) => t + 1)
  }, [key])

  useEffect(() => {
    if (!key) return
    const mine = ownerOfKey(key)
    return cache.onWritten((owner) => {
      if (owner === mine || (rosterFollows && mine === '*')) again()
    })
  }, [cache, key, again, rosterFollows])

  // the app rang: what is drawn stays, and is read again
  const app = cache.options.app
  useEffect(() => (key && app ? onAppRing(app, again) : undefined), [key, app, again])

  // another account, a visit, a tenant or a world: nothing drawn for the one before, and read again
  useEffect(() => onMemoryBoundary(() => {
    setSlot({ key: null, state: IDLE })
    setTick((t) => t + 1)
  }), [])

  useEffect(() => {
    if (!key) return
    const forced = tick !== handled.current
    handled.current = tick
    const hit = cache.held(key)
    if (hit && !forced && !pastFresh(hit)) {
      // drawn from what is held: the slot follows the key, so no older answer it kept is drawn for it later
      setSlot({ key, state: readyFrom(cache, hit, shapeRef.current, false) })
      return
    }
    // a read runs: what the slot draws for this key is marked as being read
    setSlot((s) => (s.key === key && !s.state.refreshing ? { key, state: { ...s.state, refreshing: true } } : s))
    let live = true
    const crossed = crossings
    cache.read(key, () => loadRef.current())
      .then((raw) => {
        if (!live || crossed !== crossings) return
        setSlot({ key, state: { status: 'ready', data: shapeRef.current(raw), error: '', refreshing: false,
          ...stampedBy(cache, raw, cache.held(key)?.at) } })
      })
      .catch((err: unknown) => {
        if (!live || crossed !== crossings) return
        const error = err instanceof Error ? err.message : String(err)
        if (cache.options.refused?.(err)) {
          cache.drop(key)
          setSlot({ key, state: { status: 'failed', data: null, error, refreshing: false } })
          return
        }
        setSlot((s) => ({
          key, state: s.key === key
            ? { ...s.state, status: 'failed', error, refreshing: false }
            : { status: 'failed', data: hit ? shapeRef.current(hit.raw) : null, error, refreshing: false,
              ...(hit ? stampedBy(cache, hit.raw, hit.at) : {}) },
        }))
      })
    return () => {
      live = false
    }
  }, [cache, key, tick])

  let state: ReadState<T> = IDLE
  if (key && slot.key === key) state = slot.state
  else if (key) {
    // a key not answered here yet: the session's held answer, drawn at once (read again behind it when stale), else…
    const hit = cache.held(key)
    const seed = hit ? null : first?.() ?? null
    if (hit) {
      state = readyFrom(cache, hit, shape, pastFresh(hit))
    } else if (seed !== null && seed !== undefined) {
      state = { status: 'ready', data: shape(seed), error: '', refreshing: true, ...stampedBy(cache, seed) }
    } else state = { ...IDLE, status: 'loading' }
  }
  return { ...state, reload: again }
}
