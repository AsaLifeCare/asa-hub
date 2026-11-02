// APP PACKS — the parts of an app's screen that only Apps Script can answer (private, clinical or Drive-only), one…
// The key rides a header, never the address: a client's key is their name, and the proxies write addresses to their…
import { useAuthStore } from '@/auth/useAuthStore'
import { ownClientKey } from '@/lib/ownClient'
import { onLiveEvent, seededPlace } from '@/lib/snapshotClient'
import { activeMemberId, useMemberStore } from '@/stores/useMemberStore'
import { activeTenantId, useTenantStore } from '@/stores/useTenantStore'
import { activeWorldId, useWorldStore } from '@/stores/useWorldStore'

export type PackData = {
  parts?: Record<string, unknown>
  part_status?: Record<string, { status?: number; message?: string }>
  [k: string]: unknown
}

/** `readAt`: when the relay began reading it, on this tab's clock; 0 when the relay did not say. */
export type Pack = { data: PackData; builtAt: string; at: number; readAt: number }

/** A held pack younger than this answers without asking the relay — unless this tab wrote since (heldFresh). */
export const PACK_FRESH_MS = 5 * 60_000
// A write forgets only its own owner's answers: another app's about the same people (a house's incidents after a…
export const WRITE_SETTLE_MS = 60_000
/** Packs held at once, every app together; past it the least recently used goes. */
export const PACK_MAX_HELD = 32
/** A door that said "not here" is not asked again for this long. */
export const PACK_CLOSED_MS = 5 * 60_000

// Prefetches run two at a time at most, each turn this far from the next: every /hub-lanes/ request from one…
export const PREFETCH_GAP_MS = 1_000
export const PREFETCH_AT_ONCE = 2
// the four own views asked at sign-in wait together
const PREFETCH_QUEUE_MAX = 4

/** The slot of a client-role session's own view of an app: never a key the relay reads. */
export const OWN_KEY = '~own'
/** The apps a client-role session reads its own view of. */
export const OWN_APPS = ['locations', 'client-profiles', 'ssa-profiles', 'staff-profiles'] as const
/** How long a section waits on its own view being gathered, once, before it reads its action. */
export const OWN_WAIT_S = 4

/** How long a write of this tab's own is named on the reads of its key; the relay hears no older one. */
export const PACK_WRITTEN_MS = 15 * 60_000

/** After the relay said a key is being gathered (or this tab wrote it), how long its reads ask without waiting. */
export const PACK_FILLING_MS = 5 * 60_000

// How a person's read of a pack waits: `waitS` seconds on a pack being gathered, asked once, then null; unset, the…
export type PackWait = { waitS?: number }

const held = new Map<string, Pack>()
const inflight = new Map<string, Promise<Pack | null>>()
const peeking = new Map<string, Promise<Pack | null>>()
const closed = new Map<string, number>()
// this tab's own write for a key: when it was sent, and when its answer came back
const written = new Map<string, { sent: number; at: number }>()
const filling = new Map<string, number>()
const queue: { app: string; key: string }[] = []
// an answer asked for before a forget that covers it is never held after it: an app's or every pack's forget bumps…
let epoch = 0
const keyEpochs = new Map<string, number>()
// when this tab last wrote, in any profile app
let lastWriteAt = Number.NEGATIVE_INFINITY

/** This tab wrote, in any profile app: nothing read before now is fresh, and what is read next settles (heldFresh). */
export function heardWrite(): void {
  lastWriteAt = Date.now()
}

// An answer read at `at` is still fresh: younger than `freshMs`, never read before this tab's latest write, and…
export function heldFresh(at: number, freshMs: number): boolean {
  if (at < lastWriteAt) return false
  const span = at < lastWriteAt + WRITE_SETTLE_MS ? Math.min(freshMs, WRITE_SETTLE_MS) : freshMs
  return Date.now() - at < span
}

const slot = (app: string, key: string) => `${app}|${key}`
const epochOf = (k: string) => `${epoch}:${keyEpochs.get(k) ?? 0}`
// the own view's door shuts apart from the app door's: neither closes the other
const closedKey = (app: string, key: string) => (key === OWN_KEY ? `${app}/own` : app)
const shut = (app: string, key: string) => (closed.get(closedKey(app, key)) ?? 0) > Date.now()

