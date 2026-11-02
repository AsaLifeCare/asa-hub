// THIS SIGN-IN'S APP MATRIX HAS LANDED — the server's apps×badges rows (hubBoot or their own door), or the read that
// gave up and left the kept copy standing. Where a sign-in lands is chosen only after it: chosen against the empty
// matrix of a new browser (or a copy kept from before My Work had its row), My Work read as shut and the login fell
// on the Overview. Nobody lands there (the operator, 2026-10-30).
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'

let landedFor: string | null = null
const listeners = new Set<() => void>()

/** The read for `token` is over; ignored once the session has moved on to another token. */
export function markMatrixLanded(token: string): void {
  if (useAuthStore.getState().token !== token || landedFor === token) return
  landedFor = token
  for (const fn of [...listeners]) fn()
}

export function matrixLanded(): boolean {
  const token = useAuthStore.getState().token
  return Boolean(token) && landedFor === token
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  const off = useAuthStore.subscribe(fn)
  return () => {
    listeners.delete(fn)
    off()
  }
}

/** How long a landing waits on a read that never answers before it goes on with the copy it has. */
export const LANDING_WAIT_MS = 8000

/** True once this session's landing page may be chosen: the matrix landed, or the wait for it ran out. */
export function useMatrixLanded(): boolean {
  const landed = useSyncExternalStore(subscribe, matrixLanded, matrixLanded)
  const token = useAuthStore((s) => s.token)
  const [waitedFor, setWaitedFor] = useState<string | null>(null)
  useEffect(() => {
    if (landed || !token) return
    const t = setTimeout(() => setWaitedFor(token), LANDING_WAIT_MS)
    return () => clearTimeout(t)
  }, [landed, token])
  return landed || (Boolean(token) && waitedFor === token)
}
