// One usersList for every screen.
// usersList is a LIVE /exec action — seconds on a good day, more when the single account is busy — and three…
import { useAuthStore } from '@/auth/useAuthStore'
import { gasAction } from '@/features/hiring/shared'
import { currentPlaceKey } from '@/lib/placeKey'

// Read at CALL time, never at import: the place is only known once the tenant store has rehydrated, and a…
const KEY = () => {
  const place = currentPlaceKey()
  return place ? `asa-users-directory-v1:${place}` : 'asa-users-directory-v1'
}

export type RawHubUser = Record<string, unknown>

// AWAY FROM HOME, THE TRAVELER IS THE ONLY USER.
function tenantScope_(rows: RawHubUser[]): RawHubUser[] { return rows.filter((r) => !isMasterAccountRow(r)) }

// The one filter every list of users applies on this side: the master account is never a row in one.
export function isMasterAccountRow(row: RawHubUser): boolean {
  if (row.is_master === true) return true
  const me = useAuthStore.getState().user
  if (!me?.isMaster) return false
  const email = String(row.email ?? '').trim().toLowerCase()
  return (!!me.id && String(row.id ?? '') === me.id) || (!!me.email && email === me.email.trim().toLowerCase())
}

// NAME → ACCOUNT, once for the whole platform (2026-08-29).
const normName_ = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

export function findAccountByName(
  rows: RawHubUser[],
  name: string,
): { id: string; name: string } | null {
  const want = normName_(name)
  if (!want) return null
  const hit = rows.find((r) => normName_(String(r.display_name ?? '')) === want)
  return hit ? { id: String(hit.id ?? ''), name: String(hit.display_name ?? name) } : null
}

/** The last list this tab saw, or null on the first visit of the session. */
export function cachedUsers(): RawHubUser[] | null {
  try {
    const raw = sessionStorage.getItem(KEY())
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? tenantScope_(parsed as RawHubUser[]) : null
  } catch {
    return null
  }
}

let inFlight: Promise<RawHubUser[]> | null = null
let lastFetchAt = 0

// NEAR-LIVE WITHOUT POLLING, the changes arriving over SSE: coming BACK to the tab refetches the list when it is…
const FRESHNESS_MS = 5 * 60_000

export function watchUsersFreshness(onFresh: (rows: RawHubUser[]) => void): () => void {
  const wake = () => {
    if (document.visibilityState !== 'visible') return
    if (Date.now() - lastFetchAt < FRESHNESS_MS) return
    fetchUsers({ force: true }).then(onFresh).catch(() => {})
  }
  window.addEventListener('focus', wake)
  document.addEventListener('visibilitychange', wake)
  return () => {
    window.removeEventListener('focus', wake)
    document.removeEventListener('visibilitychange', wake)
  }
}

// The 60-second freshness law, callable by any surface that is about to LINK on an id (the ⌘K palette): answers the…
export function fetchUsersIfStale(): Promise<RawHubUser[]> {
  const cached = cachedUsers()
  // The same window as the freshness watch above, and for the same reason: opening the palette is not evidence the…
  if (cached && Date.now() - lastFetchAt < FRESHNESS_MS) return Promise.resolve(cached)
  return fetchUsers()
}

// Always asks the backend — callers paint cachedUsers() first and refresh with this.
export function fetchUsers(opts?: { force?: boolean }): Promise<RawHubUser[]> {
  if (!inFlight || opts?.force) {
    lastFetchAt = Date.now()
    inFlight = gasAction<RawHubUser[]>('usersList')
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : []
        try {
          // the WHOLE list is cached; the tenant scope narrows on the way out, so coming home costs no refetch
          sessionStorage.setItem(KEY(), JSON.stringify(list))
        } catch {
          /* storage full — the fetch still answers */
        }
        return tenantScope_(list)
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight.then(tenantScope_)
}

// Called on logout/session end (useAuthStore) — the directory holds every account's contacts and override maps, and…
export function clearUsersCache(): void {
  try {
    sessionStorage.removeItem(KEY())
  } catch {
    /* nothing to clear */
  }
  inFlight = null
}
