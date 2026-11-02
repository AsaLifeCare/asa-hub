// Reading from the snapshot — THE snapshot is the database.
// A slice is one file per resource, served by our own nginx from the same origin — so reading a screen costs a…
import { SNAPSHOT_MAX_AGE_MS, type SnapshotManifest, type SnapshotSlice } from '@/lib/snapshot'
import { invalidateAll } from '@/lib/apiCache'
import { useAuthStore } from '@/auth/useAuthStore'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
// every answer from a /snapshot door tells the strip whether the relay is up
import { noteDoorAnswer, relayWait } from '@/lib/hubStatus'
import { TRACKER_VIEWS } from '@/lib/certUploads'
// THE PLACE A READ IS STANDING IN.
import { activeWorldId } from '@/stores/useWorldStore'
import { activeTenantId } from '@/stores/useTenantStore'

const BASE = '/snapshot'

/** Slices this tab has, keyed by resource. Memory only, dies with the tab. */
const slices = new Map<string, SnapshotSlice>()
/** When each held slice was FETCHED — drives the turnover, not the veto. */
const fetchedAt = new Map<string, number>()
// The turnover cadence — what looked like a maximum age is really the age at which a copy turns over, and 60…
const SLICE_REFRESH_MS = 60_000
// Resources the snapshot could not serve, and WHEN we found that out.
const absent = new Map<string, number>()
/** How long a "not available" verdict stands before we look again. */
const ABSENT_RETRY_MS = 60_000
const inflight = new Map<string, Promise<SnapshotSlice | null>>()

// "I wrote this resource at T" markers, per tab session.
const DIRTY_KEY = 'asa-slice-writes-v1'
const DIRTY_TTL_MS = 5 * 60_000
function dirtyWrites(): Record<string, number> {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DIRTY_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}
// DERIVED SLICES AND WHAT THEY READ (2026-08-28).
const DERIVED_OF: Record<string, string[]> = {
  candidates: ['hiringAnalysis'],
  talentPool: ['hiringAnalysis'],
  recruitment: ['hiringAnalysis'],
}

function markWritten(resource: string): void {
  try {
    const map = dirtyWrites()
    map[resource] = Date.now()
    for (const derived of DERIVED_OF[resource] ?? []) map[derived] = Date.now()
    sessionStorage.setItem(DIRTY_KEY, JSON.stringify(map))
  } catch { /* best effort — the in-memory patch still covers this tab */ }
}
// WHICH HELD COPIES ALREADY CARRY THIS TAB'S WRITES (2026-08-30).
const patchedAt = new Map<string, number>()

/** Store a slice that came off the wire. It is by definition unpatched. */
function storeSlice(resource: string, slice: SnapshotSlice): void {
  slices.set(resource, slice)
  patchedAt.delete(resource)
}

/** true = the held copy carries every write this tab has made to it. */
function carriesOwnWrites(resource: string): boolean {
  const wrote = dirtyWrites()[resource]
  const patched = patchedAt.get(resource)
  return !!wrote && !!patched && patched >= wrote
}

/** true = this slice predates a write this tab made and must not be served. */
function predatesOwnWrite(resource: string, slice: SnapshotSlice): boolean {
  const at = dirtyWrites()[resource]
  if (!at) return false
  if (Date.now() - at > DIRTY_TTL_MS) return false
  const built = Date.parse(String(slice.built_at ?? ''))
  if (Number.isNaN(built) || built >= at) {
    // a build from after the write: the marker has served its purpose
    try {
      const map = dirtyWrites()
      delete map[resource]
      sessionStorage.setItem(DIRTY_KEY, JSON.stringify(map))
    } catch { /* stays until TTL */ }
    return false
  }
  return true
}

let manifest: SnapshotManifest['slices'] | null = null
let manifestAt = 0
let manifestJob: Promise<SnapshotManifest['slices'] | null> | null = null

// The session's bearer, for any same-origin relay reader.
export function authHeaders(): HeadersInit | undefined {
  const token = useAuthStore.getState().token
  return token ? { Authorization: `Bearer ${token}` } : undefined
}

/** Which resources the builder currently has, and how old each one is. */
export async function loadIndex(): Promise<SnapshotManifest['slices'] | null> {
  if (manifest && Date.now() - manifestAt < 60_000) return manifest
  if (manifestJob) return manifestJob
  manifestJob = fetchIndex().finally(() => { manifestJob = null })
  return manifestJob
}

