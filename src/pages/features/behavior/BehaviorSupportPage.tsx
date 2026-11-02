// A wellbeing reading, never a productivity score: missing evidence renders as `Not read`, never as zero or green.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ArrowLeft, Brain, Loader2, RefreshCw, Search, Sparkles,
} from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import ContextBanner from '@/components/shared/ContextBanner'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG, TINT_VAR, heroBand, type ExtendedTintName } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { readSlice } from '@/lib/snapshotClient'
import { gasAction } from '@/features/hiring/shared'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { toast } from '@/stores/useToastStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { useContextStore } from '@/stores/useContextStore'
import { rowFocusTier } from '@/lib/focus'
import type { FocusType } from '@/stores/useContextStore'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------------ the shapes the relay and the backend send…

type Metrics = {
  actions: number
  active_days: number
  distinct_actions: number
  night_actions: number
  weekend_actions: number
  failures: number
  longest_run_days: number
  first_seen: string
  last_seen: string
  hours: number[]
  rail: { day: string; n: number }[]
}

type ShiftFacts = {
  shifts: number
  days: number
  overnights: number
  houses: string[]
  houses_n?: number
  first: string
  last: string
  span_days: number
  longest_run_days: number
  /** the half of the roster that has NOT happened — a plan, never a rhythm */
  planned?: number
  planned_overnights?: number
  off_requested?: number
  /** shifts worked whose cell carried no time: hours unknown, never zero */
  hours_unknown?: number
  night_run_days?: number
}

// THE TIME CLOCK — the only source that can answer hours and turnaround.
type Worked = {
  shifts: number
  hours: number
  days: number
  nights: number
  night_run_days: number
  longest_run_days: number
  hours_per_week: number | null
  longest_shift_h: number
  longest_stretch_h: number
  quick_turnarounds: number
  back_to_back: number
  min_turnaround_h: number | null
  first: string
  last: string
  span_days: number
  as_of: string
  age_days: number
  fresh: boolean
}

// A call-off is a COUNT and a TYPE.
type Absences = {
  count: number
  types: { type: string; n: number }[]
  first: string
  last: string
  as_of: string
  age_days: number
  window_days: number
}

type BoardRow = {
  id: string
  subject_kind: 'person' | 'client' | 'platform'
  subject_key: string
  subject_name: string
  role: string
  title?: string
  types?: string
  active?: boolean
  armed?: boolean
  roster_status?: string
  window_days: number
  computed_at: string
  sample: 'full' | 'thin' | 'none'
  metrics: Metrics
  top_apps: { app: string; n: number }[]
  franchises: string[]
  world?: string
  forms_actions: number
  images_touched: number
  shifts: ShiftFacts | null
  // THE WORKING LIFE.
  worked?: Worked | null
  worked_as_of?: string
  worked_age_days?: number
  worked_fresh?: boolean
  absences?: Absences | null
  absences_as_of?: string
  absences_age_days?: number
  absences_known?: boolean
  /** how they ACTUALLY worked — the punches, in the same five words */
  work_verdict?: string
  work_why?: string
  /** the worse of the two measured axes, and which one it came from */
  rhythm_verdict?: string
  rhythm_from?: string
  rhythm_why?: string
  site_verdict: string
  site_why: string
  shift_verdict: string
  shift_why: string
  reach_verdict: string
  reach_why: string
  /** platform row only — how many people each frozen book reaches */
  worked_people?: number
  absences_people?: number
  // what they were trained to do — the estate's course record, folded to one entry per course and dated.
  training?: Training | null
  ist?: { done: number; owed: number; plans: number } | null
  requirements?: ReqCounts | null
  training_verdict?: string
  training_why?: string
  signals_hash: string
  unattributed_rows?: number
  unattributed_actors?: number
}

type Course = { course: string; expires: string; state: 'valid' | 'expiring' | 'expired' | 'undated' }
type Training = {
  courses: Course[]
  valid: number; expiring: number; expired: number; undated: number; total: number
}
type ReqCounts = {
  ok: number; missing: number; expiring: number; expired: number; na: number
  wrong?: { req: string; state: string; expires: string }[]
}

type Reading = {
  subject_key: string
  subject_name: string
  computed_at: string
  signals_hash: string
  site_verdict: string
  shift_verdict: string
  reading: string
  tags: string[]
  ai_via: string
  ai_at: string
  /** what the cortex last said, kept on the row and repainted on every open */
  cortex_note?: string
  cortex_at?: string
}

type Signal = {
  signal: string
  value: string
  unit: string
  detail: string
  at: string
  window: string
  source: string
}

type Profile = {
  subject_key: string
  subject_name: string
  sees_all?: boolean
  own?: string
  // the whole measured picture, filed in the house so a person who may not read the admin-only slice can still be…
  snapshot?: BoardRow | null
  signals: Signal[]
  reading: (Reading & { highlights?: string[]; site_why?: string; shift_why?: string;
                        state?: string; note?: string }) | null
}

// ------------------------------------------------------------------ the grammar — mint is healthy, amber is watch…

const VERDICT: Record<string, { tint: ExtendedTintName; label: string }> = {
  steady: { tint: 'mint', label: 'Steady' },
  heavy: { tint: 'amber', label: 'Heavy' },
  watch: { tint: 'amber', label: 'Watch' },
  strained: { tint: 'pink', label: 'Strained' },
  quiet: { tint: 'slate', label: 'Quiet' },
  unknown: { tint: 'slate', label: 'Not read' },
  machine: { tint: 'blue', label: 'Machines' },
  multi: { tint: 'lavender', label: 'Several places' },
  'own-world': { tint: 'blue', label: 'Own world' },
  headquarters: { tint: 'slate', label: 'Headquarters' },
  single: { tint: 'slate', label: 'Headquarters' },
  // the credential clock — about paper, never about the person
  current: { tint: 'mint', label: 'In date' },
  renewing: { tint: 'amber', label: 'Renewal due' },
  lapsed: { tint: 'pink', label: 'Past its date' },
}

const COURSE_TINT: Record<string, ExtendedTintName> = {
  valid: 'mint', expiring: 'amber', expired: 'pink', undated: 'slate',
}

// Which kind of person the tracker is holding.
function focusTypeOf(p: BoardRow): FocusType {
  return p.subject_kind === 'client' || p.role === 'client' ? 'client' : 'staff'
}

const APP_TINT: ExtendedTintName[] = ['blue', 'lavender', 'mint', 'peach', 'amber', 'pink', 'violet', 'slate']

function verdictOf(v: string) {
  return VERDICT[v] ?? { tint: 'slate' as ExtendedTintName, label: v || 'Not read' }
}

function VerdictChip({ v, small }: { v: string; small?: boolean }) {
  const d = verdictOf(v)
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full font-semibold',
      small ? 'px-1.5 py-0.5 text-[10.5px]' : 'px-2 py-0.5 text-[11px]',
      TINT_BG[d.tint], TINT_FG[d.tint])}>
      {d.label}
    </span>
  )
}

// A DAY IS A DAY, NOT AN INSTANT.
const dayText = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const stampText = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ------------------------------------------------------------------ the second axis — what the time clock says…

// WHICH LIFE A VERDICT CAME FROM.
const AXIS_LABEL: Record<string, string> = {
  work: 'from the time clock',
  site: 'from the platform',
}

const axisText = (from?: string) => (from ? AXIS_LABEL[from] ?? `from ${from}` : '')

// The fused reading, falling back to the platform axis for a board filed before the working life was read.
const rhythmOf = (p: BoardRow) => p.rhythm_verdict || p.site_verdict || 'unknown'

const hoursText = (h?: number | null) =>
  h === null || h === undefined ? '' : `${Number.isInteger(h) ? h : h.toFixed(1)}h`

