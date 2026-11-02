// THE HOTLINE SCREEN'S READS — what it asks for, how often, and what it keeps.
// THE SCREEN ONLY READS WHAT IS ALREADY STORED.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  liveConnected, loadIndex as loadSliceIndex, onLiveEvent, onSliceChange, readSlice,
} from '@/lib/snapshotClient'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { useAuthStore } from '@/auth/useAuthStore'
import {
  isAccessRefusal, readCallsIndex, readDailyNotes, readHotlineLanes,
  type AccessReason, type CallRow, type CallsIndex, type DailyNote, type DailyNotesBook, type HotlineRead,
  type HotlineSweep,
} from './hotlineApi'
import type { ScreeningAccess } from './items'
import { callKey, firstSentence, type Row } from './join'
import { LANE_DOOR_KEY, SHEET_LANES, type LaneId } from './vocabulary'

export const KEPT_INDEX = 'smartcomms.hotline.index'

// Enough to paint the first screenful while the door answers; small enough to stay a convenience rather than a…
const KEPT_CALLS_MAX = 200

/** The poll, heard stream or not: a ring only brings a read sooner. */
const POLL_MS = 30_000

// A NOTES BOOK THAT WAS NEVER READ IS ASKED AGAIN, NOT LEFT FOR THE VISIT.
const NOTES_RETRY_FIRST_MS = 30_000
const NOTES_RETRY_MAX_MS = 5 * 60_000
// How often the poll looks at the clock and the stream; a read is still at most one poll after the last one asked.
const POLL_TICK_MS = 5_000

/** The relay's name for "the calls index changed". */
export const HOTLINE_LIVE_EVENT = 'hotline:calls'

// A RING WAITS A BREATH, AND A LITTLE MORE.
const NUDGE_SETTLE_MS = 600
const NUDGE_JITTER_MS = 900

/** Keys the previous Hotline screen wrote and nothing reads now. */
const RETIRED_KEPT = ['smartcomms.hotline.calls', 'smartcomms.hotline.items']

type KeptIndex = { owner: string; index: CallsIndex }

export type IndexProblem = { status: number; message: string; reason: AccessReason | '' }

// `rows` null with no `error` is "not read yet"; null WITH an error is "could not be read" — and never an empty…
export type LaneState<T> = {
  rows: T[] | null
  error: string
  /** the door's refusal of this session, when that is why there are no rows */
  refusal: IndexProblem | null
  /** when the rows on screen were read, or 0 before any answer */
  at: number
  // how fresh those rows are: the read the door says they came from, else the moment the read was asked — 0 before…
  dataAt: number
}

export type Lanes = {
  calloffs: LaneState<Row>
  queue: LaneState<Row>
  incidents: LaneState<Row>
  notes: LaneState<DailyNote>
}

export type NotesMeta = Pick<DailyNotesBook, 'built_at' | 'unmatched' | 'sources'>

export type ScreensState = {
  screens: Row[] | null
  candidates: Row[] | null
  /** true once both slices have been asked, whatever they answered */
  asked: boolean
  /** the roles the slice index says read screens — null when it did not say */
  screeningRoles: string[] | null
}

const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

function ownerNow(): string {
  return String(useAuthStore.getState().user?.id ?? '')
}

function keptIndex(): CallsIndex | null {
  const owner = ownerNow()
  const k = readKept<KeptIndex>(KEPT_INDEX)
  if (!owner || !k || k.owner !== owner || !k.index || !Array.isArray(k.index.calls)) return null
  // a kept copy never speaks for access: whether the 4040 is open is the live answer's to say
  return {
    ...k.index,
    hotline_last_logged_at: String(k.index.hotline_last_logged_at ?? ''),
    hotline_sweep: null,
    screening_withheld: null,
    calls: k.index.calls.map(keptCall),
  }
}

// A call kept while the relay was filing it: whether that finished, and what it filed, is not the copy's to say…
function keptCall(c: CallRow): CallRow {
  const h = c?.hotline
  if (!h || (h.state !== 'filing' && !h.stage)) return c
  const hotline: HotlineRead = {
    ...h,
    state: 'unlogged',
    why: 'This browser kept the call while it was being filed, so whether it was filed, and what it filed, is known once the calls index answers.',
  }
  delete hotline.stage
  return { ...c, hotline }
}

