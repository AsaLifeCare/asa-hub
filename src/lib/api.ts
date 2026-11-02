// asa.
// — API layer (design.md §12).
import * as seed from '@/lib/seed'
import { ohioDateTime } from '@/lib/ohio'
import { extraSeeds } from '@/lib/seed-extra'
import type { ResourceName } from '@/engine/types'
import { DEFAULT_EXEC_URL, useApiConfigStore } from '@/stores/useApiConfigStore'
import { noteWrite, readSlice, readSliceFloor, seededPlace } from '@/lib/snapshotClient'
// safe top-level import: the auth store never imports @/lib/api (no cycle)
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { cacheKey, cachedRead, invalidate } from '@/lib/apiCache'
import { forgetWarm } from '@/lib/prefetch'
import { normalizeRow, normalizeRows } from '@/lib/normalizeRows'
// safe: useWorldStore never imports @/lib/api (its only reach back to the network layer is a dynamic import of…
import { activeWorldId } from '@/stores/useWorldStore'
import { activeTenantId } from '@/stores/useTenantStore'
import { activeMemberId } from '@/stores/useMemberStore'
import { currentPlace, placeScope, samePlace } from '@/lib/placeKey'
import { noteDoorAnswer } from '@/lib/hubStatus'
import { TRACKER_VIEWS, trackerRowsOfAll } from '@/lib/certUploads'
import { isReaderError } from '@/lib/readerError'

// EVERYTHING THIS MODULE REMEMBERS IS REMEMBERED PER PLACE — all three axes, from the one file that defines them…

export type ListParams = {
  q?: string
  limit?: number
  offset?: number
  filters?: Record<string, string>
}

// In-memory mutable copy of the seed (mock driver state).
const db: Record<ResourceName, any[]> = {
  // the dev driver has no seeded numbers: an empty list is the truthful shape (a franchise's own state), and the…
  helpfulContacts: [],
  people: seed.people.map((x) => ({ ...x })),
  candidates: seed.candidates.map((x) => ({ ...x })),
  documents: seed.documents.map((x) => ({ ...x })),
  videos: seed.videos.map((x) => ({ ...x })),
  events: seed.events.map((x) => ({ ...x })),
  notifications: seed.notifications.map((x) => ({ ...x })),
  apps: [],
  activity: seed.activity.map((x) => ({ ...x })),
  ...Object.fromEntries(
    Object.entries(extraSeeds).map(([k, rows]) => [k, rows.map((x) => ({ ...x }))]),
  ),
}