async function fetchIndex(): Promise<SnapshotManifest['slices'] | null> {
  try {
    const res = await fetch(`${BASE}/index.json`, { headers: authHeaders() })
    noteDoorAnswer(`${BASE}/index.json`, res)
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null
    const body = (await res.json()) as SnapshotManifest
    manifest = body.slices ?? {}
    manifestAt = Date.now()
    return manifest
  } catch {
    // No snapshot at all is a normal state, not an error: every read simply stays on the live path, which is where…
    return null
  }
}

// The slice for a resource, or null when the live path should be used.
function fetchSliceInto(resource: string): Promise<SnapshotSlice | null> {
  let job = inflight.get(resource)
  if (!job) {
    job = fetch(`${BASE}/${resource}.json`, { headers: authHeaders() })
      .then(async (res) => {
        noteDoorAnswer(`${BASE}/${resource}.json`, res)
        const json = (res.headers.get('content-type') || '').includes('json')
        if (!res.ok || !json) {
          absent.set(resource, Date.now())
          return null
        }
        const slice = (await res.json()) as SnapshotSlice
        const prev = slices.get(resource)
        storeSlice(resource, slice)
        fetchedAt.set(resource, Date.now())
        absent.delete(resource)
        // The turnover must REACH THE SCREEN — whichever copy is newer goes in front: a genuinely newer copy rings…
        if (!prev || prev.built_at !== slice.built_at) {
          sliceListeners.forEach((fn) => {
            try { fn(resource) } catch { /* a listener's problem stays its own */ }
          })
        }
        return slice
      })
      .catch(() => {
        absent.set(resource, Date.now())
        return null
      })
      .finally(() => inflight.delete(resource))
    inflight.set(resource, job)
  }
  return job
}

// A VISIT NEVER READS A COMPANY SLICE.
function visiting(): boolean {
  return Boolean(useMemberStore.getState().currentMemberId)
}

export async function readSlice<T>(resource: string): Promise<T[] | null> {
  // Inside a visit, ONLY what was seeded for THAT person answers.
  if (visiting() && placeSeeded !== `member:${useMemberStore.getState().currentMemberId}`) return null
  // the certification tracker is read live only: a file an older index still lists holds everyone's rows
  if (TRACKER_VIEWS[resource]) return null
  const wroteOff = absent.get(resource)
  if (wroteOff !== undefined && Date.now() - wroteOff < ABSENT_RETRY_MS) return null

  // Age never refuses (the slice IS the database); only a slice predating this tab's OWN write does — that one…
  const held = slices.get(resource)
  if (held) {
    // predatesOwnWrite is evaluated FIRST rather than short-circuited past, because it CLEARS the marker when a…
    if (Date.now() - (fetchedAt.get(resource) ?? 0) <= SLICE_REFRESH_MS) {
      const stale = predatesOwnWrite(resource, held)
      return !stale || carriesOwnWrites(resource) ? (held.rows as T[]) : null
    }
    const fresh = await fetchSliceInto(resource)
    const pick = fresh ?? held
    const stale = predatesOwnWrite(resource, pick)
    // `fresh` came off the wire and cannot carry this tab's patch; only the held copy we fell back to can.
    return !stale || (!fresh && carriesOwnWrites(resource)) ? (pick.rows as T[]) : null
  }

  // ASK THE INDEX FIRST.
  const index = await loadIndex()
  if (!index) return null
  const entry = index[resource]
  // A failing build or an old stamp is the BUILDER's problem, not the reader's: the last good file still serves.
  if (!entry) return null
  const role = useAuthStore.getState().user?.role
  if (entry.roles?.length && role && !entry.roles.includes(role)) return null

  const slice = await fetchSliceInto(resource)
  return slice && !predatesOwnWrite(resource, slice) ? (slice.rows as T[]) : null
}

// The rows this tab already holds for a resource, at any age, never fetched and never refreshed: a screen's first…
export function heldRows<T>(resource: string): T[] | null {
  if (visiting() && placeSeeded !== `member:${useMemberStore.getState().currentMemberId}`) return null
  if (TRACKER_VIEWS[resource]) return null
  const held = slices.get(resource)
  if (!held) return null
  const wrote = dirtyWrites()[resource]
  if (wrote && Date.now() - wrote <= DIRTY_TTL_MS && !carriesOwnWrites(resource)) {
    const built = Date.parse(String(held.built_at ?? ''))
    if (!Number.isNaN(built) && built < wrote) return null
  }
  return held.rows as T[]
}

