// THE KEPT COPY — these are stored rather than volatile, held in local storage because they matter too much to lose.
// A heavy assembled read (the staff profile, the performance profile) renders INSTANTLY from the last kept copy and…

// THE COPIES LIVE IN INDEXEDDB, NOT ON THE LOCALSTORAGE SHELF.

// THE NAME STAYS ON THE SHELF.

type Kept = { v: unknown; at: string }
/** What the database holds under a key: the copy, when it was kept, its id. */
type Stored = { v: unknown; at: string; id: string }
type Receipt = { at: string; id: string }
// In memory a copy is held in ONE of two forms: `raw` (the JSON a keep() produced) or `v` (a private object read…
type Entry = { at: string; id: string; raw?: string; v?: unknown }

const DB_NAME = 'asa-kept'
const STORE = 'entries'
// An open that has not answered by now is treated as unavailable for this session; later keeps use the shelf.
const OPEN_GIVE_UP_MS = 5_000
// THE DATABASE IS NOT AN ARCHIVE.
const MAX_AGE_MS = 30 * 24 * 3600 * 1000
// THE COUNT BOUNDS THE PER-RECORD COPIES ONLY.
const MAX_RECORD_ENTRIES = 400
const RECORD_FAMILIES = ['asa:profile:', 'asa:perf:', 'asa:cal:server:', 'asa:cal:files:']
const SCREEN_COPIES = ['asa:perf:board']
// COPIES NO SCREEN READS ANY MORE.
const RETIRED_KEYS = ['smartcomms.hotline.calls', 'smartcomms.hotline.items']
// Without IndexedDB the shelf is still the store, and one copy may take at most this many characters of it — the…
const SHELF_MAX_CHARS = 256 * 1024
// A receipt younger than this is never treated as an orphan: another tab may have just written it, with its…
const ORPHAN_GRACE_MS = 60_000
const RECEIPT_HEAD = '{"kept":"indexeddb"'
// The shelf's half of the generation: every forget writes a new id here, so a read another tab started before this…
const GENERATION_KEY = 'asa-kept-generation'

// ONE SCREEN STILL READS THE SHELF DIRECTLY.
const SWEEP_LEAVES_PREFIXES = ['asa:cal:']

const memory = new Map<string, Entry>()
const migrating = new Set<string>()
const refreshing = new Set<string>()
/** undefined: not settled yet · null: unavailable this session. */
let db: IDBDatabase | null | undefined
let opening: Promise<void> | null = null
let warming: Promise<void> | null = null
let warmed = false
let freeing = false
let idSeq = 0
/** This tab's half of the generation — counts the forgets this module has run. */
let generation = 0
const forgetListeners = new Set<() => void>()

// ------------------------------------------------------------------ the public doorway — the same two synchronous…

export function readKept<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) {
      // the name is gone from the shelf: a crossing or a sign-out forgot it (or it was never kept) — a copy must…
      if (memory.delete(key)) whenDb(() => idbWrite([[key, null]]))
      return null
    }
    const receipt = receiptOf(raw)
    if (receipt) {
      const entry = memory.get(key)
      if (entry && entry.id === receipt.id) return (decode(entry) ?? null) as T | null
      // the receipt names a copy this tab does not hold: another tab kept a newer one or cleared it, or the boot…
      if (entry) memory.delete(key)
      refreshOne(key)
      return null
    }
    const legacy = parseKeptShape(raw)
    if (!legacy) return null
    scheduleMigration(key, raw)
    return (legacy.v ?? null) as T | null
  } catch { return null }
}

export function keep(key: string, v: unknown): void {
  try {
    const raw = JSON.stringify(v) as string | undefined
    if (raw === undefined) { forget(key); return }   // nothing JSON can hold
    const entry: Entry = { at: new Date().toISOString(), id: newId(), raw }
    if (db === null) { keepOnShelf(key, raw, entry); return }
    memory.set(key, entry)
    // the receipt replaces whatever the shelf held under this name — a legacy full copy included, which is this…
    if (!writeReceipt(key, entry.id)) { memory.delete(key); return }
    writeThrough(key, entry, () => {
      // the database turned out to be unavailable after all: the shelf, or this session's memory when the copy is…
      if (memory.get(key) === entry) keepOnShelf(key, raw, entry)
    })
  } catch { /* storage full or blocked — the next open simply fetches */ }
}