// The part of an answer that is not the calls but still changes what the screen must say: each source's health, the…
function metaKeyOf(ix: CallsIndex): string {
  const health = Object.entries(ix.sources).map(([k, h]) => [k, !!h?.ok, h?.error ?? ''])
  return JSON.stringify([health, ix.hotline_last_logged_at, ix.screening_withheld])
}

const blank = <T,>(): LaneState<T> => ({ rows: null, error: '', refusal: null, at: 0, dataAt: 0 })

const emptyLanes = (): Lanes => ({ calloffs: blank(), queue: blank(), incidents: blank(), notes: blank() })

export function useHotlineData() {
  const [index, setIndex] = useState<CallsIndex | null>(keptIndex)
  /** the index on screen is the kept copy, not a live answer */
  const [fromKept, setFromKept] = useState<boolean>(() => keptIndex() !== null)
  const [problem, setProblem] = useState<IndexProblem | null>(null)
  /** the door has answered at least once, either way */
  const [settled, setSettled] = useState(false)
  /** when the relay last built the index it answered with — every answer */
  const [builtAt, setBuiltAt] = useState<string>(() => keptIndex()?.built_at ?? '')
  /** the sweep's own last pass, as the latest answer said; null until one says */
  const [sweep, setSweep] = useState<HotlineSweep | null>(null)
  const [lanes, setLanes] = useState<Lanes>(emptyLanes)
  const [notesMeta, setNotesMeta] = useState<NotesMeta | null>(null)
  const [screens, setScreens] = useState<ScreensState>({ screens: null, candidates: null, asked: false, screeningRoles: null })
  const [refreshing, setRefreshing] = useState(false)
  /** this tab hears the relay's live stream right now */
  const [heard, setHeard] = useState<boolean>(liveConnected)
  // the relay's fast path is armed, as the latest live answer said; false until one says, and for a relay that does…
  const [fastPath, setFastPath] = useState(false)
  const role = useAuthStore((s) => s.user?.role ?? '')

  const versionRef = useRef<string>('')
  const lanesVersionRef = useRef<string>('')
  const metaKeyRef = useRef<string>('')
  const builtAtRef = useRef<string>(builtAt)
  const sweepKeyRef = useRef<string>('null')
  const fastPathRef = useRef(false)
  const notesVersionRef = useRef<string>('')
  /** calls whose Daily Note already asked the book once — one read per call */
  const notesAskedForRef = useRef<Set<string>>(new Set())
  const lanesRef = useRef<Lanes>(lanes)
  const fromKeptRef = useRef<boolean>(fromKept)
  const problemRef = useRef<IndexProblem | null>(null)
  const inflightRef = useRef<Promise<IndexProblem | null> | null>(null)
  const lanesInflightRef = useRef<Promise<LaneId[]> | null>(null)
  /** a ring landed while a read that started before it was still out */
  const rerunRef = useRef(false)
  // the same, for the lanes door: an answer on its way may have been built before the row that asked for the read
  const lanesRerunRef = useRef(false)
  /** a ring landed while nobody could see the tab */
  const dirtyRef = useRef(false)
  const nudgeTimerRef = useRef<number | null>(null)
  // the live read — the index and the lanes — for the one more read a finish may ask for
  const loadLiveRef = useRef<() => void>(() => {})
  const loadLanesRef = useRef<() => void>(() => {})
  const notesInflightRef = useRef<Promise<string> | null>(null)
  /** when the poll may ask for a never-read notes book again (0: not owed) */
  const notesRetryAtRef = useRef(0)
  /** how long the next refusal of that book waits before asking again */
  const notesRetryDelayRef = useRef(NOTES_RETRY_FIRST_MS)
  /** the notes on screen are a copy the relay stood in with, not the book */
  const notesCopyRef = useRef(false)
  const lastAskRef = useRef(0)
  const aliveRef = useRef(true)

  useEffect(() => { lanesRef.current = lanes }, [lanes])

  useEffect(() => {
    aliveRef.current = true
    // THE RETIRED SCREEN'S COPIES.
    for (const key of RETIRED_KEPT) {
      try { localStorage.removeItem(key) } catch { /* storage blocked — nothing to free */ }
    }
    return () => {
      aliveRef.current = false
      if (nudgeTimerRef.current !== null) window.clearTimeout(nudgeTimerRef.current)
      nudgeTimerRef.current = null
    }
  }, [])

  /** Daily Notes, through the relay. Resolves to '' when read, or why not. */
  const loadNotes = useCallback((): Promise<string> => {
    if (notesInflightRef.current) return notesInflightRef.current
    const asked = Date.now()
    const run = readDailyNotes().then((ans): string => {
      if (!aliveRef.current) return ans.ok ? '' : ans.message
      const now = Date.now()
      if (ans.ok) {
        // A BOOK BUILT FROM A COPY IS DATED BY THE COPY.
        const health = ans.data.sources.notes
        const copy = health && health.ok === false
          ? (health.error || 'The Daily Notes book could not be read; an earlier copy is shown.')
          : ''
        notesCopyRef.current = !!copy
        if (copy) {
          notesRetryAtRef.current = now + notesRetryDelayRef.current
          notesRetryDelayRef.current = Math.min(notesRetryDelayRef.current * 2, NOTES_RETRY_MAX_MS)
        } else {
          notesRetryAtRef.current = 0
          notesRetryDelayRef.current = NOTES_RETRY_FIRST_MS
        }
        const built = Date.parse(ans.data.source_at || ans.data.built_at)
        const dataAt = Number.isFinite(built) ? built : asked
        const same = !!ans.data.version && ans.data.version === notesVersionRef.current
        notesVersionRef.current = ans.data.version
        // THE SAME VERSION IS THE SAME ROWS — the array on screen stays the same object, so the picture is not…
        setLanes((prev) => ({
          ...prev,
          notes: { rows: same && prev.notes.rows ? prev.notes.rows : ans.data.notes, error: copy, refusal: null, at: now, dataAt },
        }))
        if (!same) setNotesMeta({ built_at: ans.data.built_at, unmatched: ans.data.unmatched, sources: ans.data.sources })
        return ''
      }
      const p: IndexProblem = { status: ans.status, message: ans.message, reason: ans.reason }
      if (isAccessRefusal(p)) {
        // THE GATE'S NO IS AN ANSWER, not weather: the poll never asks again
        notesRetryAtRef.current = 0
        notesCopyRef.current = false
        notesVersionRef.current = ''
        setNotesMeta(null)
        setLanes((prev) => ({ ...prev, notes: { rows: null, error: ans.message, refusal: p, at: now, dataAt: 0 } }))
      } else {
        // A BOOK NEVER READ (or only as a copy) IS OWED ANOTHER ASK, later each time it is refused
        if (!lanesRef.current.notes.dataAt || notesCopyRef.current) {
          notesRetryAtRef.current = now + notesRetryDelayRef.current
          notesRetryDelayRef.current = Math.min(notesRetryDelayRef.current * 2, NOTES_RETRY_MAX_MS)
        }
        // THE LAST GOOD NOTES STAY; the failed re-read is said beside them.
        setLanes((prev) => ({ ...prev, notes: { ...prev.notes, error: ans.message, refusal: null, at: now } }))
      }
      return ans.message || 'The Daily Notes door did not answer.'
    })
    notesInflightRef.current = run.finally(() => { notesInflightRef.current = null })
    return notesInflightRef.current
  }, [])

  // A CALL FILED A DAILY NOTE AFTER THE BOOK ON SCREEN WAS BUILT.
  const askNotesForNewFilings = useCallback((ix: CallsIndex) => {
    const notes = lanesRef.current.notes
    if (!notes.dataAt) return   // the first read of the book is still coming
    let fresh = false
    for (const c of ix.calls) {
      if (c.line_key !== 'hotline' || c.hotline?.state !== 'filed' || !c.hotline.kinds.includes('DailyNote')) continue
      const filed = Date.parse(c.hotline.at)
      const key = callKey(c.call_id)
      if (!Number.isFinite(filed) || filed <= notes.dataAt || notesAskedForRef.current.has(key)) continue
      notesAskedForRef.current.add(key)
      fresh = true
    }
    if (fresh) void loadNotes()
  }, [loadNotes])

  const loadIndex = useCallback((): Promise<IndexProblem | null> => {
    if (inflightRef.current) return inflightRef.current
    const run = (async (): Promise<IndexProblem | null> => {
      lastAskRef.current = Date.now()
      // a read that starts now covers every ring heard before it
      dirtyRef.current = false
      const generation = keptGeneration()
      const ans = await readCallsIndex()
      if (!aliveRef.current) return null
      setSettled(true)
      if (ans.ok) {
        const d = ans.data
        const recovered = problemRef.current !== null
        if (problemRef.current) { problemRef.current = null; setProblem(null) }
        // THE INDEX CAME BACK: whatever kept it down likely kept a never-read (or copy-only) notes book down too…
        const notes = lanesRef.current.notes
        if (recovered && (!notes.dataAt || notesCopyRef.current) && !notes.refusal
            && !notesInflightRef.current) {
          notesRetryDelayRef.current = NOTES_RETRY_FIRST_MS
          void loadNotes()
        }
        if (fromKeptRef.current) { fromKeptRef.current = false; setFromKept(false) }
        if (d.built_at !== builtAtRef.current) { builtAtRef.current = d.built_at; setBuiltAt(d.built_at) }
        const sweepKey = JSON.stringify(d.hotline_sweep)
        if (sweepKey !== sweepKeyRef.current) { sweepKeyRef.current = sweepKey; setSweep(d.hotline_sweep) }
        const armed = d.fast_path_armed === true
        if (armed !== fastPathRef.current) { fastPathRef.current = armed; setFastPath(armed) }
        // THE SAME VERSION IS THE SAME DATA — nothing to set, nothing to draw.
        const metaKey = metaKeyOf(d)
        if (d.version && d.version === versionRef.current && metaKey === metaKeyRef.current) return null
        versionRef.current = d.version
        metaKeyRef.current = metaKey
        // the sweep and the fast path live in their own state; the index carries only the calls' facts
        const held: CallsIndex = { ...d, hotline_sweep: null }
        delete held.fast_path_armed
        setIndex(held)
        const owner = ownerNow()
        if (owner) {
          const newest = held.calls.slice(0, KEPT_CALLS_MAX).map((c) => (c.summary
            ? { ...c, summary: { text: firstSentence(c.summary.text), next_steps: [] } }
            : c))
          keepIfCurrent(KEPT_INDEX, { owner, index: { ...held, calls: newest } } satisfies KeptIndex, generation)
        }
        askNotesForNewFilings(held)
        return null
      }
      const p: IndexProblem = { status: ans.status, message: ans.message, reason: ans.reason }
      problemRef.current = p
      setProblem(p)
      if (isAccessRefusal(p)) {
        versionRef.current = ''
        metaKeyRef.current = ''
        setIndex(null)
        fromKeptRef.current = false
        setFromKept(false)
        builtAtRef.current = ''
        setBuiltAt('')
        sweepKeyRef.current = 'null'
        setSweep(null)
        fastPathRef.current = false
        setFastPath(false)
        // a forget since the read started has already taken the copy
        keepIfCurrent(KEPT_INDEX, null, generation)
      }
      // Any other failure — a 503 included — leaves the last good index and the kept copy on screen; the page says…
      return p
    })()
    inflightRef.current = run.finally(() => {
      inflightRef.current = null
      // ONE MORE READ for a ring that landed while this one was out: the answer on its way may have been built…
      if (!rerunRef.current || !aliveRef.current) return
      rerunRef.current = false
      if (isVisible()) loadLiveRef.current()
      else dirtyRef.current = true
    })
    return inflightRef.current
  }, [askNotesForNewFilings, loadNotes])

  // THE THREE SHEET LANES, in one read of the lanes door.
  const loadLanes = useCallback((): Promise<LaneId[]> => {
    if (lanesInflightRef.current) {
      lanesRerunRef.current = true
      return lanesInflightRef.current
    }
    const asked = Date.now()
    // THE VERSION ON SCREEN GOES WITH THE READ: holding it, the door answers the news without the megabyte of rows…
    const run = readHotlineLanes(lanesVersionRef.current).then((ans): LaneId[] => {
      if (!aliveRef.current) return []
      const now = Date.now()
      if (ans.ok) {
        const same = !!ans.data.version && ans.data.version === lanesVersionRef.current
        lanesVersionRef.current = ans.data.version
        setLanes((prev) => {
          const next = { ...prev }
          for (const lane of SHEET_LANES) {
            const book = ans.data.lanes[LANE_DOOR_KEY[lane]]
            if (book.health.state === 'unreadable') {
              // A BOOK THE RELAY COULD NOT READ IS SAID, never drawn as a lane that holds nothing.
              next[lane] = { rows: null, error: book.health.why, refusal: null, at: now, dataAt: 0 }
              continue
            }
            const stale = book.health.state === 'stale'
            const read = Date.parse(book.at)
            next[lane] = {
              // ROWS LEFT OUT OF THE ANSWER ARE THE ROWS ALREADY ON SCREEN — the door leaves them out when it is…
              rows: book.rows ? (same && prev[lane].rows ? prev[lane].rows : book.rows) : prev[lane].rows,
              // A BOOK THE DOOR COULD NOT READ AGAIN IS THE COPY IT HOLDS, and it is said in the same words as any…
              error: stale ? book.health.why : '',
              refusal: null,
              at: now,
              // THE READ THESE ROWS CAME FROM, which the door dates for us: a lane serving the copy it holds dates…
              dataAt: Number.isFinite(read) ? read : (stale ? prev[lane].dataAt : asked),
            }
          }
          return next
        })
        return SHEET_LANES.filter((l) => ans.data.lanes[LANE_DOOR_KEY[l]].health.state !== 'ok')
      }
      const p: IndexProblem = { status: ans.status, message: ans.message, reason: ans.reason }
      setLanes((prev) => {
        const next = { ...prev }
        for (const lane of SHEET_LANES) {
          // A REFUSAL OF THE SESSION EMPTIES THEM: the relay could not vouch for this person, and rows read before…
          next[lane] = isAccessRefusal(p)
            ? { rows: null, error: ans.message, refusal: p, at: now, dataAt: 0 }
            : { ...prev[lane], error: ans.message, refusal: null, at: now }
        }
        return next
      })
      if (isAccessRefusal(p)) lanesVersionRef.current = ''
      return [...SHEET_LANES]
    })
    lanesInflightRef.current = run.finally(() => {
      lanesInflightRef.current = null
      if (!lanesRerunRef.current || !aliveRef.current) return
      lanesRerunRef.current = false
      if (isVisible()) loadLanesRef.current()
    })
    return lanesInflightRef.current
  }, [])
  useEffect(() => { loadLanesRef.current = () => { void loadLanes() } }, [loadLanes])

  // THE LIVE READ — the calls index, then the three lanes.
  const loadLive = useCallback(async (): Promise<{ problem: IndexProblem | null; laneErrors: LaneId[] }> => {
    const problem = await loadIndex()
    const laneErrors = await loadLanes()
    return { problem, laneErrors }
  }, [loadIndex, loadLanes])
  useEffect(() => { loadLiveRef.current = () => { void loadLive() } }, [loadLive])

  // THE RING.
  const nudge = useCallback(() => {
    if (!aliveRef.current) return
    if (!isVisible()) {
      dirtyRef.current = true
      return
    }
    if (nudgeTimerRef.current !== null) return
    nudgeTimerRef.current = window.setTimeout(() => {
      nudgeTimerRef.current = null
      if (!aliveRef.current) return
      if (inflightRef.current) rerunRef.current = true
      else void loadLive()
    }, NUDGE_SETTLE_MS + Math.floor(Math.random() * NUDGE_JITTER_MS))
  }, [loadLive])

  const loadScreens = useCallback((): Promise<void> => Promise.all([
    readSlice<Row>('phoneScreens').catch(() => null),
    readSlice<Row>('candidates').catch(() => null),
    loadSliceIndex().catch(() => null),
  ]).then(([s, c, idx]) => {
    const roles = idx?.phoneScreens?.roles
    if (aliveRef.current) {
      setScreens({
        screens: s,
        candidates: c,
        asked: true,
        screeningRoles: Array.isArray(roles) && roles.length ? roles : null,
      })
    }
  }), [])

  /* the first read of everything */
  useEffect(() => {
    void loadLive()
    void loadNotes()
    void loadScreens()
  }, [loadLive, loadNotes, loadScreens])

  // the poll — the index and the three lanes, and only while somebody can see them; the same thirty seconds while…
  useEffect(() => {
    const timer = window.setInterval(() => {
      setHeard(liveConnected())
      if (isVisible() && Date.now() - lastAskRef.current >= POLL_MS) void loadLive()
      // a notes book never read (or read only as a copy), owed another ask whose wait is over
      const notes = lanesRef.current.notes
      const owed = notesRetryAtRef.current
      if (isVisible() && owed && Date.now() >= owed && (!notes.dataAt || notesCopyRef.current)
          && !notes.refusal && !notesInflightRef.current) {
        notesRetryAtRef.current = 0
        void loadNotes()
      }
    }, POLL_TICK_MS)
    const onVisible = () => {
      if (!isVisible()) return
      if (dirtyRef.current) {
        // a ring the hidden tab remembered: read now, or once more after the read that is out
        if (inflightRef.current) rerunRef.current = true
        else void loadLive()
      } else if (Date.now() - lastAskRef.current >= POLL_MS) {
        void loadLive()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadLive, loadNotes])

  // the ring — the relay says the calls changed, or the stream opened again after a gap in which a ring may have…
  useEffect(() => {
    const offCalls = onLiveEvent(HOTLINE_LIVE_EVENT, nudge)
    const offOpen = onLiveEvent('open', () => {
      setHeard(true)
      nudge()
    })
    const offClose = onLiveEvent('close', () => setHeard(false))
    return () => {
      offCalls()
      offOpen()
      offClose()
    }
  }, [nudge])

  // the slice bell — the hiring lane's screens and candidates are still files, and they re-read when one of those…
  useEffect(() => onSliceChange((resource) => {
    if (resource === 'phoneScreens' || resource === 'candidates') void loadScreens()
  }), [loadScreens])

  /** Everything again. Resolves to what did not answer, so the caller can say it. */
  const refresh = useCallback(async (): Promise<{ problem: IndexProblem | null; laneErrors: LaneId[] }> => {
    setRefreshing(true)
    const [live, notesError] = await Promise.all([
      loadLive(),
      loadNotes(),
      loadScreens(),
    ])
    if (aliveRef.current) setRefreshing(false)
    const laneErrors: LaneId[] = [...live.laneErrors]
    if (notesError) laneErrors.push('notes')
    return { problem: live.problem, laneErrors }
  }, [loadLive, loadNotes, loadScreens])

  // WHETHER THIS ROLE READS THE 4040.
  const screening: ScreeningAccess = useMemo(() => {
    if (index?.screening_withheld === true) return 'withheld'
    if (index?.screening_withheld === false) return 'open'
    if (index?.calls.some((c) => c.line_key === 'screening')) return 'open'
    if (!screens.screeningRoles || !role) return 'unknown'
    return screens.screeningRoles.includes(role) ? 'open' : 'withheld'
  }, [index, screens.screeningRoles, role])

  // LIVE IS TWO FACTS AT ONCE: the relay says its fast path is armed, and this tab hears its stream.
  const live = heard && fastPath

  return {
    index, fromKept, problem, settled, builtAt, sweep, lanes, notesMeta, screens, screening, refreshing, refresh, live,
  }
}