const latency = () => new Promise((r) => setTimeout(r, 250 + Math.random() * 350))
const uid = () => `x-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

function applyListParams(rows: any[], params?: ListParams): any[] {
  let out = rows
  if (params?.q) {
    const q = params.q.toLowerCase()
    out = out.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
  }
  if (params?.filters) {
    for (const [k, v] of Object.entries(params.filters)) {
      if (v) out = out.filter((r) => String(r[k]) === v)
    }
  }
  const offset = params?.offset ?? 0
  const limit = params?.limit
  return limit != null ? out.slice(offset, offset + limit) : out.slice(offset)
}

/* ---------------- mock driver ---------------- */

const mock = {
  async list(resource: ResourceName, params?: ListParams) {
    await latency()
    return applyListParams(db[resource] ?? [], params)
  },
  async get(resource: ResourceName, id: string) {
    await latency()
    const row = (db[resource] ?? []).find((r) => r.id === id)
    if (!row) throw new Error(`${resource}/${id} not found`)
    return row
  },
  async create(resource: ResourceName, payload: any) {
    await latency()
    const row = { id: uid(), ...payload }
    db[resource].unshift(row)
    return row
  },
  async update(resource: ResourceName, id: string, payload: any) {
    await latency()
    const rows = db[resource]
    const i = rows.findIndex((r) => r.id === id)
    if (i === -1) throw new Error(`${resource}/${id} not found`)
    rows[i] = { ...rows[i], ...payload }
    return rows[i]
  },
  async remove(resource: ResourceName, id: string) {
    await latency()
    const rows = db[resource]
    const i = rows.findIndex((r) => r.id === id)
    if (i === -1) throw new Error(`${resource}/${id} not found`)
    rows.splice(i, 1)
    return { id }
  },
}

/* ---------------- apps-script driver ---------------- */

type Envelope = { status: number; data?: unknown; message?: string }

/** The interstitial, told apart from a real error so it can be retried once. */
class NotOurAnswer extends Error {}

const gas = {
  /** Dev /exec override wins; "" → the Hub's own default /exec endpoint. */
  url(): string {
    const { execUrl } = useApiConfigStore.getState()
    return execUrl || DEFAULT_EXEC_URL
  },
  // One attempt.
  async attempt<T>(resource: ResourceName, action: string, payload?: unknown, url?: string): Promise<T> {
    // ALWAYS POST text/plain (list/get included) — a CORS simple request, so no preflight; the session token rides…
    const target = url ?? this.url()
    const res = await fetch(target, {
      method: 'POST',
      // form-encoded (still a CORS simple request): Google's anonymous-POST interstitial intercepts text/plain…
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'body=' + encodeURIComponent(JSON.stringify({
        token: useAuthStore.getState().token ?? undefined,
        resource,
        action,
        payload,
        // USER WORLDS: while a world is active, the envelope names it and the backend re-points this verb at the…
        world: activeWorldId() || undefined,
        // TENANTS: the place narrows what answers, named actions included.
        tenant: activeTenantId() || undefined,
        // the PERSON being visited (Members.gs): their badge and their own work answer; absent means nobody is…
        member: activeMemberId() || undefined,
      })),
    })
    // our own /gas answering as if the relay were not there raises the strip (lib/hubStatus); Google's /exec, the…
    noteDoorAnswer(target, res)
    let env: Envelope
    try {
      env = (await res.json()) as Envelope
    } catch {
      // Not our envelope.
      throw new NotOurAnswer(`The backend answered with something else (${res.status})`)
    }
    // envelope 401 = the session died server-side → drop the local session (no server POST — it's already gone…
    if (env.status === 401) {
      useAuthStore.getState().clearSession()
      throw new Error('Session expired — sign in again.')
    }
    if (env.status >= 400) {
      // The status rides the error: the catch downstream must tell a per-request REFUSAL (4xx — healthy platform…
      // live path (5xx/transport) before painting any global badge.
      const refusal = new Error(env.message || `Backend error ${env.status}`) as Error & { envelopeStatus?: number }
      refusal.envelopeStatus = env.status
      throw refusal
    }
    return env.data as T
  },

  // Retry once on a TRANSPORT failure, and only on that.
  async call<T>(resource: ResourceName, action: string, payload?: unknown): Promise<T> {
    try {
      return await this.attempt<T>(resource, action, payload)
    } catch (err) {
      // A response that never arrived (TypeError) or one that arrived and was not ours (the interstitial, or…
      const worthRetrying = err instanceof TypeError || err instanceof NotOurAnswer
      if (!worthRetrying) throw err
      await new Promise((r) => setTimeout(r, 400))
      // the retry goes to the same door: the records and the sessions are this server's alone
      return await this.attempt<T>(resource, action, payload, this.url())
    }
  },
}

// ---------------- the browser write outbox ---------------- When Google is slow, a CREATE's receipt can be lost…

type OutboxEntry = {
  key: string
  resource: ResourceName
  pendingId: string
  kind: 'update' | 'remove'
  patch: Record<string, unknown>
  // The create payload the pending echo was built from — the row's own fields are the only way to recognise it once…
  fingerprint: Record<string, unknown>
  queuedAt: string
  strikes: number
  // The world the write belongs to ('' / absent = company).
  world?: string
  /** the place this write belongs to ('' = headquarters) */
  tenant?: string
  /** the person being visited, when any (reads only) */
  member?: string
  // WHO QUEUED IT: the account this browser was signed in as, and — while acting as another account (lib/beAnother)…
  uid?: string
  realUid?: string
}

/** Who this browser writes as right now — once the boot confirmed it — or null. */
function outboxHand(): { uid: string; realUid: string } | null {
  const s = useAuthStore.getState()
  const uid = String(s.user?.id ?? '')
  if (!s.hydrated || !uid) return null
  const acting = s.beAnother?.acting
  return { uid, realUid: acting ? String(s.beAnother?.real.id ?? '') : '' }
}

/** The person at the keyboard behind a hand: the real account while acting, the account otherwise. */
function outboxKeyboard(h: { uid?: string; realUid?: string }): string {
  return String(h.realUid || h.uid || '')
}

// Outbox/fingerprint key for one pending echo — world-prefixed, so the same resource name in two worlds can never…
function outboxKeyFor(resource: ResourceName, pendingId: string): string {
  return `${placeScope(resource)}:${pendingId}`
}

const OUTBOX_KEY = 'asa:write-outbox'
const OUTBOX_FP_KEY = 'asa:pending-fp'
const OUTBOX_MAX_AGE_MS = 48 * 3600_000
const OUTBOX_MAX_STRIKES = 5
const OUTBOX_VOLATILE = ['id', 'createdAt', 'updatedAt', 'created_at', 'updated_at']

function outboxRead(): OutboxEntry[] {
  try { return (JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as OutboxEntry[]) ?? [] }
  catch { return [] }
}
function outboxWrite(entries: OutboxEntry[]) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries)) } catch { /* full — the refusal path still spoke */ }
}
// What a pending create left behind.
type PendingFp = { v: Record<string, unknown>; at: string; realId?: string }

function outboxFpRead(): Record<string, PendingFp> {
  try { return (JSON.parse(localStorage.getItem(OUTBOX_FP_KEY) ?? '{}') as Record<string, PendingFp>) ?? {} }
  catch { return {} }
}
function outboxFpWrite(map: Record<string, PendingFp>) {
  try { localStorage.setItem(OUTBOX_FP_KEY, JSON.stringify(map)) } catch { /* same story */ }
}
// The map is the outbox's memory and ages on the same 48h horizon; an entry whose stamp cannot be read is junk, not…
function outboxFpPrune(map: Record<string, PendingFp>) {
  for (const k of Object.keys(map)) {
    const at = Date.parse(map[k]?.at ?? '')
    if (!Number.isFinite(at) || Date.now() - at > OUTBOX_MAX_AGE_MS) delete map[k]
  }
}

/** Called at pending-echo time: remember what the row was born as. */
function outboxRememberCreate(resource: ResourceName, pendingId: string, sent: Record<string, unknown>) {
  const map = outboxFpRead()
  map[outboxKeyFor(resource, pendingId)] = { v: sent, at: new Date().toISOString() }
  outboxFpPrune(map)
  outboxFpWrite(map)
}

// A queued write LANDED: remember which real row this pending echo became.
function outboxRememberReal(resource: ResourceName, pendingId: string, realId: string) {
  const key = outboxKeyFor(resource, pendingId)
  const map = outboxFpRead()
  map[key] = { v: map[key]?.v ?? {}, at: new Date().toISOString(), realId }
  outboxFpPrune(map)
  outboxFpWrite(map)
}

/** The real id this pending echo is already known to be, or null. */
function outboxResolvedId(resource: ResourceName, pendingId: string): string | null {
  const hit = outboxFpRead()[outboxKeyFor(resource, pendingId)]
  return hit?.realId ? String(hit.realId) : null
}

/** Fields that can actually recognise a row — the volatile ones say nothing. */
function outboxNamesRow(fingerprint: Record<string, unknown>): boolean {
  return Object.keys(fingerprint ?? {}).some((k) => !OUTBOX_VOLATILE.includes(k))
}

// Queue a write aimed at a pending row.
function outboxEnqueue(resource: ResourceName, pendingId: string, kind: 'update' | 'remove', patch: Record<string, unknown>): boolean {
  // a write nobody can be named for is refused here, never queued to land as whoever boots next
  const hand = outboxHand()
  if (!hand) return false
  const key = outboxKeyFor(resource, pendingId)
  const entries = outboxRead()
  const existing = entries.find((e) => e.key === key)
  if (existing && (existing.uid !== hand.uid || (existing.realUid ?? '') !== hand.realUid)) return false
  const fp = outboxFpRead()[key]?.v ?? {}
  // No fingerprint, no landing.
  if (!outboxNamesRow(fp) && !(existing && outboxNamesRow(existing.fingerprint))) return false
  if (existing) {
    // an entry queued before this browser knew the fingerprint can adopt it now
    if (!outboxNamesRow(existing.fingerprint)) existing.fingerprint = fp
    if (kind === 'remove') { existing.kind = 'remove'; existing.patch = {} }
    else if (existing.kind === 'update') existing.patch = { ...existing.patch, ...patch }
    // an already-queued remove swallows a later edit: the card is going away
  } else {
    entries.push({
      key, resource, pendingId, kind,
      patch: kind === 'remove' ? {} : patch,
      fingerprint: fp,
      queuedAt: new Date().toISOString(), strikes: 0,
      world: activeWorldId() || undefined,
      tenant: activeTenantId() || undefined,
      member: activeMemberId() || undefined,
      uid: hand.uid,
      realUid: hand.realUid,
    })
  }
  outboxWrite(entries)
  const held = outboxRead().some((e) => e.key === key)
  if (held) scheduleOutboxFlush(2_000)
  return held
}

function outboxSameValue(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true
  if (typeof a === 'object' || typeof b === 'object') {
    try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null) } catch { return false }
  }
  return String(a ?? '') === String(b ?? '')
}

// The real row a pending echo became, or null while it is not visible yet.
function outboxFindRow(entry: OutboxEntry, rows: Record<string, unknown>[]): string | null {
  // `??
  const fpKeys = Object.keys(entry.fingerprint ?? {}).filter((k) => !OUTBOX_VOLATILE.includes(k))
  if (!fpKeys.length) return null
  const hits = rows.filter((r) => fpKeys.every((k) => outboxSameValue(entry.fingerprint[k], r[k])))
  if (!hits.length) return null
  if (hits.length === 1) return String(hits[0].id ?? '') || null
  const minted = parseInt(entry.pendingId.slice('pending-'.length), 36)
  if (!Number.isFinite(minted)) return null
  const dated = hits
    .map((r) => ({ id: String(r.id ?? ''), at: Date.parse(String(r.createdAt ?? r['created_at'] ?? '')) }))
    .filter((x) => x.id && Number.isFinite(x.at))
  if (!dated.length) return null
  dated.sort((x, y) => Math.abs(x.at - minted) - Math.abs(y.at - minted))
  return dated[0].id
}