/** "33 days old". Anything the page cannot date says so instead. */
const ageText = (days?: number) =>
  typeof days === 'number' && days >= 0
    ? (days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} old`)
    : 'age unknown'

// HOW OLD THE EVIDENCE IS, said beside the evidence itself.
function AsOf({ at, age, fresh, what }: { at?: string; age?: number; fresh?: boolean; what?: string }) {
  if (!at) return null
  const tint: ExtendedTintName = fresh ? 'slate' : 'amber'
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
      TINT_BG[tint], TINT_FG[tint])}>
      <AppIcon name="clock" size={10} />
      {what ? `${what} ` : ''}to {dayText(at)} · {ageText(age)}
    </span>
  )
}

// UNKNOWN MUST LOOK LIKE UNKNOWN.
function NotOnFile({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[10px] border border-dashed border-border px-2.5 py-1.5 text-[11.5px] leading-[1.45] text-text-3">
      {children}
    </p>
  )
}

// ------------------------------------------------------------------ the small drawings — divs and spans…

// Ranked bars with the label on its OWN row: app names are long and a chart library's axis collides with them…
function AppBars({ apps, cap = 6 }: { apps: { app: string; n: number }[]; cap?: number }) {
  const top = apps.slice(0, cap)
  const peak = Math.max(1, ...top.map((a) => a.n))
  if (!top.length) return <p className="text-[12.5px] text-text-3">No app work recorded in this window.</p>
  return (
    <ul className="space-y-2.5">
      {top.map((a, i) => (
        <li key={a.app}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="truncate text-[12.5px] font-medium text-text-1">{a.app}</span>
            <span className="shrink-0 font-stat text-[12.5px] text-text-2">{a.n}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            {/* TINT_VAR values already read `var(--tint-…)`; wrapping them in another
                var() emitted `var(var(--tint-…))`, invalid CSS, and these bars painted
                nothing at all. These bars sit on a Card — a surface that follows the
                theme — so the theme-following token is the right colour here. */}
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(2, (a.n / peak) * 100)}%` }}
              transition={{ duration: 0.6, ease: EASE_OUT_EXPO, delay: Math.min(i, 6) * 0.04 }}
              className="h-full rounded-full"
              style={{ background: TINT_VAR[APP_TINT[i % APP_TINT.length]] }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

// The last fortnight, one column a day.
function DayRail({ rail }: { rail: { day: string; n: number }[] }) {
  if (!rail?.length) return <p className="text-[12.5px] text-text-3">No day-by-day record in this window.</p>
  const peak = Math.max(1, ...rail.map((d) => d.n))
  return (
    <div className="flex h-[92px] items-end gap-1.5">
      {rail.map((d) => {
        const h = d.n ? Math.max(6, Math.round((d.n / peak) * 76)) : 2
        const weekend = [0, 6].includes(new Date(`${d.day}T12:00:00Z`).getUTCDay())
        return (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day} · ${d.n}`}>
            <span className="font-stat text-[10px] text-text-3">{d.n || ''}</span>
            <div
              className={cn('w-full rounded-[3px]', d.n ? (weekend ? 'bg-tint-amber' : 'bg-tint-blue') : 'bg-border')}
              style={{ height: h }}
            />
            <span className="text-[9.5px] text-text-3">{d.day.slice(8)}</span>
          </div>
        )
      })}
    </div>
  )
}

// The clock of a working day — 24 slivers.
function HourClock({ hours }: { hours: number[] }) {
  const peak = Math.max(1, ...hours)
  return (
    <div className="flex h-[64px] items-end gap-[3px]">
      {hours.map((n, h) => {
        const night = h >= 22 || h < 5
        return (
          <div key={h} className="flex flex-1 flex-col items-center gap-1" title={`${h}:00 · ${n}`}>
            <div
              className={cn('w-full rounded-[2px]', n ? (night ? 'bg-tint-amber' : 'bg-tint-lavender') : 'bg-border')}
              style={{ height: n ? Math.max(4, Math.round((n / peak) * 46)) : 2 }}
            />
            {h % 6 === 0 && <span className="text-[9px] text-text-3">{h}</span>}
          </div>
        )
      })}
    </div>
  )
}

function StatChip({ label, value, tint = 'slate' }: { label: string; value: string | number; tint?: ExtendedTintName }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
      TINT_BG[tint], TINT_FG[tint])}>
      <span className="font-stat">{value}</span>
      <span className="font-normal opacity-80">{label}</span>
    </span>
  )
}

// ------------------------------------------------------------------ the page…

const KEPT_BOARD = 'asa:behavior:board'
const TABS = [
  { id: 'people', label: 'The people' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'health', label: 'Health' },
] as const
type TabId = (typeof TABS)[number]['id']

export default function BehaviorSupportPage() {
  const token = useAuthStore((s) => s.token)
  const [board, setBoard] = useState<BoardRow[] | null>(() => readKept<BoardRow[]>(KEPT_BOARD))
  const [readings, setReadings] = useState<Record<string, Reading>>({})
  const [loading, setLoading] = useState(!readKept<BoardRow[]>(KEPT_BOARD))
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('people')

  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  // null = not yet known.
  const [seesAll, setSeesAll] = useState<boolean | null>(null)
  const [own, setOwn] = useState('')

  const load = useCallback(async (loud: boolean) => {
    if (loud) setLoading(true)
    setError(null)
    // a board still in flight at a sign-out or a crossing keeps nothing: the next person on this machine may see…
    const generation = keptGeneration()
    let rows: BoardRow[] | null = null
    // the house answered with this person's OWN scope — even an empty one is the truth about them, never a gap a…
    let ownScope = false
    try {
      // the fast path: one flat file, zero executions — admin only, because a file cannot check a badge
      rows = await readSlice<BoardRow>('behaviorBoard')
    } catch { rows = null }
    // THE KEPT COPY IS RE-READ WHERE IT DECIDES, AND WHAT IS READ IS SHOWN.
    const fallBack = (why: string) => {
      // an empty kept board is not a copy worth hiding a failure behind
      const kept = readKept<BoardRow[]>(KEPT_BOARD)
      if (kept?.length) setBoard((b) => b ?? kept)
      else setError(why)
    }
    if (!rows?.length) {
      // everyone else — a badged manager, or a person looking at themselves — is answered from the house, scoped by…
      try {
        const r = await gasAction<{ rows: BoardRow[]; sees_all: boolean; own: string }>(
          'behaviorBoard', {}, { timeoutMs: 90000 })
        rows = r?.rows ?? []
        ownScope = r?.sees_all === false && Array.isArray(r?.rows)
        setSeesAll(r?.sees_all ?? false)
        setOwn(r?.own ?? '')
      } catch (err) {
        // an empty file followed by a house that did not answer is not "nothing measured" — the failure is what is…
        rows = null
        fallBack(err instanceof Error ? err.message : 'The behaviour board could not be read.')
      }
    } else {
      setSeesAll(true)
    }
    if (rows?.length || (rows && ownScope)) {
      setBoard(rows)
      keepIfCurrent(KEPT_BOARD, rows, generation)
    } else if (rows) {
      fallBack('Nothing has been measured yet. The relay files what the platform’s own log says once an hour.')
    }
    setLoading(false)
    try {
      const r = await gasAction<{ readings: Reading[]; sees_all?: boolean }>(
        'behaviorReadings', {}, { timeoutMs: 60000 })
      const map: Record<string, Reading> = {}
      for (const one of r?.readings ?? []) map[one.subject_key] = one
      setReadings(map)
      if (typeof r?.sees_all === 'boolean') setSeesAll(r.sees_all)
    } catch { /* the arithmetic stands on its own without a paragraph */ }
  }, [])

  useEffect(() => { void load(false) }, [load])

  // THE TRACKER SCOPES THE WHOLE SCREEN — a name dragged to the top filters everything below it.
  const focus = useContextStore((s) => s.focus)
  const everybody = useMemo(
    () => (board ?? []).filter((r) => r.subject_kind !== 'platform'),
    [board],
  )
  const scope = useMemo(() => {
    if (!focus) return { rows: everybody, matched: false }
    const rows = everybody.filter((p) => rowFocusTier(p, ['subject_name', 'subject_key'], focus) !== 0)
    return { rows: rows.length ? rows : everybody, matched: rows.length > 0 }
  }, [everybody, focus])
  const people = scope.rows
  const machines = useMemo(() => (board ?? []).find((r) => r.subject_kind === 'platform'), [board])
  // PEOPLE THE PLATFORM CAN READ AT ALL — the log OR the time clock.
  const evidenced = useMemo(() => people.filter((p) => p.sample !== 'none' || p.worked), [people])
  const counts = useMemo(() => {
    const c: Record<string, number> = { steady: 0, heavy: 0, watch: 0, strained: 0, quiet: 0, unknown: 0 }
    for (const p of people) { const v = rhythmOf(p); c[v] = (c[v] ?? 0) + 1 }
    return c
  }, [people])
  // how many of the fused readings the time clock is responsible for — the honest way to say what the new axis…
  const fromClock = useMemo(() => people.filter((p) => p.rhythm_from === 'work').length, [people])
  // THE FROZEN BOOKS, once for the whole board.
  const clock = useMemo(() => {
    const src = machines ?? people.find((p) => p.worked_as_of) ?? null
    if (!src?.worked_as_of) return null
    return { at: src.worked_as_of, age: src.worked_age_days, fresh: src.worked_fresh }
  }, [machines, people])
  const rosterStrain = useMemo(
    () => people.filter((p) => p.shift_verdict === 'strained').length, [people])
  const rosterWatch = useMemo(
    () => people.filter((p) => p.shift_verdict === 'watch').length, [people])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? people.filter((p) => p.subject_name.toLowerCase().includes(needle) ||
                             p.role.toLowerCase().includes(needle) ||
                             p.top_apps.some((a) => a.app.includes(needle)))
      : people
    return [...list].sort((a, b) => {
      // strain first — this is a call list for a conversation, not a ranking of people.
      const rank = (p: BoardRow) => {
        const v = rhythmOf(p)
        return v === 'strained' || p.shift_verdict === 'strained' ? 0
          : v === 'heavy' ? 1
          : v === 'watch' || p.shift_verdict === 'watch' ? 2
          : p.sample !== 'none' || p.worked ? 3 : 4
      }
      const d = rank(a) - rank(b)
      return d !== 0 ? d : b.metrics.actions - a.metrics.actions
    })
  }, [people, q])

  // resolved against EVERYBODY, never the scoped list: a panel already open must not vanish because the tracker…
  const person = useMemo(() => everybody.find((p) => p.subject_key === picked) ?? null,
                         [everybody, picked])

  // A PERSON WHO MAY ONLY SEE THEMSELVES SEES THEMSELVES — not a locked door — the badges below the line reach only…
  if (seesAll === false) {
    // their own row by key and nothing else: a board kept under a wider badge holds other people, and the first of…
    const mine = everybody.find((p) => p.subject_key === own) ?? null
    if (!mine) {
      return (
        <div className="w-full pb-16">
          <PageHeader title="Behavior Support" subtitle="Your own reading — how you work here, and whether that rhythm is sustainable." />
          {loading ? <Skeleton className="h-64 w-full" /> : (
            <Card padded={false}>
              <EmptyState
                title="Nothing measured about you yet"
                body="The platform files what its own log says once an hour. If you have just started, come back tomorrow."
              />
            </Card>
          )}
        </div>
      )
    }
    return (
      <PersonPanel
        person={mine}
        reading={readings[mine.subject_key] ?? null}
        token={token}
        onlyMine
        onBack={() => { /* there is nowhere to go back to */ }}
        onReading={(r) => setReadings((m) => ({ ...m, [r.subject_key]: r }))}
      />
    )
  }

  if (person) {
    return (
      <PersonPanel
        person={person}
        reading={readings[person.subject_key] ?? null}
        token={token}
        onBack={() => setPicked(null)}
        onReading={(r) => setReadings((m) => ({ ...m, [r.subject_key]: r }))}
      />
    )
  }

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Behavior Support"
          subtitle="How each person actually works — the platform’s log and the time clock together — and whether that rhythm is sustainable."
          actions={
            <button
              type="button"
              onClick={() => void load(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
            >
              <RefreshCw size={14} /> Refresh
            </button>
          }
        />
      </motion.div>

      {/* what the tracker is holding, and whether this board could honour it */}
      <ContextBanner filtered={focus ? scope.matched : undefined} />

      {/* THE HEADLINE, and only when there is a board to headline. A hero
          drawn over a pending or failed load printed "0 of 0 accounts" in
          60px type — a zero dressed as a fact, which is the one thing this
          module refuses to do. */}
      {!board || !people.length ? (
        loading ? <Skeleton className="mb-5 h-[200px] w-full rounded-[16px]" /> : null
      ) : (
      <div className="mb-5 rounded-[16px] bg-detail-hero p-6 shadow-2">
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              People with evidence to read
            </p>
            <p className="font-stat text-[60px] leading-none text-white">{evidenced.length}</p>
            <p className="mt-1 text-[12px] text-white/60">
              of {people.length} account{people.length === 1 ? '' : 's'} · the platform’s log over the last
              {' '}{people[0]?.window_days ?? 30} days, and the time clock
              {clock?.at ? ` to ${dayText(clock.at)}` : ''}
            </p>
            {people.length > evidenced.length && (
              <p className="mt-1.5 text-[12px] text-white/50">
                {people.length - evidenced.length} account{people.length - evidenced.length === 1 ? '' : 's'} appear
                in neither. Nothing is known about how they work — which is not the same as a good rhythm.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              How their rhythm reads — the platform and the time clock together
            </p>
            {/* The bands wear heroBand(), not their tint token: this bar lives on
                --detail-hero, navy in BOTH themes, and the light theme's tint
                foregrounds are dark ink for white paper — on navy they vanished.
                (They also used to be wrapped in a second var(), which was invalid
                CSS and painted nothing in either theme.) */}
            {/* THE DENOMINATOR IS EVERYBODY, so the part of the track that
                stays unpainted IS the people nothing is known about. Dividing
                by the read ones alone drew a full bar over a board that had
                barely been read — a picture of certainty we did not have. */}
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              {(['strained', 'heavy', 'watch', 'steady', 'quiet'] as const).map((k) => (
                counts[k] ? (
                  <span
                    key={k}
                    title={`${counts[k]} ${k}`}
                    style={{ width: `${(counts[k] / Math.max(1, people.length)) * 100}%`,
                             background: heroBand(verdictOf(k).tint) }}
                  />
                ) : null
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-white/70">
              {(['strained', 'heavy', 'watch', 'steady', 'quiet'] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  {/* the legend dot is on the same navy — same colour source as its band */}
                  <span className="h-2 w-2 rounded-full" style={{ background: heroBand(verdictOf(k).tint) }} />
                  {verdictOf(k).label} <span className="font-stat text-white">{counts[k] ?? 0}</span>
                </span>
              ))}
              {/* an unread person gets an UNPAINTED dot, matching the unpainted
                  part of the track above: no verdict was reached, and a
                  coloured chip here would claim one */}
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full border border-white/40" />
                Not read <span className="font-stat text-white">{counts.unknown ?? 0}</span>
              </span>
            </div>
            <p className="mt-3 text-[12.5px] leading-[1.55] text-white/70">
              {fromClock > 0 ? (
                <>
                  <span className="font-stat text-white">{fromClock}</span> of these read the way they do because
                  of the TIME CLOCK, not the platform — hours actually worked, nights in a row, the gap between
                  clocking out and back in.
                </>
              ) : (
                <>No reading here is coming from the time clock right now — every verdict below is about how
                  people use the platform, which is only half of a working life.</>
              )}
              {clock?.at && (
                <>
                  {' '}The stored copy of PsiAnywhere’s punches stopped when its scraper lost port 8443: its newest shift is {dayText(clock.at)}
                  {typeof clock.age === 'number' ? `, ${ageText(clock.age)}` : ''}
                  {clock.fresh === false
                    ? ' — old enough that it no longer sets anybody’s reading; it is kept as evidence of the period it covers.'
                    : '.'}
                </>
              )}
            </p>
            {(rosterStrain > 0 || rosterWatch > 0) && (
              <p className="mt-3 text-[12.5px] text-white/80">
                On the roster, <span className="font-stat text-white">{rosterStrain}</span> person
                {rosterStrain === 1 ? '' : 's'} read as strained
                {rosterWatch ? <> and <span className="font-stat text-white">{rosterWatch}</span> as worth watching</> : null}
                {' '}— long unbroken runs, six-shift weeks, or a majority of overnights.
              </p>
            )}
          </div>
        </div>
      </div>
      )}

      {/* WHAT THIS SCREEN IS, ON THE SCREEN. The laws are in the code and the
          code is not where a manager reads them; the page that judges people
          has to say out loud what it will not do. */}
      <p className="mb-4 text-[11.5px] leading-[1.55] text-text-3">
        A wellbeing reading, not a productivity or attendance score. It reads WHO did what kind of thing and
        WHEN — never a message, a client record, or the reason anybody was absent — and it is here so strain
        is noticed early, never to check up on somebody.
      </p>

      {/* the counting chips only ever count a board that arrived */}
      {!!people.length && (
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatChip label="with a reading" value={Object.keys(readings).length} tint="lavender" />
        <StatChip label="on the roster" value={people.filter((p) => p.shifts?.shifts).length} tint="blue" />
        <StatChip label="on the time clock" value={people.filter((p) => p.worked).length} tint="violet" />
        <StatChip label="work with forms" value={people.filter((p) => p.forms_actions > 0).length} tint="mint" />
        <StatChip label="reach beyond headquarters"
          value={people.filter((p) => p.reach_verdict === 'multi' || p.reach_verdict === 'own-world').length}
          tint="peach" />
        {machines && (
          <StatChip label="actions by the platform's own machines"
            value={machines.metrics.actions.toLocaleString()} tint="slate" />
        )}
      </div>
      )}

      {/* the tabs — an underline bar with counts, the Technology pattern */}
      <div className="mb-4 flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn('-mb-px border-b-2 px-4 py-2.5 text-[13px] font-semibold transition-colors',
              tab === t.id ? cn('border-current', TINT_FG.lavender)
                : 'border-transparent text-text-3 hover:text-text-2')}
          >
            {t.label}
            {t.id === 'people' && <span className="ml-1.5 font-stat text-[11.5px] opacity-70">{people.length}</span>}
            {t.id === 'health' && (rosterStrain + (counts.strained ?? 0)) > 0 && (
              <span className="ml-1.5 font-stat text-[11.5px] opacity-70">{rosterStrain + (counts.strained ?? 0)}</span>
            )}
          </button>
        ))}
        {tab === 'people' && (
          <div className="ml-auto flex items-center gap-1.5 pb-2">
            <Search size={13} className="text-text-3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a person or an app…"
              className="h-8 w-[220px] rounded-sm border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary/50"
            />
          </div>
        )}
      </div>

      {error && (
        <Card padded={false} className="mb-4 p-4">
          <p className="flex items-center gap-2 text-[13px] text-text-2">
            <AlertTriangle size={15} className={TINT_FG.amber} /> {error}
          </p>
        </Card>
      )}

      {loading && !board && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {!loading && board && people.length === 0 && (
        <Card padded={false}>
          <EmptyState
            title="Nobody to read yet"
            body="The relay measures how people use the platform from the platform's own log, once an hour. Nothing has been filed yet."
          />
        </Card>
      )}

      {tab === 'people' && shown.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p, i) => (
            <PersonCard
              key={p.subject_key}
              p={p}
              reading={readings[p.subject_key] ?? null}
              index={i}
              onOpen={() => setPicked(p.subject_key)}
            />
          ))}
        </div>
      )}

      {tab === 'rhythm' && <RhythmView people={people} machines={machines ?? null} />}
      {tab === 'health' && <HealthView people={people} onOpen={setPicked} />}

    </div>
  )
}

/* ------------------------------------------------------------------ */

function PersonCard({ p, reading, index, onOpen }:
  { p: BoardRow; reading: Reading | null; index: number; onOpen: () => void }) {
  const quiet = p.sample === 'none'
  const w = p.worked ?? null
  // nothing at all is known about this person's rhythm — neither axis ran
  const blind = quiet && !w
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO, delay: Math.min(index, 8) * 0.04 }}
    >
      <Card hover className="cursor-pointer" >
        <div onClick={onOpen} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
          <div className="flex items-start gap-3">
            <DragPerson name={p.subject_name} id={p.subject_key} type={focusTypeOf(p)} subtitle={p.role}>
              <Avatar name={p.subject_name} size="md" />
            </DragPerson>
            <div className="min-w-0 flex-1">
              {/* THE NAME IS THE HANDLE, not only the avatar — the tracker
                  hangs on the person's NAME. A
                  person's name is what somebody reaches for; a 32px circle
                  beside it is a target you have to aim at. The wrapper IS the
                  line — a span around a block element is invalid nesting, and
                  truncation needs the ellipsis on the box that drags. */}
              <span className="flex min-w-0 items-center gap-1.5">
                <DragPerson name={p.subject_name} id={p.subject_key} type={focusTypeOf(p)} subtitle={p.role}
                            className="block truncate text-[14px] font-semibold text-text-1"
                            title="Drag this name onto the tracker, top left">
                  {p.subject_name || 'Unnamed account'}
                </DragPerson>
              </span>
              <p className="truncate text-[11.5px] text-text-3">
                {p.title || p.role}{p.roster_status ? ` · ${p.roster_status}` : ''}
              </p>
            </div>
            {/* ONE VERDICT, AND WHICH LIFE IT CAME FROM. The fused reading is
                the headline; the line under it is what stops one word from
                covering two different lives. */}
            <div className="flex shrink-0 flex-col items-end gap-1">
              <VerdictChip v={rhythmOf(p)} small />
              {p.rhythm_from
                ? <span className="text-[10px] text-text-3">{axisText(p.rhythm_from)}</span>
                : <span className="text-[10px] text-text-3">no evidence</span>}
            </div>
          </div>

          {blind ? (
            <p className="mt-3 text-[12.5px] text-text-3">
              Neither the platform’s log nor the time clock holds anything for this account in the window.
              That is the absence of evidence, not a good rhythm and not a fault.
            </p>
          ) : (
            <>
              {/* THE WORKING LIFE FIRST when it is what the verdict rests on:
                  a night worker who barely clicks should not have their card
                  led by how little they clicked. */}
              {w && (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-2">
                  <span><span className="font-stat text-text-1">{w.shifts}</span> shift{w.shifts === 1 ? '' : 's'} punched</span>
                  <span><span className="font-stat text-text-1">{hoursText(w.hours)}</span> worked</span>
                  {w.nights > 0 && (
                    <span className={TINT_FG.amber}>
                      <span className="font-stat">{w.nights}</span> at night
                      {w.night_run_days >= 2 ? `, ${w.night_run_days} running` : ''}
                    </span>
                  )}
                  {w.hours_per_week !== null && (
                    <span><span className="font-stat text-text-1">{w.hours_per_week}</span> h/week</span>
                  )}
                </div>
              )}
              {/* A CARD IS NOT THE PLACE FOR A PARAGRAPH, but it is still the
                  place where "we have no hours for this person" must not look
                  like "this person worked nothing". A hollow marker and four
                  words; the panel says the rest. */}
              {w ? (
                <div className="mt-2"><AsOf at={w.as_of} age={w.age_days} fresh={w.fresh} what="time clock" /></div>
              ) : (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-text-3">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-text-3" />
                  time clock: no record — hours unread, not zero
                </p>
              )}

              {quiet ? (
                <p className="mt-3 border-t border-border pt-2.5 text-[12px] text-text-3">
                  The platform’s own log recorded nothing for this account in the window — their work happens
                  elsewhere.
                </p>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2.5 text-[12px] text-text-2">
                    <span><span className="font-stat text-text-1">{p.metrics.actions.toLocaleString()}</span> actions</span>
                    <span><span className="font-stat text-text-1">{p.metrics.active_days}</span> day{p.metrics.active_days === 1 ? '' : 's'}</span>
                    {p.metrics.night_actions > 0 && (
                      <span className={TINT_FG.amber}>
                        <span className="font-stat">{p.metrics.night_actions}</span> at night
                      </span>
                    )}
                    {!!p.shifts?.shifts && <span><span className="font-stat text-text-1">{p.shifts.shifts}</span> rostered</span>}
                  </div>
                  {p.top_apps.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {p.top_apps.slice(0, 4).map((a, i) => (
                        <span key={a.app}
                          className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                            TINT_BG[APP_TINT[i % APP_TINT.length]], TINT_FG[APP_TINT[i % APP_TINT.length]])}>
                          {a.app} {a.n}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {reading?.reading && (
            <p className="mt-3 flex gap-1.5 border-t border-border pt-2.5 text-[12px] leading-[1.55] text-text-2">
              <Sparkles size={13} className={cn('mt-0.5 shrink-0', TINT_FG.lavender)} />
              <span className="clamp-2">{reading.reading}</span>
            </p>
          )}
        </div>
      </Card>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */

function RhythmView({ people, machines }: { people: BoardRow[]; machines: BoardRow | null }) {
  // the log's own drawings are about the people the LOG saw; the working-life strip below is about the people the…
  const logged = useMemo(() => people.filter((p) => p.sample !== 'none'), [people])
  const apps = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of logged) for (const a of p.top_apps) c[a.app] = (c[a.app] ?? 0) + a.n
    return Object.entries(c).map(([app, n]) => ({ app, n })).sort((a, b) => b.n - a.n)
  }, [logged])
  const hours = useMemo(() => {
    const h = new Array(24).fill(0)
    for (const p of logged) p.metrics.hours?.forEach((n, i) => { h[i] += n })
    return h
  }, [logged])
  const rail = useMemo(() => {
    const byDay: Record<string, number> = {}
    for (const p of logged) for (const d of p.metrics.rail ?? []) byDay[d.day] = (byDay[d.day] ?? 0) + d.n
    return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, n]) => ({ day, n }))
  }, [logged])
  const night = logged.reduce((s, p) => s + p.metrics.night_actions, 0)
  const weekend = logged.reduce((s, p) => s + p.metrics.weekend_actions, 0)
  const total = logged.reduce((s, p) => s + p.metrics.actions, 0)

  // THE SHAPE OF THE WORKFORCE'S REAL WEEK, counted only over the people the punch record can actually see, and…
  const clocked = useMemo(() => people.filter((p) => p.worked), [people])
  const work = useMemo(() => {
    if (!clocked.length) return null
    const w = clocked.map((p) => p.worked!)
    const rates = w.map((x) => x.hours_per_week).filter((x): x is number => x !== null).sort((a, b) => a - b)
    return {
      people: w.length,
      hours: w.reduce((s, x) => s + x.hours, 0),
      nights: w.reduce((s, x) => s + x.nights, 0),
      runs: w.filter((x) => x.night_run_days >= 4).length,
      quick: w.filter((x) => x.quick_turnarounds > 0).length,
      stretch: w.filter((x) => x.longest_stretch_h >= 24).length,
      median: rates.length ? rates[Math.floor(rates.length / 2)] : null,
      rated: rates.length,
      as_of: w[0].as_of,
      age: w[0].age_days,
      fresh: w.every((x) => x.fresh),
    }
  }, [clocked])

  if (!people.length) {
    return <Card padded={false}><EmptyState title="No rhythm to draw yet" body="Nobody has been measured in this window." /></Card>
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        {/* THE HOURS PEOPLE ACTUALLY WORKED, before the hours they clicked.
            Counts, never a ranking: no name is printed on this card. */}
        <Card>
          <CardHeader
            title="The week this workforce actually worked"
            sub={work
              ? `Counted from the time clock, over the ${work.people} of ${people.length} account(s) it can see.`
              : 'The time clock reaches nobody on this board.'} />
          {work ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label="Hours clocked" value={Math.round(work.hours).toLocaleString()} />
                <Tile label="Median a week" value={work.median === null ? '—' : hoursText(work.median)} />
                <Tile label="Nights worked" value={work.nights.toLocaleString()} tint={work.nights ? 'amber' : undefined} />
                <Tile label="4+ nights running" value={work.runs} tint={work.runs ? 'pink' : undefined} />
              </div>
              <p className="mt-3 text-[12.5px] leading-[1.55] text-text-2">
                <span className="font-stat text-text-1">{work.quick}</span> person(s) clocked back in less than
                ten hours after clocking out, and <span className="font-stat text-text-1">{work.stretch}</span>{' '}
                spent 24 hours or more clocked in with no gap between shifts.
                {work.median === null
                  ? ' No weekly rate could be taken: nobody has a week of punched span.'
                  : ` The weekly rate is an average over each person's punched span, taken for ${work.rated} of them.`}
              </p>
              <div className="mt-3">
                <AsOf at={work.as_of} age={work.age} fresh={work.fresh} what="punches" />
              </div>
              {people.length > work.people && (
                <p className="mt-2 text-[11.5px] leading-[1.45] text-text-3">
                  The other {people.length - work.people} account(s) are not in the punch record at all. Their
                  hours are unread — none of the numbers above says anything about them.
                </p>
              )}
            </>
          ) : (
            <NotOnFile>
              No punch record reaches anybody on this board, so there is nothing to say about hours, nights or
              turnaround. That is a gap in what we hold, not a quiet workforce.
            </NotOnFile>
          )}
        </Card>
        <Card>
          <CardHeader title="Where the platform work happens"
            sub={`Every recorded action in the window, grouped by the app it belongs to — the ${logged.length} account(s) the log saw.`} />
          <AppBars apps={apps} cap={10} />
        </Card>
        <Card>
          <CardHeader title="The last fortnight" sub="One column a day, the whole company. Weekends wear amber." />
          <DayRail rail={rail.slice(-15)} />
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="The hours people are on the platform"
            sub="On Ohio's clock. Amber is 10pm to 5am. This is clicking, not shifts — the time clock answers shifts." />
          <HourClock hours={hours} />
          <div className="mt-4 space-y-2 border-t border-border pt-3 text-[12.5px] text-text-2">
            <p className="flex items-center justify-between">
              <span>After 10pm or before 5am</span>
              <span className="font-stat text-text-1">
                {night.toLocaleString()} <span className="text-[11px] text-text-3">
                  ({total ? Math.round((night / total) * 100) : 0}%)</span>
              </span>
            </p>
            <p className="flex items-center justify-between">
              <span>At weekends</span>
              <span className="font-stat text-text-1">
                {weekend.toLocaleString()} <span className="text-[11px] text-text-3">
                  ({total ? Math.round((weekend / total) * 100) : 0}%)</span>
              </span>
            </p>
          </div>
        </Card>
        {machines && (
          <Card>
            <CardHeader title="And the platform's own machines"
              sub="Counted apart, so nobody's rhythm is judged on a sweep's work." />
            <p className="font-stat text-[26px] text-text-1">{machines.metrics.actions.toLocaleString()}</p>
            <p className="mt-1 text-[12px] text-text-3">{machines.site_why}</p>
            {!!machines.unattributed_rows && (
              <p className="mt-2 text-[11.5px] text-text-3">
                {machines.unattributed_rows.toLocaleString()} further action(s) came from
                {' '}{machines.unattributed_actors} actor(s) with no account row — neither judged nor hidden.
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function HealthView({ people, onOpen }: { people: BoardRow[]; onOpen: (k: string) => void }) {
  // THE BANDS READ THE FUSED VERDICT, so somebody strained at the time clock lands here even if the platform's log…
  const strained = people.filter((p) => rhythmOf(p) === 'strained' || p.shift_verdict === 'strained')
  const watch = people.filter((p) => !strained.includes(p) &&
    (rhythmOf(p) === 'heavy' || rhythmOf(p) === 'watch' || p.shift_verdict === 'watch'))
  const known = (p: BoardRow) => p.sample !== 'none' || !!p.worked || !!p.shifts?.shifts
  const steady = people.filter((p) => !strained.includes(p) && !watch.includes(p) && known(p))
  const unread = people.filter((p) => !known(p))

  const bands: { title: string; dot: string; note: string; rows: BoardRow[] }[] = [
    { title: 'Worth a conversation', dot: 'bg-tint-fg-pink', rows: strained,
      note: 'Two or more strain signals at once — nights in a row, a week of hours above this workforce’s own norm, turnarounds too short to sleep in, or days without one off.' },
    { title: 'Worth watching', dot: 'bg-tint-fg-amber', rows: watch,
      note: 'One signal above the norm, on the platform or on the clock. Not a problem yet.' },
    { title: 'A steady rhythm', dot: 'bg-tint-fg-mint', rows: steady,
      note: 'Nothing in what is on record suggests strain. Only ever as good as the axes that actually ran.' },
    { title: 'Not enough evidence', dot: 'bg-border', rows: unread,
      note: 'No log, no punch, no worked shift. This is a gap in what we hold — never a verdict about the person, and never to be read as a good rhythm.' },
  ]

  return (
    <div className="space-y-7">
      {bands.map((b) => (
        <section key={b.title}>
          <h2 className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-text-2">
            <span className={cn('h-2 w-2 rounded-full', b.dot)} />
            {b.title}
            <span className="font-stat text-[12px] text-text-3">{b.rows.length}</span>
          </h2>
          <p className="mb-3 text-[11.5px] text-text-3">{b.note}</p>
          {b.rows.length === 0 ? (
            <p className="text-[12.5px] text-text-3">Nobody here.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {b.rows.slice(0, 24).map((p) => (
                <Card key={p.subject_key} hover className="cursor-pointer">
                  <div onClick={() => onOpen(p.subject_key)} role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') onOpen(p.subject_key) }}>
                    <div className="flex items-center justify-between gap-2">
                      <DragPerson name={p.subject_name} id={p.subject_key} type={focusTypeOf(p)}
                                  subtitle={p.role}
                                  className="block truncate text-[13.5px] font-semibold text-text-1"
                                  title="Drag this name onto the tracker, top left">
                        {p.subject_name}
                      </DragPerson>
                      <VerdictChip v={p.shift_verdict === 'strained' ? 'strained' : rhythmOf(p)} small />
                    </div>
                    {/* THE EVIDENCE, not just the word. The time clock's line
                        comes first when it is what the verdict rests on, and
                        it carries its own date because that book is frozen. */}
                    {p.worked && p.work_why && (
                      <p className="mt-1.5 flex gap-1.5 text-[12px] leading-[1.5] text-text-2">
                        <AppIcon name="clock" size={12} className="mt-0.5 shrink-0" />
                        <span>
                          {p.work_why}
                          <span className="text-text-3"> · punched to {dayText(p.worked.as_of)}, {ageText(p.worked.age_days)}</span>
                        </span>
                      </p>
                    )}
                    {p.site_why && p.sample !== 'none' && (
                      <p className="mt-1.5 text-[12px] leading-[1.5] text-text-2">{p.site_why}</p>
                    )}
                    {!!p.shifts?.shifts && p.shift_why && (
                      <p className="mt-1.5 flex gap-1.5 text-[12px] leading-[1.5] text-text-3">
                        <AppIcon name="calendar" size={12} className="mt-0.5 shrink-0" />
                        <span>{p.shift_why}</span>
                      </p>
                    )}
                    {!p.worked && (
                      <p className="mt-1.5 text-[11.5px] leading-[1.45] text-text-3">
                        No time-clock record — hours, nights and turnaround unread for this person.
                      </p>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ one person…

// WHAT THEY WERE TRAINED TO DO.
function TrainingCard({ person }: { person: BoardRow }) {
  const t = person.training
  const ist = person.ist
  const req = person.requirements
  if (!t && !ist && !req) {
    return (
      <Card>
        <CardHeader title="What they were trained to do" />
        <p className="text-[12.5px] leading-[1.5] text-text-3">
          No course record reaches this name. The estate files training by name, so this is a gap in our
          records rather than anything about this person.
        </p>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader
        title="What they were trained to do"
        sub={t ? `${t.total} completed course${t.total === 1 ? '' : 's'} on file.` : undefined}
      />
      {person.training_verdict && (
        <div className="mb-2 flex items-center gap-2">
          <VerdictChip v={person.training_verdict} small />
          <span className="text-[11.5px] text-text-3">{person.training_why}</span>
        </div>
      )}
      {t && (
        <ul className="space-y-1">
          {t.courses.map((c) => (
            <li key={c.course} className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-text-1">{c.course}</span>
              <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold',
                TINT_BG[COURSE_TINT[c.state] ?? 'slate'], TINT_FG[COURSE_TINT[c.state] ?? 'slate'])}>
                {c.expires ? dayText(c.expires) : 'no date'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {ist && (
        <p className="mt-3 border-t border-border pt-3 text-[12.5px] leading-[1.5] text-text-2">
          Client-specific training: <strong>{ist.done}</strong> signed off across {ist.plans} plan
          {ist.plans === 1 ? '' : 's'}
          {ist.owed ? <>, <strong>{ist.owed}</strong> still owed</> : null}.
        </p>
      )}
      {req && (
        <p className="mt-2 text-[12.5px] leading-[1.5] text-text-3">
          Onboarding requirements: {req.ok} met · {req.missing} not on file · {req.expiring} expiring ·{' '}
          {req.expired} expired.
        </p>
      )}
    </Card>
  )
}

// THE THREE AXES, KEPT APART AND SAID IN ORDER.
function RhythmCard({ person }: { person: BoardRow }) {
  const w = person.worked ?? null
  const rows: { v: string; where: string; why: string; stale?: ReactNode; missing?: string }[] = [
    {
      v: person.work_verdict || 'unknown',
      where: 'at the time clock',
      why: person.work_why || '',
      stale: w ? <AsOf at={w.as_of} age={w.age_days} fresh={w.fresh} /> : null,
      missing: w ? '' : 'No punch reaches this name, so hours, nights and turnaround are unread — not zero.',
    },
    {
      v: person.site_verdict,
      where: 'on the platform',
      why: person.site_why,
      missing: person.sample === 'none' ? 'Nothing recorded in the platform’s own log in this window.' : '',
    },
    {
      v: person.shift_verdict,
      where: 'on the roster',
      why: person.shift_why,
      missing: person.shifts?.shifts ? '' : 'No worked shift on the roster in this window.',
    },
  ]
  return (
    <Card>
      <CardHeader title="Their rhythm" sub="One reading, and the lives it was read from." />
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5">
        <VerdictChip v={rhythmOf(person)} />
        <span className="text-[11.5px] text-text-3">
          {person.rhythm_from ? axisText(person.rhythm_from) : 'no axis could be read'}
        </span>
        {person.rhythm_why && (
          <p className="w-full text-[12.5px] leading-[1.5] text-text-2">{person.rhythm_why}</p>
        )}
      </div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.where} className={cn(i > 0 && 'border-t border-border pt-3')}>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <VerdictChip v={r.v} small />
              <span className="text-[11.5px] text-text-3">{r.where}</span>
              {r.stale}
            </div>
            {r.missing
              ? <NotOnFile>{r.missing}</NotOnFile>
              : <p className="text-[12.5px] leading-[1.5] text-text-2">{r.why}</p>}
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-border pt-2.5 text-[10.5px] leading-[1.5] text-text-3">
        The fused word is the WORSE of the platform and the time clock, never an average, and an axis that
        did not run is skipped rather than counted as good. The roster is shown here but never fused: it
        covers the same days the punches do.
      </p>
    </Card>
  )
}

// WHAT THE TIME CLOCK SAYS — the hours somebody was actually paid for.
function WorkCard({ person }: { person: BoardRow }) {
  const w = person.worked ?? null
  if (!w) {
    return (
      <Card>
        <CardHeader title="What the time clock says" />
        <NotOnFile>
          No punch on the time clock reaches this name
          {person.worked_as_of ? ` in the record to ${dayText(person.worked_as_of)}` : ''}. Their hours, their
          nights and the gaps between their shifts are UNREAD — this is a gap in what we hold, not a person
          who worked nothing, and it must not be read as a healthy rhythm.
        </NotOnFile>
      </Card>
    )
  }
  const week = w.hours_per_week
  return (
    <Card>
      <CardHeader
        title="What the time clock says"
        sub={`${dayText(w.first)} — ${dayText(w.last)}, ${w.span_days} day(s) of record. Overnights split at midnight by PsiAnywhere are stitched back into one shift.`}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <VerdictChip v={person.work_verdict || 'unknown'} small />
        <AsOf at={w.as_of} age={w.age_days} fresh={w.fresh} what="punches" />
      </div>
      {w.fresh === false && (
        <p className={cn('mb-3 rounded-[10px] px-3 py-2 text-[11.5px] leading-[1.5]', TINT_BG.amber, TINT_FG.amber)}>
          These hours come from the stored copy of PsiAnywhere’s punches, which stopped when its scraper lost port
          8443. PsiAnywhere is still the official time clock — the Punch board in Smart Comms reads it live. This
          copy is true about the days it covers and is no longer allowed to set the reading at the top of the page.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Shifts" value={w.shifts} />
        <Tile label="Hours" value={hoursText(w.hours)} />
        <Tile label="A week" value={week === null ? '—' : hoursText(week)}
          tint={week !== null && week >= 48 ? 'pink' : undefined} />
        <Tile label="Nights" value={w.nights}
          tint={w.nights && w.nights / Math.max(1, w.shifts) >= 0.5 ? 'amber' : undefined} />
        <Tile label="Nights running" value={w.night_run_days}
          tint={w.night_run_days >= 4 ? 'pink' : undefined} />
        <Tile label="Days on, unbroken" value={`${w.longest_run_days}d`}
          tint={w.longest_run_days >= 10 ? 'pink' : undefined} />
        <Tile label="Shortest turnaround" value={w.min_turnaround_h === null ? '—' : hoursText(w.min_turnaround_h)}
          tint={w.min_turnaround_h !== null && w.min_turnaround_h < 10 ? 'pink' : undefined} />
        <Tile label="Longest stretch in" value={hoursText(w.longest_stretch_h)}
          tint={w.longest_stretch_h >= 24 ? 'pink' : undefined} />
      </div>
      {/* THE EVIDENCE UNDER EACH CLAIM — the sentence a manager can act on,
          and the arithmetic it came from, never one without the other. */}
      <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-[12.5px] leading-[1.5] text-text-2">
        <li>
          <span className="font-stat text-text-1">{w.nights}</span> of {w.shifts} shift(s) reached at least two
          hours into 10pm–6am, so an eight o'clock finish is not counted as a night.
          {w.night_run_days >= 2 && (
            <> The longest run of nights back to back was{' '}
              <span className="font-stat text-text-1">{w.night_run_days}</span> — counted on the night each
              shift belongs to, so a week of 10pm–6am reads as {w.night_run_days} nights and not twice as many
              halves.</>
          )}
        </li>
        <li>
          {week === null ? (
            <>Under a week of punched span, so there is NO weekly rate — {hoursText(w.hours)} over{' '}
              {w.span_days} day(s) is all that can honestly be said.</>
          ) : (
            <><span className="font-stat text-text-1">{hoursText(w.hours)}</span> clocked across{' '}
              {w.days} day(s), an average of <span className="font-stat text-text-1">{week}</span> a week over the
              span actually punched.</>
          )}
        </li>
        <li>
          {w.min_turnaround_h === null ? (
            <>Only one shift in range, so there is no gap to measure a turnaround from.</>
          ) : (
            <><span className="font-stat text-text-1">{w.quick_turnarounds}</span> gap(s) under 10 hours between
              clocking out and back in, the shortest {hoursText(w.min_turnaround_h)}
              {w.back_to_back ? <>, and <span className="font-stat text-text-1">{w.back_to_back}</span> straight
                back-to-back</> : ''}. Breaks over three days are holidays and are not counted as turnarounds.</>
          )}
        </li>
        {w.longest_stretch_h >= 24 && (
          <li className={TINT_FG.pink}>
            <span className="font-stat">{hoursText(w.longest_stretch_h)}</span> clocked in with no gap at all
            between shifts — the shift count alone hides this completely.
          </li>
        )}
      </ul>
      <p className="mt-3 text-[10.5px] leading-[1.5] text-text-3">
        This reads WHEN somebody was clocked in and for how long. It holds no client, no place and no reason,
        and nothing here knows whether a run of nights was chosen, covered for somebody, or imposed.
      </p>
    </Card>
  )
}

// CALL-OFFS: THE FACT AND THE TYPE, AND NOTHING ELSE.
function AbsenceCard({ person }: { person: BoardRow }) {
  const a = person.absences ?? null
  if (!a) {
    return (
      <Card>
        <CardHeader title="Time called off" />
        <NotOnFile>
          {person.absences_known
            ? <>Nothing on file in the window ending {dayText(person.absences_as_of)}.</>
            : <>The call-off book is frozen — its newest entry is {dayText(person.absences_as_of) || 'undated'}
                {typeof person.absences_age_days === 'number' && person.absences_age_days >= 0
                  ? `, ${ageText(person.absences_age_days)}` : ''}, older than the window this page reads. Nobody
                gets a number from it, because a zero here would say “never absent” about a book that simply
                stopped.</>}
        </NotOnFile>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader title="Time called off"
        sub={`${a.count} in the ${a.window_days} day(s) to ${dayText(a.as_of)}.`} />
      <div className="flex flex-wrap items-center gap-2">
        {a.types.map((t) => <StatChip key={t.type} label={t.type} value={t.n} tint="slate" />)}
        <AsOf at={a.as_of} age={a.age_days} fresh={false} what="the book" />
      </div>
      <p className="mt-3 text-[11.5px] leading-[1.5] text-text-3">
        The count and the kind only. The reason somebody gave, how late they were and who reported it are
        written down elsewhere about their health and their conduct — this page does not read them, and no
        absence makes anybody’s rhythm read worse.
      </p>
    </Card>
  )
}

function PersonPanel({ person, reading, token, onBack, onReading, onlyMine }: {
  person: BoardRow
  reading: Reading | null
  token: string | null
  onBack: () => void
  onReading: (r: Reading) => void
  onlyMine?: boolean
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [busy, setBusy] = useState<'' | 'read' | 'cortex'>('')
  // THE TWO ANSWERS ARE HELD — each stays on screen until it is asked for again, never vanishing on its own.
  const [cortex, setCortex] = useState('')
  const [cortexAt, setCortexAt] = useState('')
  const [cortexErr, setCortexErr] = useState('')
  const session = useRef(`DLG-behavior-${person.subject_key}`.slice(0, 64))

  useEffect(() => {
    let alive = true
    setCortex(''); setCortexAt(''); setCortexErr('')
    void gasAction<Profile>('behaviorProfile', { subject_key: person.subject_key }, { timeoutMs: 60000 })
      .then((p) => {
        if (!alive) return
        setProfile(p)
        const kept = p?.reading?.cortex_note ?? ''
        if (kept) { setCortex(kept); setCortexAt(p?.reading?.cortex_at ?? '') }
      })
      .catch(() => { /* the board's own arithmetic is already on screen */ })
    return () => { alive = false }
  }, [person.subject_key])

  const compose = async (refresh: boolean) => {
    setBusy('read')
    try {
      const r = await gasAction<Reading & { state?: string; message?: string; note?: string }>(
        'behaviorEvaluate',
        {
          subject_key: person.subject_key, subject_kind: person.subject_kind,
          subject_name: person.subject_name, role: person.role, title: person.title,
          window_days: String(person.window_days), metrics: person.metrics,
          top_apps: person.top_apps, franchises: person.franchises,
          site_verdict: person.site_verdict, site_why: person.site_why,
          shift_verdict: person.shift_verdict, shift_why: person.shift_why,
          // THE WORKING LIFE GOES IN WITH THE QUESTION.
          work_verdict: person.work_verdict ?? '', work_why: person.work_why ?? '',
          rhythm_verdict: rhythmOf(person), rhythm_from: person.rhythm_from ?? '',
          rhythm_why: person.rhythm_why ?? '',
          worked: person.worked ?? null, worked_as_of: person.worked_as_of ?? '',
          reach_verdict: person.reach_verdict, refresh,
        },
        { timeoutMs: 180000 },
      )
      if (r?.reading) {
        onReading(r)
        setProfile((p) => (p ? { ...p, reading: { ...(p.reading ?? {} as never), ...r } } : p))
        toast({ type: 'success', title: r.state === 'stored' ? 'The stored reading is current' : 'Reading composed',
                body: r.note || undefined })
      } else {
        toast({ type: 'info', title: 'No reading', body: r?.message || 'The facts stand on their own.' })
      }
    } catch (err) {
      toast({ type: 'danger', title: 'The reading could not be composed',
              body: err instanceof Error ? err.message : 'Try again.' })
    } finally { setBusy('') }
  }

  // THE CORTEX, through the door that already exists — the same SSE reader the Cortex app and the Administration…
  const askCortex = async () => {
    if (!token) { setCortexErr('Sign in again.'); return }
    setBusy('cortex'); setCortexErr(''); setCortex('')
    // WHAT WE ALREADY HOLD GOES IN WITH THE QUESTION — it rides as a parameter of the cortex's analysis.
    const t = person.training
    const trained = t?.courses.length
      ? `Our own record says they completed: ${t.courses
          .map((c) => `${c.course}${c.expires ? ` (valid to ${c.expires}${c.state === 'expired' ? ', past its date' : ''})` : ''}`)
          .join('; ')}.`
      : `Our own record holds no completed course for them.`
    const question = `What do you know about ${person.subject_name}? Summarise their role, their schedule ` +
      `and anything on record about how they work. ${trained} Use that as context: say whether what you ` +
      `hold agrees with it, and name any training or qualification you know of that is missing from our ` +
      `list. Treat an expired date as a renewal to book, never as a judgement about the person. ` +
      `Facts only, four sentences at most, and say plainly if you hold nothing about them.`
    try {
      const res = await fetch('/cortex/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: question, session_id: session.current }),
      })
      if (!res.ok || !res.body) throw new Error(`The cortex did not answer (${res.status}).`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = '', text = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const frames = buf.split('\n\n')
        buf = frames.pop() ?? ''
        for (const frame of frames) {
          let event = '', data = ''
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (!data) continue
          let payload: Record<string, unknown> = {}
          try { payload = JSON.parse(data) } catch { /* a frame we cannot read is a frame we skip */ }
          if (event === 'token' || event === 'delta') {
            const piece = String(payload.delta ?? payload.text ?? payload.content ?? '')
            if (piece) { text += piece; setCortex(text) }
          } else if (event === 'complete' || event === 'response') {
            const whole = String(payload.response ?? '')
            if (whole && !text) { text = whole; setCortex(whole) }
          } else if (event === 'error') {
            throw new Error(String(payload.message ?? 'The cortex refused.'))
          }
        }
      }
      if (text.trim()) {
        // KEPT, not just shown: the answer goes onto the person's row so the next open paints it without asking…
        void gasAction<{ cortex_at?: string }>('behaviorCortexNote', {
          subject_key: person.subject_key, subject_kind: person.subject_kind,
          subject_name: person.subject_name, note: text.slice(0, 4000),
        }).then((r) => setCortexAt(r?.cortex_at ?? new Date().toISOString()))
          .catch(() => { /* shown now, simply not kept — say nothing louder */ })
      }
    } catch (err) {
      setCortexErr(err instanceof Error ? err.message : 'The cortex could not be reached.')
    } finally { setBusy('') }
  }

  const m = person.metrics
  const live = profile?.reading ?? reading
  const quiet = person.sample === 'none'
  // nothing at all to read a rhythm from — neither log nor punch.
  const blind = quiet && !person.worked

  return (
    <div className="w-full pb-16">
      {onlyMine ? (
        <PageHeader
          title="Behavior Support"
          subtitle="Your own reading — how you work here, and whether that rhythm is sustainable."
        />
      ) : (
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-3 transition-colors hover:text-text-1"
        >
          <ArrowLeft size={14} /> Everybody
        </button>
      )}

      <Card className="mb-4">
        <div className="flex flex-wrap items-start gap-4">
          <DragPerson name={person.subject_name} id={person.subject_key} type={focusTypeOf(person)}
                      subtitle={person.role}>
            <Avatar name={person.subject_name} size="lg" />
          </DragPerson>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 font-display text-[20px] font-bold leading-tight text-text-1">
              <DragPerson name={person.subject_name} id={person.subject_key} type={focusTypeOf(person)}
                          subtitle={person.role}
                          title="Drag this name onto the tracker, top left">
                {person.subject_name || 'Unnamed account'}
              </DragPerson>
            </h1>
            <p className="mt-0.5 text-[12.5px] text-text-3">
              {[person.title, person.role, person.roster_status].filter(Boolean).join(' · ')}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <VerdictChip v={rhythmOf(person)} />
              <span className="text-[11px] text-text-3">
                {person.rhythm_from ? axisText(person.rhythm_from) : 'nothing measurable'}
              </span>
              <VerdictChip v={person.reach_verdict} />
              <span className="text-[11px] text-text-3">
                measured {stampText(person.computed_at)} · the platform’s log, last {person.window_days} days
              </span>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => void compose(true)}
              disabled={busy !== '' || blind}
              title={blind ? 'There is nothing measured to read' : 'Compose a fresh reading through the platform’s own AI door'}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              {busy === 'read' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {live?.reading ? 'New reading' : 'Compose a reading'}
            </button>
            <button
              type="button"
              onClick={() => void askCortex()}
              disabled={busy !== ''}
              title="Ask the cortex what it holds about this person"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              {busy === 'cortex' ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
              Ask the cortex
            </button>
          </div>
        </div>
      </Card>

      {quiet && (
        <Card padded={false} className="mb-4 p-5">
          <p className="text-[13px] leading-[1.6] text-text-2">
            The platform’s own log recorded nothing for this account in the last {person.window_days} days.
            {person.worked
              ? ' Their rhythm below is read from the time clock instead — the hours they were actually paid for.'
              : person.shifts?.shifts
                ? ' Their roster below is the only thing on record, and a roster is a plan, not hours.'
                : ' The time clock holds nothing for them either.'}
            {' '}That is the absence of evidence, not a finding about the person.
          </p>
        </Card>
      )}

      {/* the model's own voice, kept visibly apart from the arithmetic */}
      {live?.reading && (
        <Card className="mb-4" tint="lavender">
          <div className="flex items-start gap-3">
            <Sparkles size={18} className={cn('mt-0.5 shrink-0', TINT_FG.lavender)} />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] leading-[1.65] text-text-1">{live.reading}</p>
              {!!(live as { highlights?: string[] }).highlights?.length && (
                <ul className="mt-2.5 space-y-1">
                  {(live as { highlights?: string[] }).highlights!.map((h) => (
                    <li key={h} className="flex gap-1.5 text-[12.5px] text-text-2">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-3" />{h}
                    </li>
                  ))}
                </ul>
              )}
              {!!live.tags?.length && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {live.tags.map((t, i) => (
                    <span key={t} className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                      TINT_BG[APP_TINT[i % APP_TINT.length]], TINT_FG[APP_TINT[i % APP_TINT.length]])}>{t}</span>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[10.5px] text-text-3">
                Written by a model over the counted facts on this page — never over a message, a document or a
                client's record. {live.ai_via ? `Via ${live.ai_via}. ` : ''}{live.ai_at ? stampText(live.ai_at) : ''}
                {(live as { note?: string }).note ? ` · ${(live as { note?: string }).note}` : ''}
              </p>
            </div>
          </div>
        </Card>
      )}

      {(cortex || cortexErr || busy === 'cortex') && (
        <Card className="mb-4">
          <CardHeader
            title="What the cortex holds"
            sub={cortexAt && busy !== 'cortex'
              ? `Asked ${stampText(cortexAt)}. It stays here until you ask again.`
              : "Asked live, through the platform's own cortex door."}
          />
          {cortexErr ? (
            <p className="flex items-center gap-2 text-[12.5px] text-text-2">
              <AlertTriangle size={14} className={TINT_FG.amber} /> {cortexErr}
            </p>
          ) : (
            <p className="whitespace-pre-wrap text-[13px] leading-[1.6] text-text-2">
              {cortex || 'Asking…'}
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card padded={false}>
            <div className="border-b border-border px-4 py-3">
              <p className="text-[12px] font-semibold text-text-2">The arithmetic — the platform’s own log</p>
            </div>
            <dl className="divide-y divide-border">
              <Fact label="Recorded actions" value={quiet ? '—' : m.actions.toLocaleString()} />
              <Fact label="Days worked on the platform" value={quiet ? '—' : String(m.active_days)} />
              <Fact label="Different things done" value={quiet ? '—' : String(m.distinct_actions)} />
              <Fact label="After 10pm or before 5am" value={quiet ? '—' : String(m.night_actions)}
                tint={m.night_actions ? 'amber' : undefined} />
              <Fact label="At weekends" value={quiet ? '—' : String(m.weekend_actions)}
                tint={m.weekend_actions ? 'amber' : undefined} />
              <Fact label="Longest run without a day off" value={quiet ? '—' : `${m.longest_run_days} day${m.longest_run_days === 1 ? '' : 's'}`}
                tint={m.longest_run_days >= 12 ? 'pink' : undefined} />
              <Fact label="First seen" value={dayText(m.first_seen) || '—'} />
              <Fact label="Last seen" value={stampText(m.last_seen) || '—'} />
              <Fact label="Works with forms" value={person.forms_actions ? `yes · ${person.forms_actions} action(s)` : 'not in this window'} />
              <Fact label="Client images" value={person.images_touched ? `yes · ${person.images_touched} action(s)` : 'not in this window'} />
              <Fact label="Where they may stand" value={person.reach_why || '—'} />
            </dl>
          </Card>

          <RhythmCard person={person} />

          <TrainingCard person={person} />
        </div>

        <div className="space-y-4">
          {/* THE WORKING LIFE LEADS. Somebody who works nights and barely
              touches the site was, for a month, a page of empty charts about
              their clicking — the thing that mattered was never drawn. */}
          <WorkCard person={person} />

          <Card>
            <CardHeader title="Where their work happens on the platform"
              sub="Every recorded action, grouped by the app it belongs to." />
            <AppBars apps={person.top_apps} cap={8} />
          </Card>

          {!quiet && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader title="The last fortnight" />
                <DayRail rail={m.rail ?? []} />
              </Card>
              <Card>
                <CardHeader title="The hours they work" sub="Ohio's clock; amber is 10pm to 5am." />
                <HourClock hours={m.hours ?? new Array(24).fill(0)} />
              </Card>
            </div>
          )}

          {person.shifts && (
            <Card>
              <CardHeader title="On the roster"
                sub={person.shifts.shifts
                  ? `${dayText(person.shifts.first)} — ${dayText(person.shifts.last)}. A roster names shifts, not hours, so this counts shifts, days and runs.`
                  : 'Nothing worked yet in this window.'} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label="Shifts worked" value={person.shifts.shifts} />
                <Tile label="Days on" value={person.shifts.days} />
                <Tile label="Overnights" value={person.shifts.overnights}
                  tint={person.shifts.shifts && person.shifts.overnights >= person.shifts.shifts / 2 ? 'amber' : undefined} />
                <Tile label="Longest run" value={`${person.shifts.longest_run_days}d`}
                  tint={person.shifts.longest_run_days >= 7 ? 'pink' : undefined} />
              </div>
              {/* THE FUTURE IS A PLAN, AND IS NEVER JUDGED. The roster carries
                  six weeks ahead; counting those as worked read a person
                  rostered through October as having already done it. */}
              {!!person.shifts.planned && (
                <p className="mt-3 text-[12px] leading-[1.5] text-text-3">
                  <span className="font-stat text-text-2">{person.shifts.planned}</span> further shift(s) are
                  rostered AHEAD{person.shifts.planned_overnights
                    ? `, ${person.shifts.planned_overnights} of them overnight` : ''} — a plan, not a rhythm
                  anybody has lived, and no part of the verdict above.
                </p>
              )}
              {!!person.shifts.hours_unknown && (
                <p className="mt-1.5 text-[12px] leading-[1.5] text-text-3">
                  {person.shifts.hours_unknown} of those cells carry no time at all: worked, hours unknown —
                  never counted as zero. The time clock above is where hours are answered.
                </p>
              )}
              {!!person.shifts.off_requested && (
                <p className="mt-1.5 text-[12px] leading-[1.5] text-text-3">
                  {person.shifts.off_requested} day(s) marked as requested off, kept out of the count.
                </p>
              )}
              {person.shifts.houses.length > 0 && (
                <p className="mt-3 text-[12px] text-text-3">
                  Houses: {person.shifts.houses.join(' · ')}
                </p>
              )}
            </Card>
          )}

          <AbsenceCard person={person} />

          {profile && profile.signals.length > 0 && (
            <Card padded={false}>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="text-[12px] font-semibold text-text-2">Everything filed about this person</p>
                <span className="font-stat text-[11.5px] text-text-3">{profile.signals.length}</span>
              </div>
              <div className="scroll-thin max-h-[280px] overflow-y-auto">
                <ul className="divide-y divide-border">
                  {profile.signals.map((s, i) => (
                    <li key={`${s.signal}-${i}`} className="px-4 py-2">
                      <div className="flex items-baseline gap-3">
                        <span className="w-[150px] shrink-0 truncate text-[12px] text-text-2">{s.signal}</span>
                        <span className="font-stat text-[12.5px] text-text-1">{s.value}</span>
                        <span className="text-[11px] text-text-3">{s.unit}</span>
                        <span className="ml-auto truncate text-[11px] text-text-3">{s.source}</span>
                      </div>
                      {/* THE DETAIL IS WHERE THE DATE LIVES. Every `work.*` and
                          `absence.*` signal carries the day its evidence was
                          measured, and dropping that line printed a frozen
                          number as though it were current. */}
                      {s.detail && (
                        <p className="mt-0.5 text-[11px] leading-[1.45] text-text-3">{s.detail}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="border-t border-border px-4 py-2 text-[10.5px] text-text-3">
                This is the generic behaviour house — anything the platform, the cortex or a person files about
                somebody lands here in the same shape.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Fact({ label, value, tint }: { label: string; value: string; tint?: ExtendedTintName }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <dt className="text-[12px] text-text-3">{label}</dt>
      <dd className={cn('shrink-0 text-right font-stat text-[12.5px]', tint ? TINT_FG[tint] : 'text-text-1')}>{value}</dd>
    </div>
  )
}

function Tile({ label, value, tint }: { label: string; value: string | number; tint?: ExtendedTintName }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface-2 px-3 py-2.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">{label}</p>
      <p className={cn('mt-0.5 font-stat text-[22px]', tint ? TINT_FG[tint] : 'text-text-1')}>{value}</p>
    </div>
  )
}
