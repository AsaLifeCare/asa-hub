// ATTENDANCE — the punch record and the call-off book, side by side, one line per person.
// PsiAnywhere combined with the call-off book is a page in its own right, and nothing else offered it: the punches…
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ChevronDown, ChevronRight, Clock, HelpCircle, PhoneOff,
  RefreshCw, Search, Snowflake, UserCheck, UserX,
} from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { Badge } from '@/components/shared/Badge'
import { TINT_BG, TINT_FG, TINT_VAR, heroBand } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { readSlice } from '@/lib/snapshotClient'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'

// ------------------------------------------------------------------ the shape comm_attendance.py emits — 48…

/** Which books knew this person. From the EXACT key; no match edits it. */
type Sources = 'both' | 'punch_only' | 'call_off_only'

/** The word that exists so a screen cannot draw a zero for a missing half. */
type Reading = 'counted' | 'none_recorded'

type RateState = 'measured' | 'unknown_no_punch_record' | 'unknown_no_call_offs'

// One half a stored copy that stopped, the other alive — carried on every row so the staleness of each can be read…
type Freshness = {
  punch_source: string
  punch_state: string
  punch_newest_day: string
  punch_synced_at: string
  punch_age_days: number | null
  call_off_source: string
  call_off_state: string
  call_off_newest_day: string
  call_off_mirrored_at: string
  call_off_age_days: number | null
  read_at: string
}

type AttendanceRow = {
  id: string
  person_key: string
  name: string
  /** every other spelling seen under this key, kept rather than discarded */
  name_variants: string
  sources: Sources

  /* the stored punch copy — every count null, never 0, when none_recorded */
  punch_reading: Reading
  punch_people_id: string
  /** the OTHER spelling filed under the same PsiAnywhere id. Named, never merged. */
  punch_people_id_shared_with: string
  punch_rows: number | null
  punch_rows_cut_half: number | null
  punch_rows_ending_at_cut: number | null
  punch_rows_starting_at_cut: number | null
  punch_rows_cut_at_both_ends: number | null
  /** PsiAnywhere's own check_hours, summed, as text to two decimals */
  punch_hours: string
  punch_first_day: string
  punch_last_day: string
  punch_rows_undated: number | null
  // nobody clocked out.
  punch_open: number | null

  /* the living half — null when the book holds nothing for this person */
  call_off_reading: Reading
  call_off_rows_all: number | null
  call_off_call_off_all: number | null
  call_off_sent_home_all: number | null
  call_off_no_show_all: number | null
  call_off_late_show_all: number | null
  call_off_untyped_all: number | null
  call_off_last_day: string
  call_off_rows_undated: number | null

  /* the rate, only where both sides exist */
  rate_state: RateState
  rate_window_from: string
  rate_window_to: string
  rate_denominator_hours: string
  rate_denominator_rows: number | null
  rate_denominator_says: string
  rate_numerator_says: string
  call_offs_in_window: number | null
  sent_home_in_window: number | null
  no_shows_in_window: number | null
  late_shows_in_window: number | null
  call_off_per_100h: number | null
  sent_home_per_100h: number | null
  no_show_per_100h: number | null
  late_show_per_100h: number | null

  /* the identity evidence, for names only one book had */
  platform_key: string
  platform_name: string
  platform_matched_by: string
  /** null, not false, when the matcher gave no answer */
  platform_also_punched: boolean | null
  identity_note: string

  freshness: Freshness
}

/** The resource. One file, role-gated server-side by the app's own audience. */
const RESOURCE = 'commAttendance'
const KEPT = 'smartcomms.attendance.people'

// ------------------------------------------------------------------ the three piles, and what each one MEANS…

type GroupSpec = { id: Sources; label: string; tint: TintName; lede: string }

const GROUPS: GroupSpec[] = [
  {
    id: 'both', label: 'In both books', tint: 'mint',
    lede: 'The punch record and the living call-off book name this person under the same flattened key — the strongest evidence of identity there is here, and no guess is involved. This is the only group where a rate can honestly exist, because it is the only one with a denominator.',
  },
  {
    id: 'punch_only', label: 'The punch record only', tint: 'blue',
    lede: 'PsiAnywhere recorded their hours and the call-off book has never held a row for them. Read that as NONE RECORDED. The book is a form people fill in themselves; "nothing was written down" and "this person was never absent" are different sentences, and only the first one is evidence.',
  },
  {
    id: 'call_off_only', label: 'The call-off book only', tint: 'lavender',
    lede: 'The living book knows them and PsiAnywhere never did. That is not proof they did not work: PsiAnywhere was habitually not filled in, so a person with no punch row may have worked every day of the window. There is no denominator for anybody here, and this page invents none rather than dividing by something it made up.',
  },
]

const GROUP: Record<Sources, GroupSpec> = {
  both: GROUPS[0], punch_only: GROUPS[1], call_off_only: GROUPS[2],
}

// ------------------------------------------------------------------ THE FOUR TYPES ARE FOUR FACTS — and never one…

type TypeSpec = {
  id: string
  label: string
  tint: TintName
  /** the whole-book count on a row */
  all: 'call_off_call_off_all' | 'call_off_sent_home_all' | 'call_off_no_show_all' | 'call_off_late_show_all'
  /** the count inside that person's own punched span */
  win: 'call_offs_in_window' | 'sent_home_in_window' | 'no_shows_in_window' | 'late_shows_in_window'
  per100: 'call_off_per_100h' | 'sent_home_per_100h' | 'no_show_per_100h' | 'late_show_per_100h'
  means: string
  /** TRUE for the one type that is a person who turned up and did the work */
  worked?: boolean
}

