// THE PUNCH BOARD — who clocked in on PsiAnywhere, and who did not.
// PsiAnywhere is the OFFICIAL time clock, its punches live in ASA Data, and this is the Smart Comms TABLE of every…
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, Clock, LogIn, RefreshCw, Search, TimerReset, UserCheck, UserX,
} from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { Badge } from '@/components/shared/Badge'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { readSlice } from '@/lib/snapshotClient'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'
import { accountText, downText, type DownStatus, type TyStatus } from '@/pages/features/smartcomms/psiAccount'
import PunchWarnings from '@/pages/features/smartcomms/PunchWarnings'
import { pairSpec, warningSpec, type PairsCard } from '@/pages/features/smartcomms/punchPairsLogic'

// ------------------------------------------------------------------ the shape punch_board_slices.py emits — named…

type Verdict =
  | 'punched_on_time' | 'late' | 'no_punch_yet' | 'no_punch' | 'not_entered_yet'
  | 'told_by_a_human' | 'not_known_to_clock' | 'upcoming' | 'clock_not_read'
  | 'punch_without_shift'

type ClockState = 'read' | 'held' | 'down' | 'paused' | 'refused' | 'unknown' | 'no_credential' | 'never_read' | string

type StatusRow = {
  row_kind: 'status'
  id: 'status'
  generated_at: string
  clock_state: ClockState
  clock_why: string
  /** the last collection that came back with entries, Ohio ISO, or '' */
  read_at: string
  last_attempt?: { state?: string; why?: string; at?: string }
  /** 'psi' while the clock can be read; 'calendar' when the reminders go from the roster */
  mode: 'psi' | 'calendar' | string
  next_collection: string
  follow_up: boolean
  /** collections made today for the missing alone (the day's purse) */
  follow_ups_today?: number
  days: string[]
  counts: Record<string, number>
  books: string
  books_why: string
  books_at: string
  /** 'kept' while the entry history holds every read; 'unwritten' / 'unreadable' otherwise */
  history?: 'kept' | 'unwritten' | 'unreadable' | string
  session_kept: boolean
  /** how long the lane has measured a kept session to live, in minutes */
  session_life?: { longest_taken_min?: number; refused_at_min?: number[] }
  reminders?: { readable?: boolean; due?: number; held?: number; quiet?: boolean; stopped?: number;
                answered?: Record<string, number>; answers?: Record<string, number>;
                awaiting_check?: number; notes_why?: string }
  /** the PsiAnywhere account the relay signs in with: 'adm' (the line) or 'ty' */
  account?: 'adm' | 'ty' | string
  ty?: TyStatus
  down?: DownStatus | null
  /** the pair rule's card: when the shifts were paired, whether that is stale, and every warning */
  pairs?: PairsCard
}

type BoardRow = {
  row_kind: 'shift' | 'punch'
  id: string
  person: string
  person_key: string
  house: string
  shift_code: string
  day: string
  shift_at: string
  shift_end: string
  time: string
  verdict: Verdict
  minutes: number | null
  arrived: string
  ended?: string
  open?: boolean
  entry_id: string
  early_minutes: number | null
  told_source: string
  checked_at: string
  /** whether the clock has spelled this person lately; null when it has spelled nobody yet */
  known?: boolean | null
  /** the house's own name ("JH home"), from the houses directory */
  house_name?: string
  /** what kind of day a human said (call_off, late_show, no_show, sent_home, reported_call_off) and when it was learned */
  told_kind?: string
  told_at?: string
  /** a call-off book says they called to say they would be late */
  late_call?: boolean
  /** what the shift flow knows: the reply to the ask, and when the house manager was told */
  confirm?: string
  hm_no_show_at?: string
  late_call_at?: string
  /** the shift's own pair verdict (server/punch_pairs.py), whether it is a fault, and why */
  pair?: string
  pair_fault?: boolean
  pair_why?: string
  /** the warning raised to the directors on this shift, if any */
  warning_state?: string
  warning_ref?: string
  warning_tells?: number
  warning_why?: string
}

type Row = StatusRow | BoardRow