let outboxTimer: ReturnType<typeof setTimeout> | null = null
let outboxFlushing = false

function scheduleOutboxFlush(delayMs: number) {
  if (outboxTimer) clearTimeout(outboxTimer)
  outboxTimer = setTimeout(() => { outboxTimer = null; void outboxFlush() }, delayMs)
}

function outboxPersist(entry: OutboxEntry) {
  const all = outboxRead()
  const i = all.findIndex((e) => e.key === entry.key)
  if (i !== -1) { all[i] = entry; outboxWrite(all) }
}

// Drop the QUEUE entry only.
function outboxErase(key: string) {
  outboxWrite(outboxRead().filter((e) => e.key !== key))
}

function outboxBury(entry: OutboxEntry, why: string) {
  outboxErase(entry.key)
  // The one moment this lane speaks: a write that will never land, silently dropped, is a save the person believes…
  toast({
    type: 'danger', title: 'A queued edit could not be written',
    body: `An edit to a ${entry.resource} card queued at ${ohioDateTime(entry.queuedAt)} was ${why} — open the card and save it again.`,
  })
}

async function outboxFlush(): Promise<void> {
  if (outboxFlushing) return
  const entries = outboxRead()
  if (!entries.length) return
  if (useApiConfigStore.getState().driver !== 'apps-script' || !useAuthStore.getState().token) {
    scheduleOutboxFlush(60_000)
    return
  }
  // nothing is sent until the boot has said who this token is
  const hand = outboxHand()
  if (!hand) {
    scheduleOutboxFlush(5_000)
    return
  }
  outboxFlushing = true
  try {
    const listed = new Map<ResourceName, Record<string, unknown>[] | null>()
    const here = currentPlace()
    for (const entry of entries) {
      const aged = Date.now() - Date.parse(entry.queuedAt) > OUTBOX_MAX_AGE_MS
      if (!entry.uid) { outboxBury(entry, 'queued before this browser recorded who made it'); continue }
      // A WRITE WAITS FOR THE HAND THAT MADE IT — the account and, while acting, the real one behind it.
      if (entry.uid !== hand.uid || (entry.realUid ?? '') !== hand.realUid) {
        if (aged) {
          // the toast goes only to the person who typed it; anyone else's expired edit leaves quietly
          if (outboxKeyboard(entry) === outboxKeyboard(hand)) outboxBury(entry, 'older than 48h')
          else outboxErase(entry.key)
        }
        continue
      }
      if (aged) { outboxBury(entry, 'older than 48h'); continue }
      // A WRITE WAITS FOR THE PLACE IT WAS MADE IN — all three axes (audit, 2026-08-18).
      if (!samePlace(entry, here)) continue
      // An earlier landing may already have named the row — then no list is needed at all, and the fingerprint…
      let realId = outboxResolvedId(entry.resource, entry.pendingId)
      if (!realId) {
        let rows = listed.get(entry.resource)
        if (rows === undefined) {
          try {
            rows = normalizeRows(entry.resource, await gas.call<Record<string, unknown>[]>(entry.resource, 'list', undefined))
          } catch { rows = null }
          listed.set(entry.resource, rows)
        }
        if (!rows) continue                      // list failed — next pass retries
        realId = outboxFindRow(entry, rows)
      }
      if (!realId) continue                      // the create is still landing
      try {
        if (entry.kind === 'remove') await gas.call(entry.resource, 'delete', { id: realId })
        else await gas.call(entry.resource, 'update', { id: realId, ...entry.patch })
        // the card is still open under the pending id — say what it became
        outboxRememberReal(entry.resource, entry.pendingId, realId)
        outboxErase(entry.key)                   // "quando conseguir, faça o erase"
        invalidate(placeScope(entry.resource))  // only entries of THIS place reach here
      } catch (err) {
        const st = (err as { envelopeStatus?: number }).envelopeStatus
        if (st && st >= 400 && st < 500) {
          entry.strikes += 1
          if (entry.strikes >= OUTBOX_MAX_STRIKES) outboxBury(entry, `refused ${entry.strikes} times ("${(err as Error).message}")`)
          else outboxPersist(entry)
        }
        // transport/5xx failures say nothing and are simply retried
      }
    }
  } finally {
    outboxFlushing = false
    if (outboxRead().length) scheduleOutboxFlush(60_000)
  }
}