const TYPES: TypeSpec[] = [
  {
    id: 'call_off', label: 'Call Off', tint: 'pink',
    all: 'call_off_call_off_all', win: 'call_offs_in_window', per100: 'call_off_per_100h',
    means: 'They decided not to go. The day holds — somebody sick at 6am is not a free line for the 9am message about a missing card.',
  },
  {
    id: 'sent_home', label: 'Sent Home', tint: 'peach',
    all: 'call_off_sent_home_all', win: 'sent_home_in_window', per100: 'sent_home_per_100h',
    means: 'They came, they started, they were sent home. The day holds, and nothing about the moment before their shift changes.',
  },
  {
    id: 'no_show', label: 'No Show No Call', tint: 'amber',
    all: 'call_off_no_show_all', win: 'no_shows_in_window', per100: 'no_show_per_100h',
    means: 'The house is uncovered and the platform is trying to FIND this person. ("No Show / No Call" is the same fact typed a second way; the builder normalises the two spellings into one.)',
  },
  {
    id: 'late_show', label: 'Late Show', tint: 'blue',
    all: 'call_off_late_show_all', win: 'late_shows_in_window', per100: 'late_show_per_100h',
    means: 'NOTHING. THEY WORKED. It is counted here to be read, never to be added to the three above — summing it would punish somebody who turned up.',
    worked: true,
  },
]

// ------------------------------------------------------------------ what the estate's matcher said about a name…

// EVIDENCE, NOT A MERGE.
const MATCHED_BY: Record<string, { label: string; tint: TintName }> = {
  alias: { label: 'known under another spelling (curated alias)', tint: 'mint' },
  name_trgm: { label: 'read as somebody known, by the trigram lane', tint: 'mint' },
  phone: { label: 'matched on a phone the estate holds', tint: 'mint' },
  refused_one_word: { label: 'refused — one word is not an identity', tint: 'amber' },
  refused_not_a_person: { label: 'refused — not a person’s name', tint: 'amber' },
  refused_client: { label: 'refused — the estate types this name as a CLIENT', tint: 'amber' },
  refused_no_name: { label: 'refused — the book carried no name', tint: 'amber' },
  refused_estate_line: { label: 'refused — only one of the estate’s own lines', tint: 'amber' },
  unresolved: { label: 'genuinely unknown to the platform', tint: 'lavender' },
  // THE MATCHER WAS NOT CONSULTED, which is NOT the same fact as "unknown to the platform" — one is a question…
  not_asked: { label: 'the matcher gave no answer at all', tint: 'lavender' },
}

/** The key a row's matcher answer is counted under. Empty is `not_asked`. */
const matchedKey = (r: AttendanceRow) => r.platform_matched_by || 'not_asked'

// ------------------------------------------------------------------ MEASURED AGAINST THE SOURCE TABLES, NOT…

// Four facts this page states and cannot compute, because they are about rows the slice does not carry — who TYPED…
const MEASURED = {
  /** of the tracker's rows, the ones a machine wrote. The rest are people. */
  trackerMachineWritten: 3,
  // the older per-employee call-off book: typed rows, how stale, how many of them carry an employee id at all
  olderBookRows: 559,
  olderBookAgeDays: 158,
  olderBookWithEmployeeId: 227,
  // the hotline queue: rows of category "Schedule - Call Off", and the transcribed calls sitting behind a lane that…
  hotlineRows: 19,
  hotlineUnprocessed: 29,
}

// ------------------------------------------------------------------ reading the builder's own spellings…

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

// A DAY IS A DAY, NOT AN INSTANT.
function dayLabel(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  const m = DAY.exec(iso || '')
  if (!m) return ''
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC', ...opts })
}

/** An ISO instant as a short local stamp. Provenance only, never evidence. */
function stampText(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// The builder sends hours as TEXT to two decimals — a float would print 8.08000000000000007105 for a number…
function hoursNum(raw: string): number | null {
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

const fmtHours = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n >= 100 ? 0 : 1 })
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)
const ageText = (d: number | null) =>
  d === null ? 'age unknown' : d === 0 ? 'today' : `${d} ${plural(d, 'day')} ago`

// ------------------------------------------------------------------ the arithmetic — counted from the rows, never…

type Board = {
  people: number
  bySource: Record<Sources, number>
  /* the stored punch copy, in ROWS and HOURS — the only two units it earns */
  punchPeople: number
  punchRows: number
  punchCutHalf: number
  punchCutEnd: number
  punchCutStart: number
  punchCutBoth: number
  punchOpen: number
  punchUndated: number
  punchHours: number
  /* the living half */
  offPeople: number
  offRows: number
  offUndated: number
  byType: Record<string, number>
  /* the rate, and who has one */
  rated: number
  inWindow: number
  /* the matcher's answers about the names only the book had */
  lonelyMatched: { how: string; n: number }[]
  lonelyAlsoPunched: number
  /* one PsiAnywhere id, two spellings */
  sharedIds: { name: string; other: string; id: string }[]
  freshness: Freshness | null
}

function sum(rows: AttendanceRow[], pick: (r: AttendanceRow) => number | null): number {
  let n = 0
  for (const r of rows) n += pick(r) ?? 0
  return n
}