// THE BANG — one json carries the data of the whole site, so a single bang puts everything on its feet: one fetch…
export async function placeLoad(place: { world?: string; tenant?: string; member?: string }): Promise<number> {
  // A VISIT HAS ITS OWN FILE NOW (2026-08-20).
  if (visiting() && !place.member) return 0
  try {
    const q = place.member ? `?member=${encodeURIComponent(place.member)}`
      : place.world ? `?world=${encodeURIComponent(place.world)}`
      : place.tenant ? `?tenant=${encodeURIComponent(place.tenant)}` : ''
    const res = await fetch(`${BASE}/place${q}`, { headers: authHeaders() })
    noteDoorAnswer(`${BASE}/place`, res)
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return 0
    const bundle = (await res.json()) as { slices?: Record<string, SnapshotSlice> }
    const now = Date.now()
    let seeded = 0
    for (const [resource, slice] of Object.entries(bundle.slices ?? {})) {
      if (!slice || !Array.isArray(slice.rows)) continue
      storeSlice(resource, slice)
      fetchedAt.set(resource, now)
      absent.delete(resource)
      seeded++
    }
    if (seeded) placeSeeded = place.member ? `member:${place.member}` : place.world || place.tenant || 'home'
    return seeded
  } catch {
    return 0
  }
}

// Which place the in-memory slices were seeded for ('' = none).
let placeSeeded = ''
export function seededPlace(): string { return placeSeeded }

export async function bangLoad(): Promise<number> {
  if (visiting()) return 0
  try {
    const res = await fetch(`${BASE}/all.json`, { headers: authHeaders() })
    noteDoorAnswer(`${BASE}/all.json`, res)
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return 0
    const bundle = (await res.json()) as {
      slices?: Record<string, SnapshotSlice>
      access?: { badges?: Record<string, string[]>; tenants?: Record<string, string[]>; sections?: Record<string, string[]> }
      config?: {
        shelf?: { sections?: unknown[]; placement?: Record<string, string>; order?: Record<string, string[]> }
        source?: string
        menuLinks?: { links?: unknown }
        appsBuilt?: { apps?: unknown[]; problems?: unknown[] }
        hiringViews?: { views?: string[] }
        clientViews?: { views?: string[]; tools?: string[]; toolbar?: boolean }
        potClientsViews?: { views?: string[] }
        ist?: { values?: Record<string, string>; problems?: Record<string, string>; unknown?: string[]; tab?: string }
      }
    }
    // An empty matrix means "not read", never "nothing is allowed": applying it would leave every non-master with…
    if (bundle.access) {
      const store = useBadgeAccessStore.getState()
      const filled = (m?: Record<string, string[]>) => !!m && Object.keys(m).length > 0
      if (filled(bundle.access.badges)) store.setRules(bundle.access.badges!)
      if (filled(bundle.access.tenants)) store.setTenantRules(bundle.access.tenants!)
      if (filled(bundle.access.sections)) store.setConfigRules(bundle.access.sections!)
    }
    // THE SIDEBAR'S SHAPE ARRIVES WITH THE DATA.
    if (bundle.config?.shelf?.sections?.length) {
      const shelf = bundle.config.shelf
      void import('@/stores/useCategoryStore')
        .then(({ useCategoryStore }) => useCategoryStore.getState().adopt(shelf as never))
        .catch(() => { /* the live pull is still the door */ })
    }
    // THE VIEW POLICIES, WHEN THE BACKEND ITSELF ANSWERED THEM.
    const cfg = bundle.config
    // THE IST SETTINGS, from the mirror, resolved by the one declaration: the IST and compliance screens read this…
    if (cfg?.ist?.values) {
      const ist = cfg.ist
      void import('@/lib/istConfig')
        .then(({ seedIstConfig }) => seedIstConfig(ist))
        .catch(() => { /* the live pull is still the door */ })
    }
    if (cfg?.source === 'backend') {
      // THE TOP BAR AND THE SHEET-BUILT APPS, from the file the machine already built (2026-08-29).
      if (cfg.menuLinks) {
        void import('@/stores/useUserMenuStore')
          .then(({ seedUserMenuLinks }) =>
            seedUserMenuLinks((cfg.menuLinks as { links?: unknown }).links,
                              useAuthStore.getState().token))
          .catch(() => { /* the live pull is still the door */ })
      }
      if (cfg.appsBuilt) {
        void import('@/lib/sheetApps')
          .then(({ seedSheetApps }) => seedSheetApps(cfg.appsBuilt as never))
          .catch(() => { /* the live pull is still the door */ })
      }
      if (cfg.hiringViews) {
        void import('@/stores/useHiringPolicyStore')
          .then(({ useHiringPolicyStore }) => useHiringPolicyStore.getState().apply(cfg.hiringViews as never))
          .catch(() => { /* the live pull is still the door */ })
      }
      if (cfg.clientViews) {
        void import('@/stores/useClientsPolicyStore')
          .then(({ useClientsPolicyStore }) => useClientsPolicyStore.getState().apply(cfg.clientViews as never))
          .catch(() => { /* the live pull is still the door */ })
      }
      if (cfg.potClientsViews) {
        void import('@/stores/usePotClientsViewsStore')
          .then(({ usePotClientsPolicyStore }) => usePotClientsPolicyStore.getState().apply(cfg.potClientsViews as never))
          .catch(() => { /* the live pull is still the door */ })
      }
    }
    const entries = Object.entries(bundle.slices ?? {})
    const now = Date.now()
    let seeded = 0
    for (const [resource, slice] of entries) {
      if (!slice || !Array.isArray(slice.rows)) continue
      storeSlice(resource, slice)
      fetchedAt.set(resource, now)
      absent.delete(resource)
      seeded++
    }
    return seeded
  } catch {
    return 0
  }
}

