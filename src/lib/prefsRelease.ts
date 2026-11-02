// THE TWO RULES prefsSync keeps about a release, apart from the module that wires itself to the window, so they can…

/** The three welcome marks: each a JSON list of the user ids that walked that sequence on this machine. */
export const FIRST_LOGIN_KEYS = ['asa-tour-seen', 'asa-playground-intro-seen', 'asa-myworld-intro-seen']
/** Stamped into the server blob by a release (Prefs.gs PREFS_RELEASED_KEY); never collected, never pushed. */
export const RELEASED_KEY = 'asa-released-at'

// A RELEASE OUTRANKS AN UNSYNCED COPY OLDER THAN IT — for the welcome marks, and only for the person released.
export function dropReleasedMarks(blob: Record<string, unknown>, uid: string,
  dirtySince: number | null): string[] {
  const released = Date.parse(String(blob?.[RELEASED_KEY] ?? ''))
  if (!uid || Number.isNaN(released)) return []
  if (dirtySince != null && dirtySince > released) return []
  const touched: string[] = []
  for (const key of FIRST_LOGIN_KEYS) {
    let list: unknown = []
    try { list = JSON.parse(localStorage.getItem(key) ?? '[]') } catch { list = [] }
    if (!Array.isArray(list)) continue
    const ids = list.map(String)
    if (!ids.includes(uid)) continue
    localStorage.setItem(key, JSON.stringify(ids.filter((x) => x !== uid)))
    touched.push(key)
  }
  return touched
}

// The dirty stamp carries WHOSE change it is: on a shared machine, user A's unsynced accent must never outvote user…
export function nextDirtyStamp(prevRaw: string | null, uid: string, now: number): string {
  let since = now
  try {
    const prev = JSON.parse(prevRaw ?? 'null') as { uid?: string; since?: number } | null
    if (prev && String(prev.uid ?? '') === uid && typeof prev.since === 'number' && prev.since < now) {
      since = prev.since
    }
  } catch { /* a malformed stamp starts over */ }
  return JSON.stringify({ uid, at: now, since })
}

/** When the oldest unsynced change was made, or null when the stamp cannot say. */
export function dirtySinceOf(raw: string | null): number | null {
  try {
    const parsed = JSON.parse(raw ?? 'null') as { since?: number } | null
    return parsed && typeof parsed.since === 'number' ? parsed.since : null
  } catch { return null }
}