function build(rows: AttendanceRow[]): Board {
  const bySource: Record<Sources, number> = { both: 0, punch_only: 0, call_off_only: 0 }
  for (const r of rows) bySource[r.sources] += 1

  const byType: Record<string, number> = {}
  for (const t of TYPES) byType[t.id] = sum(rows, (r) => r[t.all])

  const lonely = rows.filter((r) => r.sources === 'call_off_only')
  const how = new Map<string, number>()
  for (const r of lonely) {
    const k = matchedKey(r)
    how.set(k, (how.get(k) ?? 0) + 1)
  }

  return {
    people: rows.length,
    bySource,
    punchPeople: rows.filter((r) => r.punch_reading === 'counted').length,
    punchRows: sum(rows, (r) => r.punch_rows),
    punchCutHalf: sum(rows, (r) => r.punch_rows_cut_half),
    punchCutEnd: sum(rows, (r) => r.punch_rows_ending_at_cut),
    punchCutStart: sum(rows, (r) => r.punch_rows_starting_at_cut),
    punchCutBoth: sum(rows, (r) => r.punch_rows_cut_at_both_ends),
    punchOpen: sum(rows, (r) => r.punch_open),
    punchUndated: sum(rows, (r) => r.punch_rows_undated),
    punchHours: rows.reduce((a, r) => a + (hoursNum(r.punch_hours) ?? 0), 0),
    offPeople: rows.filter((r) => r.call_off_reading === 'counted').length,
    offRows: sum(rows, (r) => r.call_off_rows_all),
    offUndated: sum(rows, (r) => r.call_off_rows_undated),
    byType,
    rated: rows.filter((r) => r.rate_state === 'measured').length,
    inWindow: rows.reduce((a, r) => a
      + (r.call_offs_in_window ?? 0) + (r.sent_home_in_window ?? 0)
      + (r.no_shows_in_window ?? 0) + (r.late_shows_in_window ?? 0), 0),
    lonelyMatched: [...how.entries()]
      .map(([h, n]) => ({ how: h, n }))
      .sort((a, b) => b.n - a.n || a.how.localeCompare(b.how)),
    lonelyAlsoPunched: lonely.filter((r) => r.platform_also_punched === true).length,
    sharedIds: rows
      .filter((r) => r.punch_people_id_shared_with)
      .map((r) => ({ name: r.name, other: r.punch_people_id_shared_with, id: r.punch_people_id })),
    freshness: rows[0]?.freshness ?? null,
  }
}

// ------------------------------------------------------------------ the small pieces…

// UNKNOWN MUST LOOK LIKE UNKNOWN — a dashed outline and a sentence saying what is missing, never a zero and never a…
function NotOnFile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('rounded-[10px] border border-dashed border-border px-2.5 py-1.5 text-[11.5px] leading-[1.45] text-text-3', className)}>
      {children}
    </p>
  )
}

function Chip({ label, value, tint = 'blue' }: { label: string; value: string | number; tint?: TintName }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
      TINT_BG[tint], TINT_FG[tint])}>
      <span className="font-stat">{value}</span>
      <span className="font-normal opacity-80">{label}</span>
    </span>
  )
}

// A number with the UNIT it was counted in printed beside it, always.
function Count({ n, unit, tint, sub }:
  { n: number | null; unit: string; tint?: TintName; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className={cn('font-stat text-[20px] leading-none', tint ? TINT_FG[tint] : 'text-text-1')}>
        {n === null ? '—' : n.toLocaleString()}
      </p>
      <p className="mt-1 text-[11px] leading-[1.35] text-text-3">
        {unit}{sub ? <> · {sub}</> : null}
      </p>
    </div>
  )
}

/** One source, one line, with its own staleness on it. */
function SourceLine({ icon, title, state, stateTint, body, stamps }:
  { icon: ReactNode; title: string; state: string; stateTint: TintName; body: string; stamps?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3 last:border-0">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-text-1">{title}</span>
          <Badge label={state} tint={stateTint} />
        </div>
        <p className="mt-1 text-[12.5px] leading-[1.55] text-text-2">{body}</p>
        {stamps && <p className="mt-1 text-[11.5px] leading-[1.5] text-text-3">{stamps}</p>}
      </div>
    </li>
  )
}

// ------------------------------------------------------------------ the page…

type SortId = 'name' | 'hours' | 'rows' | 'recorded' | 'rate'

const SORTS: { id: SortId; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'hours', label: 'Hours on the punch record' },
  { id: 'rows', label: 'Punch rows' },
  { id: 'recorded', label: 'Call-off rows recorded' },
  { id: 'rate', label: 'Call-offs per 100h' },
]

