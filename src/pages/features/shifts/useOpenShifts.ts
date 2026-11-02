// Every open shift (/hub-lanes/housecal/open), one shared read per page, re-read on the `housecal` ring and on…
// A failed read keeps the last answer with `failed`; never "no open shifts".
import { useEffect, useSyncExternalStore } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
import { onLiveEvent } from '@/lib/snapshotClient'
import { HOUSECAL_LIVE_EVENT, type OpenShift } from './houseCalTypes'

export type OpenShiftsFeed = {
  shifts: OpenShift[]
  open: number
  claimed: number
  /** whether the shift pool could be read */
  pool?: { readable: boolean; why: string }
}

type State = { token: string; data: OpenShiftsFeed | null; failed: string; at: number }

const EMPTY: State = { token: '', data: null, failed: '', at: 0 }
let state: State = EMPTY
let inflight: Promise<void> | null = null
let again = false
const listeners = new Set<() => void>()

function publish(next: State) {
  state = next
  for (const fn of [...listeners]) fn()
}

/** A mount reads only when the held answer is older than this; a ring always reads. */
const FRESH_MS = 5_000

async function read(force: boolean): Promise<void> {
  const token = useAuthStore.getState().token ?? ''
  // another session's answer is never painted
  if (state.token !== token) publish({ ...EMPTY, token })
  if (inflight) {
    if (force) again = true
    return inflight
  }
  if (!force && state.data && Date.now() - state.at < FRESH_MS) return
  inflight = (async () => {
    try {
      const res = await fetch('/hub-lanes/housecal/open', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const env = await res.json().catch(() => ({}))
      if (Number(env.status) !== 200) throw new Error(String(env.message || `the server answered ${res.status}`))
      if (useAuthStore.getState().token === token) {
        publish({ token, data: env.data as OpenShiftsFeed, failed: '', at: Date.now() })
      }
    } catch (err) {
      if (useAuthStore.getState().token === token) {
        publish({ ...state, token, failed: err instanceof Error ? err.message : 'could not be read' })
      }
    } finally {
      inflight = null
      if (again) {
        again = false
        void read(true)
      }
    }
  })()
  return inflight
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/* one stream listener for all mounts, so a ring is one read */
let followers = 0
let unfollow: (() => void) | null = null

/** Follow the ring and the stream's return while mounted; answers the undo. */
export function followLive(): () => void {
  followers += 1
  if (!unfollow) {
    const offRing = onLiveEvent(HOUSECAL_LIVE_EVENT, () => { void read(true) })
    const offOpen = onLiveEvent('open', () => { void read(true) })
    unfollow = () => { offRing(); offOpen() }
  }
  let done = false
  return () => {
    if (done) return
    done = true
    followers = Math.max(0, followers - 1)
    if (followers === 0 && unfollow) {
      unfollow()
      unfollow = null
    }
  }
}

const snapshot = () => state

export function useOpenShifts(): {
  shifts: OpenShift[] | null
  pool: OpenShiftsFeed['pool']
  failed: string
  reload: () => void
} {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot)
  const token = useAuthStore((a) => a.token) ?? ''
  useEffect(() => {
    void read(false)
    return followLive()
  }, [token])
  const mine = s.token === token
  return {
    shifts: mine ? (s.data?.shifts ?? null) : null,
    pool: mine ? s.data?.pool : undefined,
    failed: mine ? s.failed : '',
    reload: () => { void read(true) },
  }
}