// WHICH GENERATION A READ STARTED IN — taken as the read starts, handed back to `keepIfCurrent` when it lands.
export function keptGeneration(): string {
  let shelf = ''
  try { shelf = localStorage.getItem(GENERATION_KEY) ?? '' } catch { /* this tab's count still answers */ }
  return `${generation}|${shelf}`
}

// `keep`, unless a sign-out or a crossing forgot everything after the read started (`generation` is what…
export function keepIfCurrent(key: string, v: unknown, gen: string): boolean {
  if (gen !== keptGeneration()) return false
  keep(key, v)
  return true
}

/** One copy forgotten — memory, its name on the shelf and the database. Never throws. */
export function forgetKept(key: string): void {
  try { forget(key) } catch { /* the next keep under the name replaces it */ }
}

// Hear every `forgetAllKept`, for a cache this module does not hold — one that lives in a screen's own memory.
export function onForgetAllKept(listener: () => void): () => void {
  forgetListeners.add(listener)
  return () => { forgetListeners.delete(listener) }
}

// Load every copy into memory, then move the legacy copies off the shelf.
export function warmKept(): Promise<void> {
  if (!warming) {
    warming = warm()
      .catch(() => { /* a copy that cannot be loaded is a copy the next open fetches */ })
      .finally(() => { warmed = true })
  }
  return warming
}

// FORGET EVERY KEPT COPY, NOW — memory, the receipts, any full copy still on the shelf, and the database.
export function forgetAllKept(): void {
  // the generation moves FIRST, so nothing below that fails can leave a late read free to keep
  generation += 1
  try {
    localStorage.setItem(GENERATION_KEY, newId())
  } catch {
    // a full or blocked shelf: a mark that is gone is still a changed mark
    try { localStorage.removeItem(GENERATION_KEY) } catch { /* this tab's count moved all the same */ }
  }
  try {
    memory.clear()
    migrating.clear()
    refreshing.clear()
  } catch { /* a Map that will not clear still answers nothing without its receipts */ }
  try {
    for (const key of shelfKeys()) {
      const raw = localStorage.getItem(key)
      if (receiptOf(raw) !== null || parseKeptShape(raw) !== null) localStorage.removeItem(key)
    }
  } catch { /* a shelf that cannot be walked keeps its names; the database still goes */ }
  whenDb((d) => {
    if (!d) return
    try {
      d.transaction(STORE, 'readwrite').objectStore(STORE).clear()
    } catch { /* receipts are gone, so the next boot's warm deletes what stayed */ }
  })
  for (const listener of [...forgetListeners]) {
    try { listener() } catch { /* one cache that will not clear does not keep the others */ }
  }
}

// THE RELIEF VALVE FOR A FULL SHELF (lib/safeStorage).
export function freeKeptSpace(): number {
  return freeShelf(null)
}

// WHAT COUNTS AS A LEGACY KEPT COPY — strictly the shape `keep` used to write: a JSON object whose only keys are…
export function parseKeptShape(raw: string | null | undefined): Kept | null {
  if (typeof raw !== 'string' || !(raw.startsWith('{"v":') || raw.startsWith('{"at":'))) return null
  try {
    const o: unknown = JSON.parse(raw)
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null
    const keys = Object.keys(o)
    if (keys.length !== 2 || !keys.includes('v') || !keys.includes('at')) return null
    const at = (o as { at: unknown }).at
    return typeof at === 'string' ? { v: (o as { v: unknown }).v, at } : null
  } catch { return null }
}

// Is this the browser saying the shelf is full?
export function isQuotaError(e: unknown): boolean {
  const { name, code } = (e ?? {}) as { name?: unknown; code?: unknown }
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 || code === 1014
}

// ------------------------------------------------------------------ boot…

