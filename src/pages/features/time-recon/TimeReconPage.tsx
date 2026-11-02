// Time Reconciliation — the audit queue of PsiAnywhere's punches × the house calendars × coverage.
// One screen, because the work is one loop: pick the dates the way PsiAnywhere cuts them (its 14-day, Sunday-to-
// Saturday pay periods, the current one by default), run the reconciliation over that period, and work the anomalies a
// person must vouch for, house by house. The reads are the lanes (/hub-lanes/time-recon/periods once, /queue on every
// filter change, both behind the writers' gate), the writes the recon doors as before. Every filter lives in this
// component's state, never the URL: the screen is also drawn inside Scheduling, whose own params are not ours to move.
// The Overtime tab answers to its own App Control row and shows only to the people it names.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Skeleton from '@/components/shared/Skeleton'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import { gasAction } from '@/features/hiring/shared'
import { relayLane } from '@/lib/noticesApi'
import { useFeatureAllowed } from '@/lib/featureAccess'
import { ohioToday } from '@/lib/ohio'
import { askConfirm } from '@/stores/useDialogStore'
import { toast } from '@/stores/useToastStore'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import {
  dayLabel, dayRuns, dayYearLabel, isDay, payPeriodOf, RECON_TYPES, TYPE_META, zeroCounts,
  type PayPeriod, type QueueStatus, type ReconError, type ReconEmployee, type ReconPeriods, type ReconQueue,
  type ReconRun, type ReconRunResult, type ReconStatus, type ReconType,
} from './reconTypes'
import { askKey, openLeftInRun, type QueueAsk } from './reconState'
import ErrorQueue from './ErrorQueue'
import EmployeePicker from './EmployeePicker'
import OvertimeTab from './OvertimeTab'
import ResolveNotePanel from './ResolveNotePanel'
import RunStrip from './RunStrip'
import ShiftsPanel from './ShiftsPanel'

/** `embedded`: drawn as a Scheduling screen, inside that page's own gutter. `initialHouse` (a house code) and
 *  `initialDate` (an ISO day, whose PsiAnywhere pay period opens) are where Scheduling stands when it opens this screen. */
export interface TimeReconPageProps {
  embedded?: boolean
  initialHouse?: string
  initialDate?: string
}

const LANE = '/hub-lanes/time-recon'
const CUSTOM = 'custom'
/** the pay periods the select lists: the current one and the twelve before it, as /periods answers them */
const PERIODS_LISTED = 13

/** The dates on screen: a pay period's (its id) or the reviewer's own (`periodId` ''). */
type Range = { periodId: string; from: string; to: string }

/** The pay period holding `day` (today when it is not one) — the same grid the server computes, so the queue can be
 *  asked before /periods answers. */
function rangeOf(day: string): Range {
  const today = ohioToday()
  const p = payPeriodOf(isDay(day) ? day : today, today)
  return p ? { periodId: p.id, from: p.from, to: p.to } : { periodId: '', from: today, to: today }
}

