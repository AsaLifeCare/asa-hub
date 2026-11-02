/** The one fetch for the relay's calendar doors; a refusal keeps its reason word and data. */
import { useAuthStore } from '@/auth/useAuthStore'

export class LaneError extends Error {
  status: number
  reason: string
  data: Record<string, unknown>
  constructor(message: string, status: number, reason: string, data: Record<string, unknown>) {
    super(message)
    this.status = status
    this.reason = reason
    this.data = data
  }
}

export async function lane<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const env = await res.json().catch(() => ({}))
  if (Number(env.status) !== 200) {
    throw new LaneError(String(env.message || `the server answered ${res.status}`),
      Number(env.status) || res.status, String(env.reason || ''),
      (env.data && typeof env.data === 'object' ? env.data : {}) as Record<string, unknown>)
  }
  return env.data as T
}

/** A POST with a JSON body, through the same door. */
export function post<T>(path: string, body: unknown): Promise<T> {
  return lane<T>(path, { method: 'POST', body: JSON.stringify(body) })
}