async function warm(): Promise<void> {
  retire()
  await openDb()
  const d = db
  if (!d) return   // no database this session: the shelf stays the store
  const stored = await readAll(d)
  if (!stored) return   // an unreadable database is not an empty one — prune nothing

  // From here to the end runs in ONE synchronous stretch, so no keep() can land between reading the shelf and…
  const now = Date.now()
  const doomed: string[] = []
  const records: Array<[string, Stored, number]> = []
  for (const [key, val] of stored) {
    // a legacy copy is moving over this one right now; its own commit decides
    if (migrating.has(key)) continue
    if (RETIRED_KEYS.includes(key)) { doomed.push(key); continue }
    const kept = asStored(val)
    const receipt = receiptOf(localStorage.getItem(key))   // a shelf that cannot be read aborts the warm: load nothing
    // no receipt means the name was swept (a crossing, a sign-out), or the shelf holds a newer full copy that the…
    if (!kept || !receipt) { doomed.push(key); continue }
    if (kept.id !== receipt.id) {
      // the receipt names another copy: one another tab is still writing (left alone), or one that never landed…
      if (!isYoung(receipt.at, now)) doomed.push(key)
      continue
    }
    if (memory.get(key)?.id === kept.id) continue   // this session already holds it
    const t = Date.parse(kept.at)
    if (!(now - t <= MAX_AGE_MS)) { doomed.push(key); continue }
    if (isRecordCopy(key)) { records.push([key, kept, t]); continue }
    memory.set(key, { at: kept.at, id: kept.id, v: kept.v })
  }
  records.sort((a, b) => b[2] - a[2])
  records.forEach(([key, kept], i) => {
    if (i >= MAX_RECORD_ENTRIES) { doomed.push(key); return }
    memory.set(key, { at: kept.at, id: kept.id, v: kept.v })
  })
  idbWrite(doomed.map((k): [string, null] => [k, null]))

  // the legacy copies move off the shelf
  const batch: Move[] = []
  for (const key of shelfKeys()) {
    if (migrating.has(key) || RETIRED_KEYS.includes(key) ||
        SWEEP_LEAVES_PREFIXES.some((p) => key.startsWith(p))) continue
    const raw = localStorage.getItem(key)
    const legacy = parseKeptShape(raw)
    if (raw === null || !legacy) continue
    if (!(now - Date.parse(legacy.at) <= MAX_AGE_MS)) { localStorage.removeItem(key); continue }
    migrating.add(key)
    batch.push({ key, raw, legacy })
  }
  migrate(batch)

  // and receipts whose copy is gone (evicted, capped, never committed) leave with it
  for (const key of shelfKeys()) {
    if (migrating.has(key)) continue
    const receipt = receiptOf(localStorage.getItem(key))
    if (receipt === null || memory.get(key)?.id === receipt.id || isYoung(receipt.at, now)) continue
    memory.delete(key)
    localStorage.removeItem(key)
  }
}

// The retired copies leave the shelf and memory at once; the database copies go with the warm's own deletions.
function retire(): void {
  for (const key of RETIRED_KEYS) {
    memory.delete(key)
    try { localStorage.removeItem(key) } catch { /* a blocked shelf holds nothing to free */ }
  }
}

type Move = { key: string; raw: string; legacy?: Kept }

// Put legacy copies in the database; only once that COMMITS does the shelf copy become a receipt — a tab closed…
function migrate(batch: Move[]): void {
  if (!db || batch.length === 0) {
    batch.forEach((m) => migrating.delete(m.key))
    return
  }
  const moves: Array<{ key: string; raw: string; entry: Entry; before: Entry | undefined }> = []
  for (const m of batch) {
    const legacy = m.legacy ?? parseKeptShape(m.raw)
    if (!legacy) { migrating.delete(m.key); continue }
    moves.push({ key: m.key, raw: m.raw, entry: { at: legacy.at, id: newId(), v: legacy.v }, before: memory.get(m.key) })
  }
  const settled = () => moves.forEach((m) => migrating.delete(m.key))
  const started = idbWrite(
    moves.map((m): [string, Stored] => [m.key, { v: m.entry.v, at: m.entry.at, id: m.entry.id }]),
    () => {
      for (const m of moves) {
        migrating.delete(m.key)
        let current: string | null = null
        try { current = localStorage.getItem(m.key) } catch { continue }
        if (current === null) { idbWrite([[m.key, null]]); continue }   // swept while it moved
        if (current !== m.raw || memory.get(m.key) !== m.before) continue   // a newer keep got there first
        memory.set(m.key, m.entry)
        if (!writeReceipt(m.key, m.entry.id)) memory.delete(m.key)
      }
    },
    settled,   // the move failed: the shelf copy stays, and the next boot tries again
  )
  if (!started) settled()
}