/** Anywhere but headquarters in the signed-in account's own session: a visit, a tenant or a world. */
const elsewhere = (): boolean => Boolean(activeMemberId() || activeTenantId() || activeWorldId())

// Headquarters in the account's own session, over a slice shelf seeded there or not seeded at all — api.list's own…
export function shelfServesHere(): boolean {
  if (elsewhere()) return false
  const seeded = seededPlace()
  return !seeded || seeded === 'home'
}

/** The door's address: never the key, which rides the X-App-Pack-Key header (packHeaders); `own`, the own view's. */
export const packPath = (app: string,
  q: { writtenMs?: number; sentMs?: number; waitS?: number; peek?: boolean; own?: boolean } = {}) => {
  const said: string[] = []
  if (q.peek) said.push('peek=1')
  if (!q.own && q.writtenMs && q.writtenMs > 0) {
    said.push(`written_ms=${Math.round(q.writtenMs)}`)
    if (q.sentMs && q.sentMs >= q.writtenMs) said.push(`sent_ms=${Math.round(q.sentMs)}`)
  }
  if (!q.peek && q.waitS !== undefined) said.push(`wait=${Math.max(0, Math.round(q.waitS * 1000) / 1000)}`)
  return `/hub-lanes/app-pack/${encodeURIComponent(app)}${q.own ? '/own' : ''}${said.length ? `?${said.join('&')}` : ''}`
}

/** The key, URI-encoded, and the session; the own view sends no key at all. */
export const packHeaders = (key: string, token: string | null | undefined): Record<string, string> => ({
  ...(key === OWN_KEY ? {} : { 'X-App-Pack-Key': encodeURIComponent(key) }),
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
})

/** This tab's own write for the key while it is still named: how long ago it was answered and sent. */
function writtenAgo(k: string): { writtenMs: number; sentMs: number } | null {
  const w = written.get(k)
  if (!w) return null
  const now = Date.now()
  const writtenMs = Math.max(1, now - w.at)
  if (writtenMs > PACK_WRITTEN_MS) {
    written.delete(k)
    return null
  }
  return { writtenMs, sentMs: Math.max(writtenMs, now - w.sent) }
}

const fillingNow = (k: string): boolean => (filling.get(k) ?? 0) > Date.now()

/** Every pack of an app, one key's, or every pack there is. */
export function forgetPack(app?: string, key?: string): void {
  if (app && key) keyEpochs.set(slot(app, key), (keyEpochs.get(slot(app, key)) ?? 0) + 1)
  else epoch++
  if (!app) {
    held.clear()
    inflight.clear()
    peeking.clear()
    closed.clear()
    keyEpochs.clear()
    written.clear()
    filling.clear()
    queue.length = 0
    return
  }
  const hit = (k: string) => (key ? k === slot(app, key) : k.startsWith(`${app}|`))
  for (const map of [held, inflight, peeking, filling] as Map<string, unknown>[]) {
    for (const k of [...map.keys()]) if (hit(k)) map.delete(k)
  }
  for (let i = queue.length - 1; i >= 0; i--) if (hit(slot(queue[i].app, queue[i].key))) queue.splice(i, 1)
}

/** The held pack at any age; null when none. */
export function peekPack(app: string, key: string): Pack | null {
  return held.get(slot(app, key)) ?? null
}

/** Hold a pack as the most recently used; past the bound the least recently used goes. */
function holdPack(k: string, pack: Pack): void {
  held.delete(k)
  held.set(k, pack)
  for (const old of held.keys()) {
    if (held.size <= PACK_MAX_HELD) break
    held.delete(old)
  }
}

/** A held pack still fresh, marked as just used; null when none. */
function freshPack(k: string): Pack | null {
  const hit = held.get(k)
  if (!hit || !heldFresh(hit.at, PACK_FRESH_MS)) return null
  holdPack(k, hit)
  return hit
}