/** For the tests: the outbox as stored, and one flush now. */
export function outboxEntriesForTests(): OutboxEntry[] {
  return outboxRead()
}
export function outboxFlushForTests(): Promise<void> {
  return outboxFlush()
}

// The build's snapshot-manifest emitter imports this module in Node behind a bare `window` shim — a real browser is…
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' &&
    typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  window.addEventListener('online', () => { if (outboxRead().length) scheduleOutboxFlush(1_500) })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && outboxRead().length) scheduleOutboxFlush(1_500)
  })
  if (outboxRead().length) scheduleOutboxFlush(3_000)
}

/* ---------------- facade with fallback ---------------- */

type Method = 'list' | 'get' | 'create' | 'update' | 'remove'

// Live-only resources: real data served by the Apps Script backend that must NEVER silently fall back to demo rows…
const LIVE_ONLY = new Set<ResourceName>(['candidates', 'directors'])

// Reads go through the cache (stale-while-revalidate, see lib/apiCache); writes never do, and every write drops the…
async function run<T>(method: Method, resource: ResourceName, args: unknown[]): Promise<T> {
  if (method === 'list' || method === 'get') {
    // the cache key carries the world prefix: rows read inside a world are remembered for that world only, and the…
    return cachedRead<T>(cacheKey(placeScope(resource), method, args[0]), () => runUncached<T>(method, resource, args), asBackground)
  }
  const result = await runUncached<T>(method, resource, args)
  invalidate(placeScope(resource))
  forgetWarm(resource)
  // The snapshot is told by the browser that just wrote — it already knows, and telling it from Apps Script would…
  if (!activeWorldId()) {
    noteWrite(resource, {
      id: (args[0] as { id?: string } | undefined)?.id ?? (typeof args[0] === 'string' ? args[0] : undefined),
      row: method === 'remove' ? undefined : (result as unknown),
      removed: method === 'remove',
    })
  }
  return result
}