function scheduleMigration(key: string, raw: string): void {
  if (db === null || migrating.has(key) || RETIRED_KEYS.includes(key)) return
  migrating.add(key)
  // re-parsed later on purpose: the object readKept parsed now belongs to its caller
  whenDb(() => migrate([{ key, raw }]))
}

// ONE COPY FETCHED FOR THE NEXT READ, when the shelf names a copy this tab does not hold.
function refreshOne(key: string): void {
  if (db === null || refreshing.has(key) || (warming !== null && !warmed)) return
  refreshing.add(key)
  whenDb((d) => {
    if (!d || !refreshing.has(key)) { refreshing.delete(key); return }
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => {
        if (!refreshing.delete(key)) return   // everything was forgotten meanwhile
        try {
          const kept = asStored(req.result)
          const receipt = receiptOf(localStorage.getItem(key))
          if (!kept || !receipt || kept.id !== receipt.id) return
          if (memory.get(key)?.id === receipt.id) return
          memory.set(key, { at: kept.at, id: kept.id, v: kept.v })
        } catch { /* the next open fetches */ }
      }
      req.onerror = () => { refreshing.delete(key) }
    } catch { refreshing.delete(key) }
  })
}

// ------------------------------------------------------------------ the shelf…

function shelfKeys(): string[] {
  const out: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k !== null) out.push(k)
  }
  return out
}

/** The receipt's `at` and `id` when `raw` is a receipt ('' for either it lacks), else null. */
function receiptOf(raw: string | null): Receipt | null {
  if (raw === null || !raw.startsWith(RECEIPT_HEAD)) return null
  try {
    const o = JSON.parse(raw) as { at?: unknown; id?: unknown }
    return { at: typeof o.at === 'string' ? o.at : '', id: typeof o.id === 'string' ? o.id : '' }
  } catch { return null }
}

function isYoung(at: string, now: number): boolean {
  const t = Date.parse(at)
  return Number.isFinite(t) && now - t < ORPHAN_GRACE_MS
}

function isRecordCopy(key: string): boolean {
  return !SCREEN_COPIES.includes(key) && RECORD_FAMILIES.some((p) => key.startsWith(p))
}