// A write just landed.
export function noteWrite(resource: string, applied?: { id?: string | number; row?: unknown; removed?: boolean }) {
  const slice = slices.get(resource)
  if (slice && applied?.id !== undefined) {
    const idx = slice.rows.findIndex((r) => (r as { id?: unknown })?.id === applied.id)
    if (applied.removed) {
      if (idx >= 0) slice.rows.splice(idx, 1)
    } else if (applied.row) {
      // MERGE, never replace: when the write ledger answers before the sheet, the api facade hands us only {id…
      if (idx >= 0) slice.rows[idx] = { ...(slice.rows[idx] as object), ...(applied.row as object) }
      else slice.rows.unshift(applied.row)
    }
    // THE COPY NOW CARRIES THE WRITE.
    patchedAt.set(resource, Date.now())
  } else {
    // We cannot say what changed, so we stop claiming to know: the next read of this resource goes live until a…
    slices.delete(resource)
    patchedAt.delete(resource)
  }
  // A derivation cannot be patched in place — its rows are counts, not the row that changed — so the held copy is…
  for (const derived of DERIVED_OF[resource] ?? []) {
    slices.delete(derived)
    patchedAt.delete(derived)
  }

  markWritten(resource)

  void fetch(`${BASE}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeaders() ?? {}) },
    body: JSON.stringify({ resource }),
    keepalive: true,
  }).catch(() => {
    // Best effort.
  })
}

// noteWrite for a screen that waits on the answer: each resource's held copy and its derivations are let go (its…
export async function noteWriteAwaited(resources: string[]): Promise<string[]> {
  const names = [...new Set(resources.filter(Boolean))]
  if (!names.length) return []
  for (const resource of names) {
    slices.delete(resource)
    patchedAt.delete(resource)
    for (const derived of DERIVED_OF[resource] ?? []) {
      slices.delete(derived)
      patchedAt.delete(derived)
    }
    markWritten(resource)
  }
  try {
    const res = await fetch(`${BASE}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authHeaders() ?? {}) },
      body: JSON.stringify({ resources: names }),
    })
    const body = (await res.json().catch(() => null)) as { accepted?: unknown } | null
    return Array.isArray(body?.accepted) ? body.accepted.map(String).filter((n) => names.includes(n)) : []
  } catch {
    return []
  }
}

// The relay wrote these slices again with an edit laid (server/edit_overlay.py): each is read again now, never refused.
export async function refetchSlices(resources: string[]): Promise<void> {
  const names = [...new Set(resources.filter(Boolean))]
  for (const resource of names) {
    slices.delete(resource)
    patchedAt.delete(resource)
  }
  await Promise.all(names.map((resource) => fetchSliceInto(resource)))
}

