// THE PHARMACY'S REPORTS, AS THIS READER MAY SEE THEM — one relay door (`/hub-lanes/house-supplies/meds`…
// `?since=` makes an unchanged answer cost nothing.
import { useCallback, useEffect, useRef, useState } from 'react'
import { lane, LaneError } from '@/pages/features/shifts/laneFetch'
import type { MedsView } from '@/lib/houseMedsAnalysis'

export const HOUSE_MEDS_PATH = '/hub-lanes/house-supplies/meds'

export type HouseMedsState = {
  status: 'idle' | 'loading' | 'failed' | 'ready'
  data: MedsView | null
  error: string
  reason: string
  readAt: number
  refreshing: boolean
}

const IDLE: HouseMedsState = { status: 'idle', data: null, error: '', reason: '', readAt: 0, refreshing: false }

export function useHouseMeds(enabled: boolean) {
  const [state, setState] = useState<HouseMedsState>(IDLE)
  const version = useRef('')
  const flight = useRef<Promise<void> | null>(null)

  const read = useCallback(async (force = false) => {
    if (!enabled) return
    if (flight.current) return flight.current
    setState((s) => ({ ...s, status: s.data ? s.status : 'loading', refreshing: true }))
    const since = !force && version.current ? `?since=${encodeURIComponent(version.current)}` : ''
    const run = (async () => {
      try {
        const got = await lane<MedsView & { unchanged?: boolean }>(HOUSE_MEDS_PATH + since)
        if (got && (got as { unchanged?: boolean }).unchanged) {
          setState((s) => ({ ...s, status: s.data ? 'ready' : s.status, readAt: Date.now(), refreshing: false }))
          return
        }
        version.current = String(got?.version ?? '')
        setState({ status: 'ready', data: got, error: '', reason: '', readAt: Date.now(), refreshing: false })
      } catch (err) {
        const reason = err instanceof LaneError ? err.reason : ''
        const message = err instanceof Error ? err.message : String(err)
        setState((s) => ({ ...s, status: 'failed', error: message, reason, refreshing: false }))
      } finally {
        flight.current = null
      }
    })()
    flight.current = run
    return run
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void read(true)
    const onFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void read()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [enabled, read])

  return { state, refresh: () => read(true) }
}