// This tab wrote the key: its pack is forgotten, and none the relay began reading before the write was sent…
export function wrotePack(app: string, key: string, sentAt?: number): void {
  if (!app || !key) return
  const at = Date.now()
  heardWrite()
  forgetPack(app, key)
  written.set(slot(app, key), { sent: sentAt && Number.isFinite(sentAt) ? Math.min(sentAt, at) : at, at })
  filling.set(slot(app, key), at + PACK_FILLING_MS)
}

/** When the relay began reading an answer, on this tab's clock; 0 when it did not say. */
function readAtOf(data: PackData, now: number): number {
  const ago = Number(data.read_age_s ?? data.age_s)
  return Number.isFinite(ago) && ago >= 0 ? now - ago * 1000 : 0
}

async function fetchPack(app: string, key: string, how: PackWait & { peek?: boolean } = {}): Promise<Pack | 'filling' | null> {
  const k = slot(app, key)
  const asked = epochOf(k)
  const token = useAuthStore.getState().token
  // a key the relay is known to be gathering is asked without waiting on it
  const waitS = how.waitS === undefined ? undefined : fillingNow(k) ? 0 : how.waitS
  const own = key === OWN_KEY
  let res: Response
  try {
    res = await fetch(packPath(app, { ...((!own && writtenAgo(k)) || {}), waitS, peek: how.peek, own }),
      { headers: packHeaders(key, token) })
  } catch {
    return null
  }
  const env = (await res.json().catch(() => null)) as { status?: number; reason?: string; data?: unknown } | null
  const status = Number(env?.status ?? res.status)
  // no door here, not this session's door, or no pack on the engine yet; a refusal about one key shuts nothing, and…
  if (res.status === 404 || (!env && res.ok) || env?.reason === 'unknown' || (status === 503 && env?.reason === 'unpublished')) {
    closed.set(closedKey(app, key), Date.now() + PACK_CLOSED_MS)
    return null
  }
  if (status === 503 && env?.reason === 'filling') {
    if (asked === epochOf(k)) filling.set(k, Date.now() + PACK_FILLING_MS)
    return 'filling'
  }
  const data = env?.data
  if (status !== 200 || !data || typeof data !== 'object' || Array.isArray(data)) return null
  const now = Date.now()
  const pack: Pack = { data: data as PackData, builtAt: String((data as PackData).built_at ?? ''), at: now,
    readAt: readAtOf(data as PackData, now) }
  // read before this tab's own write was sent: never drawn, and the section reads its own action
  const wrote = written.get(k)
  if (wrote && pack.readAt < wrote.sent) return null
  if (asked === epochOf(k)) {
    holdPack(k, pack)
    filling.delete(k)
    if (wrote) written.delete(k)
  }
  return pack
}

// The pack for one key: the held one while it is fresh, else the relay's — from its memory, or the fill it waits…
export function readPack(app: string, key: string, how: PackWait = {}): Promise<Pack | null> {
  if (!key || elsewhere()) return Promise.resolve(null)
  const k = slot(app, key)
  const hit = freshPack(k)
  if (hit) return Promise.resolve(hit)
  if (shut(app, key)) return Promise.resolve(null)
  const running = inflight.get(k)
  if (running) return running
  const once = how.waitS !== undefined
  const job = fetchPack(app, key, how)
    .then((got) => (got === 'filling' && !once ? fetchPack(app, key, how) : got))
    .then((got) => (got === 'filling' ? null : got))
    .finally(() => {
      if (inflight.get(k) === job) inflight.delete(k)
    })
  inflight.set(k, job)
  return job
}

/** A prefetch: the relay's memory alone, never waited on; a person's read of the key in flight is shared. */
function prefetchRead(app: string, key: string): Promise<Pack | null> {
  const k = slot(app, key)
  const running = inflight.get(k) ?? peeking.get(k)
  if (running) return running
  const job = fetchPack(app, key, { peek: true })
    .then((got) => (got === 'filling' ? null : got))
    .finally(() => {
      if (peeking.get(k) === job) peeking.delete(k)
    })
  peeking.set(k, job)
  return job
}

