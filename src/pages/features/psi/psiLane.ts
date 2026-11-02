// PSI Log's lanes, read as relayLane reads them (the envelope's data, its message on a refusal) — but a refusal keeps
// the lane's reason and status. PsiAnywhere answers a session it let go of with empty rows, and the server turns that
// into reason "signed-out" (401): the PSI pages then show the sign-in card, never a stale signed-in screen or a
// "PsiAnywhere said no" toast.
import { useAuthStore } from '@/auth/useAuthStore'

export const PSI_LOG_HOME = '/app/psi-log/clock'
export const SESSION_ENDED = 'Your PsiAnywhere session ended — sign in again.'

export class PsiLaneError extends Error {
  reason: string
  status: number
  constructor(message: string, reason: string, status: number) {
    super(message)
    this.reason = reason
    this.status = status
  }
}

/** Whether a lane refused because the PsiAnywhere session is gone (ended there, or never signed in here). A 401 whose
 * reason is 'session' is the Hub's own sign-in (the gate's "sign in first"), not PsiAnywhere's: it is said as it is. */
export function signedOut(e: unknown): boolean {
  return e instanceof PsiLaneError && (e.reason === 'signed-out' || (e.status === 401 && e.reason !== 'session'))
}

export async function psiLane<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token
  if (!token) throw new Error('not signed in')
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
    },
  })
  const env = (await res.json().catch(() => ({}))) as { status?: number; message?: string; reason?: string; data?: T }
  const status = Number(env.status)
  if (status !== 200) {
    throw new PsiLaneError(String(env.message || `the server answered ${res.status}`), String(env.reason ?? ''), status)
  }
  return env.data as T
}