// LAST RESORT — the floor under a dead live path.
export async function readSliceFloor<T>(resource: string): Promise<{ rows: T[]; ageMs: number | null; sourceAgeMs: number | null } | null> {
  // a stale company file is still a company file — the floor is refused unless it was seeded for this very person
  if (visiting() && placeSeeded !== `member:${useMemberStore.getState().currentMemberId}`) return null
  if (TRACKER_VIEWS[resource]) return null
  // HOW LONG SINCE WE LOOKED — not how long since the data moved.
  const age = (s: SnapshotSlice): number | null => {
    // `built_at` is required on a slice and `source_at` is not, which is why the fallback needs a floor of its own…
    const stamp = Date.parse(s.built_at || s.source_at || '')
    return Number.isNaN(stamp) ? null : Date.now() - stamp
  }
  const sourceAge = (s: SnapshotSlice): number | null => {
    const stamp = Date.parse(s.source_at || '')
    return Number.isNaN(stamp) ? null : Date.now() - stamp
  }
  const held = slices.get(resource)
  // Same order as readSlice: let predatesOwnWrite run (it clears a spent marker), then serve anyway when this tab's…
  if (held && (!predatesOwnWrite(resource, held) || carriesOwnWrites(resource))) {
    return { rows: held.rows as T[], ageMs: age(held), sourceAgeMs: sourceAge(held) }
  }
  const index = await loadIndex()
  const entry = index?.[resource]
  // entry.error is NOT a refusal here: a failing builder still leaves the last good file on disk, and that file is…
  if (!entry) return null
  const role = useAuthStore.getState().user?.role
  if (entry.roles?.length && role && !entry.roles.includes(role)) return null
  try {
    const res = await fetch(`${BASE}/${resource}.json`, { headers: authHeaders() })
    noteDoorAnswer(`${BASE}/${resource}.json`, res)
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null
    const slice = (await res.json()) as SnapshotSlice
    storeSlice(resource, slice)
    if (predatesOwnWrite(resource, slice)) return null
    return { rows: slice.rows as T[], ageMs: age(slice), sourceAgeMs: sourceAge(slice) }
  } catch {
    return null
  }
}


// THE BELL FINALLY HAS A ROPE.
let liveStop: (() => void) | null = null

// NAMED EVENTS, FOR A SCREEN THAT IS NOT A SLICE.
const liveListeners = new Map<string, Set<(name: string) => void>>()

export function onLiveEvent(name: string, fn: (name: string) => void): () => void {
  let set = liveListeners.get(name)
  if (!set) {
    set = new Set()
    liveListeners.set(name, set)
  }
  set.add(fn)
  return () => {
    const s = liveListeners.get(name)
    if (!s) return
    s.delete(fn)
    if (!s.size) liveListeners.delete(name)
  }
}

/** Runs on every name before its own listeners: what a tab holds about it is let go before any screen reads again. */
const liveFirst = new Set<(name: string) => void>()

export function onAnyLiveEvent(fn: (name: string) => void): () => void {
  liveFirst.add(fn)
  return () => { liveFirst.delete(fn) }
}

function ringLive(name: string) {
  for (const fn of [...liveFirst]) {
    try { fn(name) } catch { /* a listener's problem stays its own */ }
  }
  const set = liveListeners.get(name)
  if (!set) return
  for (const fn of [...set]) {
    try { fn(name) } catch { /* a listener's problem stays its own */ }
  }
}

/** The stream is open, and when it last said anything — a keepalive counts. */
let liveOpen = false
let liveHeardAt = 0
// The relay pings every 25 s; nearly three missed pings is a line gone quiet, however open the socket still looks…
const LIVE_QUIET_MS = 70_000

// Whether this tab is hearing the relay right now — screens use it to relax their polls, never to skip a read…
export function liveConnected(): boolean {
  return liveOpen && Date.now() - liveHeardAt < LIVE_QUIET_MS
}

function liveClosed() {
  if (!liveOpen) return
  liveOpen = false
  ringLive('close')
}

