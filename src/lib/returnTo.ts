// A signed-out link's target, kept across sign-in (router state, plus storage for detours like a reload).
// Only in-app paths ('/app/…') are kept or followed.

const KEY = 'asa.returnTo'
/** How long a kept target stays valid. */
const KEEP_MS = 15 * 60 * 1000

/** Is this an in-app page a sign-in may land on? */
export function isReturnPath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  const p = path.trim()
  return p.startsWith('/app/') && !p.startsWith('//') && !p.includes('://') && !p.includes('\\')
}

/** The guard keeps the address a signed-out visitor asked for. */
export function rememberReturn(path: string): void {
  if (!isReturnPath(path)) return
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }))
  } catch { /* storage refused — the router state still carries it */ }
}

/** Router state first, then a fresh kept path; null means home. */
export function returnPath(state: unknown, now = Date.now()): string | null {
  const from = (state as { from?: unknown } | null | undefined)?.from
  if (isReturnPath(from)) return from
  try {
    const kept = JSON.parse(sessionStorage.getItem(KEY) || 'null') as { path?: unknown; at?: unknown } | null
    if (kept && isReturnPath(kept.path) && typeof kept.at === 'number' && now - kept.at < KEEP_MS) {
      return kept.path
    }
  } catch { /* unreadable storage is no destination */ }
  return null
}

/** Followed once: the next ordinary sign-in goes home. */
export function forgetReturn(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch { /* nothing to forget */ }
}
