// My Inbox's one read and its marks.
// It reads on mount, on a new person, on the page's Refresh, on coming back to the tab, when a notice arrives on…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isActing, useAuthStore } from '@/auth/useAuthStore'
import {
  LANE_RINGS, answerAge, copyAge, forgetLane, forgetLanes, keepLane, keptLane, laneGeneration, onLaneRing,
  refusalForgets,
} from '@/lib/laneKeep'
import { usePageRefresh } from '@/lib/pageRefresh'
import { lane, LaneError, post } from '@/pages/features/shifts/laneFetch'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { toast } from '@/stores/useToastStore'
import {
  MY_INBOX_READ_PATH, applyMarks, markKeys, myInboxPath,
  type MarkOverride, type MyInboxView, type PersonEntry,
} from './myInboxModel'

export type MyInboxState = {
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'refused'
  data: MyInboxView | null
  error: string
  reason: string
  readAt: number
  refreshing: boolean
  /** the answer drawn is a kept copy not read again since */
  kept?: boolean
}

export const MY_INBOX_IDLE: MyInboxState = { status: 'idle', data: null, error: '', reason: '', readAt: 0, refreshing: false }

/** Coming back to the tab reads again only when the last read is at least this old. */
export const WAKE_GAP_MS = 15_000

/** The master's person list from the session's last mass answer, drawn while another read runs. */
export type Chooser = { people: PersonEntry[] | null; people_why: string }

/** The chooser a mass answer carries; an own answer carries none. */
export function chooserOf(view: MyInboxView): Chooser | null {
  const s = view.scope
  return s.mode === 'mass' ? { people: Array.isArray(s.people) ? s.people : null, people_why: s.people_why ?? '' } : null
}

const held = new Map<string, MyInboxState>()
const heldChooser = new Map<string, Chooser>()
const heldMarks = new Map<string, Map<string, MarkOverride>>()
const NO_MARKS: ReadonlyMap<string, MarkOverride> = new Map()

/** Tests only: forget what was held, and the kept answers. */
export function forgetHeld(): void {
  forgetLanes()
  held.clear()
  heldChooser.clear()
  heldMarks.clear()
}

const sessionKey = () => String(useAuthStore.getState().token ?? '')

function wellFormed(v: unknown): v is MyInboxView {
  const x = v as MyInboxView | null
  return !!x && typeof x === 'object' && !!x.scope && Array.isArray(x.items) && Array.isArray(x.heads) && !!x.marks
}

/** The account's kept answer for a person, drawn before any read this session lands. */
function keptFor(person: string): MyInboxState | null {
  const data = keptLane<MyInboxView>(myInboxPath(person))
  return data && wellFormed(data) ? { ...MY_INBOX_IDLE, status: 'ready', data, readAt: copyAge(data), kept: true } : null
}

/** What is drawn for a person before their read lands: their own held or kept answer, never anybody else's. */
const heldFor = (k: string, person: string): MyInboxState =>
  held.get(k) ?? keptFor(person) ?? { ...MY_INBOX_IDLE, status: 'loading' }

