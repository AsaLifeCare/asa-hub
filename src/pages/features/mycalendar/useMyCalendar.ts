// My Calendar's read — the relay's door on mount, on a new person or week, on retry, after a write, on the app's…
// A 403 keeps the relay's words.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
import { gasAction } from '@/features/hiring/shared'
import {
  LANE_RINGS, answerAge, copyAge, forgetLane, forgetLanes, keepLane, keptLane, laneGeneration, onLaneRing,
  refusalForgets,
} from '@/lib/laneKeep'
import { lane, LaneError } from '@/pages/features/shifts/laneFetch'
import { act, fileRequest, previewRequest } from '@/pages/features/timeoff/useTimeOff'
import type { Preview } from '@/pages/features/timeoff/timeOffModel'
import {
  CHANGE_NOTE, checkPath, fileBody, myCalendarPath, orphanLine, type CheckAnswer, type MyCalendarView, type PersonEntry,
} from './myCalendarModel'

export type MyCalendarState = {
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'refused'
  data: MyCalendarView | null
  error: string
  reason: string
  readAt: number
  refreshing: boolean
  /** the answer drawn is a kept copy not read again since */
  kept?: boolean
}

export const MY_CALENDAR_IDLE: MyCalendarState = { status: 'idle', data: null, error: '', reason: '', readAt: 0, refreshing: false }

/** The master's person list from the session's last mass answer, drawn while another read runs. */
export type Chooser = { people: PersonEntry[]; people_why: string }

/** The chooser a mass answer carries, the master's or an edition holder's; an own answer carries none. */
export function chooserOf(view: MyCalendarView): Chooser | null {
  const s = view.scope
  return s.mode === 'mass' || Boolean(s.edition) ? { people: s.people ?? [], people_why: s.people_why ?? '' } : null
}

const held = new Map<string, MyCalendarState>()
const heldPerson = new Map<string, MyCalendarView>()
const heldChooser = new Map<string, Chooser>()

/** Tests only: forget what was held, and the kept answers. */
export function forgetHeld(): void {
  forgetLanes()
  held.clear()
  heldPerson.clear()
  heldChooser.clear()
  heldRoute.clear()
}

const sessionKey = () => String(useAuthStore.getState().token ?? '')

/** The account's kept answer for a person and week, drawn before any read this session lands. */
function keptFor(person: string, week: string): MyCalendarState | null {
  const data = keptLane<MyCalendarView>(myCalendarPath({ week, person }))
  return data ? { ...MY_CALENDAR_IDLE, status: 'ready', data, readAt: copyAge(data), kept: true } : null
}

/** What is drawn for a person and week before their read lands: their own held or kept answer, never anybody else's. */
const heldFor = (k: string, person: string, week: string): MyCalendarState =>
  held.get(k) ?? keptFor(person, week) ?? { ...MY_CALENDAR_IDLE, status: 'loading' }

export function useMyCalendar(enabled: boolean, person: string, week: string) {
  const session = sessionKey()
  const key = `${session}|${person}|${week}`
  const personKey = `${session}|${person}`
  const [slot, setSlot] = useState<{ key: string; state: MyCalendarState }>(() => ({
    key, state: held.get(key) ?? (enabled ? keptFor(person, week) : null) ?? MY_CALENDAR_IDLE,
  }))
  // the state belongs to the person and week it was read for, from the first render of a new choice
  const state = slot.key === key ? slot.state : heldFor(key, person, week)
  const seq = useRef(0)

  const read = useCallback(async () => {
    if (!enabled) return
    const mine = ++seq.current
    const k = `${sessionKey()}|${person}|${week}`
    const path = myCalendarPath({ week, person })
    const generation = laneGeneration()
    const base = held.get(k) ?? keptFor(person, week) ?? MY_CALENDAR_IDLE
    setSlot({ key: k, state: { ...base, status: base.data ? base.status : 'loading', refreshing: true } })
    try {
      const got = await lane<MyCalendarView>(path)
      if (mine !== seq.current) return
      keepLane(path, got, generation)
      const next: MyCalendarState = { status: 'ready', data: got, error: '', reason: '', refreshing: false, ...answerAge(got) }
      held.set(k, next)
      heldPerson.set(`${sessionKey()}|${person}`, got)
      const bar = got?.scope ? chooserOf(got) : null
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
        heldPerson.delete(`${sessionKey()}|${person}`)
        if (refusalForgets(reason)) forgetLane(path)
      }
      setSlot((cur) => {
        const s = cur.key === k ? cur.state : heldFor(k, person, week)
        return { key: k, state: { ...s, status: refused ? 'refused' : 'failed', error: message, reason, refreshing: false, data: refused ? null : s.data } }
      })
    }
  }, [enabled, person, week])

  useEffect(() => {
    void read()
  }, [read])

  // the app's ring and the stream's return read again; nothing polls
  useEffect(() => (enabled ? onLaneRing(LANE_RINGS.calendar, () => void read()) : undefined), [enabled, read])

  // the chooser is the answer's own when one is drawn; while a read runs, the session's last mass answer's
  const chooser: Chooser | null = state.data ? chooserOf(state.data) : (heldChooser.get(session) ?? null)
  // the same person's last answer, for the parts that do not change with the week
  const backdrop: MyCalendarView | null = state.data ?? (state.status === 'refused' ? null : heldPerson.get(personKey) ?? null)

  return { state, refresh: read, chooser, backdrop }
}

/* ---------- your own time off, filed into Scheduling (behind a switch) ---------- */

/** One of your own time off requests filed into Scheduling from here. */
export type RoutedRequest = {
  flow_id: string; from: string; to: string; state: string; word: string; decided_by: string; decided_at: string; note: string
}

