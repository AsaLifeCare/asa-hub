// My Work's one read: drawn at once from the account's kept answer (lib/laneKeep), then read on mount, on a new…
// A 403 keeps the relay's words.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LANE_RINGS, answerAge, copyAge, forgetLane, keepLane, keptLane, laneGeneration, onLaneRing, refusalForgets,
} from '@/lib/laneKeep'
import { lane, LaneError } from '@/pages/features/shifts/laneFetch'
import { myWorkPath, type MyWorkView } from './myWorkModel'

export type MyWorkState = {
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'refused'
  data: MyWorkView | null
  error: string
  reason: string
  readAt: number
  refreshing: boolean
  /** the answer drawn is a kept copy not read again since */
  kept?: boolean
}

export const MY_WORK_IDLE: MyWorkState = { status: 'idle', data: null, error: '', reason: '', readAt: 0, refreshing: false }

/** The account's kept answer for this person, drawn before the read lands; idle when there is none. */
function keptState(enabled: boolean, person: string): MyWorkState {
  const data = enabled ? keptLane<MyWorkView>(myWorkPath(person)) : null
  return data ? { ...MY_WORK_IDLE, status: 'ready', data, readAt: copyAge(data), kept: true } : MY_WORK_IDLE
}

export function useMyWork(enabled: boolean, person: string) {
  const [state, setState] = useState<MyWorkState>(() => keptState(enabled, person))
  const seq = useRef(0)

  const read = useCallback(async () => {
    if (!enabled) return
    const mine = ++seq.current
    const path = myWorkPath(person)
    const generation = laneGeneration()
    setState((s) => {
      const base = s.data ? s : keptState(enabled, person)
      return { ...base, status: base.data ? base.status : 'loading', refreshing: true }
    })
    try {
      const got = await lane<MyWorkView>(path)
      if (mine !== seq.current) return
      keepLane(path, got, generation)
      setState({ status: 'ready', data: got, error: '', reason: '', refreshing: false, ...answerAge(got) })
    } catch (err) {
      if (mine !== seq.current) return
      const refused = err instanceof LaneError && err.status === 403
      const message = err instanceof Error ? err.message : String(err)
      const reason = err instanceof LaneError ? err.reason : ''
      if (refused && refusalForgets(reason)) forgetLane(path)
      setState((s) => ({
        ...s, status: refused ? 'refused' : 'failed', error: message, reason, refreshing: false,
        data: refused ? null : s.data,
      }))
    }
  }, [enabled, person])

  useEffect(() => {
    void read()
  }, [read])

  // the app's ring and the stream's return read again; nothing polls
  useEffect(() => (enabled ? onLaneRing(LANE_RINGS.work, () => void read()) : undefined), [enabled, read])

  return { state, refresh: read }
}