const RESOURCE = 'commPunchBoard'
const KEPT = 'smartcomms.punchboard.rows'

// ------------------------------------------------------------------ what each verdict MEANS, and how it is drawn…

type VerdictSpec = { label: string; tint: TintName | null; means: string }

/** `tint: null` is UNKNOWN, and unknown is drawn dashed — never as a finding. */
const VERDICT: Record<Verdict, VerdictSpec> = {
  punched_on_time: { label: 'Clocked in', tint: 'mint',
    means: 'The clock has an entry that covers the start of this shift.' },
  late: { label: 'Late', tint: 'amber',
    means: 'The clock has them in, this many minutes after the start.' },
  no_punch_yet: { label: 'No punch yet', tint: 'peach',
    means: 'A read after the start found nothing, less than an hour in.' },
  no_punch: { label: 'No punch', tint: 'pink',
    means: 'A read an hour or more after the start found nothing, and no call-off is on record.' },
  not_entered_yet: { label: 'Not entered yet', tint: null,
    means: 'The shift is over and the clock has no entry for it yet. Most entries are typed after the shift, '
      + 'many the next day — unknown, not an absence, until the entry is typed.' },
  told_by_a_human: { label: 'Called off', tint: 'green',
    means: 'A call-off book names this person for the day — a human told us.' },
  not_known_to_clock: { label: 'Not known to the clock', tint: null,
    means: 'The clock has not spelled this name lately — listed, never called absent, never texted.' },
  upcoming: { label: 'Upcoming', tint: 'blue', means: 'The shift has not begun.' },
  clock_not_read: { label: 'Clock not read', tint: null,
    means: 'No read of the clock since this shift began. Unknown — not a missing punch.' },
  punch_without_shift: { label: 'No roster shift', tint: 'lavender',
    means: 'The clock has this punch and the roster has no shift it belongs to.' },
}

const ORDER: Verdict[] = ['no_punch', 'no_punch_yet', 'late', 'not_entered_yet', 'clock_not_read',
  'not_known_to_clock', 'told_by_a_human', 'punched_on_time', 'upcoming', 'punch_without_shift']

/** The clock's own state, in the words the banner says. */
const CLOCK: Record<string, { label: string; tint: TintName | null; says: string }> = {
  read: { label: 'read', tint: 'mint', says: 'The last collection read PsiAnywhere.' },
  held: { label: 'held', tint: 'amber', says: 'A collection was due and nothing was sent.' },
  down: { label: 'down', tint: 'pink',
    says: 'A read on the kept session failed and the login right after it failed too — PsiAnywhere is down. Nothing is asked of it until the health retry, and the first read that lands brings it back.' },
  paused: { label: 'paused', tint: 'pink',
    says: 'Every request is held for now (a pause the platform set before this version).' },
  refused: { label: 'refused', tint: 'pink',
    says: 'PsiAnywhere answers, and the account refused the last login in its own words. No login is sent on it until its credential file changes, or a day passes.' },
  unknown: { label: 'unreadable', tint: 'amber', says: 'The last collection came back with nothing it could read.' },
  no_credential: { label: 'no credential', tint: 'pink', says: 'There is no PsiAnywhere credential on the platform.' },
  never_read: { label: 'not read yet', tint: null, says: 'No collection has read the clock yet.' },
}

// ------------------------------------------------------------------ reading the relay's own spellings…

/** "2026-09-22T08:00:00-04:00" → "8:00 AM", read in Ohio. Provenance only. */
function clockText(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
}

/** An instant as a short Ohio stamp: "Sep 22, 9:20 AM". */
function stampText(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                                       timeZone: 'America/New_York' })
}

