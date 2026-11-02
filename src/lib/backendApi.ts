// Generic backend API helper (v9) — the pattern EVERY app on the platform follows to talk to the Google Apps Script…
// Apps POST a single envelope: POST {exec} { "resource": "<name>", "action": "create", "payload": { … } } Each…
import { useSyncStore } from '@/stores/useSyncStore'

export type BackendAction = 'list' | 'get' | 'create' | 'update' | 'delete'

export type BackendResult = {
  ok: boolean
  /** Envelope status (200/4xx/5xx); 0 when the request never reached the backend. */
  status: number
  data?: any
  error?: string
}

type Envelope = { status?: number; data?: unknown; message?: string }

/** The configured /exec endpoint — '' means demo mode (nothing configured). */
export const backendEndpoint = (): string => useSyncStore.getState().endpointUrl.trim()

/** Parses the uniform envelope; never throws on a non-JSON body. */
async function readEnvelope(res: Response): Promise<{ env: Envelope; parseError?: string }> {
  try {
    return { env: (await res.json()) as Envelope }
  } catch {
    return { env: {}, parseError: `Non-JSON response (HTTP ${res.status})` }
  }
}

function toResult(res: Response, env: Envelope, parseError?: string): BackendResult {
  if (parseError) return { ok: false, status: res.status, error: parseError }
  const status = env.status ?? res.status
  if (!res.ok || status >= 400) {
    return { ok: false, status, error: env.message || `Backend error ${status}` }
  }
  return { ok: true, status, data: env.data }
}

// POST { resource, action, payload } to the configured /exec endpoint.
export async function postToBackend(
  resource: string,
  action: BackendAction,
  payload: Record<string, unknown> = {},
): Promise<BackendResult> {
  const url = backendEndpoint()
  if (!url) return { ok: false, status: 0, error: 'No backend endpoint configured — demo mode.' }
  try {
    const res = await fetch(url, {
      method: 'POST',
      // text/plain = CORS "simple request" → avoids the preflight Apps Script mishandles
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ resource, action, payload }),
    })
    const { env, parseError } = await readEnvelope(res)
    return toResult(res, env, parseError)
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

// Connectivity probe — verifies the URL answers with the JSON envelope AND that the resource is registered (unknown…
export async function testConnection(resource: string): Promise<BackendResult> {
  return postToBackend(resource, 'list', { limit: 1 })
}