export default function SmartCommsAttendancePage() {
  /** null is NOT an empty roster — it is "we do not know yet". */
  const [rows, setRows] = useState<AttendanceRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [doorMissing, setDoorMissing] = useState(false)
  const [stale, setStale] = useState(false)
  const [group, setGroup] = useState<Sources | 'all'>('all')
  const [sort, setSort] = useState<SortId>('name')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  const load = useCallback(async (loud: boolean) => {
    setLoading(true)
    // a read still in flight at a sign-out or a crossing keeps nothing (lib/kept)
    const generation = keptGeneration()

    // ONE PATH, ON PURPOSE.
    let got: AttendanceRow[] | null = null
    try { got = await readSlice<AttendanceRow>(RESOURCE) } catch { got = null }

    if (got === null) {
      const kept = readKept<AttendanceRow[]>(KEPT)
      setRows(kept ?? null)
      setStale(!!kept)
      setDoorMissing(!kept)
      if (loud) {
        toast({
          type: 'warning',
          title: 'Nothing answered for attendance',
          body: `The ${RESOURCE} slice did not reply. The page is showing what it knows, not zeros.`,
        })
      }
    } else {
      setRows(got)
      setStale(false)
      setDoorMissing(false)
      keepIfCurrent(KEPT, got, generation)
      if (loud) {
        toast({ type: 'success', title: 'Read again', body: `${got.length} people across the two books.` })
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load(false) }, [load])

  const board = useMemo(() => (rows?.length ? build(rows) : null), [rows])

  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => {
    if (!rows) return []
    const hit = needle
      ? rows.filter((r) => `${r.name} ${r.name_variants} ${r.person_key} ${r.platform_name}`.toLowerCase().includes(needle))
      : rows
    const by = (r: AttendanceRow): number => {
      switch (sort) {
        case 'hours': return hoursNum(r.punch_hours) ?? -1
        case 'rows': return r.punch_rows ?? -1
        case 'recorded': return r.call_off_rows_all ?? -1
        case 'rate': return r.rate_state === 'measured' ? (r.call_off_per_100h ?? 0) : -1
        default: return 0
      }
    }
    return sort === 'name'
      ? [...hit].sort((a, b) => a.name.localeCompare(b.name))
      : [...hit].sort((a, b) => by(b) - by(a) || a.name.localeCompare(b.name))
  }, [rows, needle, sort])

  const groupsShown = group === 'all' ? GROUPS : GROUPS.filter((g) => g.id === group)
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const fresh = board?.freshness ?? null

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Attendance"
          subtitle="PsiAnywhere's punch record and the living call-off book, read together — one line per person, and the fact that the two do not agree about who exists."
          actions={
            <>
              <PageSwitch />
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </>
          }
        />
      </motion.div>

      {/* ── 1 · THE DISAGREEMENT ────────────────────────────────────
          First and largest, because it is the finding. Two books that were
          both kept about the same workforce name almost entirely different
          people, and the larger half of the answer is people the punch
          record never heard of. */}
      {!board ? (
        loading ? <Skeleton className="mb-5 h-[260px] w-full rounded-[16px]" /> : null
      ) : (
        <div className="mb-5 rounded-[16px] bg-detail-hero p-6 shadow-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
            The two books do not agree about who exists
          </p>
          <div className="mt-3 grid gap-5 sm:grid-cols-3">
            {GROUPS.map((g) => (
              <div key={g.id} className="min-w-0">
                <p className="font-stat text-[52px] leading-none" style={{ color: heroBand(g.tint) }}>
                  {board.bySource[g.id].toLocaleString()}
                </p>
                <p className="mt-1 text-[12.5px] font-semibold text-white/85">{g.label}</p>
                <p className="mt-1 text-[11.5px] leading-[1.5] text-white/55">{g.lede}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            {GROUPS.map((g) => (
              board.bySource[g.id] ? (
                <span key={g.id} title={`${board.bySource[g.id]} · ${g.label}`}
                  style={{ width: `${(board.bySource[g.id] / Math.max(1, board.people)) * 100}%`, background: heroBand(g.tint) }} />
              ) : null
            ))}
          </div>

          <p className="mt-3 text-[12.5px] leading-[1.6] text-white/80">
            <span className="font-stat text-white">{board.people.toLocaleString()}</span> people in total, and only{' '}
            <span className="font-stat text-white">{board.bySource.both.toLocaleString()}</span> of them are in both.
            The books are matched on the platform&apos;s own flattened name key and on nothing else — no fuzzy match
            ever moves anybody between these three piles, because a wrong match attaches one person&apos;s absences to
            another person&apos;s hours and nobody notices.
          </p>
        </div>
      )}

      {/* the state of the read, said before anybody mistrusts the dashes */}
      {doorMissing && (
        <Card className="mb-4 flex items-start gap-2.5">
          <AlertTriangle size={15} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            Nothing answered for <code className="font-stat">{RESOURCE}</code> on this deployment. The platform builds
            this reading from Postgres, and until the file lands every figure here reads “—”. None of them is a
            measured zero, and none of them is a person with nothing recorded.
          </p>
        </Card>
      )}

      {stale && (
        <Card className="mb-4 flex items-start gap-2.5">
          <Clock size={15} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            Nothing answered just now — this is the last reading this tab held. The call-off book is alive, so a row
            may have been filed since; the stored punch copy this reading uses has not moved since 2026-08-14.
          </p>
        </Card>
      )}

      {loading && !board && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {!loading && !board && !doorMissing && (
        <Card padded={false}>
          <EmptyState
            title="The reading holds nobody"
            body="Neither book answered with a person. An empty file and a refused one look the same from here, which is why this says nothing rather than zero."
          />
        </Card>
      )}

      {board && (
        <div className="space-y-4">
          {/* ── 2 · WHAT EACH SOURCE IS, with its staleness on it ─── */}
          <Card padded={false} className="overflow-hidden">
            <div className="p-5 pb-3">
              <CardHeader
                title="What each of these books is"
                sub="One half is a stored copy that stopped and the other is alive. An answer that does not say which is which is read as current." />
            </div>
            <ul className="border-t border-border">
              <SourceLine
                icon={<Snowflake size={16} className={TINT_FG.blue} />}
                title={fresh?.punch_source || 'The punch record'}
                state="stopped 2026-08-14" stateTint="blue"
                body={`The stored copy of the clock-in and clock-out record of PsiAnywhere — the agency's official time clock. The copy stopped on 2026-08-14 because the scraper that fills it dials port 8443, which stopped connecting; PsiAnywhere itself did not stop, and what it records today is on the Punch board. So a gap after that date is the port, not a quiet week — and this reading holds ${board.punchRows.toLocaleString()} of the copy's rows for ${board.punchPeople} ${plural(board.punchPeople, 'person', 'people')}, ${fmtHours(board.punchHours)} hours by its own reckoning.`}
                stamps={fresh ? (
                  <>
                    newest service day {dayLabel(fresh.punch_newest_day) || '—'} · {ageText(fresh.punch_age_days)}
                    {fresh.punch_synced_at ? <> · last synced from PsiAnywhere {stampText(fresh.punch_synced_at)}</> : null}
                  </>
                ) : undefined}
              />
              <SourceLine
                icon={<PhoneOff size={16} className={TINT_FG.mint} />}
                title={fresh?.call_off_source || 'Call Off Tracker Master'}
                state="live" stateTint="mint"
                body={`Alive, typed, and filled in BY PEOPLE through a form — of its ${board.offRows.toLocaleString()} rows only ${MEASURED.trackerMachineWritten} were ever written by a machine. It holds who was absent and what type of absence it was; who REPORTED it, the prose about how late somebody was and the supervisors' notes about people's health never leave the database.`}
                stamps={fresh ? (
                  <>
                    newest dated row {dayLabel(fresh.call_off_newest_day) || '—'} · {ageText(fresh.call_off_age_days)}
                    {fresh.call_off_mirrored_at ? <> · mirrored {stampText(fresh.call_off_mirrored_at)}</> : null}
                    {board.offUndated ? <> · {board.offUndated} {plural(board.offUndated, 'row')} carried a date nothing could read and {plural(board.offUndated, 'is', 'are')} counted, never pivoted</> : null}
                  </>
                ) : undefined}
              />
              {/* THE TWO OLDER BOOKS. They are not in this reading — they are
                  here so nobody goes looking for a third number and finds one
                  of them without knowing what state it is in. */}
              <SourceLine
                icon={<HelpCircle size={16} className={TINT_FG.amber} />}
                title="The older per-employee call-off book"
                state="months behind" stateTint="amber"
                body={`${MEASURED.olderBookRows} typed rows from the old platform's own entity tables, and the newest of them was ${MEASURED.olderBookAgeDays} days old when this was measured. Only ${MEASURED.olderBookWithEmployeeId} of the rows carry an employee id at all, so most of it cannot be attached to a person without guessing. It is NOT counted anywhere on this page.`}
              />
              <SourceLine
                icon={<AlertTriangle size={16} className={TINT_FG.pink} />}
                title="The hotline queue"
                state="the lane stopped" stateTint="pink"
                body={`${MEASURED.hotlineRows} rows of category “Schedule - Call Off” from the phone line. The lane that fills it ran successfully ONCE and has returned zero or thrown ever since, leaving ${MEASURED.hotlineUnprocessed} transcribed calls unprocessed. That is a finding about a lane, not a number to add to the book above — and nothing here adds it.`}
              />
            </ul>
            <p className="border-t border-border px-4 py-3 text-[11.5px] leading-[1.5] text-text-3">
              The figures on the first two lines are counted from the reading itself. The figures on the last two were
              measured directly against the source tables — the slice does not carry those books, and a number a
              screen cannot recompute must at least say where it came from.
            </p>
          </Card>

          {/* ── 3 · THE FOUR TYPES ─────────────────────────────────── */}
          <Card>
            <CardHeader
              title="Four types, four facts — and never one number"
              sub="Counted over every row in the living book. Nothing on this page adds them together, here or on a person's line." />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {TYPES.map((t) => {
                const n = board.byType[t.id] ?? 0
                const share = board.offRows ? Math.round((n / board.offRows) * 100) : 0
                return (
                  <div key={t.id}
                    className={cn('rounded-[14px] border px-3.5 py-3',
                      t.worked ? 'border-dashed border-border bg-surface-2' : 'border-border bg-surface-2')}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12.5px] font-semibold text-text-1">{t.label}</span>
                      {t.worked && <Badge label="they worked" tint="blue" />}
                    </div>
                    <p className={cn('mt-1 font-stat text-[30px] leading-none', TINT_FG[t.tint])}>
                      {n.toLocaleString()}
                    </p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(2, share)}%` }}
                        transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
                        className="h-full rounded-full"
                        style={{ background: TINT_VAR[t.tint] }}
                      />
                    </div>
                    <p className="mt-1.5 text-[11px] text-text-3">
                      {share}% of the book&apos;s {board.offRows.toLocaleString()} rows
                    </p>
                    <p className="mt-2 text-[11.5px] leading-[1.45] text-text-3">{t.means}</p>
                  </div>
                )
              })}
            </div>
            {board.byType.late_show > 0 && (
              <NotOnFile className="mt-3">
                {Math.round((board.byType.late_show / Math.max(1, board.offRows)) * 100)}% of this book is a LATE SHOW —
                {' '}{board.byType.late_show.toLocaleString()} rows about people who turned up and did the work. Any
                screen anywhere that reports one “absences” figure for this book is reporting that third of it as an
                absence.
              </NotOnFile>
            )}
          </Card>

          {/* ── 5 · THE MIDNIGHT CUT, WHERE THE COUNTS ARE ─────────── */}
          <Card>
            <CardHeader
              title="Rows, not shifts — PsiAnywhere's midnight cut"
              sub="Every punch figure on this page is a count of ROWS and says so. Here is why it cannot be a count of shifts." />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-[14px] border border-border bg-surface-2 px-3.5 py-3">
                <Count n={board.punchRows} unit="filed rows" sub={`${board.punchPeople} people`} />
              </div>
              <div className="rounded-[14px] border border-dashed border-border px-3.5 py-3">
                <Count n={board.punchCutHalf} unit="rows that are one HALF of a night" tint="amber"
                  sub={`${board.punchCutEnd.toLocaleString()} end at the cut · ${board.punchCutStart.toLocaleString()} start at it`} />
              </div>
              <div className="rounded-[14px] border border-border bg-surface-2 px-3.5 py-3">
                <Count n={board.punchHours ? Number(board.punchHours.toFixed(2)) : null} unit="hours, PsiAnywhere's own"
                  sub="the one figure the cut does not distort" />
              </div>
              <div className="rounded-[14px] border border-dashed border-border px-3.5 py-3">
                <Count n={board.punchOpen} unit="punches nobody closed" tint="pink"
                  sub="the end is unknown, and they carry no hours" />
              </div>
            </div>
            <p className="mt-3 text-[12.5px] leading-[1.6] text-text-2">
              PsiAnywhere closed every overnight at <span className="font-stat">11:59:59 PM</span> and opened a fresh row
              at <span className="font-stat">12:00:00 AM</span>, so a ten-to-eight night is TWO rows on TWO dates with
              a one-second turnaround. A page that counts rows and calls them shifts reads this workforce as having
              about a quarter more shifts than it worked.
            </p>
            <p className="mt-2 text-[12.5px] leading-[1.6] text-text-2">
              {board.punchCutEnd.toLocaleString()} rows end at the cut and {board.punchCutStart.toLocaleString()}{' '}
              start at it. THE TWO ARE NOT EQUAL, so their difference is not a shift count and this page never
              subtracts one from the other. {board.punchCutBoth > 0 && (
                <>Exactly {board.punchCutBoth} {plural(board.punchCutBoth, 'punch', 'punches')} opens at the cut and
                closes at it, which is why the two markers added together would double-count{' '}
                {plural(board.punchCutBoth, 'it', 'them')} — the halves column counts each row once.{' '}</>
              )}
              Hours are the exception and are safe to sum: the two halves of a night carry the two halves of its
              hours. The Punches page stitches the rows back into shifts; this one counts what it can defend and
              labels it.
            </p>
            {board.punchUndated > 0 && (
              <NotOnFile className="mt-3">
                {board.punchUndated} {plural(board.punchUndated, 'row')} carried a service date nothing could read.
                They are counted as rows and take no part in anybody&apos;s window.
              </NotOnFile>
            )}
            {board.sharedIds.length > 0 && (
              <NotOnFile className="mt-2">
                {board.sharedIds.map((s) => (
                  <span key={s.id + s.name} className="block">
                    PsiAnywhere filed people_id <span className="font-stat">{s.id}</span> under two spellings —{' '}
                    <span className="text-text-2">{s.name}</span> and <span className="text-text-2">{s.other}</span>.
                    They stay two lines and each names the other: a silent merge would attach one person&apos;s
                    absences to the other&apos;s hours.
                  </span>
                ))}
              </NotOnFile>
            )}
          </Card>

          {/* ── 4 · THE PEOPLE ─────────────────────────────────────── */}
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setGroup('all')}
                className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold transition-colors',
                  group === 'all' ? 'border-primary/50 bg-surface-2 text-text-1' : 'border-border bg-surface text-text-3 hover:text-text-2')}
              >
                Everybody <span className="font-stat opacity-70">{board.people}</span>
              </button>
              {GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroup(g.id)}
                  className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold transition-colors',
                    group === g.id ? cn('border-current bg-surface-2', TINT_FG[g.tint]) : 'border-border bg-surface text-text-3 hover:text-text-2')}
                >
                  {g.label} <span className="font-stat opacity-70">{board.bySource[g.id]}</span>
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5">
                <Search size={13} className="text-text-3" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Find a person…"
                  className="h-8 w-[150px] rounded-sm border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary/50 sm:w-[220px]"
                />
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-3">Order by</span>
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSort(s.id)}
                  className={cn('h-7 rounded-md border px-2.5 text-[12px] font-semibold transition-colors',
                    sort === s.id ? 'border-primary/50 bg-surface-2 text-text-1' : 'border-border bg-surface text-text-3 hover:text-text-2')}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* A RAW COUNT IS NOT A LEAGUE TABLE, and the order the reader
                just chose is exactly where that goes wrong. */}
            {sort === 'recorded' && (
              <NotOnFile className="mb-3">
                This order is a RAW COUNT of rows in the book. It is not a ranking: somebody who worked twice as much
                has twice as many chances to appear in it, and{' '}
                {board.bySource.call_off_only.toLocaleString()} of these people have no punch record at all — there is
                nothing to divide their count by, so they are listed, never ranked. The rate order below only sorts
                the {board.rated} people who have a denominator.
              </NotOnFile>
            )}
            {sort === 'rate' && (
              <NotOnFile className="mb-3">
                Only {board.rated} of {board.people} people have a rate — a rate needs both books and is measured
                inside that person&apos;s OWN punched span. Everybody else sorts to the bottom carrying the word
                unknown, which is what they are.
              </NotOnFile>
            )}

            <div className="space-y-4">
              {groupsShown.map((g) => {
                const list = shown.filter((r) => r.sources === g.id)
                const total = board.bySource[g.id]
                return (
                  <Card key={g.id} padded={false} className="overflow-hidden">
                    <div className="p-5 pb-3">
                      <CardHeader
                        title={`${g.label} — ${total.toLocaleString()} ${plural(total, 'person', 'people')}`}
                        sub={g.lede}
                        extra={g.id === 'both'
                          ? <UserCheck size={16} className={TINT_FG[g.tint]} />
                          : <UserX size={16} className={TINT_FG[g.tint]} />}
                      />
                      {g.id === 'call_off_only' && board.lonelyMatched.length > 0 && (
                        <div className="rounded-[12px] border border-dashed border-border px-3.5 py-3">
                          <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                            What the estate&apos;s own matcher says about these names
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {board.lonelyMatched.map((m) => (
                              <Chip key={m.how} value={m.n}
                                label={MATCHED_BY[m.how]?.label || m.how}
                                tint={MATCHED_BY[m.how]?.tint ?? 'lavender'} />
                            ))}
                          </div>
                          <p className="mt-2 text-[11.5px] leading-[1.5] text-text-3">
                            Asked, never acted on: no alias was created, no candidate merged, no row updated, and not
                            one of these answers moves anybody out of this group. Only{' '}
                            <span className="font-stat text-text-2">{board.lonelyAlsoPunched}</span> of them resolve to
                            somebody who actually PUNCHED — so this group is not mostly a spelling problem between the
                            two books. The punch record simply never held these people.
                          </p>
                        </div>
                      )}
                    </div>
                    {!list.length ? (
                      <p className="border-t border-border px-5 py-4 text-[12.5px] leading-[1.55] text-text-2">
                        {needle
                          ? 'Nobody in this group answers to that.'
                          : 'Nobody is in this group in the current reading.'}
                      </p>
                    ) : (
                      <>
                        <ul className="border-t border-border">
                          {list.map((r) => (
                            <PersonLine key={r.id} r={r} open={open.has(r.id)} onToggle={() => toggle(r.id)} />
                          ))}
                        </ul>
                        {needle && (
                          <p className="border-t border-border px-4 py-2.5 text-[11.5px] text-text-3">
                            Showing {list.length} of {total} in this group.
                          </p>
                        )}
                      </>
                    )}
                  </Card>
                )
              })}
            </div>
          </div>

          {/* the last word */}
          <p className="px-1 text-[12px] leading-[1.6] text-text-3">
            Nothing on this page writes, sends or arms anything: it reads one file the platform builds out of Postgres,
            and it creates no alias and merges no person. Of the living book&apos;s{' '}
            {board.offRows.toLocaleString()} rows, only {board.inWindow.toLocaleString()} fall inside the punched span
            of the person they belong to — which is the whole reason a rate is offered for{' '}
            {board.rated} people and refused for {(board.people - board.rated).toLocaleString()}.
            {fresh?.read_at ? <> The reading itself was taken {stampText(fresh.read_at)}.</> : null}
          </p>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ ONE PERSON — both halves, and every unknown…

function PersonLine({ r, open, onToggle }: { r: AttendanceRow; open: boolean; onToggle: () => void }) {
  const g = GROUP[r.sources]
  const punched = r.punch_reading === 'counted'
  const booked = r.call_off_reading === 'counted'
  const hours = hoursNum(r.punch_hours)

  return (
    <li className="border-b border-border last:border-0">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        className="flex w-full cursor-pointer flex-wrap items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
      >
        <Avatar name={r.name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <DragPerson name={r.name} id={r.person_key} type="staff" subtitle="attendance"
              className="min-w-0 text-[13.5px] font-semibold text-text-1"
              title="Drag this name onto the tracker, top left">
              <span className="truncate">{r.name}</span>
            </DragPerson>
            <Badge label={g.label} tint={g.tint} />
            {r.punch_people_id_shared_with && (
              <Badge label="one PsiAnywhere id, two spellings" tint="amber" />
            )}
          </div>

          {/* THE STORED PUNCH COPY, IN ROWS AND HOURS — the two units it earns. */}
          <p className="mt-1 text-[12.5px] leading-[1.5] text-text-2">
            {punched ? (
              <>
                <span className="font-stat text-text-1">{(r.punch_rows ?? 0).toLocaleString()}</span> punch{' '}
                {plural(r.punch_rows ?? 0, 'row')}
                {hours !== null && <> · <span className="font-stat text-text-1">{fmtHours(hours)}</span> hours</>}
                {r.punch_rows_cut_half ? <span className="text-text-3"> · {r.punch_rows_cut_half} of them one half of a night</span> : null}
                {r.punch_open ? <span className={TINT_FG.pink}> · {r.punch_open} never closed</span> : null}
                {r.punch_first_day && (
                  <span className="text-text-3"> · {dayLabel(r.punch_first_day, { year: undefined })} – {dayLabel(r.punch_last_day)}</span>
                )}
              </>
            ) : (
              <span className="text-text-3">
                No punch row. NOT “did not work” — PsiAnywhere was habitually not filled in.
              </span>
            )}
          </p>

          {/* THE LIVING HALF — four counts, never a total. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            {booked ? TYPES.map((t) => {
              const n = r[t.all] ?? 0
              return (
                <span key={t.id} className={n ? TINT_FG[t.tint] : 'text-text-3'}>
                  <span className="font-stat">{n}</span> {t.label.toLowerCase()}
                  {t.worked && n > 0 ? <span className="text-text-3"> (worked)</span> : null}
                </span>
              )
            }) : (
              <span className="text-text-3">Nothing in the call-off book — none recorded, never “never absent”.</span>
            )}
          </div>
        </div>

        {/* THE RATE, or the reason there is not one. Never a zero. */}
        <div className="ml-auto flex shrink-0 items-start gap-2 text-right">
          <div>
            {r.rate_state === 'measured' ? (
              <>
                <p className="font-stat text-[20px] leading-none text-text-1">
                  {(r.call_off_per_100h ?? 0).toFixed(2)}
                </p>
                <p className="mt-1 text-[10.5px] leading-[1.35] text-text-3">
                  call-offs per 100h<br />
                  <span className="font-stat">{r.call_offs_in_window ?? 0}</span> in{' '}
                  <span className="font-stat">{r.rate_denominator_hours}</span>h
                </p>
              </>
            ) : (
              <>
                <p className="font-stat text-[20px] leading-none text-text-3">—</p>
                <p className="mt-1 max-w-[132px] text-[10.5px] leading-[1.35] text-text-3">
                  {r.rate_state === 'unknown_no_punch_record'
                    ? 'unknown — no punch record to divide by'
                    : 'unknown — no call-off recorded'}
                </p>
              </>
            )}
          </div>
          {open ? <ChevronDown size={15} className="mt-1 text-text-3" />
            : <ChevronRight size={15} className="mt-1 text-text-3" />}
        </div>
      </div>

      {open && <PersonDetail r={r} />}
    </li>
  )
}

// THE EXPANDED LINE.
function PersonDetail({ r }: { r: AttendanceRow }) {
  const measured = r.rate_state === 'measured'
  return (
    <div className="border-t border-border bg-surface-2 px-4 py-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* the rate, spelled out */}
        <div className="min-w-0">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
            The rate, and what it was measured against
          </p>
          {measured ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TYPES.map((t) => (
                  <div key={t.id} className="rounded-[10px] border border-border bg-surface px-2.5 py-2">
                    <p className={cn('font-stat text-[16px] leading-none', TINT_FG[t.tint])}>
                      {r[t.per100] === null ? '—' : (r[t.per100] as number).toFixed(2)}
                    </p>
                    <p className="mt-1 text-[10.5px] leading-[1.3] text-text-3">
                      {t.label} / 100h<br />
                      <span className="font-stat">{r[t.win] ?? 0}</span> in the window
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11.5px] leading-[1.5] text-text-3">
                Window {dayLabel(r.rate_window_from)} – {dayLabel(r.rate_window_to)} — this person&apos;s OWN punched
                span, never the whole book. {r.rate_denominator_says}.
              </p>
              <p className="mt-1 text-[11.5px] leading-[1.5] text-text-3">
                Numerator: {r.rate_numerator_says}.
              </p>
            </>
          ) : (
            <NotOnFile className="mt-2">
              {r.rate_state === 'unknown_no_punch_record'
                ? 'No punch record, so there are no hours and no rows to divide by. A rate here would be a number this page invented — and the absence of a punch row is not evidence that this person did not work.'
                : 'Nothing recorded in the call-off book for this person, so there is nothing to put over the hours. That is “none recorded”, not “never absent”.'}
            </NotOnFile>
          )}
        </div>

        {/* the two halves, in full */}
        <div className="min-w-0 space-y-3">
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
              The stored punch copy (to 2026-08-14)
            </p>
            {r.punch_reading === 'counted' ? (
              <p className="mt-1.5 text-[12px] leading-[1.6] text-text-2">
                PsiAnywhere id <span className="font-stat">{r.punch_people_id || '—'}</span> ·{' '}
                <span className="font-stat">{(r.punch_rows ?? 0).toLocaleString()}</span> rows ·{' '}
                <span className="font-stat">{r.punch_hours}</span> hours ·{' '}
                <span className="font-stat">{r.punch_rows_cut_half ?? 0}</span> rows are one half of a night
                {' '}({r.punch_rows_ending_at_cut ?? 0} end at the cut, {r.punch_rows_starting_at_cut ?? 0} start at it
                {r.punch_rows_cut_at_both_ends ? `, ${r.punch_rows_cut_at_both_ends} at both ends` : ''})
                {r.punch_open ? <> · <span className={TINT_FG.pink}>{r.punch_open} never clocked out, carrying no hours</span></> : null}
                {r.punch_rows_undated ? <> · {r.punch_rows_undated} undated</> : null}
                {r.punch_people_id_shared_with && (
                  <> · the same PsiAnywhere id is also filed under <span className="text-text-1">{r.punch_people_id_shared_with}</span>, kept apart on purpose</>
                )}
              </p>
            ) : (
              <NotOnFile className="mt-1.5">No row in the punch record at all.</NotOnFile>
            )}
          </div>
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
              The living half
            </p>
            {r.call_off_reading === 'counted' ? (
              <p className="mt-1.5 text-[12px] leading-[1.6] text-text-2">
                <span className="font-stat">{(r.call_off_rows_all ?? 0).toLocaleString()}</span> rows in the book —{' '}
                {TYPES.map((t, i) => (
                  <span key={t.id}>
                    {i ? ' · ' : ''}<span className="font-stat">{r[t.all] ?? 0}</span> {t.label.toLowerCase()}
                  </span>
                ))}
                {r.call_off_untyped_all ? <> · {r.call_off_untyped_all} with no type written</> : null}
                {r.call_off_last_day ? <> · most recent {dayLabel(r.call_off_last_day)}</> : null}
                {r.call_off_rows_undated ? <> · {r.call_off_rows_undated} undated</> : null}
                . These four are never added together.
              </p>
            ) : (
              <NotOnFile className="mt-1.5">Nothing recorded in the call-off book.</NotOnFile>
            )}
          </div>
        </div>
      </div>

      {(r.name_variants || r.sources !== 'both' || r.platform_matched_by) && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
            Identity — evidence, never a merge
          </p>
          {r.name_variants && (
            <p className="mt-1.5 text-[11.5px] leading-[1.5] text-text-3">
              Also spelled {r.name_variants.split(' | ').join(', ')}. The punch record&apos;s spelling is the one shown:
              it is PsiAnywhere&apos;s payroll spelling, while the book&apos;s is whatever the person typed into the form
              that morning.
            </p>
          )}
          {matchedKey(r) !== 'exact_key' && (
            <p className="mt-1.5 text-[11.5px] leading-[1.5] text-text-3">
              {MATCHED_BY[matchedKey(r)]?.label || matchedKey(r)}
              {r.platform_name ? <> — the platform calls them <span className="text-text-2">{r.platform_name}</span></> : null}
              {r.identity_note ? <>. {r.identity_note}</> : null}.
              {r.platform_also_punched === true && (
                <> <span className={TINT_FG.amber}>The platform knows this person under a spelling that DID punch.</span>{' '}
                  That is a question for a person to answer, not a fact this page may act on — nothing was merged and
                  this line stays where it is.</>
              )}
              {r.platform_also_punched === null && <> Whether they punched under another spelling is unknown, not settled in the negative.</>}
            </p>
          )}
          {r.platform_matched_by === 'exact_key' && (
            <p className="mt-1.5 text-[11.5px] leading-[1.5] text-text-3">
              {r.identity_note || 'Both books name this person under the same flattened key.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
