// My Work, My Calendar and My Inbox for a client-role account — a client, or a guardian signed in for one.
// The same doors answer (/hub-lanes/my-work, /my-calendar, /my-inbox): the relay forwards such a session to the…
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  answerAge, copyAge, forgetLane, keepLane, keptLane, laneGeneration, onLaneRing, refusalForgets, ringOfPath,
} from '@/lib/laneKeep'
import { lane, LaneError } from '@/pages/features/shifts/laneFetch'

export type Viewer = 'client' | 'guardian'

/** ok and empty are answers; not_applicable is shut to this account; unreadable could not be looked at. */
export type FamilySourceState = 'ok' | 'empty' | 'not_applicable' | 'unreadable'

export type FamilySource = { key: string; label: string; state: FamilySourceState | string; why: string; count: number | null }

export type FamilyBase = {
  family: true
  part: 'calendar' | 'work' | 'inbox'
  viewer: Viewer
  linked: boolean
  ward: { name: string }
  why: string
  today: string
  read_at: string
}

export type Appointment = { day: string; title: string; doctor: string; time: string; place: string; status: string }

/** A staff shift at the client's own house: the day, the staff member's name and the hours ('HH:mm', '' unwritten). */
export type FamilyShift = { day: string; staff: string; start: string; end: string }

export type FamilyCalendar = FamilyBase & {
  part: 'calendar'
  week?: { from: string; to: string; prev: string; next: string; this: string }
  /** `drawn`: the days the house calendar carries at all; a day it does not reach is never "No shifts" */
  shifts?: { rows: FamilyShift[]; drawn: string[]; houses: string[]; source: FamilySource }
  appointments?: { rows: Appointment[]; next: Appointment | null; undated: number; source: FamilySource }
  manager?: { rows: { name: string; phone: string }[]; source: FamilySource }
}

export type FamilyWorkRow = { id: string; source: string; title: string; status: string; at: string }

export type FamilyWork = FamilyBase & {
  part: 'work'
  sources?: FamilySource[]
  rows?: FamilyWorkRow[]
  capped?: boolean
  actions?: { state: string; why: string }
  /** Settings › My Work's hides, as the staff answer carries them */
  display?: { hidden?: Partial<Record<'header' | 'source_notes' | 'missing_row' | 'completed', boolean>> }
}

/** Is this answer the backend's client-role read (and not a staff answer)? */
export function isFamily(data: unknown): data is FamilyBase {
  return !!data && typeof data === 'object' && (data as { family?: unknown }).family === true
}

// Who is reading: the answer's own word first; before an answer, a client-role account wearing SSA or FAMILY is a…
export function viewerKind(
  answer: { viewer?: string } | null | undefined,
  user: { role?: string | null; types?: string[] } | null | undefined,
): Viewer {
  if (answer?.viewer === 'guardian' || answer?.viewer === 'client') return answer.viewer
  const guardian = String(user?.role ?? '') === 'client' &&
    (user?.types ?? []).some((t) => ['SSA', 'FAMILY', 'GUARDIAN'].includes(String(t).trim().toUpperCase()))
  return guardian ? 'guardian' : 'client'
}

/** A first name for a heading: "Jane" of "Jane Doe", '' when there is none. */
export function firstName(name: string | null | undefined): string {
  return String(name ?? '').trim().split(/\s+/)[0] ?? ''
}

/** "Your" for a client; "Jane's" for a guardian, or "Your family member's" when the record gave no name. */
export function whose(viewer: Viewer, ward: string): string {
  if (viewer !== 'guardian') return 'Your'
  const first = firstName(ward)
  return first ? `${first}’s` : 'Your family member’s'
}

/** The title of a page: "My Week" for a client, "Jane’s week" for a guardian. */
export function familyTitle(viewer: Viewer, ward: string, own: string, noun: string): string {
  return viewer === 'guardian' ? `${whose(viewer, ward)} ${noun}` : own
}

export const UNLINKED_TITLE = 'Your account isn’t linked to a family member yet'
export const UNLINKED_BODY = 'Ask the office and we will connect your sign-in to the right record. Until then nothing ' +
  'about anybody is shown here — showing the wrong person is the one mistake this screen is never allowed to make.'

const STATE_WORDS: Record<string, string> = {
  ok: '',
  empty: 'Nothing right now.',
  not_applicable: 'Not open to this account.',
  unreadable: 'Could not be read.',
}

/** The line a source says under its card: its own sentence, else the state in words; '' for an answer with rows. */
export function sourceLine(s: FamilySource | null | undefined): string {
  if (!s) return 'Could not be read.'
  const why = String(s.why ?? '').trim()
  if (why) return /[.!?]$/.test(why) ? why : `${why}.`
  return STATE_WORDS[s.state] ?? 'Could not be read.'
}

/** A source that could not be looked at — the tone of its line. */
export function sourceFailed(s: FamilySource | null | undefined): boolean {
  return !s || s.state === 'unreadable' || !(s.state in STATE_WORDS)
}

/* ---------- the read ---------- */

export type FamilyState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'refused'
  data: T | null
  error: string
  reason: string
  readAt: number
  refreshing: boolean
  /** the answer drawn is a kept copy not read again since */
  kept?: boolean
}

export function familyIdle<T>(): FamilyState<T> {
  return { status: 'idle', data: null, error: '', reason: '', readAt: 0, refreshing: false }
}

// One read of a door for a client-role session: drawn at once from the account's kept answer (lib/laneKeep), then…
export function useFamilyRead<T extends FamilyBase>(enabled: boolean, path: string) {
  const keptState = (): FamilyState<T> => {
    const data = enabled ? keptLane<T>(path) : null
    return data && isFamily(data)
      ? { ...familyIdle<T>(), status: 'ready', data, readAt: copyAge(data), kept: true }
      : familyIdle<T>()
  }
  const [state, setState] = useState<FamilyState<T>>(keptState)
  const seq = useRef(0)
  const read = useCallback(async () => {
    if (!enabled) return
    const mine = ++seq.current
    const generation = laneGeneration()
    setState((s) => {
      const base = s.data ? s : keptState()
      return { ...base, status: base.data ? base.status : 'loading', refreshing: true }
    })
    try {
      const got = await lane<T>(path)
      if (mine !== seq.current) return
      if (!isFamily(got)) throw new Error('the answer was not this account’s')
      keepLane(path, got, generation)
      setState({ status: 'ready', data: got, error: '', reason: '', refreshing: false, ...answerAge(got) })
    } catch (err) {
      if (mine !== seq.current) return
      const refused = err instanceof LaneError && err.status === 403
      const reason = err instanceof LaneError ? err.reason : ''
      if (refused && refusalForgets(reason)) forgetLane(path)
      setState((s) => ({
        ...s, status: refused ? 'refused' : 'failed', error: err instanceof Error ? err.message : String(err),
        reason, refreshing: false, data: refused ? null : s.data,
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, path])
  useEffect(() => {
    void read()
  }, [read])
  // the app's ring and the stream's return read again; nothing polls
  useEffect(() => {
    const ring = ringOfPath(path)
    return enabled && ring ? onLaneRing(ring, () => void read()) : undefined
  }, [enabled, path, read])
  return { state, refresh: read }
}