/** Whether your own time off files into Scheduling, and what you filed there. Decided by your own account alone. */
export type VacationRoute = { on: boolean; readable: boolean; why: string; mine: RoutedRequest[] }

export type RouteState = { status: 'idle' | 'loading' | 'ready' | 'failed'; route: VacationRoute | null; error: string }

const heldRoute = new Map<string, VacationRoute>()
const routeListeners = new Set<(r: VacationRoute) => void>()

const t = (v: unknown) => (v == null ? '' : String(v)).trim()

export function routeFrom(raw: unknown): VacationRoute {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const mine = Array.isArray(d.mine) ? d.mine : []
  return {
    on: d.on === true,
    readable: d.readable !== false,
    why: t(d.why),
    mine: mine.filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object').map((m) => ({
      flow_id: t(m.flow_id), from: t(m.from), to: t(m.to), state: t(m.state), word: t(m.word) || t(m.state),
      decided_by: t(m.decided_by), decided_at: t(m.decided_at), note: t(m.note),
    })).filter((m) => m.flow_id),
  }
}

/** The session's last answer: what a filing follows. Unknown means today's door. */
export function heldVacationRoute(): VacationRoute | null {
  return heldRoute.get(sessionKey()) ?? null
}

export async function readVacationRoute(): Promise<VacationRoute> {
  const k = sessionKey()
  const route = routeFrom(await gasAction<unknown>('myCalendarVacationRoute', {}))
  heldRoute.set(k, route)
  for (const fn of [...routeListeners]) fn(route)
  return route
}

/** Read once per mount, for your own calendar; a failed read adds nothing and files through today's door. */
export function useVacationRoute(enabled: boolean): RouteState {
  const [state, setState] = useState<RouteState>(() => {
    const hit = enabled ? heldVacationRoute() : null
    return hit ? { status: 'ready', route: hit, error: '' } : { status: 'idle', route: null, error: '' }
  })
  useEffect(() => {
    if (!enabled) return
    const fn = (route: VacationRoute) => setState({ status: 'ready', route, error: '' })
    routeListeners.add(fn)
    return () => { routeListeners.delete(fn) }
  }, [enabled])
  useEffect(() => {
    if (!enabled) return
    let live = true
    setState((s) => (s.route ? s : { ...s, status: 'loading' }))
    readVacationRoute()
      .then((route) => { if (live) setState({ status: 'ready', route, error: '' }) })
      .catch((e: unknown) => {
        if (!live) return
        // a backend that does not answer this door yet has nothing filed there: today's door, said nowhere
        if ((e as { status?: number })?.status === 404) { setState({ status: 'ready', route: routeFrom({ on: false, readable: false }), error: '' }); return }
        setState((s) => ({ ...s, status: 'failed', error: (e instanceof Error ? e.message : String(e)) || 'no answer' }))
      })
    return () => { live = false }
  }, [enabled])
  return enabled ? state : { status: 'idle', route: null, error: '' }
}

/** What a filing into Scheduling answers. */
export type RoutedFiling = { ref: string; routed: true; said: string }

/* ---------- the writes, through the Time Off doors ---------- */

// The Add panel's dry run: no house; no person on your own calendar, so the relay answers for the session's own…
export function previewAdd(start: string, end: string, reason: string, person = ''): Promise<Preview> {
  return previewRequest(fileBody(start, end, reason, person))
}

export type FileAnswer = Awaited<ReturnType<typeof fileRequest>> | RoutedFiling

// A new request.
export async function fileAdd(start: string, end: string, reason: string, person = ''): Promise<FileAnswer> {
  if (person === '' && heldVacationRoute()?.on) {
    const got = await gasAction<{ ok?: boolean; routed?: boolean; flow_id?: string; said?: string; why?: string }>(
      'myCalendarVacationFile', { from: start, to: end, reason }, { retry: false })
    if (got?.routed === true) {
      // the list of what you filed there follows; a failed read leaves it as it was
      readVacationRoute().catch(() => {})
      return { ref: t(got.flow_id), routed: true, said: t(got.said) || 'Asked. Both directors have it; the first answer decides.' }
    }
  }
  return fileRequest(fileBody(start, end, reason, person))
}

export function isRouted(a: FileAnswer): a is RoutedFiling {
  return (a as RoutedFiling).routed === true
}

export function withdrawRequest(ref: string, note: string) {
  return act('withdraw', ref, { note })
}

/** Would these dates file in place of `ref`? Read only. `person` is the chosen roster row, on a chosen person's calendar. */
export function checkDates(ref: string, start: string, end: string, person = ''): Promise<CheckAnswer> {
  return lane<CheckAnswer>(checkPath(ref, start, end, person))
}

export type ChangeResult =
  | { state: 'done'; ref: string }
  | { state: 'kept'; message: string }
  | { state: 'orphaned'; message: string }

export type ChangeDeps = {
  withdraw: (ref: string, note: string) => Promise<unknown>
  file: (start: string, end: string, reason: string, person: string) => Promise<{ ref: string }>
}

// New dates for a request: withdraw it, then file the new dates — for `person` (fileFor) on a chosen person's…
export async function changeDates(ref: string, start: string, end: string, reason: string, person = '',
  deps: ChangeDeps = { withdraw: withdrawRequest, file: fileAdd }): Promise<ChangeResult> {
  try {
    await deps.withdraw(ref, CHANGE_NOTE)
  } catch (e) {
    return { state: 'kept', message: `Nothing was changed: ${e instanceof Error ? e.message : String(e)}` }
  }
  try {
    const got = await deps.file(start, end, reason, person)
    return { state: 'done', ref: got.ref }
  } catch (e) {
    return { state: 'orphaned', message: orphanLine(ref, e instanceof Error ? e.message : String(e)) }
  }
}
