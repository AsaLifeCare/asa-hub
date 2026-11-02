// THE MOMENT THIS SESSION'S PREFERENCES HAVE LANDED — the server's copy, or the local cache standing in for it when…
// Once-per-person questions (the first-login tour, the playground intro, the world welcome) read their "seen" marks…
import { useAuthStore } from '@/auth/useAuthStore'

let settledFor: string | null = null
const settledListeners = new Set<() => void>()

/** The pull for `token` finished; ignored when the session has moved on to another token. */
export function markSettled(token: string): void {
  if (useAuthStore.getState().token !== token) return
  settledFor = token
  for (const fn of [...settledListeners]) fn()
}

export function prefsSettled(): boolean {
  const token = useAuthStore.getState().token
  return Boolean(token) && settledFor === token
}

export function onPrefsSettled(fn: () => void): () => void {
  settledListeners.add(fn)
  return () => { settledListeners.delete(fn) }
}