export function startLiveUpdates(): () => void {
  if (liveStop) return liveStop
  const ctrl = new AbortController()
  let stopped = false
  // Backoff so a server that is down does not become a reconnect flood; reset on every message, because a stream…
  let wait = 2000

  const run = async () => {
    while (!stopped) {
      try {
        const res = await fetch(`${BASE}/events`, { headers: authHeaders(), signal: ctrl.signal })
        noteDoorAnswer(`${BASE}/events`, res)
        if (!res.ok || !res.body) throw new Error(String(res.status))
        wait = 2000
        liveOpen = true
        liveHeardAt = Date.now()
        ringLive('open')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          liveHeardAt = Date.now()
          buf += decoder.decode(value, { stream: true })
          // SSE frames are separated by a blank line; ':' lines are comments (our keepalives) and carry nothing.
          const frames = buf.split('\n\n')
          buf = frames.pop() ?? ''
          for (const frame of frames) {
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue
              const resource = line.slice(5).trim()
              if (!resource) continue
              // `open` and `close` are this stream's own word, never a frame's
              if (resource !== 'open' && resource !== 'close') ringLive(resource)
              // RE-READ, then ring.
              if (slices.has(resource) || fetchedAt.has(resource)) {
                void fetchSliceInto(resource)
              }
            }
          }
        }
      } catch {
        if (stopped) return
      }
      // a stopped stream was already closed by liveStop — a newer one may be open
      if (stopped) return
      liveClosed()
      // a relay coming back up is retried often, so the strip clears soon
      await new Promise((r) => setTimeout(r, relayWait(wait)))
      wait = Math.min(wait * 2, 60_000)
    }
  }
  void run()

  liveStop = () => {
    stopped = true
    ctrl.abort()
    liveStop = null
    liveClosed()
  }
  return liveStop
}

// Forget everything this tab holds — used when a shared seat is released.
const sliceListeners = new Set<(resource: string) => void>()
export function onSliceChange(fn: (resource: string) => void): () => void {
  sliceListeners.add(fn)
  return () => { sliceListeners.delete(fn) }
}

export function forgetSnapshot() {
  slices.clear()
  fetchedAt.clear()
  absent.clear()  // Map, same call
  manifest = null
  manifestAt = 0
}

// IDENTITY IS A MEMORY BOUNDARY.
let lastIdentity = ''
useAuthStore.subscribe((s) => {
  const identity = `${s.user?.id ?? ''}:${s.token ?? ''}`
  if (identity === lastIdentity) return
  lastIdentity = identity
  forgetSnapshot()
  invalidateAll()
  try { sessionStorage.removeItem('asa-slice-writes-v1') } catch { /* best effort */ }
  const cfg = useApiConfigStore.getState()
  if (cfg.demoFallback) cfg.setDemoFallback(false)
})

// AND A CROSSING IS A MEMORY BOUNDARY TOO (2026-08-20).
const visitStamp = (s: { currentMemberId: string; memberEpoch: number }) =>
  `${s.currentMemberId}:${s.memberEpoch}`
// SEEDED FROM THE STORE, NOT FROM '' — and that is not a nicety.
let lastVisit = visitStamp(useMemberStore.getState())
useMemberStore.subscribe((s) => {
  const here = visitStamp(s)
  if (here === lastVisit) return
  lastVisit = here
  forgetSnapshot()
  placeSeeded = ''
  invalidateAll()
})

/** For the age line on screen: how old the data behind a resource is, in ms. */
export function sliceAgeMs(resource: string): number | null {
  const slice = slices.get(resource)
  if (!slice) return null
  const stamp = Date.parse(slice.source_at || slice.built_at)
  return Number.isNaN(stamp) ? null : Date.now() - stamp
}

// -------------------------------------------------------------------------- THE RUNG BELOW EVERYTHING, AND ABOVE…
export type DepositTabState =
  'rows' | 'absent' | 'too-large' | 'unreadable' | 'no-deposit' | 'withheld' | 'offline'

// WHAT THE AGE IS AN AGE OF, which is not the same question as how old it is.
type DepositFacts = {
  builtAt: string
  ageMs: number | null
  stale: boolean
  unreadableBooks: string[]
  source: 'deposit' | 'slice' | ''
  carried: boolean | null
}

export type DepositTab<T> =
  | ({ state: 'rows'; rows: T[] } & DepositFacts)
  | ({ state: Exclude<DepositTabState, 'rows'> } & DepositFacts)