// An unfiltered list, straight from the snapshot when there is a usable one.
async function fromSnapshot<T>(resource: ResourceName, params: ListParams | undefined): Promise<T[] | null> {
  // WORLD DATA IS NEVER SLICED: in a world, a resource named 'tasks' is the user's own tab, and the company slice…
  if (TRACKER_VIEWS[resource]) return null
  const place = activeWorldId() || activeTenantId() || ''
  if (place && seededPlace() !== place) return null
  if (!place && seededPlace() && seededPlace() !== 'home') return null
  if (params && Object.keys(params).length) return null
  if (useApiConfigStore.getState().driver !== 'apps-script') return null
  return (await readSlice<T>(resource)) as T[] | null
}

// The pink badge must PROVE the disease, continuously: there must be no LIVE API ISSUE on screen when no such issue…
let probingLive = false
export async function revalidateLive(): Promise<void> {
  const cfg = useApiConfigStore.getState()
  if (!cfg.demoFallback || probingLive) return
  const token = useAuthStore.getState().token
  if (!token) {
    cfg.setDemoFallback(false)
    return
  }
  probingLive = true
  // authStatus: the lightest action that writes no log rows.
  const probe = async (url: string) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'body=' + encodeURIComponent(JSON.stringify({ token, action: 'authStatus' })),
    })
    const env = (await res.json()) as { status?: unknown }
    return typeof env?.status === 'number' && env.status < 500
  }
  try {
    const primary = cfg.execUrl || DEFAULT_EXEC_URL
    let alive = false
    try {
      alive = await probe(primary)
    } catch {
      /* the server is down: truly unwell */
    }
    if (alive) useApiConfigStore.getState().setDemoFallback(false)
  } finally {
    probingLive = false
  }
}