/** One part of a key's pack, or null when the pack or that part did not answer. */
export async function readPackPart(app: string, key: string, part: string, how: PackWait = {}):
  Promise<{ part: unknown; builtAt: string } | null> {
  const pack = await readPack(app, key, how)
  // a crossing while the pack was read: headquarters' pack answers nothing there
  if (!pack || elsewhere()) return null
  const status = pack.data.part_status?.[part]
  const value = pack.data.parts?.[part]
  if (value === undefined || value === null || (status && status.status !== undefined && status.status !== 200)) return null
  return { part: value, builtAt: pack.builtAt }
}

export type OwnPart = { part: unknown; builtAt: string; data: PackData }

function ownPartOf(pack: Pack | null, part: string): OwnPart | null {
  if (!pack) return null
  const status = pack.data.part_status?.[part]
  const value = pack.data.parts?.[part]
  if (value === undefined || value === null || (status && status.status !== undefined && status.status !== 200)) return null
  return { part: value, builtAt: pack.builtAt, data: pack.data }
}

// One part of this client-role session's own view of an app, with the envelope it came in (whose client, house or…
export async function readOwnPart(app: string, part: string, how: PackWait = { waitS: OWN_WAIT_S }): Promise<OwnPart | null> {
  if (!ownClientKey()) return null
  const pack = await readPack(app, OWN_KEY, how)
  // another account or a crossing while it was read: the view answers nothing
  if (!ownClientKey() || elsewhere()) return null
  return ownPartOf(pack, part)
}

/** The same part of the own view this tab already holds, at any age, never fetched: a section's first paint. */
export function heldOwnPart(app: string, part: string): OwnPart | null {
  if (!ownClientKey() || elsewhere()) return null
  return ownPartOf(peekPack(app, OWN_KEY), part)
}

/** A client-role session's four own views, asked of the relay's memory while the browser is idle: at sign-in. */
export function prefetchOwnPacks(): void {
  if (!ownClientKey()) return
  for (const app of OWN_APPS) prefetchPack(app, OWN_KEY)
}

/* ---------- when an answer was made ---------- */

const stamps = new WeakMap<object, string>()

// Mark an answer with when its source was made (a slice's build, a pack's); answers are objects, so the mark rides…
export function stampAnswer<T>(answer: T, at: string): T {
  if (answer && typeof answer === 'object' && at) stamps.set(answer as object, at)
  return answer
}

/** When an answer's source was made — a relay's kept copy says when it was read (`kept_at`); '' for one read live. */
export const answerStamp = (raw: unknown): string => {
  if (!raw || typeof raw !== 'object') return ''
  const kept = (raw as { kept_at?: unknown }).kept_at
  return stamps.get(raw as object) ?? (typeof kept === 'string' ? kept : '')
}

/* ---------- an app's ring ---------- */

// The name the relay rings when what an app shows changed: a landed write, a pack of a key read lately filled again…
export const appRingName = (app: string): string => `app:${app}`
/** Rings this close together are answered once. */
export const APP_RING_SETTLE_MS = 1_000

const ringers = new Map<string, Set<() => void>>()

// `fn` runs on the app's ring — the app's held packs forgotten first — and as the stream (re)opens, to catch up on…
export function onAppRing(app: string, fn: () => void): () => void {
  let fns = ringers.get(app)
  if (!fns) {
    const set = new Set<() => void>()
    let timer: ReturnType<typeof setTimeout> | null = null
    let rung = false
    const fire = () => {
      timer = null
      if (rung) forgetPack(app)
      rung = false
      for (const f of [...set]) {
        try { f() } catch { /* a listener's failure stays its own */ }
      }
    }
    const later = (ring: boolean) => () => {
      rung = rung || ring
      timer ??= setTimeout(fire, APP_RING_SETTLE_MS)
    }
    onLiveEvent(appRingName(app), later(true))
    onLiveEvent('open', later(false))
    ringers.set(app, set)
    fns = set
  }
  const mine = fns
  mine.add(fn)
  return () => { mine.delete(fn) }
}

/* ---------- a document's bytes, held for the tab ---------- */

const DOC_KEEP = 8
// base64 text, one byte a character: about 60 MB held at most
const DOC_KEEP_CHARS = 60 * 1024 * 1024
const DOC_KEEP_MS = 10 * 60_000
const docs = new Map<string, { at: number; answer: { b64: string } }>()
// bumped by every forget: bytes asked for before it are never held after it
let docsEpoch = 0