// A tab answer is a tab.
const TAB_ANSWER_MAX_BYTES = 8 * 1024 * 1024

/** The sentence a screen can print for anything that is not `rows`. */
export function depositTabWhy(state: Exclude<DepositTabState, 'rows'>): string {
  switch (state) {
    case 'absent': return 'this tab is not in the saved copy'
    case 'too-large': return 'this tab is too large to serve from the saved copy'
    case 'unreadable': return 'the saved copy could not be read'
    case 'no-deposit': return 'there is no saved copy for this place yet'
    case 'withheld': return 'this account may not read this tab'
    default: return 'the server did not answer'
  }
}

type PlaceQuery = { world?: string; tenant?: string; member?: string }

// THE SAME DOOR `placeLoad` USES, with `tab=` on it — deliberately not a new path.
export async function depositTab<T>(resource: string, place?: PlaceQuery): Promise<DepositTab<T>> {
  // WHERE THE CALLER IS STANDING, ASKED OF THE SAME STORES EVERY OTHER READ PATH ASKS (review).
  const where: PlaceQuery = place ?? (() => {
    const memberId = useMemberStore.getState().currentMemberId
    if (memberId) return { member: memberId }
    const world = activeWorldId()
    if (world) return { world }
    const tenant = activeTenantId()
    if (tenant) return { tenant }
    return {}
  })()
  const parts = [`tab=${encodeURIComponent(resource)}`]
  if (where.member) parts.push(`member=${encodeURIComponent(where.member)}`)
  else if (where.world) parts.push(`world=${encodeURIComponent(where.world)}`)
  else if (where.tenant) parts.push(`tenant=${encodeURIComponent(where.tenant)}`)
  const offline = {
    state: 'offline' as const, builtAt: '', ageMs: null, stale: false,
    unreadableBooks: [], source: '' as const, carried: null,
  }
  try {
    const res = await fetch(`${BASE}/place?${parts.join('&')}`, { headers: authHeaders() })
    noteDoorAnswer(`${BASE}/place`, res)
    if (!(res.headers.get('content-type') || '').includes('json')) return offline
    // A RELAY THAT DOES NOT KNOW `tab=` HANDS BACK THE WHOLE BUNDLE (review).
    const declared = Number(res.headers.get('content-length') || '0')
    if (declared > TAB_ANSWER_MAX_BYTES) return offline
    const body = await res.json() as {
      state?: string; rows?: unknown; built_at?: string; age_s?: number | null
      stale?: boolean | null; deposit_unreadable?: unknown
      source?: string; resource?: string; carried?: boolean
    }
    // And the honest half, for a relay that sent no length: the tab route names the resource it answered for and…
    if (body.resource !== resource || !body.source) return offline
    const builtAt = String(body.built_at || '')
    // THE AGE COMES FROM THE DEPOSIT'S OWN STAMP.
    const ageMs = typeof body.age_s === 'number' ? body.age_s * 1000
      : builtAt && !Number.isNaN(Date.parse(builtAt)) ? Date.now() - Date.parse(builtAt)
      : null
    const stale = typeof body.stale === 'boolean' ? body.stale
      : ageMs === null ? false : ageMs > SNAPSHOT_MAX_AGE_MS
    const books = Array.isArray(body.deposit_unreadable)
      ? body.deposit_unreadable.map(String) : []
    const source: 'deposit' | 'slice' | '' = body.source === 'slice' ? 'slice'
      : body.source === 'deposit' ? 'deposit' : ''
    // Absent means the relay did not say, and that is its own answer — never folded into `false`, which would claim…
    const carried = typeof body.carried === 'boolean' ? body.carried : null
    if (body.state === 'rows' && Array.isArray(body.rows)) {
      return { state: 'rows', rows: body.rows as T[], builtAt, ageMs, stale, unreadableBooks: books, source, carried }
    }
    const known: DepositTabState[] = ['absent', 'too-large', 'unreadable', 'no-deposit', 'withheld']
    const state = known.includes(body.state as DepositTabState)
      ? body.state as Exclude<DepositTabState, 'rows'>
      // A shape this build does not recognise is NOT an empty tab.
      : 'offline'
    return { state, builtAt, ageMs, stale, unreadableBooks: books, source, carried }
  } catch {
    return offline
  }
}

export { SNAPSHOT_MAX_AGE_MS }
