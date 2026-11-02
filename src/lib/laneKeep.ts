// THE MY APPS' KEPT ANSWER — My Work, My Calendar, My Inbox and My Profile draw the last answer this browser kept…
// A copy is never kept in a switched session, never drawn for another account, and forgotten when the door refuses.
import { isActing, useAuthStore } from '@/auth/useAuthStore'
import { forgetKept, keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { placeScope } from '@/lib/placeKey'
import { onLiveEvent } from '@/lib/snapshotClient'

/** The relay's word on an answer it gave from its own kept copy. */
export type KeptMark = { at?: string; fresh?: boolean; age_s?: number }

/** Each app's ring, as the relay sounds it. */
export const LANE_RINGS = { work: 'my-work', calendar: 'my-calendar', inbox: 'my-inbox', profile: 'my-profile' } as const

export const KEPT_LANE_PREFIX = 'asa:lane:'
type Copy = { owner: string; path: string; data: unknown }

function ownerNow(): string {
  const uid = String(useAuthStore.getState().user?.id ?? '')
  return uid && !isActing() ? placeScope(uid) : ''
}

const keyOf = (owner: string, path: string) => `${KEPT_LANE_PREFIX}${owner}|${path}`

/** The generation a read started in, for keepLane. */
export const laneGeneration = keptGeneration

/** This account's kept answer for a door's path, or null. */
export function keptLane<T>(path: string): T | null {
  const owner = ownerNow()
  if (!owner) return null
  const got = readKept<Copy>(keyOf(owner, path))
  return got && got.owner === owner && got.path === path && got.data && typeof got.data === 'object' ? (got.data as T) : null
}

/** Keeps an answer for the account, unless a sign-out or a crossing came after the read started. */
export function keepLane(path: string, data: unknown, generation: string): void {
  const owner = ownerNow()
  if (owner) keepIfCurrent(keyOf(owner, path), { owner, path, data } satisfies Copy, generation)
}

export function forgetLane(path: string): void {
  const owner = ownerNow()
  if (owner) forgetKept(keyOf(owner, path))
}

/** Every kept answer of these apps, whoever's: a test's clean slate. */
export function forgetLanes(): void {
  const doomed: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(KEPT_LANE_PREFIX)) doomed.push(k)
    }
  } catch { /* a shelf that cannot be walked keeps nothing to forget */ }
  doomed.forEach(forgetKept)
}

/** Whether a refusal takes the copy: a mirror too old or unreadable does not. */
export function refusalForgets(reason: string): boolean {
  return reason !== 'stale' && reason !== 'unreadable'
}

/** When an answer was read and whether it is a copy not read again since: the relay's word, else the answer's own. */
export function answerAge(data: unknown, now = Date.now()): { readAt: number; kept: boolean } {
  const mark = (data as { kept?: KeptMark } | null)?.kept
  if (!mark || typeof mark !== 'object') return { readAt: now, kept: false }
  const at = Date.parse(String(mark.at ?? ''))
  return { readAt: Number.isFinite(at) ? at : now, kept: mark.fresh !== true }
}

/** When a copy this browser kept was read; 0 when it does not say. */
export function copyAge(data: unknown): number {
  const d = data as { kept?: KeptMark; read_at?: unknown } | null
  const at = Date.parse(String(d?.kept?.at ?? d?.read_at ?? ''))
  return Number.isFinite(at) ? at : 0
}

/** The ring of the app a door's path belongs to; '' for any other door. */
export function ringOfPath(path: string): string {
  const m = /^\/hub-lanes\/(my-(?:work|calendar|inbox|profile))(?:[?/]|$)/.exec(path)
  return m && !path.startsWith('/hub-lanes/my-calendar/check') ? m[1] : ''
}

/** Reads again on the app's ring and when the stream (re)opens; returns the unsubscribe. */
export function onLaneRing(name: string, fn: () => void): () => void {
  const offRing = onLiveEvent(name, fn)
  const offOpen = onLiveEvent('open', fn)
  return () => {
    offRing()
    offOpen()
  }
}
