// Read cache for the api facade — stale-while-revalidate.
// THE PROBLEM IT SOLVES Every screen fetched its rows on every mount.

type Entry = { data: unknown; at: number; inflight?: Promise<unknown> }

// Long enough that navigation feels instant, short enough that a sheet edited in another tab shows up without a…
const FRESH_MS = 45_000
// Past this the copy is not offered at all — better to wait than to show yesterday.
const MAX_AGE_MS = 10 * 60_000
const MAX_ENTRIES = 40

const store = new Map<string, Entry>()

export function cacheKey(resource: string, method: string, args: unknown): string {
  return `${resource}::${method}::${args === undefined ? '' : JSON.stringify(args)}`
}

function trim() {
  while (store.size > MAX_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (!oldest) break
    store.delete(oldest[0])
  }
}

/** Everything we hold for one resource is wrong the moment it is written. */
export function invalidate(resource: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(`${resource}::`)) store.delete(key)
  }
}

export function invalidateAll(): void {
  store.clear()
}

// Serve from cache when we can, and keep it current.
export async function cachedRead<T>(
  key: string,
  fetcher: () => Promise<T>,
  wrapBackground?: <U>(fn: () => Promise<U>) => Promise<U>,
): Promise<T> {
  const hit = store.get(key)
  const age = hit ? Date.now() - hit.at : Infinity

  if (hit && age < FRESH_MS) return hit.data as T

  // one refresh at a time per key, however many screens ask
  const refresh = () => {
    const existing = store.get(key)
    if (existing?.inflight) return existing.inflight as Promise<T>
    const p = fetcher()
      .then((data) => {
        store.set(key, { data, at: Date.now() })
        trim()
        return data
      })
      .catch((err) => {
        const cur = store.get(key)
        if (cur) delete cur.inflight
        throw err
      })
    store.set(key, { data: hit?.data, at: hit?.at ?? 0, inflight: p })
    return p
  }

  if (hit && age < MAX_AGE_MS && hit.data !== undefined) {
    // The refresh runs as BACKGROUND work (api.asBackground): nobody is waiting on it, so its failure must not…
    void (wrapBackground ? wrapBackground(refresh) : refresh()).catch(() => {
      /* the copy on screen stays — a failed refresh is not an empty page */
    })
    return hit.data as T
  }

  return refresh()
}

/** For debugging and for the settings screen: what is being held right now. */
export function cacheStats(): { entries: number; resources: string[] } {
  const resources = new Set<string>()
  for (const key of store.keys()) resources.add(key.split('::')[0])
  return { entries: store.size, resources: [...resources] }
}
