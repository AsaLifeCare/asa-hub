// WHEN — the page that answers, for a manager: when can we reach each person, and why then?
// The rule: fifteen minutes before their shift a person can take a message without being disturbed.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, CalendarX, Clock, HelpCircle, MoonStar, PhoneOff, RefreshCw, Search,
} from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { Badge } from '@/components/shared/Badge'
import { heroBand, TINT_FG } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { readSlice } from '@/lib/snapshotClient'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'

// ------------------------------------------------------------------ the shapes comm_when.py emits — field for…

type WhenState = 'reachable' | 'held' | 'spent' | 'hours_unknown' | 'no_shift'

type WhenRow = {
  id: string
  person_key: string
  name: string
  state: WhenState
  /** empty — never a fake hour — when there is no window */
  window_from: string
  window_to: string
  /** the rule's own T-15, carried as the point inside the window */
  moment_at: string
  shift_at: string
  shift_code: string
  house: string
  // TRUE means the window sits inside 21:00-08:00: it exists only because of this rule, and it is the reason the…
  only_by_this_rule: boolean
  moments_ahead: number
  why: string
  hold_until: string
  // not an instruction to send: the house is uncovered and the module refuses to report them unreachable
  reach_anyway: boolean
  add_quiet_after_from?: string
  add_quiet_after_to?: string
  add_day_sleeper?: boolean
  add_day_sleeper_why?: string
  // OPTIONAL, AND NOT EMITTED YET.
  unreadable_cells?: number
  // WHICH BOOKS THIS READING STOOD ON, and how old each one was when it was read — the computation's own sentence…
  sources_freshness?: string
}

type MomentRow = {
  id: string
  person_key: string
  name: string
  house: string
  shift_code: string
  shift_at: string
  window_from: string
  window_to: string
  moment_at: string
  only_by_this_rule: boolean
  voided_by_call_off: boolean
  sources_freshness?: string
}

// The two files.
const WHEN_RESOURCE = 'commWhen'
const PLAN_RESOURCE = 'commWhenMoments'
const KEPT_PEOPLE = 'smartcomms.when.people'
const KEPT_PLAN = 'smartcomms.when.plan'

/** The window the builder proposes, mirrored here only to be SAID out loud. */
const OPEN_BEFORE_MIN = 30
const CLOSE_BEFORE_MIN = 5
const OPERATOR_POINT_MIN = 15
/** The platform-wide floor this rule proposes an exception to (CommPolicy.gs). */
const QUIET_LABEL = '21:00–08:00'

// ------------------------------------------------------------------ the grammar of the day…

type Band = 'by_rule' | 'daylight' | 'held' | 'hours_unknown' | 'no_shift' | 'spent'

const BANDS: Band[] = ['by_rule', 'daylight', 'held', 'hours_unknown', 'no_shift', 'spent']

const BAND: Record<Band, { label: string; tint: TintName }> = {
  by_rule: { label: 'Only by this rule', tint: 'mint' },
  daylight: { label: 'Daylight', tint: 'blue' },
  held: { label: 'Called off', tint: 'pink' },
  hours_unknown: { label: 'Hours unknown', tint: 'amber' },
  no_shift: { label: 'No shift', tint: 'lavender' },
  spent: { label: 'Week spent', tint: 'peach' },
}

function bandOf(r: WhenRow): Band {
  if (r.state === 'reachable') return r.only_by_this_rule ? 'by_rule' : 'daylight'
  if (r.state === 'held') return 'held'
  if (r.state === 'hours_unknown') return 'hours_unknown'
  if (r.state === 'spent') return 'spent'
  return 'no_shift'
}

// ------------------------------------------------------------------ the clock — the HOUSES' clock, read off the…

// THE HOURS ON THIS PAGE ARE OHIO'S, NOT THE READER'S.
const ESTATE_TZ = 'America/New_York'

function hhmm(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '')
  return m ? `${m[1]}:${m[2]}` : '—'
}

function dayKey(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10) : ''
}

function estateToday(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: ESTATE_TZ }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function dayLabel(iso: string, today: string): string {
  const d = dayKey(iso)
  if (!d) return '—'
  if (d === today) return 'Today'
  const a = Date.parse(`${today}T00:00:00Z`)
  const b = Date.parse(`${d}T00:00:00Z`)
  if (Number.isFinite(a) && Number.isFinite(b)) {
    const days = Math.round((b - a) / 86_400_000)
    if (days === 1) return 'Tomorrow'
    if (days === -1) return 'Yesterday'
    if (days > 1 && days < 7) {
      return new Date(b).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })
    }
  }
  return d
}

