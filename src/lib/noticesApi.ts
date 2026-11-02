// Company notices for the bell: GET /hub-lanes/notices, POST /hub-lanes/notices/read, and the translation to a bell…
// Each notice is already this reader's copy (server/web_notices.py).
import { isActing, useAuthStore } from '@/auth/useAuthStore'
import { cellText } from '@/pages/features/shifts/cellClock'
import type { AppNotification } from '@/engine/types'

export type ServerNotice = {
  id: number
  kind: string
  /** why this reader hears it: theirs · decider · company · invited */
  role: string
  at: string
  published_at: string
  title: string
  body: string
  /** the shift as the calendar writes it; `{shift}` in the words is filled from it */
  shift: string
  house: string
  col_iso: string
  ref: string
  href: string
  priority: 'low' | 'normal' | 'high'
  tone: '' | 'urgent' | 'good' | string
  /** an invitation's window close, or '' */
  expires_at: string
  read?: boolean
  /** held by test mode: never drawn anywhere */
  held?: boolean
  /** shaped in the quiet window: bell and toast only, no OS copy */
  quiet?: boolean
}

export type Inbox = {
  notices: ServerNotice[]
  unread: number
  /** the newest notice id in the relay's store — not only this reader's */
  seq: number
  since: number
  me: string
  /** why every notice is held ('test mode'), or ''; the bell then reads paused */
  held: string
  /** only the newest part of the fortnight was judged */
  truncated: boolean
}

export const NOTICES_PATH = '/hub-lanes/notices'
export const NOTICES_READ_PATH = '/hub-lanes/notices/read'
/** A bell row that came from the relay carries its notice id behind this. */
export const NOTICE_ID_PREFIX = 'srv-'
/** How new a notice must be to interrupt the screen. */
export const NOTICE_FRESH_MS = 10 * 60_000

export function isServerNotice(id: string): boolean {
  return String(id).startsWith(NOTICE_ID_PREFIX)
}