function newId(): string {
  try {
    const c = globalThis.crypto
    if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  } catch { /* an insecure context has no randomUUID */ }
  idSeq += 1
  return `${Date.now().toString(36)}-${idSeq.toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** `at` is the receipt's own write time — the orphan grace reads it. */
function writeReceipt(key: string, id: string): boolean {
  const receipt = JSON.stringify({ kept: 'indexeddb', at: new Date().toISOString(), id })
  try { localStorage.setItem(key, receipt); return true } catch (e) {
    if (freeing || !isQuotaError(e) || freeShelf(key) <= 0) return false
    try { localStorage.setItem(key, receipt); return true } catch { return false }
  }
}

/** The pre-IndexedDB write, byte-identical to what `keep` always stored. */
function writeShelfCopy(key: string, raw: string, at: string): boolean {
  const copy = `{"v":${raw},"at":${JSON.stringify(at)}}`
  try {
    if (copy.length > SHELF_MAX_CHARS) {
      // too big to share the shelf; an older copy under this name goes too, rather than painting a copy the screen…
      localStorage.removeItem(key)
      return false
    }
    try { localStorage.setItem(key, copy); return true } catch (e) {
      if (freeing || !isQuotaError(e) || freeShelf(key) <= 0) return false
      localStorage.setItem(key, copy)
      return true
    }
  } catch { return false }
}

/** No database: the shelf, and failing that this session's memory. */
function keepOnShelf(key: string, raw: string, entry: Entry): void {
  if (writeShelfCopy(key, raw, entry.at)) { memory.delete(key); return }
  memory.set(key, entry)
  if (!writeReceipt(key, entry.id)) memory.delete(key)
}

// Every legacy copy off the shelf.
function freeShelf(superseded: string | null): number {
  if (freeing) return 0
  freeing = true
  let freed = 0
  try {
    for (const key of shelfKeys()) {
      const raw = localStorage.getItem(key)
      const legacy = parseKeptShape(raw)
      if (raw === null || !legacy) continue
      localStorage.removeItem(key)
      freed += (key.length + raw.length) * 2
      if (key === superseded || RETIRED_KEYS.includes(key)) continue
      const entry: Entry = { at: legacy.at, id: newId(), v: legacy.v }
      memory.set(key, entry)
      if (!writeReceipt(key, entry.id)) { memory.delete(key); continue }
      writeThrough(key, entry)
    }
  } catch { /* whatever was freed stays freed */ }
  finally { freeing = false }
  return freed
}

function forget(key: string): void {
  memory.delete(key)
  try { localStorage.removeItem(key) } catch { /* nothing to forget, then */ }
  whenDb(() => idbWrite([[key, null]]))
}

// ------------------------------------------------------------------ memory and the database…

function decode(entry: Entry): unknown {
  if (entry.raw === undefined) {
    entry.raw = JSON.stringify(entry.v) as string | undefined
    entry.v = undefined
  }
  return entry.raw === undefined ? null : JSON.parse(entry.raw)
}

/** A stored copy with no id vouches for nothing a receipt can name. */
function asStored(val: unknown): Stored | null {
  if (!val || typeof val !== 'object' || !('v' in val)) return null
  const { at, id } = val as { at?: unknown; id?: unknown }
  return typeof at === 'string' && typeof id === 'string' && id !== ''
    ? { v: (val as { v: unknown }).v, at, id }
    : null
}

function writeThrough(key: string, entry: Entry, onNoDb?: () => void): void {
  whenDb((d) => {
    if (memory.get(key) !== entry) return   // superseded by a newer keep, or forgotten
    if (!d) { onNoDb?.(); return }
    try {
      const v: unknown = entry.raw !== undefined ? JSON.parse(entry.raw) : entry.v
      idbWrite([[key, { v, at: entry.at, id: entry.id }]])
    } catch { /* the copy lives for this session only */ }
  })
}

function openDb(): Promise<void> {
  if (opening) return opening
  opening = new Promise<void>((resolve) => {
    const settle = (d: IDBDatabase | null) => {
      if (db !== undefined) { if (d) d.close(); return }
      db = d
      resolve()
    }
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => {
        const d = req.result
        // another tab upgrading, or the browser clearing site data: let go, and later keeps use the shelf
        d.onversionchange = () => { d.close(); if (db === d) db = null }
        d.onclose = () => { if (db === d) db = null }
        settle(d)
      }
      req.onerror = () => settle(null)
      setTimeout(() => settle(null), OPEN_GIVE_UP_MS)
    } catch { settle(null) }
  })
  return opening
}

/** Runs after the open settles, in call order, with the handle as it is THEN. */
function whenDb(fn: (d: IDBDatabase | null) => void): void {
  openDb().then(() => fn(db ?? null)).catch(() => { /* never surfaces */ })
}

/** Every [key, stored value] in the store, or null when the store cannot be read. */
function readAll(d: IDBDatabase): Promise<Array<[string, unknown]> | null> {
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const keys = store.getAllKeys()
      const values = store.getAll()
      values.onsuccess = () => {
        resolve(keys.result.map((k, i): [string, unknown] => [String(k), values.result[i]]))
      }
      tx.onabort = () => resolve(null)
      tx.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

// One readwrite transaction: a value puts, null deletes.
function idbWrite(ops: Array<[string, Stored | null]>, onCommit?: () => void, onFail?: () => void): boolean {
  const d = db
  if (!d || ops.length === 0) return false
  let tx: IDBTransaction
  try { tx = d.transaction(STORE, 'readwrite') } catch { return false }
  if (onCommit) tx.oncomplete = onCommit
  if (onFail) { tx.onabort = onFail; tx.onerror = onFail }
  try {
    const store = tx.objectStore(STORE)
    for (const [key, val] of ops) {
      if (val) store.put(val, key)
      else store.delete(key)
    }
  } catch {
    // half a batch must not commit as if it were the whole one
    try { tx.abort() } catch { /* already finishing — nothing more to undo */ }
  }
  return true
}