export function useMyInbox(enabled: boolean, person: string) {
  const session = useAuthStore((s) => String(s.token ?? ''))
  const key = `${session}|${person}`
  const [slot, setSlot] = useState<{ key: string; state: MyInboxState }>(() => ({
    key, state: held.get(key) ?? (enabled ? keptFor(person) : null) ?? MY_INBOX_IDLE,
  }))
  // the state belongs to the person it was read for: a new choice draws that person's, from the first render
  const state = slot.key === key ? slot.state : heldFor(key, person)
  const [marksVersion, setMarksVersion] = useState(0)
  const seq = useRef(0)
  const lastRead = useRef(0)

  const read = useCallback(async () => {
    if (!enabled) return
    const mine = ++seq.current
    lastRead.current = Date.now()
    const k = `${sessionKey()}|${person}`
    const path = myInboxPath(person)
    const generation = laneGeneration()
    // only this person's own answer is ever drawn while the read runs, never the one chosen before
    const base = held.get(k) ?? keptFor(person) ?? MY_INBOX_IDLE
    setSlot({ key: k, state: { ...base, status: base.data ? base.status : 'loading', refreshing: true } })
    try {
      const got = await lane<MyInboxView>(path)
      if (mine !== seq.current) return
      if (!wellFormed(got)) throw new Error('the server answered without the alerts, so nothing is listed')
      keepLane(path, got, generation)
      const next: MyInboxState = { status: 'ready', data: got, error: '', reason: '', refreshing: false, ...answerAge(got) }
      held.set(k, next)
      const bar = chooserOf(got)
      if (bar) heldChooser.set(sessionKey(), bar)
      else heldChooser.delete(sessionKey())
      setSlot({ key: k, state: next })
    } catch (err) {
      if (mine !== seq.current) return
      const refused = err instanceof LaneError && (err.status === 403 || err.reason === 'person')
      const message = err instanceof Error ? err.message : String(err)
      const reason = err instanceof LaneError ? err.reason : ''
      if (refused) {
        held.delete(k)
        if (refusalForgets(reason)) forgetLane(path)
      }
      setSlot((cur) => {
        const s = cur.key === k ? cur.state : heldFor(k, person)
        return { key: k, state: { ...s, status: refused ? 'refused' : 'failed', error: message, reason, refreshing: false, data: refused ? null : s.data } }
      })
    }
  }, [enabled, person])

  useEffect(() => {
    void read()
  }, [read])

  // the app's ring and the stream's return read again; nothing polls
  useEffect(() => (enabled ? onLaneRing(LANE_RINGS.inbox, () => void read()) : undefined), [enabled, read])

  // the page's Refresh
  usePageRefresh(() => void read())

  // coming back to the tab
  useEffect(() => {
    if (!enabled) return
    const wake = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRead.current < WAKE_GAP_MS) return
      void read()
    }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [enabled, read])

  // a notice that arrived on the stream (the bell's arrival count moves)
  const arrival = useNotificationStore((s) => s.arrivalTick)
  const arrivalSeen = useRef(arrival)
  useEffect(() => {
    if (arrival === arrivalSeen.current) return
    arrivalSeen.current = arrival
    void read()
  }, [arrival, read])

  const view = useMemo(
    () => (state.data ? applyMarks(state.data, heldMarks.get(key) ?? NO_MARKS) : null),
    // `marksVersion` moves when this tab marks something
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.data, key, marksVersion],
  )

  // Mark the session's own alerts read, or clear them.
  const mark = useCallback(async (ids: string[], dismiss: boolean): Promise<boolean> => {
    const k = `${sessionKey()}|${person}`
    const answer = held.get(k)?.data
    if (!answer || answer.marks?.kept === false || isActing()) return false
    const mine = heldMarks.get(k) ?? new Map<string, MarkOverride>()
    const keys = markKeys(applyMarks(answer, mine).items, ids)
    if (!keys.length) return false
    const before = new Map(keys.map((id) => [id, mine.get(id)]))
    for (const id of keys) {
      const was = mine.get(id)
      // an answered warning stays answered when it is also marked read
      if (was === 'dismissed' || (was === 'aware' && !dismiss)) continue
      mine.set(id, dismiss ? 'dismissed' : 'read')
    }
    heldMarks.set(k, mine)
    setMarksVersion((v) => v + 1)
    try {
      await post(MY_INBOX_READ_PATH, dismiss ? { keys, dismiss: true } : { keys })
      // a company notice keeps one unread state: the bell reads it again
      if (keys.some((id) => id.startsWith('srv-'))) void useNotificationStore.getState().fetchAll({ force: true })
      return true
    } catch (err) {
      const now = heldMarks.get(k)
      if (now) {
        for (const [id, was] of before) {
          if (was) now.set(id, was)
          else now.delete(id)
        }
      }
      setMarksVersion((v) => v + 1)
      toast({
        type: 'warning',
        title: dismiss ? 'Not cleared' : 'Not marked read',
        body: err instanceof Error ? err.message : 'The marks could not be kept. Try again.',
      })
      return false
    }
  }, [person])

  // An alert answered through its own door ("I'm aware"): held here as answered until the mirror says so, then…
  const answered = useCallback(async (id: string): Promise<void> => {
    const k = `${sessionKey()}|${person}`
    const mine = heldMarks.get(k) ?? new Map<string, MarkOverride>()
    if (mine.get(id) !== 'dismissed') mine.set(id, 'aware')
    heldMarks.set(k, mine)
    setMarksVersion((v) => v + 1)
    await mark([id], false)
  }, [person, mark])

  // the chooser is the answer's own when one is drawn; while a read runs, the session's last mass answer's
  const chooser: Chooser | null = state.data ? chooserOf(state.data) : (heldChooser.get(session) ?? null)

  return {
    state,
    view,
    chooser,
    refresh: read,
    markRead: (ids: string[]) => mark(ids, false),
    clear: (ids: string[]) => mark(ids, true),
    answered,
  }
}