// Calls nobody is waiting on.
let backgroundDepth = 0
export function runningInBackground(): boolean {
  return backgroundDepth > 0
}
export async function asBackground<T>(fn: () => Promise<T>): Promise<T> {
  backgroundDepth++
  try {
    return await fn()
  } finally {
    backgroundDepth--
  }
}

// THE FLOOR — with slices or without them a reader stays fully covered.
async function floorRead<T>(method: Method, resource: ResourceName, args: unknown[]): Promise<T | null> {
  // fromSnapshot's twin: a failed WORLD read must error honestly, never be answered by the company's slice of a…
  if (TRACKER_VIEWS[resource]) return null
  const placeF = activeWorldId() || activeTenantId() || ''
  if (placeF && seededPlace() !== placeF) return null
  if (!placeF && seededPlace() && seededPlace() !== 'home') return null
  if (method === 'list') {
    const params = args[0] as ListParams | undefined
    if (params && Object.keys(params).length) return null
    const floor = await readSliceFloor<unknown>(resource)
    if (!floor) return null
    return floor.rows as T
  }
  if (method === 'get') {
    const floor = await readSliceFloor<{ id?: unknown }>(resource)
    const row = floor?.rows.find((r) => String(r?.id ?? '') === String(args[0]))
    if (!floor || !row) return null
    return row as T
  }
  return null
}

