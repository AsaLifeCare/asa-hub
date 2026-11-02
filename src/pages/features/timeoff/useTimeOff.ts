/** The Time Off feed from its relay door; a failed read keeps the last good answer beside the reason. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { lane, post, LaneError } from '@/pages/features/shifts/laneFetch'
import {
  CANCEL_PATH, DECIDE_PATH, DETAIL_PATH, FEED_PATH, REQUEST_PATH, REVIEW_PATH, WITHDRAW_PATH,
  type Detail, type Preview, type TimeOffFeed, type TimeOffRowView,
} from './timeOffModel'

export const IDLE_FEED: FeedState = { status: 'idle', data: null, error: '', reason: '', refreshing: false }

export type FeedState = {
  status: 'idle' | 'loading' | 'failed' | 'ready'
  data: TimeOffFeed | null
  error: string
  reason: string
  refreshing: boolean
}

export function useTimeOff(house = '') {
  const [state, setState] = useState<FeedState>(IDLE_FEED)
  const flight = useRef<Promise<void> | null>(null)

  const read = useCallback(async () => {
    if (flight.current) return flight.current
    setState((s) => ({ ...s, status: s.data ? s.status : 'loading', refreshing: true }))
    const run = (async () => {
      try {
        const got = await lane<TimeOffFeed>(FEED_PATH + (house ? `?house=${encodeURIComponent(house)}` : ''))
        setState({ status: 'ready', data: got, error: '', reason: '', refreshing: false })
      } catch (err) {
        setState((s) => ({ ...s, status: 'failed', refreshing: false,
                           error: err instanceof Error ? err.message : String(err),
                           reason: err instanceof LaneError ? err.reason : '' }))
      } finally {
        flight.current = null
      }
    })()
    flight.current = run
    return run
  }, [house])

  useEffect(() => {
    void read()
    const onFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void read()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [read])

  return { state, refresh: read }
}

export type RequestBody = { person?: string; start: string; end: string; houses: string[]; reason?: string }

export function previewRequest(body: RequestBody): Promise<Preview> {
  return post<Preview>(REQUEST_PATH, { ...body, dry_run: true })
}

export function fileRequest(body: RequestBody): Promise<{ ref: string; asked: { house_manager: string[]; hm_mode: string; directors: string[]; directors_why?: string }; row: TimeOffRowView }> {
  return post(REQUEST_PATH, body)
}

export function readDetail(ref: string): Promise<Detail> {
  return lane<Detail>(`${DETAIL_PATH}?ref=${encodeURIComponent(ref)}`)
}

export type Act = 'approve' | 'deny' | 'withdraw' | 'cancel' | 'confirm' | 'merge' | 'discard'

/** One action on one request, through its own door; the server chooses the half and refuses in words. */
export function act(kind: Act, ref: string, extra: { note?: string; into?: string; person?: string;
                                                        start?: string; end?: string; via?: string } = {}) {
  if (kind === 'approve' || kind === 'deny') {
    return post<TimeOffRowView>(DECIDE_PATH, { ref, word: kind, note: extra.note ?? '', via: extra.via ?? 'platform' })
  }
  if (kind === 'withdraw') return post<TimeOffRowView>(WITHDRAW_PATH, { ref, note: extra.note ?? '' })
  if (kind === 'cancel') return post<TimeOffRowView>(CANCEL_PATH, { ref, note: extra.note ?? '' })
  return post<TimeOffRowView>(REVIEW_PATH, { ref, action: kind, ...extra })
}