/** The thirteen periods, newest first, until /periods brings the server's own. */
function localPeriods(today: string): PayPeriod[] {
  const out: PayPeriod[] = []
  let p = payPeriodOf(today, today)
  for (let i = 0; p && i < PERIODS_LISTED; i += 1) {
    out.push(p)
    const d = new Date(`${p.from}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    p = payPeriodOf(d.toISOString().slice(0, 10), today)
  }
  return out
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** /periods with every list a list. */
function shapedMeta(d: ReconPeriods | null | undefined): ReconPeriods {
  const x = (d ?? {}) as Partial<ReconPeriods>
  return {
    today: String(x.today ?? ''),
    periods: arr<PayPeriod>(x.periods),
    houses: arr<string>(x.houses).map(String),
    employees: arr<ReconEmployee>(x.employees).filter((e) => e && e.key),
    coverage: { psiFrom: String(x.coverage?.psiFrom ?? ''), psiTo: String(x.coverage?.psiTo ?? '') },
    lastAuto: x.lastAuto && typeof x.lastAuto === 'object' ? x.lastAuto : null,
  }
}

/** /queue with every list a list — an answer in a shape this screen cannot read is said, never drawn as "clean". */
function shapedQueue(d: ReconQueue | null | undefined): ReconQueue {
  const x = (d ?? {}) as Partial<ReconQueue>
  if (!Array.isArray(x.errors)) throw new Error('The reconciliation queue arrived in a shape this screen cannot read.')
  const c = (x.counts ?? {}) as Partial<ReconQueue['counts']>
  return {
    from: String(x.from ?? ''),
    to: String(x.to ?? ''),
    period: String(x.period ?? ''),
    errors: x.errors,
    counts: {
      total: Number(c.total) || 0,
      byType: { ...zeroCounts(), ...(c.byType ?? {}) },
      byHouse: arr<ReconQueue['counts']['byHouse'][number]>(c.byHouse)
        .map((h) => ({ ...h, byType: { ...zeroCounts(), ...(h.byType ?? {}) } })),
      byEmployee: arr(c.byEmployee),
    },
    runs: arr<ReconRun>(x.runs),
    daysWithoutData: arr<string>(x.daysWithoutData),
  }
}

const STATUS_TABS: { id: QueueStatus; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All' },
]

const control = 'h-9 rounded-md border border-border bg-surface px-2.5 text-[13px] text-text-1 outline-none focus:border-primary'

export default function TimeReconPage({ embedded = false, initialHouse = '', initialDate = '' }: TimeReconPageProps) {
  const overtimeAllowed = useFeatureAllowed('time-recon.overtime')
  const [tab, setTab] = useState<'queue' | 'overtime'>('queue')
  const [meta, setMeta] = useState<ReconPeriods | null>(null)
  const [metaError, setMetaError] = useState('')
  const [range, setRange] = useState<Range>(() => rangeOf(initialDate))
  const [house, setHouse] = useState(initialHouse)
  const [employee, setEmployee] = useState('')
  const [status, setStatus] = useState<QueueStatus>('open')
  const [typeFilter, setTypeFilter] = useState<ReconType | ''>('')
  const [queue, setQueue] = useState<ReconQueue | null>(null)
  // the filters the queue on screen was read for — not the ones being typed: the folds start afresh, and the Close-run
  // warning counts, against the answer actually drawn
  const [queueFor, setQueueFor] = useState<QueueAsk | null>(null)
  const [queueError, setQueueError] = useState('')
  const [queueBusy, setQueueBusy] = useState(false)
  // Refresh: every read again (the periods, the queue, the overtime)
  const [reloadKey, setReloadKey] = useState(0)
  const [running, setRunning] = useState(false)
  const [closing, setClosing] = useState('')
  const [resolving, setResolving] = useState<{ error: ReconError; status: ReconStatus } | null>(null)
  const [viewing, setViewing] = useState<ReconError | null>(null)
  // a resolve write in flight: no other card replaces its panel until the answer is back
  const resolveBusy = useRef(false)
  // only the newest queue read may draw: a slow answer for old filters never paints over a newer one
  const asked = useRef(0)

  // Scheduling moving to another house or day while this screen is open moves the filters with it
  const seenHouse = useRef(initialHouse)
  const seenDate = useRef(initialDate)
  useEffect(() => {
    if (initialHouse !== seenHouse.current) { seenHouse.current = initialHouse; setHouse(initialHouse) }
  }, [initialHouse])
  useEffect(() => {
    if (initialDate !== seenDate.current) { seenDate.current = initialDate; setRange(rangeOf(initialDate)) }
  }, [initialDate])

  // a tab its row no longer names is left for the queue
  useEffect(() => { if (!overtimeAllowed && tab === 'overtime') setTab('queue') }, [overtimeAllowed, tab])

  useEffect(() => {
    let alive = true
    relayLane<ReconPeriods>(`${LANE}/periods`)
      .then((got) => { if (alive) { setMeta(shapedMeta(got)); setMetaError('') } })
      .catch((e) => { if (alive) setMetaError(e instanceof Error ? e.message : 'The pay periods could not be read.') })
    return () => { alive = false }
  }, [reloadKey])

  const rangeOk = isDay(range.from) && isDay(range.to) && range.from <= range.to

  const loadQueue = useCallback(async (quiet: boolean) => {
    if (!rangeOk) return
    const mine = ++asked.current
    if (!quiet) setQueueBusy(true)
    const ask: QueueAsk = { from: range.from, to: range.to, house, employee, status, type: typeFilter }
    try {
      const qs = new URLSearchParams({ from: ask.from, to: ask.to, status: ask.status })
      if (ask.house) qs.set('house', ask.house)
      if (ask.employee) qs.set('employee', ask.employee)
      if (ask.type) qs.set('type', ask.type)
      const got = shapedQueue(await relayLane<ReconQueue>(`${LANE}/queue?${qs}`))
      if (mine !== asked.current) return
      setQueue(got)
      setQueueFor(ask)
      setQueueError('')
    } catch (e) {
      if (mine !== asked.current) return
      setQueueError(e instanceof Error ? e.message : 'The reconciliation queue could not be read.')
    } finally {
      if (mine === asked.current) setQueueBusy(false)
    }
  }, [rangeOk, range.from, range.to, status, house, employee, typeFilter])

  // every filter change reads the queue again (a beat later, so typing a date asks once); the Overtime tab reads its own
  useEffect(() => {
    if (tab !== 'queue') return
    const t = window.setTimeout(() => void loadQueue(false), 200)
    return () => window.clearTimeout(t)
  }, [loadQueue, tab, reloadKey])

  const today = meta?.today || ohioToday()
  const periods = useMemo(() => {
    const list = meta?.periods.length ? meta.periods : localPeriods(today)
    // a day older than the thirteen listed (Scheduling's initialDate) still opens its own period
    if (range.periodId && !list.some((p) => p.id === range.periodId)) {
      const extra = payPeriodOf(range.from, today)
      if (extra) return [...list, extra]
    }
    return list
  }, [meta, today, range.periodId, range.from])
  const houses = useMemo(() => {
    const list = meta?.houses ?? []
    return house && !list.includes(house) ? [...list, house].sort() : list
  }, [meta, house])
  const employees = meta?.employees ?? []

  // the run button is offered only when the dates are exactly one pay period (whatever chose them)
  const onePeriod = useMemo(() => {
    if (!rangeOk) return null
    const p = payPeriodOf(range.from, today)
    return p && p.from === range.from && p.to === range.to ? p : null
  }, [rangeOk, range.from, range.to, today])

  const pickPeriod = (id: string) => {
    if (id === CUSTOM) { setRange((r) => ({ ...r, periodId: '' })); return }
    const p = periods.find((x) => x.id === id)
    if (p) setRange({ periodId: p.id, from: p.from, to: p.to })
  }

  const run = async () => {
    if (!onePeriod || running) return
    setRunning(true)
    try {
      const out = await gasAction<ReconRunResult>('reconRun', { dateFrom: onePeriod.from, dateTo: onePeriod.to })
      const counts = out?.counts ?? {}
      const found = Number(out?.total) || RECON_TYPES.reduce((s, t) => s + (Number(counts[t]) || 0), 0)
      const carried = Number(out?.carried) || 0
      toast({
        type: found ? 'warning' : 'success',
        title: found ? `${found} anomal${found === 1 ? 'y' : 'ies'} in ${onePeriod.label}` : `${onePeriod.label} is clean`,
        body: carried
          ? `${carried} earlier resolution${carried === 1 ? ' was' : 's were'} carried forward to this run.`
          : 'Read from PsiAnywhere against the house calendars.',
      })
      void loadQueue(true)
    } catch (e) {
      toast({ type: 'danger', title: 'The run did not go through', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setRunning(false)
    }
  }

  const closeRun = async (r: ReconRun) => {
    // Closing over an unworked queue is the mistake worth naming — counted only when the list on screen is the whole
    // run's open work (read over the run's own dates, no house, person, type or Resolved narrowing it), never guessed
    // from a slice.
    const open = openLeftInRun(r, queue?.errors ?? [], queueFor) ?? 0
    const warn = open ? `${open} anomal${open === 1 ? 'y is' : 'ies are'} still open in this run.` : undefined
    if (!(await askConfirm({
      title: `Close the run ${dayLabel(r.dateFrom)} – ${dayLabel(r.dateTo)}?`,
      body: 'It will be marked Reviewed.',
      detail: warn,
      confirmLabel: 'Close the run',
    }))) return
    setClosing(r.id)
    try {
      await gasAction('reconRunClose', { runId: r.id, status: 'Reviewed' })
      toast({ type: 'success', title: 'Run closed', body: 'Marked Reviewed.' })
      void loadQueue(true)
    } catch (e) {
      toast({ type: 'danger', title: 'Not closed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setClosing('')
    }
  }

  const byType = queue?.counts.byType ?? zeroCounts()
  const runs = queue?.runs ?? []
  const missingDays = queue?.daysWithoutData ?? []
  const busy = tab === 'queue' ? queueBusy : false
  // the Overtime tab says its own failures in place; the periods' only while nothing of them was ever read
  const loadError = (tab === 'queue' ? queueError : '') || (meta ? '' : metaError)

  const empty = (() => {
    if (status === 'resolved') {
      return { title: 'Nothing resolved here', body: 'No anomaly in these dates matching these filters has been resolved.' }
    }
    if (runs.length === 0) {
      return {
        title: 'No run covers these dates',
        body: onePeriod
          ? 'Run the reconciliation for this period: it reads PsiAnywhere’s entries against the house calendars.'
          : 'Pick a pay period to run the reconciliation over it.',
      }
    }
    return status === 'open'
      ? { title: 'Nothing open to review', body: 'No open anomaly matches these filters — switch to Resolved to see the work done.' }
      : { title: 'No anomalies', body: 'No anomaly matches these filters.' }
  })()

  return (
    <div className={cn('w-full', !embedded && 'px-5 py-6')} data-time-recon="">
      <PageHeader
        title="Time Reconciliation"
        subtitle="PsiAnywhere’s punches against the house calendars, by pay period — every anomaly reviewed by a person."
        actions={
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)} disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        }
      />

      {overtimeAllowed && (
        <SegmentedTabs
          className="mb-4 w-fit"
          tabs={[{ id: 'queue', label: 'Review queue' }, { id: 'overtime', label: 'Overtime' }]}
          value={tab}
          onChange={(id) => setTab(id === 'overtime' ? 'overtime' : 'queue')}
        />
      )}

      {/* ── the filter bar: PsiAnywhere's periods first, then the queue's own narrowing ── */}
      <Card className="mb-4 space-y-3 p-4" padded={false}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Pay period"
            value={range.periodId || CUSTOM}
            onChange={(e) => pickPeriod(e.target.value)}
            className={cn(control, 'min-w-[200px] tabular-nums')}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.label}{p.current ? ' (current)' : ''}</option>
            ))}
            <option value={CUSTOM}>Custom dates</option>
          </select>
          {!range.periodId && (
            <>
              <input
                type="date" aria-label="From" value={range.from} max={range.to || undefined}
                onChange={(e) => { const v = e.target.value; setRange((r) => ({ ...r, periodId: '', from: v })) }}
                className={control}
              />
              <span className="text-[13px] text-text-3">to</span>
              <input
                type="date" aria-label="To" value={range.to} min={range.from || undefined}
                onChange={(e) => { const v = e.target.value; setRange((r) => ({ ...r, periodId: '', to: v })) }}
                className={control}
              />
            </>
          )}
          {tab === 'queue' && (
            <>
              <select aria-label="House" value={house} onChange={(e) => setHouse(e.target.value)} className={cn(control, 'min-w-[130px]')}>
                <option value="">All houses</option>
                {houses.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <EmployeePicker employees={employees} value={employee} onChange={setEmployee} />
              <SegmentedTabs
                className="ml-auto"
                tabs={STATUS_TABS}
                value={status}
                onChange={(id) => setStatus(STATUS_TABS.find((s) => s.id === id)?.id ?? 'open')}
              />
            </>
          )}
        </div>

        {!rangeOk && (
          <p className="text-[12.5px] text-tint-fg-amber">Pick a From day on or before the To day.</p>
        )}

        {tab === 'queue' && (
          <div className="flex flex-wrap items-center gap-1.5">
            {RECON_TYPES.map((t) => {
              const on = typeFilter === t
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  title={`${TYPE_META[t].label} — ${TYPE_META[t].blurb}`}
                  onClick={() => setTypeFilter(on ? '' : t)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold transition-opacity',
                    TINT_BG[TYPE_META[t].tint], TINT_FG[TYPE_META[t].tint],
                    typeFilter && !on && 'opacity-40',
                    on && 'ring-2 ring-current',
                  )}
                >
                  <span className="tabular-nums">{queue ? byType[t] : '·'}</span>
                  {TYPE_META[t].label.toLowerCase()}
                </button>
              )
            })}
            {queue && (
              <span className="ml-auto text-[12.5px] text-text-3">
                <span className="font-semibold tabular-nums text-text-1">{queue.counts.total}</span>{' '}
                {status === 'open' ? 'open' : status === 'resolved' ? 'resolved' : 'in all'}
                {queue.period ? ` · ${queue.period}` : ` · ${dayLabel(queue.from)} – ${dayLabel(queue.to)}`}
              </span>
            )}
          </div>
        )}

        {/* what the dates can say at all: how far PsiAnywhere's record reaches, and the days it holds nothing for */}
        {(meta?.coverage.psiTo || (tab === 'queue' && missingDays.length > 0)) && (
          <div className="space-y-0.5 text-[12.5px] text-text-3">
            {meta?.coverage.psiTo && (
              <p title={meta.coverage.psiFrom ? `From ${dayYearLabel(meta.coverage.psiFrom)}` : undefined}>
                PsiAnywhere entries through {dayYearLabel(meta.coverage.psiTo)}.
              </p>
            )}
            {tab === 'queue' && missingDays.length > 0 && (
              <p className="text-tint-fg-amber">
                No PsiAnywhere entries for {missingDays.length} day{missingDays.length === 1 ? '' : 's'} in this range:{' '}
                {dayRuns(missingDays).join(', ')}.
              </p>
            )}
          </div>
        )}
      </Card>

      {loadError && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">
          <span className="flex-1">{loadError}</span>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded-md border border-current px-2.5 py-1 text-[12px] font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {tab === 'overtime' && overtimeAllowed ? (
        <OvertimeTab
          from={range.from} to={range.to} rangeOk={rangeOk}
          fallbackEmployees={employees} reloadKey={reloadKey}
        />
      ) : (
        <div className="space-y-4">
          <RunStrip
            runs={runs}
            loading={!queue && !queueError}
            periodLabel={onePeriod?.label ?? ''}
            canRun={!!onePeriod}
            running={running}
            closing={closing}
            lastAuto={meta?.lastAuto ?? null}
            onRun={() => void run()}
            onCloseRun={(r) => void closeRun(r)}
          />

          <section className={cn('transition-opacity', queueBusy && queue && 'opacity-60')}>
            {!queue ? (
              queueError ? null : (
                <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
              )
            ) : (
              <ErrorQueue
                errors={queue.errors}
                byHouse={queue.counts.byHouse}
                houseFiltered={!!queueFor?.house}
                typeFilter={typeFilter}
                resetKey={askKey(queueFor)}
                empty={empty}
                // one right panel at a time: a card's action or its shifts replace whatever panel is open
                onAction={(error, s) => { if (resolveBusy.current) return; setViewing(null); setResolving({ error, status: s }) }}
                onViewShifts={(error) => { if (resolveBusy.current) return; setResolving(null); setViewing(error) }}
              />
            )}
          </section>
        </div>
      )}

      {resolving && (
        <ResolveNotePanel
          key={`${resolving.error.id}:${resolving.status}`}
          error={resolving.error}
          status={resolving.status}
          onClose={() => setResolving(null)}
          // quietly: the list stays drawn (folds, pages and scroll with it) until the new answer replaces it
          onResolved={() => void loadQueue(true)}
          onBusy={(b) => { resolveBusy.current = b }}
        />
      )}
      {viewing && <ShiftsPanel key={viewing.id} error={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