async function runUncached<T>(method: Method, resource: ResourceName, args: unknown[]): Promise<T> {
  // A `pending-*` id is OUR OWN echo (minted below when the write ledger answers "accepted" without the row): the…
  if ((method === 'update' || method === 'remove') && String(args[0] ?? '').startsWith('pending-')) {
    const pendingId = String(args[0])
    // The outbox already landed a write for this echo and learned the real id.
    const resolved = outboxResolvedId(resource, pendingId)
    if (resolved) {
      args[0] = resolved
    } else {
      const patch = (args[1] ?? {}) as Record<string, unknown>
      const held = method === 'update'
        ? outboxEnqueue(resource, pendingId, 'update', patch)
        : outboxEnqueue(resource, pendingId, 'remove', {})
      if (held) return (method === 'update' ? { id: pendingId, ...patch } : { id: pendingId }) as T
      // the browser database refused the copy (full/blocked), or nothing is left to recognise the row by — only…
      throw new Error('This card is still landing on the sheet — it was saved, but its real id has not reached this browser yet. Reopen the board in a moment and edit it there.')
    }
  }
  const driver = useApiConfigStore.getState().driver
  if (driver === 'apps-script') {
    try {
      let out: T
      switch (method) {
        case 'list': {
          // the certification tracker is read through the door that knows who is asking (Certs.gs certTrackerList)…
          const view = TRACKER_VIEWS[resource]
          out = view
            ? trackerRowsOfAll(await gas.call<unknown>(resource, 'certTrackerList', { view })) as T
            : await gas.call<T>(resource, 'list', args[0])
          break
        }
        case 'get': out = await gas.call<T>(resource, 'get', { id: args[0] }); break
        case 'create': out = await gas.call<T>(resource, 'create', args[0]); break
        case 'update': out = await gas.call<T>(resource, 'update', { id: args[0], ...(args[1] as object) }); break
        // extras travel with a delete too: the estate sheets re-check a witness column before touching a row (see…
        case 'remove': out = await gas.call<T>(resource, 'delete', { id: args[0], ...((args[1] as object) ?? {}) }); break
      }
      // The write ledger answered "accepted" instead of the row: the save is guaranteed (queued or already executed…
      const acc = out as { accepted?: unknown } | null
      if (acc && typeof acc === 'object' && acc.accepted === true &&
          !('id' in acc) && Object.keys(acc).length <= 2) {
        if (method === 'create') {
          const sent = (args[0] ?? {}) as Record<string, unknown>
          const pendingId = `pending-${Date.now().toString(36)}`
          // the outbox recognises the real row by these fields later, so an edit made while the id is still pending…
          outboxRememberCreate(resource, pendingId, sent)
          out = { id: pendingId, ...sent } as T
        } else if (method === 'update') {
          out = { id: args[0], ...(args[1] as object) } as T
        } else if (method === 'remove') {
          out = { id: args[0] } as T
        }
      }
      if (useApiConfigStore.getState().demoFallback) {
        useApiConfigStore.getState().setDemoFallback(false)
      }
      return out
    } catch (err) {
      // a refusal written for the reader: the screen says it; no floor, no toast, no badge
      if (isReaderError(err)) throw err
      const msg = err instanceof Error ? err.message : ''
      const unknownResource = msg.startsWith('Unknown resource')
      // A dead session is definitive — serving anything would dress a signed-out person as signed in.
      const sessionDead = msg.startsWith('Session expired')
      if (!unknownResource && !sessionDead && !runningInBackground() &&
          (method === 'list' || method === 'get')) {
        const floor = await floorRead<T>(method, resource, args)
        if (floor !== null) return floor   // floorRead marks stale only when the copy is actually old
      }
      // Real data must never be silently impersonated by the demo dataset.
      if (LIVE_ONLY.has(resource)) throw err
      if (unknownResource) {
        // THE BACKEND HAS NO TABLE FOR THIS APP YET — and an app with nothing in it must LOOK like an app with…
        useApiConfigStore.getState().markUnserved(resource)
        if (method === 'list') return [] as unknown as T
        throw new Error(
          `This app has no table on the platform yet, so "${resource}" cannot be read or written. ` +
          'Ask an admin to connect it — nothing was saved.',
        )
      } else if (sessionDead) {
        // An expired session is an AUTH state, not an API disease — the person is sent to sign in; painting "Live…
        throw err
      } else if (runningInBackground()) {
        // A warm nobody asked for failed.
        throw err
      } else {
        const envelopeStatus = (err as { envelopeStatus?: number }).envelopeStatus
        if (envelopeStatus !== undefined && envelopeStatus < 500) {
          // The backend ANSWERED and refused THIS request — a per-request verdict from a healthy live path, never…
          // The real message travels; no global badge.
          toast({ type: 'danger', title: 'The backend refused this request', body: msg })
          throw err
        }
        // A resource the backend DOES serve failed at the TRANSPORT level (or answered 5xx) — that's real trouble…
        useApiConfigStore.getState().setDemoFallback(true)
        toast({
          type: 'danger',
          title: 'Live API unreachable',
          body: msg || 'This screen shows an error until the connection recovers.',
        })
        throw err
      }
    }
  }
  // THE SEEDED DATASET, AND THE ONLY DOOR LEFT TO IT.
  // @ts-expect-error — homogeneous signature across drivers
  return mock[method](resource, ...args) as Promise<T>
}