/** Forget the held documents whose key starts with `prefix`, or every one. */
export function forgetDocBytes(prefix = ''): void {
  docsEpoch++
  for (const k of [...docs.keys()]) if (!prefix || k.startsWith(prefix)) docs.delete(k)
}

// A document's bytes through its own door, kept in memory for the tab — the last eight of every app, about 60 MB at…
export async function readDocBytesHeld<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = docs.get(key)
  if (hit && Date.now() - hit.at < DOC_KEEP_MS) {
    docs.delete(key)
    docs.set(key, hit)
    return hit.answer as T
  }
  const asked = docsEpoch
  const answer = await load()
  const b64 = (answer as { b64?: unknown } | null)?.b64
  if (asked === docsEpoch && typeof b64 === 'string' && b64) {
    docs.set(key, { at: Date.now(), answer: answer as { b64: string } })
    let chars = 0
    for (const v of docs.values()) chars += v.answer.b64.length
    for (const k of [...docs.keys()]) {
      if (docs.size <= DOC_KEEP && chars <= DOC_KEEP_CHARS) break
      if (k === key) continue
      chars -= docs.get(k)?.answer.b64.length ?? 0
      docs.delete(k)
    }
  }
  return answer
}

const idle = (fn: () => void) => {
  const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => unknown }
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 2_000 })
  else setTimeout(fn, 200)
}

/** Not held fresh, not on its way, and the door is open. */
function wanted(app: string, key: string): boolean {
  const k = slot(app, key)
  const hit = held.get(k)
  return !((hit && heldFresh(hit.at, PACK_FRESH_MS)) || inflight.has(k) || peeking.has(k) || shut(app, key))
}

// prefetch turns taken now: PREFETCH_AT_ONCE at most
let turns = 0

function drain(): void {
  while (turns < PREFETCH_AT_ONCE) {
    const next = queue.shift()
    if (!next) return
    turns++
    const asked = epochOf(slot(next.app, next.key))
    idle(() => {
      const go = asked === epochOf(slot(next.app, next.key)) && !elsewhere() && wanted(next.app, next.key)
        ? prefetchRead(next.app, next.key) : Promise.resolve(null)
      void go.catch(() => null).finally(() => {
        setTimeout(() => {
          turns--
          drain()
        }, PREFETCH_GAP_MS)
      })
    })
  }
}

// Ask for a key's pack when the browser is idle, in its turn — two at a time at most — unless it is held fresh, on…
export function prefetchPack(app: string, key: string): void {
  if (!key || elsewhere() || !wanted(app, key)) return
  if (queue.some((q) => q.app === app && q.key === key)) return
  queue.push({ app, key })
  if (queue.length > PREFETCH_QUEUE_MAX) queue.shift()
  drain()
}

const boundaryListeners = new Set<() => void>()

// Run `fn` whenever what is held must be dropped: another account, a sign-out, a visit's, a tenant's or a world's…
export function onMemoryBoundary(fn: () => void): () => void {
  boundaryListeners.add(fn)
  return () => { boundaryListeners.delete(fn) }
}

function boundary(): void {
  forgetPack()
  forgetDocBytes()
  for (const fn of [...boundaryListeners]) {
    try { fn() } catch { /* a listener's failure stays its own */ }
  }
}

// who is signed in, and whose place this is, are memory boundaries: nothing held crosses either
const identityOf = (s: ReturnType<typeof useAuthStore.getState>) => `${s.user?.id ?? ''}:${s.token ?? ''}`
let identity = identityOf(useAuthStore.getState())
useAuthStore.subscribe((s) => {
  const now = identityOf(s)
  if (now === identity) return
  identity = now
  boundary()
})
const placeOf = () => {
  const m = useMemberStore.getState()
  return `${m.currentMemberId}:${m.memberEpoch}:${activeTenantId()}:${activeWorldId()}`
}
let place = placeOf()
const followPlace = () => {
  const now = placeOf()
  if (now === place) return
  place = now
  boundary()
}
useMemberStore.subscribe(followPlace)
useTenantStore.subscribe(followPlace)
useWorldStore.subscribe(followPlace)