/** "HH:MM" (24h, Ohio) → "7:30 AM". */
function hhmmText(raw: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(raw || '')
  if (!m) return ''
  const h24 = Number(m[1])
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h}:${m[2]} ${h24 < 12 ? 'AM' : 'PM'}`
}

/** A day is a day, not an instant — rebuilt in UTC so it never renders a day early. */
function dayText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return iso
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

// ------------------------------------------------------------------ the small pieces…

/** A verdict chip. Unknown is DASHED and neutral, so it can never be read as a finding. */
function VerdictChip({ v }: { v: Verdict }) {
  const spec = VERDICT[v] ?? { label: v, tint: null, means: '' }
  if (!spec.tint) {
    return (
      <span title={spec.means}
        className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-semibold text-text-3">
        {spec.label}
      </span>
    )
  }
  return <span title={spec.means}><Badge label={spec.label} tint={spec.tint} /></span>
}

/** The shift's own pair, beside the entry verdict. Unknown is dashed; a fault says so. */
function PairChip({ r }: { r: BoardRow }) {
  const spec = pairSpec(r.pair)
  if (!spec) return null
  const title = [spec.means, r.pair_why].filter(Boolean).join(' — ')
  const label = r.pair_fault ? `${spec.label} · fault` : spec.label
  if (!spec.tint) {
    return (
      <span title={title}
        className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-semibold text-text-3">
        {label}
      </span>
    )
  }
  return <span title={title}><Badge label={label} tint={spec.tint} /></span>
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold transition-colors',
        active ? 'border-primary/50 bg-surface-2 text-text-1' : 'border-border bg-surface text-text-3 hover:text-text-2')}
    >
      {children}
    </button>
  )
}

/** What a row adds to its verdict, in words. */
function detailText(r: BoardRow): string {
  if (r.row_kind === 'punch') {
    return r.open ? `on the clock since ${hhmmText(r.arrived)}` : `${hhmmText(r.arrived)} – ${hhmmText(r.ended || '') || '?'}`
  }
  switch (r.verdict) {
    case 'punched_on_time':
      return r.early_minutes
        ? `in at ${hhmmText(r.arrived)} — ${r.early_minutes} min before the start`
        : r.arrived ? `in at ${hhmmText(r.arrived)}` : ''
    case 'late':
      return `in at ${hhmmText(r.arrived)} — ${r.minutes ?? '?'} min late`
    case 'no_punch_yet':
    case 'no_punch':
      return `nothing at ${clockText(r.checked_at)} (${r.minutes ?? '?'} min in)`
    case 'not_entered_yet':
      return `no entry at ${clockText(r.checked_at)}, after the shift ended — it may still be typed`
    case 'told_by_a_human':
      return [r.late_call ? 'said they will be late' : (r.told_kind || '').replace('_', ' '),
              r.told_source ? `from ${r.told_source}` : ''].filter(Boolean).join(' · ')
    default:
      return ''
  }
}

// ------------------------------------------------------------------ the page…

export default function SmartCommsPunchBoardPage() {
  /** null is NOT an empty board — it is "we do not know yet". */
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [doorMissing, setDoorMissing] = useState(false)
  const [stale, setStale] = useState(false)
  const [day, setDay] = useState<string>('all')
  const [house, setHouse] = useState<string>('all')
  const [verdict, setVerdict] = useState<Verdict | 'all' | 'early'>('all')
  const [q, setQ] = useState('')

  const load = useCallback(async (loud: boolean) => {
    setLoading(true)
    const generation = keptGeneration()
    // ONE PATH, ON PURPOSE: the board is the relay's own file, and no Apps Script action answers to this name.
    let got: Row[] | null = null
    try { got = await readSlice<Row>(RESOURCE) } catch { got = null }
    if (got === null) {
      const kept = readKept<Row[]>(KEPT)
      setRows(kept ?? null)
      setStale(!!kept)
      setDoorMissing(!kept)
      if (loud) {
        toast({ type: 'warning', title: 'Nothing answered for the punch board',
                body: `The ${RESOURCE} slice did not reply. The page shows what it knows, not zeros.` })
      }
    } else {
      setRows(got)
      setStale(false)
      setDoorMissing(false)
      keepIfCurrent(KEPT, got, generation)
      if (loud) toast({ type: 'success', title: 'Read again', body: `${Math.max(0, got.length - 1)} rows on the board.` })
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load(false) }, [load])

  const status = useMemo(() => (rows?.find((r) => r.row_kind === 'status') as StatusRow | undefined) ?? null, [rows])
  const board = useMemo(() => (rows ?? []).filter((r): r is BoardRow => r.row_kind === 'shift' || r.row_kind === 'punch'), [rows])
  const days = useMemo(() => (status?.days?.length ? status.days : [...new Set(board.map((r) => r.day))].sort()), [status, board])
  const houses = useMemo(() => [...new Set(board.map((r) => r.house).filter(Boolean))].sort(), [board])

  const inScope = useMemo(() => board.filter((r) =>
    (day === 'all' || r.day === day) && (house === 'all' || r.house === house)), [board, day, house])

  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const r of inScope) out[r.verdict] = (out[r.verdict] ?? 0) + 1
    out.early = inScope.filter((r) => r.early_minutes).length
    return out
  }, [inScope])

  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => inScope
    .filter((r) => verdict === 'all' || (verdict === 'early' ? !!r.early_minutes : r.verdict === verdict))
    .filter((r) => !needle || `${r.person} ${r.house} ${r.shift_code}`.toLowerCase().includes(needle))
    .sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict)
      || (a.shift_at || a.day).localeCompare(b.shift_at || b.day) || a.person.localeCompare(b.person)),
  [inScope, verdict, needle])

  const shifts = shown.filter((r) => r.row_kind === 'shift')
  const punches = shown.filter((r) => r.row_kind === 'punch')
  const clock = status ? (CLOCK[status.clock_state] ?? { label: status.clock_state, tint: null, says: '' }) : null
  const unread = !!status && status.clock_state !== 'read' && status.clock_state !== 'held'

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Punch board"
          subtitle="Who clocked in on PsiAnywhere — the official time clock — and who did not: every roster shift of yesterday and today, beside the clock's own state."
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

      {/* ── 1 · THE CLOCK, FIRST — before anybody reads a verdict ─────── */}
      {status && clock && (
        <Card className={cn('mb-4', unread && 'border-dashed')}>
          <div className="flex flex-wrap items-start gap-3">
            <span className="mt-0.5 shrink-0">
              {unread
                ? <AlertTriangle size={16} className={TINT_FG.amber} />
                : <LogIn size={16} className={TINT_FG.mint} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-semibold text-text-1">The time clock</span>
                {clock.tint
                  ? <Badge label={clock.label} tint={clock.tint} />
                  : <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-semibold text-text-3">{clock.label}</span>}
                {status.mode === 'calendar' && <Badge label="reminders from the calendar" tint="amber" />}
                {status.follow_up && <Badge label="checking every 30 min" tint="blue" />}
              </div>
              <p className="mt-1 text-[12.5px] leading-[1.55] text-text-2">
                {clock.says}{status.clock_why ? <> <span className="text-text-3">— {status.clock_why}</span></> : null}
              </p>
              <p className="mt-1 text-[11.5px] leading-[1.5] text-text-3">
                {status.read_at
                  ? <>Last read {stampText(status.read_at)}. Every “no punch” below is as of a read, and says which.</>
                  : <>The clock has not been read. Nothing below is a missing punch.</>}
                {status.next_collection ? <> Next collection {stampText(status.next_collection)}.</> : null}
                {' '}Board written {stampText(status.generated_at)}.
              </p>
              {downText(status.down) && (
                <p className={cn('mt-1 text-[11.5px] leading-[1.5]', TINT_FG.pink)}>{downText(status.down)}</p>
              )}
              {accountText(status) && (
                <p className="mt-1 text-[11.5px] leading-[1.5] text-text-3">{accountText(status)}</p>
              )}
              {status.mode === 'calendar' && (
                <p className="mt-1.5 rounded-[10px] border border-dashed border-border px-2.5 py-1.5 text-[11.5px] leading-[1.45] text-text-3">
                  While the clock cannot be read, the shift reminders go from the roster: five minutes before each
                  start, then every half hour, stopping when the person replies — and the words say no check stands
                  behind them.
                </p>
              )}
              {status.books_why && (
                <p className={cn('mt-1.5 text-[11.5px] leading-[1.5]', TINT_FG.pink)}>
                  The roster or the call-off books could not be read ({status.books_why}) — the shifts below are
                  the last ones read.
                </p>
              )}
              {status.history && status.history !== 'kept' && (
                <p className={cn('mt-1.5 text-[11.5px] leading-[1.5]', TINT_FG.pink)}>
                  The platform’s copy of the entries it read could not be {status.history === 'unreadable' ? 'read' : 'written'}.
                  The board stands on the last read alone, and every shift that read cannot vouch for says “clock not
                  read” — never a missing punch — and nobody is texted from it.
                </p>
              )}
              {status.reminders?.readable && (
                <p className="mt-1.5 text-[11.5px] leading-[1.5] text-text-3">
                  Reminders: {status.reminders.due ?? 0} owed now
                  {status.reminders.held ? <>, {status.reminders.held} held by the quiet window (21:31–07:59)</> : null}
                  {status.reminders.stopped ? <>, {status.reminders.stopped} {plural(status.reminders.stopped, 'shift')} stopped by a reply</> : null}
                  {status.reminders.answers && Object.keys(status.reminders.answers).length
                    ? <>; replies to the ask: {Object.entries(status.reminders.answers)
                        .map(([w, n]) => `${n} ${w.toUpperCase()}`).join(', ')}</> : null}
                  {status.reminders.awaiting_check
                    ? <>; {status.reminders.awaiting_check} no-show {plural(status.reminders.awaiting_check, 'message')} waiting for a read of the clock</> : null}.
                  Said by Smart Comms; this page sends nothing.
                </p>
              )}
              {status.reminders?.notes_why && (
                <p className={cn('mt-1.5 text-[11.5px] leading-[1.5]', TINT_FG.amber)}>
                  Daily Note reminders are held: {status.reminders.notes_why}. Nobody is reminded of a note the
                  platform cannot see is missing.
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {doorMissing && (
        <Card className="mb-4 flex items-start gap-2.5">
          <AlertTriangle size={15} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            Nothing answered for <code className="font-stat">{RESOURCE}</code> on this deployment. The platform writes the
            board from the roster and the time clock; until the file lands, this page knows nobody — which is not the
            same as nobody clocking in.
          </p>
        </Card>
      )}
      {stale && (
        <Card className="mb-4 flex items-start gap-2.5">
          <Clock size={15} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            Nothing answered just now — this is the last board this tab held. People may have clocked in since.
          </p>
        </Card>
      )}

      {/* ── 1b · THE WARNINGS TO THE DIRECTORS, beside the clock ──────── */}
      {status && (
        <div className="mb-4">
          <PunchWarnings card={status.pairs} onAnswered={() => void load(true)} />
        </div>
      )}

      {loading && !rows && (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {!loading && rows && !board.length && (
        <Card padded={false}>
          <EmptyState
            title="No roster shift and no punch on the board"
            body="Neither the roster nor the clock answered with anybody for these two days. An empty board and an unread one look alike from here — the clock's line above says which this is."
          />
        </Card>
      )}

      {board.length > 0 && (
        <div className="space-y-4">
          {/* ── 2 · THE FILTERS ─────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip active={day === 'all'} onClick={() => setDay('all')}>Both days</FilterChip>
            {days.map((d) => (
              <FilterChip key={d} active={day === d} onClick={() => setDay(d)}>{dayText(d)}</FilterChip>
            ))}
            <select
              value={house}
              onChange={(e) => setHouse(e.target.value)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none focus:border-primary/50"
              aria-label="House"
            >
              <option value="all">Every house</option>
              {houses.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
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

          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={verdict === 'all'} onClick={() => setVerdict('all')}>
              Everything <span className="font-stat opacity-70">{inScope.length}</span>
            </FilterChip>
            {ORDER.filter((v) => counts[v]).map((v) => (
              <FilterChip key={v} active={verdict === v} onClick={() => setVerdict(v)}>
                {VERDICT[v].label} <span className="font-stat opacity-70">{counts[v]}</span>
              </FilterChip>
            ))}
            {counts.early > 0 && (
              <FilterChip active={verdict === 'early'} onClick={() => setVerdict('early')}>
                Early clock-ins <span className="font-stat opacity-70">{counts.early}</span>
              </FilterChip>
            )}
          </div>

          {/* ── 3 · THE SHIFTS ──────────────────────────────────────── */}
          <Card padded={false} className="overflow-hidden">
            <div className="p-5 pb-3">
              <CardHeader
                title={`Roster shifts — ${shifts.length} shown`}
                sub="Each shift's verdict, as of the read that decided it. Hover a verdict for what it means."
                extra={<UserCheck size={16} className={TINT_FG.mint} />}
              />
            </div>
            {!shifts.length ? (
              <p className="border-t border-border px-5 py-4 text-[12.5px] text-text-2">No shift matches these filters.</p>
            ) : (
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full min-w-[720px] text-left text-[12.5px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-[0.08em] text-text-3">
                      <th className="px-4 py-2 font-semibold">Person</th>
                      <th className="px-3 py-2 font-semibold">House</th>
                      <th className="px-3 py-2 font-semibold">Shift</th>
                      <th className="px-3 py-2 font-semibold">Verdict</th>
                      <th className="px-3 py-2 font-semibold">What the clock shows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map((r) => (
                      <tr key={r.id} className="border-t border-border align-top hover:bg-surface-2">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <Avatar name={r.person} size="sm" />
                            <DragPerson name={r.person} id={r.person_key} type="staff" subtitle="punch board"
                              className="min-w-0 font-semibold text-text-1"
                              title="Drag this name onto the tracker, top left">
                              <span className="truncate">{r.person}</span>
                            </DragPerson>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-text-2">{r.house || '—'}</td>
                        <td className="px-3 py-2.5 text-text-2">
                          <span className="font-stat text-text-1">{clockText(r.shift_at) || r.shift_code}</span>
                          <span className="block text-[11px] text-text-3">{dayText(r.day)} · {r.shift_code}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <VerdictChip v={r.verdict} />
                            {r.early_minutes ? <Badge label={`early ${r.early_minutes} min`} tint="blue" /> : null}
                            <PairChip r={r} />
                            {r.warning_state ? (
                              <span title={[warningSpec(r.warning_state).means, r.warning_why].filter(Boolean).join(' — ')}>
                                <Badge label={`warning: ${warningSpec(r.warning_state).label}`}
                                  tint={warningSpec(r.warning_state).tint ?? 'lavender'} />
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-text-2">{detailText(r) || <span className="text-text-3">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ── 4 · THE PUNCHES NO SHIFT CLAIMED ────────────────────── */}
          {(verdict === 'all' || verdict === 'punch_without_shift') && (
            <Card padded={false} className="overflow-hidden">
              <div className="p-5 pb-3">
                <CardHeader
                  title={`Punches with no roster shift — ${punches.length}`}
                  sub="The clock has these entries and the roster has no shift they belong to: a cover nobody wrote in, a shift on another house's row, or a misspelled name."
                  extra={<UserX size={16} className={TINT_FG.lavender} />}
                />
              </div>
              {!punches.length ? (
                <p className="border-t border-border px-5 py-4 text-[12.5px] text-text-2">
                  Every punch on these days belongs to a roster shift.
                </p>
              ) : (
                <ul className="border-t border-border">
                  {punches.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
                      <Avatar name={r.person} size="sm" />
                      <span className="min-w-0 flex-1 text-[13px] font-semibold text-text-1">{r.person}</span>
                      <span className="text-[12px] text-text-3">{dayText(r.day)}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', TINT_BG.lavender, TINT_FG.lavender)}>
                        {detailText(r)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <p className="flex items-start gap-2 px-1 text-[12px] leading-[1.6] text-text-3">
            <TimerReset size={14} className="mt-0.5 shrink-0" />
            <span>
              The board is rewritten at every collection and every ten minutes from the roster and the call-off books,
              with no login spent on it. A shift stays open for a whole day, and closes only on a real read of the clock.
              Nothing on this page sends or arms anything; a director's RECEIVED on a live warning is the only thing it
              writes, and the platform decides whether it stands.
            </span>
          </p>
        </div>
      )}
    </div>
  )
}