/** How far off, from the reader's own now — an absolute instant, so Date is right. */
function fromNow(iso: string): string {
  const ms = Date.parse(iso || '')
  if (!Number.isFinite(ms)) return ''
  const d = ms - Date.now()
  if (d <= 0) return 'open now'
  const mins = Math.round(d / 60_000)
  if (mins < 60) return `in ${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `in ${h}h${mins % 60 ? ` ${mins % 60}m` : ''}`
  return `in ${Math.round(h / 24)}d`
}

/* ------------------------------------------------------------------ */

type Tab = 'next' | 'blocked' | 'week'

const TABS: { id: Tab; label: string }[] = [
  { id: 'next', label: 'Next moment' },
  { id: 'blocked', label: 'Cannot be reached' },
  { id: 'week', label: 'The week ahead' },
]

export default function SmartCommsWhenPage() {
  /** null is NOT an empty roster — it is "we do not know yet". */
  const [people, setPeople] = useState<WhenRow[] | null>(null)
  const [plan, setPlan] = useState<MomentRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [unanswered, setUnanswered] = useState(false)
  // The file answered and held no rows — a different sentence from "it did not answer", and the reader is owed the…
  const [emptyFile, setEmptyFile] = useState(false)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('next')
  const [q, setQ] = useState('')

  const load = useCallback(async (loud: boolean) => {
    setLoading(true)
    setError('')
    // a read still in flight at a sign-out or a crossing keeps nothing (lib/kept)
    const generation = keptGeneration()

    // THE FILE IS THE PATH, AND THERE IS NO OTHER ONE.
    let rows: WhenRow[] | null = null
    try {
      rows = await readSlice<WhenRow>(WHEN_RESOURCE)
    } catch (err) {
      rows = null
      setError(err instanceof Error ? err.message : String(err))
    }

    let moments: MomentRow[] | null = null
    try { moments = await readSlice<MomentRow>(PLAN_RESOURCE) } catch { moments = null }

    // AN EMPTY FILE IS NOT A WEEK WITH NOBODY ON IT.
    const emptied = rows !== null && rows.length === 0
    if (emptied) setEmptyFile(true)
    else setEmptyFile(false)
    if (rows === null || emptied) {
      // NOT A ZERO.
      const kept = readKept<WhenRow[]>(KEPT_PEOPLE)
      setPeople(kept ?? null)
      setPlan(readKept<MomentRow[]>(KEPT_PLAN) ?? null)
      setStale(!!kept)
      setUnanswered(!kept)
      if (loud) {
        toast({
          type: 'warning',
          title: emptied ? 'The “when” file came back empty' : 'Nothing answered for “when”',
          body: emptied
            ? `The ${WHEN_RESOURCE} file answered with no rows at all. The builder refuses to write an empty roster, so this is a read that failed upstream — not a week with nobody on it.`
            : `The ${WHEN_RESOURCE} file did not answer this reader. The page is showing what it knows, not zeros.`,
        })
      }
    } else {
      setPeople(rows)
      setPlan(moments)
      setStale(false)
      setUnanswered(false)
      keepIfCurrent(KEPT_PEOPLE, rows, generation)
      if (moments) keepIfCurrent(KEPT_PLAN, moments, generation)
      if (loud) toast({ type: 'success', title: 'Read again', body: `${rows.length} people on this week's roster.` })
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load(false) }, [load])

  const today = useMemo(() => estateToday(), [])

  const counts = useMemo(() => {
    if (!people) return null
    const c: Record<Band, number> = {
      by_rule: 0, daylight: 0, held: 0, hours_unknown: 0, no_shift: 0, spent: 0,
    }
    for (const p of people) c[bandOf(p)] += 1
    return c
  }, [people])

  const reachable = useMemo(() => {
    if (!people) return null
    return [...people]
      .filter((p) => p.state === 'reachable' && p.window_from)
      .sort((a, b) => (Date.parse(a.window_from) || 0) - (Date.parse(b.window_from) || 0))
  }, [people])

  const needle = q.trim().toLowerCase()
  const match = useCallback((r: WhenRow) => (
    !needle || `${r.name} ${r.house} ${r.shift_code} ${r.why}`.toLowerCase().includes(needle)
  ), [needle])

  const shownReachable = useMemo(() => (reachable ?? []).filter(match), [reachable, match])

  const blocked = useMemo(() => {
    const pick = (s: WhenState) => (people ?? [])
      .filter((p) => p.state === s)
      .filter(match)
      .sort((a, b) => a.name.localeCompare(b.name))
    return { held: pick('held'), hours: pick('hours_unknown'), none: pick('no_shift'), spent: pick('spent') }
  }, [people, match])

  /** The week, in the estate's own days, each one in time order. */
  const week = useMemo(() => {
    if (!plan) return null
    const days = new Map<string, MomentRow[]>()
    for (const m of [...plan].sort((a, b) => (Date.parse(a.window_from) || 0) - (Date.parse(b.window_from) || 0))) {
      const k = dayKey(m.window_from)
      if (!k) continue
      const list = days.get(k)
      if (list) list.push(m); else days.set(k, [m])
    }
    return [...days.entries()]
  }, [plan])

  const planByRule = useMemo(() => {
    if (!plan) return null
    return plan.filter((m) => m.only_by_this_rule && !m.voided_by_call_off).length
  }, [plan])

  const blockedTotal = counts
    ? counts.held + counts.hours_unknown + counts.no_shift + counts.spent
    : null

  // THE BOOKS UNDER THE ANSWER.
  const standingOn = useMemo(
    () => (people ?? []).find((p) => p.sources_freshness)?.sources_freshness ?? '',
    [people],
  )

  /* ------------------------------------------------------------- */

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="When"
          subtitle="When each person can be reached without being disturbed — and the shift that proves it."
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

      {/* THE HEADLINE — the argument for the whole feature, on the one dark
          surface this design system keeps. The number is the set of people
          whose next moment sits INSIDE the platform's quiet hours: under the
          old blanket rule every one of them was unreachable. */}
      <div className="mb-5 rounded-[16px] bg-detail-hero p-6 shadow-2">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Reachable only by this rule
            </p>
            <p className="font-stat text-[60px] leading-none text-white">
              {counts ? counts.by_rule : '—'}
            </p>
            <p className="mt-1 text-[12px] text-white/60">
              {people
                ? <>of {people.length} on this week&apos;s roster · their window falls inside {QUIET_LABEL}</>
                : <>the roster has not answered — nothing here is a measured zero</>}
            </p>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              How the whole roster reads right now
            </p>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              {counts && people && people.length > 0 ? BANDS.map((b) => (
                counts[b] ? (
                  <span
                    key={b}
                    title={`${counts[b]} · ${BAND[b].label}`}
                    style={{
                      width: `${(counts[b] / Math.max(1, people.length)) * 100}%`,
                      background: heroBand(BAND[b].tint),
                    }}
                  />
                ) : null
              )) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[12px] text-white/70">
              {BANDS.map((b) => (
                <span key={b} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: heroBand(BAND[b].tint) }} />
                  {BAND[b].label} <span className="font-stat text-white">{counts ? counts[b] : '—'}</span>
                </span>
              ))}
            </div>
            <p className="mt-3 text-[12.5px] leading-[1.55] text-white/80">
              A window opens <span className="font-stat text-white">{OPEN_BEFORE_MIN}</span> minutes before a shift and
              closes <span className="font-stat text-white">{CLOSE_BEFORE_MIN}</span> minutes before it — the
              standing T-<span className="font-stat text-white">{OPERATOR_POINT_MIN}</span> sits in the middle.
              Too early wakes them; too late catches them driving.
              {planByRule !== null && (
                <> Across the week the roster holds <span className="font-stat text-white">{planByRule}</span> such
                windows the old rule refused.</>
              )}
            </p>
            {standingOn && (
              <p className="mt-2 text-[11.5px] leading-[1.5] text-white/50">
                Read from: {standingOn}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* WHY THERE ARE NO NUMBERS, said before anyone mistrusts the dashes. */}
      {unanswered && (
        <Card className="mb-4 flex items-start gap-2.5">
          <AlertTriangle size={15} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
          <div className="min-w-0">
            {emptyFile && (
              <p className="mb-1.5 text-[12.5px] leading-[1.55] text-text-2">
                <strong className="text-text-1">The file answered, and it held no rows at all.</strong> That is not a
                week on which nobody works: the builder refuses to write an empty{' '}
                <code className="font-stat">{WHEN_RESOURCE}</code>, so a zero reaching this page means the roster read
                failed upstream — the schedule mirror, or the tab it reads.
              </p>
            )}
            <p className="text-[12.5px] leading-[1.55] text-text-2">
              {emptyFile
                ? <>There is no second path to try either:</>
                : <>The <code className="font-stat">{WHEN_RESOURCE}</code> file did not answer this reader, and there is no
                  second path to try:</>}{' '}
              the windows are computed against the roster and the call-off book in the platform&apos;s
              own database, and the one write this lane declares is its ingest, which the platform runs on its own clock.
              So every figure above reads “—”. <strong className="text-text-1">None of them is a measured zero</strong> —
              the roster was not read and nobody was found unreachable.
            </p>
            {error && <p className="mt-1 text-[12px] text-text-3">The read said: {error}</p>}
          </div>
        </Card>
      )}

      {stale && (
        <Card className="mb-4 flex items-start gap-2.5">
          <Clock size={15} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            Nothing answered just now — this is the last reading this tab held. The hours below were true when it was
            taken, and a shift may have moved since.
          </p>
        </Card>
      )}

      {/* the tabs — an underline bar with counts, the app's pattern */}
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn('-mb-px border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors sm:px-4',
              tab === t.id ? cn('border-current', TINT_FG.mint)
                : 'border-transparent text-text-3 hover:text-text-2')}
          >
            {t.label}
            <span className="ml-1.5 font-stat text-[11.5px] opacity-70">
              {t.id === 'next' ? (reachable ? reachable.length : '—')
                : t.id === 'blocked' ? (blockedTotal ?? '—')
                : (plan ? plan.length : '—')}
            </span>
          </button>
        ))}
        {tab !== 'week' && (
          <div className="ml-auto flex items-center gap-1.5 pb-2">
            <Search size={13} className="text-text-3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a person or a house…"
              className="h-8 w-[150px] rounded-sm border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary/50 sm:w-[220px]"
            />
          </div>
        )}
      </div>

      {loading && !people && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[72px] w-full" />)}
        </div>
      )}

      {/* ── NEXT MOMENT ─────────────────────────────────────────── */}
      {tab === 'next' && people && (
        reachable && reachable.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              title="No window ahead of anybody"
              body="Nobody on this week's roster has a readable shift still in front of them. The platform's own quiet hours stand, unnarrowed — which is the safe answer, not a good one."
            />
          </Card>
        ) : (
          <>
            <Card padded={false} className="overflow-hidden">
              <ul>
                {shownReachable.map((r) => (
                  <MomentLine key={r.id} r={r} today={today} />
                ))}
              </ul>
            </Card>
            {reachable && (
              <p className="mt-2 px-1 text-[12px] text-text-3">
                Showing {shownReachable.length} of {reachable.length} with a window ahead.
                {' '}The headline above counts the whole roster, not this list.
              </p>
            )}
          </>
        )
      )}

      {/* ── CANNOT BE REACHED ───────────────────────────────────── */}
      {tab === 'blocked' && people && (
        <div className="space-y-4">
          {/* 1. a human decision, recorded */}
          <Card padded={false} className="overflow-hidden">
            <div className="p-5 pb-3">
              <CardHeader
                title="Called off — the day is theirs"
                sub="Somebody sick at 6am is not a free line for the 9am message about a missing card. Routine traffic waits until the end of their local day."
                extra={<PhoneOff size={16} className={TINT_FG.pink} />}
              />
            </div>
            {blocked.held.length ? (
              <ul className="border-t border-border">
                {blocked.held.map((r) => <BlockedLine key={r.id} r={r} today={today} tint="pink" />)}
              </ul>
            ) : (
              <p className="border-t border-border px-5 py-4 text-[12.5px] leading-[1.55] text-text-2">
                No call-off in the book touches this week. The book is the record of what was filed, kept in Postgres:
                read this as “nothing has been recorded”, not as “nobody called off”.
              </p>
            )}
          </Card>

          {/* 2. a spreadsheet that never held the fact */}
          <Card padded={false} className="overflow-hidden">
            <div className="p-5 pb-3">
              <CardHeader
                title="Rostered, but no cell says an hour"
                sub="The calendar named the house and never the hour — “48TH (B)”, “BM”, “ADMIN”. The platform knows they work that day and not when, so its quiet hours stand, unnarrowed. This is a spreadsheet to fix, not a parser to improve."
                extra={<HelpCircle size={16} className={TINT_FG.amber} />}
              />
            </div>
            {blocked.hours.length ? (
              <ul className="border-t border-border">
                {blocked.hours.map((r) => <BlockedLine key={r.id} r={r} today={today} tint="amber" />)}
              </ul>
            ) : (
              <p className="border-t border-border px-5 py-4 text-[12.5px] text-text-2">
                Every rostered person this week has at least one readable hour.
              </p>
            )}
          </Card>

          {/* 3. not on the roster at all */}
          <Card padded={false} className="overflow-hidden">
            <div className="p-5 pb-3">
              <CardHeader
                title="Not on this week's roster"
                sub="No shift on file inside the horizon. This page knows nothing about their week, so it narrows nothing: the platform's own quiet hours apply in full."
                extra={<CalendarX size={16} className={TINT_FG.lavender} />}
              />
            </div>
            {blocked.none.length ? (
              <ul className="border-t border-border">
                {blocked.none.map((r) => <BlockedLine key={r.id} r={r} today={today} tint="lavender" />)}
              </ul>
            ) : (
              <p className="border-t border-border px-5 py-4 text-[12.5px] text-text-2">
                Everybody this page knows about is on the roster.
              </p>
            )}
          </Card>

          {/* 4. answered by tomorrow's roster, unlike the three above */}
          {blocked.spent.length > 0 && (
            <Card padded={false} className="overflow-hidden">
              <div className="p-5 pb-3">
                <CardHeader
                  title="Every window this week is behind them"
                  sub="They were reachable; the moments have passed. Tomorrow's roster answers this one on its own."
                  extra={<Clock size={16} className={TINT_FG.peach} />}
                />
              </div>
              <ul className="border-t border-border">
                {blocked.spent.map((r) => <BlockedLine key={r.id} r={r} today={today} tint="peach" />)}
              </ul>
            </Card>
          )}
        </div>
      )}

      {/* ── THE WEEK AHEAD ──────────────────────────────────────── */}
      {tab === 'week' && (
        week === null ? (
          !loading && (
            <Card padded={false}>
              <EmptyState
                title="The week has not answered"
                body="The per-moment plan is a second resource, commWhenMoments. It did not reply, so nothing is drawn here — rather than a week that looks empty."
              />
            </Card>
          )
        ) : week.length === 0 ? (
          <Card padded={false}>
            <EmptyState title="No windows in the horizon" body="No readable shift starts in the days ahead." />
          </Card>
        ) : (
          <div className="space-y-4">
            {week.map(([day, rows]) => (
              <Card key={day} padded={false} className="overflow-hidden">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
                  <h3 className="font-display text-[15px] font-bold text-text-1">{dayLabel(`${day}T00:00`, today)}</h3>
                  <p className="text-[12px] text-text-3">
                    {day} · <span className="font-stat">{rows.length}</span> window{rows.length === 1 ? '' : 's'} ·{' '}
                    <span className="font-stat">{rows.filter((m) => m.only_by_this_rule).length}</span> inside quiet hours
                  </p>
                </div>
                <ul>
                  {rows.map((m) => (
                    <li key={m.id}
                      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 last:border-0',
                        m.voided_by_call_off && 'opacity-55')}>
                      <span className="w-[104px] shrink-0 font-stat text-[13px] text-text-1">
                        {hhmm(m.window_from)}–{hhmm(m.window_to)}
                      </span>
                      <DragPerson name={m.name} id={m.person_key} subtitle={m.house}
                        className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-1">
                        <span className="truncate">{m.name}</span>
                      </DragPerson>
                      <span className="text-[12px] text-text-3">
                        {m.shift_code || '—'}{m.house ? ` · ${m.house}` : ''} · starts {hhmm(m.shift_at)}
                      </span>
                      {m.only_by_this_rule && <Badge label="quiet hours" tint="mint" />}
                      {m.voided_by_call_off && <Badge label="called off" tint="pink" />}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )
      )}

      {/* the last word: this page reads, and reading is all it does */}
      <p className="mt-5 px-1 text-[12px] leading-[1.6] text-text-3">
        Nothing on this page sends anything. It proposes a narrow exception to the platform&apos;s{' '}
        {QUIET_LABEL} quiet hours with the shift that justifies it attached; consent still decides whether a person may
        be contacted at all, and the policy still owns the floor.
      </p>
    </div>
  )
}

// ------------------------------------------------------------------ one person with a window — the time, and the…

function MomentLine({ r, today }: { r: WhenRow; today: string }) {
  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3 last:border-0">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Avatar name={r.name} size="sm" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <DragPerson name={r.name} id={r.person_key} subtitle={r.house}
              className="min-w-0 text-[13.5px] font-semibold text-text-1">
              <span className="truncate">{r.name}</span>
            </DragPerson>
            {r.only_by_this_rule
              ? <Badge label="only by this rule" tint="mint" />
              : <Badge label="daylight" tint="blue" />}
            {r.add_day_sleeper && (
              <span title={r.add_day_sleeper_why || undefined}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-3">
                <MoonStar size={12} /> works nights
              </span>
            )}
          </div>

          {/* THE EVIDENCE. 21:45 is not arbitrary and this line is why. */}
          <p className="mt-1 text-[12.5px] leading-[1.5] text-text-2">
            <span className="font-semibold text-text-1">{dayLabel(r.shift_at, today)}</span>
            {' · '}{r.shift_code || 'shift'}{r.house ? ` at ${r.house}` : ''}
            {' · starts '}<span className="font-stat">{hhmm(r.shift_at)}</span>
          </p>
          <p className="mt-0.5 text-[11.5px] leading-[1.5] text-text-3">
            {r.why || '—'}
          </p>
          {(r.moments_ahead > 1 || r.add_quiet_after_to) && (
            <p className="mt-0.5 text-[11.5px] text-text-3">
              {r.moments_ahead > 1 && <>{r.moments_ahead - 1} further window{r.moments_ahead - 1 === 1 ? '' : 's'} this week</>}
              {r.moments_ahead > 1 && r.add_quiet_after_to ? ' · ' : ''}
              {r.add_quiet_after_to && <>held again until {hhmm(r.add_quiet_after_to)} after that shift ends — handover, then the drive home</>}
            </p>
          )}
        </div>
      </div>

      <div className="ml-auto shrink-0 text-right">
        <p className="font-stat text-[22px] leading-none text-text-1">{hhmm(r.moment_at)}</p>
        <p className="mt-1 text-[11.5px] leading-none text-text-3">
          {hhmm(r.window_from)}–{hhmm(r.window_to)}
        </p>
        <p className="mt-1 text-[11px] leading-none text-text-3">{fromNow(r.window_from)}</p>
      </div>
    </li>
  )
}

// ------------------------------------------------------------------ one person who cannot be reached — the reason…

function BlockedLine({ r, today, tint }: { r: WhenRow; today: string; tint: TintName }) {
  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3 last:border-0">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Avatar name={r.name} size="sm" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <DragPerson name={r.name} id={r.person_key} subtitle={r.house}
              className="min-w-0 text-[13.5px] font-semibold text-text-1">
              <span className="truncate">{r.name}</span>
            </DragPerson>
            {/* NOT an instruction to send — it says the house is uncovered and
                this module refuses to call them unreachable. */}
            {r.reach_anyway && <Badge label="house uncovered" tint={tint} />}
            {r.unreadable_cells ? <Badge label={`${r.unreadable_cells} unreadable cell${r.unreadable_cells === 1 ? '' : 's'}`} tint="amber" /> : null}
          </div>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-text-2">{r.why || '—'}</p>
        </div>
      </div>
      <div className="ml-auto shrink-0 text-right">
        {r.hold_until ? (
          <>
            <p className="text-[11px] uppercase tracking-[0.1em] text-text-3">held until</p>
            <p className="font-stat text-[15px] leading-tight text-text-1">
              {hhmm(r.hold_until) === '00:00' ? 'midnight' : hhmm(r.hold_until)}
            </p>
            <p className="text-[11px] text-text-3">{dayLabel(r.hold_until, today)}</p>
          </>
        ) : (
          <p className="font-stat text-[15px] text-text-3">—</p>
        )}
        {r.window_from && (
          <p className="mt-1 text-[11px] text-text-3">
            next {hhmm(r.window_from)} · {dayLabel(r.window_from, today)}
          </p>
        )}
      </div>
    </li>
  )
}