export const api = {
  list: async <T = any>(resource: ResourceName, params?: ListParams) => {
    // Every exit runs the resource's normalizer (lib/normalizeRows): the rows must look the same whether the slice…
    const snap = await fromSnapshot<T>(resource, params)
    // An EMPTY slice is not an answer (review 2026-08-05).
    if (snap && snap.length) return normalizeRows(resource, snap)
    if (snap) {
      try {
        return normalizeRows(resource, await run<T[]>('list', resource, [params]))
      } catch {
        return normalizeRows(resource, snap)
      }
    }
    return normalizeRows(resource, await run<T[]>('list', resource, [params]))
  },
  // One row.
  get: async <T = any>(resource: ResourceName, id: string) => {
    const rows = await fromSnapshot<any>(resource, undefined)
    const hit = rows?.find((r) => String(r?.id) === String(id))
    if (hit) return normalizeRow(resource, hit) as T
    return normalizeRow(resource, await run<T>('get', resource, [id]))
  },
  create: <T = any>(resource: ResourceName, payload: Partial<T>) => run<T>('create', resource, [payload]),
  update: <T = any>(resource: ResourceName, id: string, payload: Partial<T>) => run<T>('update', resource, [id, payload]),
  remove: (resource: ResourceName, id: string, extras?: Record<string, unknown>) =>
    run<{ id: string }>('remove', resource, [id, extras]),
}