export function serverIdOf(id: string): number | null {
  if (!isServerNotice(id)) return null
  const n = Number(String(id).slice(NOTICE_ID_PREFIX.length))
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Fill `{shift}` as code or clock, per the calendar's Time switch. */
export function spellShift(text: string, shift: string, clock: boolean): string {
  const said = cellText(String(shift ?? '').trim(), clock) || 'a shift'
  return String(text ?? '').split('{shift}').join(said)
}

/** The bell row for a relay notice; no appId, so hiding an app never hides it. */
export function toAppNotification(n: ServerNotice, clock: boolean): AppNotification {
  return {
    id: `${NOTICE_ID_PREFIX}${n.id}`,
    type: 'system',
    title: spellShift(n.title, n.shift, clock),
    body: spellShift(n.body, n.shift, clock),
    createdAt: n.at || n.published_at || new Date().toISOString(),
    read: Boolean(n.read),
    href: n.href || undefined,
    priority: n.priority === 'high' ? 'high' : n.priority === 'low' ? 'low' : 'normal',
    tone: n.tone === 'urgent' || n.tone === 'good' ? n.tone : undefined,
  }
}

/** Fresh by publish time, not event time. */
export function isFresh(n: Pick<ServerNotice, 'published_at' | 'at'>, nowMs: number,
  windowMs = NOTICE_FRESH_MS): boolean {
  const t = Date.parse(n.published_at || n.at || '')
  return Number.isFinite(t) && nowMs - t < windowMs && t - nowMs < 60_000
}

/** Kinds pinned until closed when marked urgent; the toast switch does not silence them. */
export const URGENT_KINDS: ReadonlySet<string> = new Set(['call_off', 'open_shift'])

export function isUrgentNotice(n: Pick<ServerNotice, 'kind' | 'tone' | 'priority'>): boolean {
  return URGENT_KINDS.has(n.kind) && n.tone === 'urgent' && n.priority === 'high'
}

/** When the notice stops being true, in epoch ms — 0 when it does not end. */
export function expiryOf(n: Pick<ServerNotice, 'expires_at'>): number {
  const t = Date.parse(n.expires_at || '')
  return Number.isFinite(t) ? t : 0
}

/** 'pin' (urgent, until its invitation ends) · 'toast' (high and fresh, switch on) · null (bell only). */
export function noticeAlert(n: ServerNotice, nowMs: number, toastsOn: boolean): 'pin' | 'toast' | null {
  if (n.held || n.priority !== 'high' || n.read) return null
  const ends = expiryOf(n)
  if (ends && ends <= nowMs) return null
  const stillOpen = ends > nowMs && isUrgentNotice(n)
  if (!stillOpen && !isFresh(n, nowMs)) return null
  if (isUrgentNotice(n)) return 'pin'
  return toastsOn ? 'toast' : null
}

/** Anything not plainly "no" counts as held: wrongly showing reaches a person, wrongly hiding only delays. */
export function heldOf(raw: unknown): boolean {
  if (raw === true || raw === 1) return true
  if (typeof raw !== 'string') return false
  return !['', '0', 'false', 'no'].includes(raw.trim().toLowerCase())
}

/** A frame off the stream, checked before it is believed. */
export function asServerNotice(raw: unknown): ServerNotice | null {
  if (!raw || typeof raw !== 'object') return null
  const n = raw as Record<string, unknown>
  const id = Number(n.id)
  if (!Number.isInteger(id) || id <= 0 || typeof n.title !== 'string') return null
  return {
    id,
    kind: String(n.kind ?? ''),
    role: String(n.role ?? ''),
    at: String(n.at ?? ''),
    published_at: String(n.published_at ?? ''),
    title: String(n.title ?? ''),
    body: String(n.body ?? ''),
    shift: String(n.shift ?? ''),
    house: String(n.house ?? ''),
    col_iso: String(n.col_iso ?? ''),
    ref: String(n.ref ?? ''),
    href: String(n.href ?? ''),
    priority: n.priority === 'high' ? 'high' : n.priority === 'low' ? 'low' : 'normal',
    tone: String(n.tone ?? ''),
    expires_at: String(n.expires_at ?? ''),
    read: Boolean(n.read),
    held: heldOf(n.held),
    quiet: heldOf(n.quiet),
  }
}

/** A relay /hub-lanes/ door with the session's token (or `asToken`); throws unless 200. */
export async function relayLane<T>(path: string, init?: RequestInit, asToken?: string): Promise<T> {
  return lane<T>(path, init, asToken)
}

async function lane<T>(path: string, init?: RequestInit, asToken?: string): Promise<T> {
  const token = asToken || useAuthStore.getState().token
  if (!token) throw new Error('not signed in')
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
    },
  })
  const env = (await res.json().catch(() => ({}))) as { status?: number; message?: string; data?: T }
  if (Number(env.status) !== 200) {
    throw new Error(String(env.message || `the server answered ${res.status}`))
  }
  return env.data as T
}

/** The bell, or only what is newer than `since`. Throws when it could not be read. */
export async function readInbox(since = 0): Promise<Inbox> {
  const q = since > 0 ? `?since=${encodeURIComponent(String(since))}` : ''
  const data = await lane<Inbox>(NOTICES_PATH + q)
  const raw = (data as { held?: unknown } | undefined)?.held
  const held = heldOf(raw) ? (typeof raw === 'string' ? raw : 'test mode') : ''
  return {
    // A HELD BELL DRAWS NOTHING, whatever else came with it.
    notices: held ? [] : (Array.isArray(data?.notices) ? data.notices : [])
      .map(asServerNotice)
      .filter((n): n is ServerNotice => n !== null),
    unread: held ? 0 : Number(data?.unread) || 0,
    seq: Number(data?.seq) || 0,
    since: Number(data?.since) || 0,
    me: String(data?.me ?? ''),
    held,
    truncated: (data as { truncated?: unknown } | undefined)?.truncated === true,
  }
}

/** Write down that this account read — or cleared — these notices. */
export async function markNotices(ids: number[], dismiss = false): Promise<void> {
  const clean = [...new Set(ids.filter((i) => Number.isInteger(i) && i > 0))]
  if (!clean.length) return
  // WEARING ANOTHER ACCOUNT (Be Another): what they have read stays theirs to say — refused here as the relay…
  if (isActing()) throw new Error('Not while acting as another account — their read marks stay their own.')
  await lane(NOTICES_READ_PATH, { method: 'POST', body: JSON.stringify({ ids: clean, dismiss }) })
}
