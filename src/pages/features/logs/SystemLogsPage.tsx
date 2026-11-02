// Read-only on purpose: `logsList`'s sentence first, the ids underneath and never instead of it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ChevronDown, RefreshCw, Search, ShieldOff, X,
} from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import Pager from '@/components/shared/Pager'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import ExportMenu from '@/components/shared/ExportMenu'
import { usePager } from '@/lib/pager'
import { gasAction } from '@/features/hiring/shared'
import { EASE_OUT_EXPO } from '@/engine/motion'
import SheetEditor from '@/components/shared/SheetEditor'
import { useUiPrefsStore, type LogsDefaultView } from '@/stores/useUiPrefsStore'
import { cn } from '@/lib/utils'
import { ohioDayYear, ohioLongDay, ohioSameDay, ohioTime } from '@/lib/ohio'

/** Fifty rows a page — the fetch window (400) divides evenly into eight. */
const LOG_PAGE_SIZE = 50

type LogEvent = {
  at: string
  when: string
  actor: string
  actor_name: string
  area: string
  outcome: 'ok' | 'failed' | 'denied' | string
  summary: string
  action: string
  target: string
  detail: string
}
type LogsPayload = { events: LogEvent[]; areas: { area: string; count: number }[]; total: number }

/* ══════════════════ THE ENGINE'S TRAIL, MERGED IN ══════════════════ */

// The Events trail moves into System Logs, merged, carrying the source of those rows with it — and the SOURCE is…
type EngineEvent = {
  event_id?: string
  type?: string
  actor?: string
  subject_type?: string
  subject_key?: string
  subject_name?: string
  payload?: Record<string, unknown>
  source?: string
  at?: string
  tenant?: string
}

/** Where a row came from. The discriminator the merged list is sorted and filtered by. */
type LogSource = 'platform' | 'engine'
type MergedEvent = LogEvent & { src: LogSource; key: string }

// The two origins, declared as a table the way CompanyCalendarPage declares its kinds — this repo's one existing…
const SOURCES: { id: LogSource; label: string; tint: string }[] = [
  { id: 'platform', label: 'Platform', tint: 'bg-tint-blue text-tint-fg-blue' },
  { id: 'engine', label: 'Engine', tint: 'bg-tint-lavender text-tint-fg-lavender' },
]
const SOURCE_META: Record<LogSource, { label: string; tint: string }> =
  Object.fromEntries(SOURCES.map((s) => [s.id, { label: s.label, tint: s.tint }])) as never

/** The mirror. Anything stamped with it is already on the platform feed. */
const MIRROR_SOURCE = 'hubSysLog_'

// An engine event, said as a sentence.
function engineSummary(e: EngineEvent): string {
  const what = String(e.type ?? '').replace(/_/g, ' ').trim() || 'engine event'
  const who = String(e.subject_name ?? e.subject_key ?? '').trim()
  return who ? `${what} — ${who}` : what
}

const WINDOWS = [
  { id: '1', label: 'Today' },
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '', label: 'All' },
]

// THE SECOND MERGE, over the two sidebar rungs: Activity and Raw table were two PAGES of one app reading the same…
type LogsView = 'activity' | 'table' | 'sheet'

const VIEWS: { id: LogsView; label: string }[] = [
  { id: 'activity', label: 'Activity' },
  { id: 'table', label: 'Table' },
  { id: 'sheet', label: 'Sheet' },
]

// The stored preference keeps its ORIGINAL words.
const VIEW_OF_PREF: Record<LogsDefaultView, LogsView> = {
  normal: 'activity',
  table: 'table',
  sheet: 'sheet',
}

function isView(v: string | null): v is LogsView {
  return v === 'activity' || v === 'table' || v === 'sheet'
}

/** The tab's own header names — the replica shows the sheet, not our words. */
const SHEET_COLUMNS = [
  { key: 'at', label: 'timestamp' }, { key: 'actor', label: 'actor' },
  { key: 'actor_name', label: 'actor_name' }, { key: 'action', label: 'action' },
  { key: 'target', label: 'target' }, { key: 'area', label: 'area' },
  { key: 'outcome', label: 'outcome' }, { key: 'summary', label: 'summary' },
  { key: 'detail', label: 'detail' },
]

/** Export carries every column the log holds, whatever view is on screen. */
const EXPORT_COLUMNS = [
  { key: 'at', label: 'Timestamp' }, { key: 'actor', label: 'Account' },
  { key: 'actor_name', label: 'Name' }, { key: 'action', label: 'Action' },
  { key: 'target', label: 'Record' }, { key: 'area', label: 'Area' },
  { key: 'outcome', label: 'Outcome' }, { key: 'summary', label: 'Summary' },
  { key: 'detail', label: 'Detail' },
]

const OUTCOME = {
  failed: { label: 'failed', cls: 'bg-tint-danger text-tint-fg-danger', Icon: AlertTriangle },
  denied: { label: 'not allowed', cls: 'bg-tint-amber text-tint-fg-amber', Icon: ShieldOff },
} as const

// Today / Yesterday / the date — the unit people actually think in, on the COMPANY clock: days group by Ohio…
function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'Undated'
  const now = new Date()
  if (ohioSameDay(d, now)) return 'Today'
  if (ohioSameDay(d, new Date(now.getTime() - 86400000))) return 'Yesterday'
  return ohioLongDay(d)
}

function clockLabel(iso: string): string {
  return ohioTime(iso)
}

// THE FIRST MERGE — the two System Logs apps became one: the Studio-imported grid (`app_system_logs`, a raw view of…
export default function SystemLogsPage() {
  const [data, setData] = useState<LogsPayload | null>(null)
  const [engine, setEngine] = useState<EngineEvent[]>([])
  const [engineErr, setEngineErr] = useState('')
  /** Which sources are hidden — empty means both are shown. */
  const [hiddenSrc, setHiddenSrc] = useState<Set<LogSource>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [area, setArea] = useState('')
  const [outcome, setOutcome] = useState('')
  const [days, setDays] = useState('7')
  const [open, setOpen] = useState<string | null>(null)
  // The view opens on the person's chosen default (Settings → Appearance) — unless the address names one, which is…
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<LogsView>(() => {
    const asked = params.get('view')
    if (isView(asked)) return asked
    return VIEW_OF_PREF[useUiPrefsStore.getState().logsDefaultView] ?? 'activity'
  })
  // The address follows the screen, so a link shared from here shows the reader what the sender was looking at.
  const pickView = useCallback((next: LogsView) => {
    setView(next)
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('view', next)
      return p
    }, { replace: true })
  }, [setParams])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setEngineErr('')
    try {
      const since = days ? new Date(Date.now() - Number(days) * 86400000).toISOString() : ''
      // The filters run on the SERVER.
      const res = (await gasAction('logsList', {
        q, area, outcome, since, limit: 400,
      })) as LogsPayload
      setData(res)
      // THE ENGINE'S TRAIL, asked for SECOND and never allowed to break the first.
      if (!outcome && !area) {
        try {
          const ev = (await gasAction('eventsList', { limit: 200, since })) as { events?: EngineEvent[] }
          setEngine(Array.isArray(ev?.events) ? ev.events : [])
        } catch {
          // The platform log still stands.
          setEngine([])
          setEngineErr('The engine trail did not answer — the platform log below is complete, the engine rows are missing.')
        }
      } else {
        setEngine([])
      }
    } catch (e) {
      // A blank feed reads as "nothing happened", which is the one thing an empty audit trail must never be allowed…
      setError(e instanceof Error ? e.message : 'The log could not be read.')
    } finally {
      setLoading(false)
    }
  }, [q, area, outcome, days])

  // EVERY change waits, not just typing.
  useEffect(() => {
    const t = setTimeout(() => void load(), 300)
    return () => clearTimeout(t)
  }, [load])

  // Fifty at a time.
  const merged = useMemo<MergedEvent[]>(() => {
    const rows: MergedEvent[] = (data?.events ?? []).map((e, i) => ({
      ...e, src: 'platform' as const, key: `p:${e.at}:${e.action}:${i}`,
    }))
    for (const [i, e] of engine.entries()) {
      if (String(e.source ?? '') === MIRROR_SOURCE) continue
      rows.push({
        at: String(e.at ?? ''),
        when: '',
        actor: String(e.actor ?? ''),
        actor_name: String(e.actor ?? '') || 'system',
        area: '',
        outcome: '',
        summary: engineSummary(e),
        action: String(e.type ?? ''),
        target: String(e.subject_key ?? ''),
        // the payload IS the detail on this side; pretty-printed so the disclosure reads like the trail's own…
        detail: e.payload && Object.keys(e.payload).length ? JSON.stringify(e.payload, null, 2) : '',
        src: 'engine',
        key: `e:${e.event_id ?? `${e.at}:${i}`}`,
      })
    }
    // newest first, the order both feeds already arrive in and the only order an audit trail is ever read in
    rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    return hiddenSrc.size ? rows.filter((r) => !hiddenSrc.has(r.src)) : rows
  }, [data, engine, hiddenSrc])

  const engineCount = useMemo(
    () => engine.filter((e) => String(e.source ?? '') !== MIRROR_SOURCE).length,
    [engine],
  )

  const pager = usePager(merged, LOG_PAGE_SIZE, `${merged.length}|${[...hiddenSrc].join(',')}`)

  const groups = useMemo(() => {
    const out: { day: string; events: MergedEvent[] }[] = []
    for (const ev of pager.slice) {
      const day = dayLabel(ev.at)
      const last = out[out.length - 1]
      if (last && last.day === day) last.events.push(ev)
      else out.push({ day, events: [ev] })
    }
    return out
  }, [pager.slice])

  const filtering = !!(q || area || outcome) || days !== '7' || hiddenSrc.size > 0
  const shown = merged.length

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="w-full px-4 pb-16 pt-4 sm:px-6"
    >
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-text-1">System logs</h1>
          <p className="mt-0.5 text-[13px] text-text-2">
            Every action on the platform, as it happened. Read-only.
          </p>
        </div>
        {/* One flex group: the view switch sits IMMEDIATELY beside Refresh
            (T10) — not floating alone across the header. */}
        <div className="flex items-center gap-2">
          <SegmentedTabs
            tabs={VIEWS}
            value={view}
            onChange={(id) => pickView(id as LogsView)}
          />
          {/* Export belongs to the DATA, not to one view: it hands over every
              matched event with every column, from wherever you are standing. */}
          {/* And it exports what the screen SHOWS — engine rows included. An
              export that disagrees with the table it sits on is a second
              version of the truth. */}
          {shown > 0 && (
            <ExportMenu filename="system-logs" columns={EXPORT_COLUMNS} rows={merged} />
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-[13px] font-medium text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="mb-4 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a person, a name, an action…"
              className="h-9 w-full rounded-sm border border-border bg-surface pl-8 pr-8 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary"
            />
            {q && (
              <button
                onClick={() => setQ('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-1"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {WINDOWS.map((w) => (
            <button
              key={w.id}
              onClick={() => setDays(w.id)}
              className={cn(
                'h-9 rounded-sm border px-2.5 text-[12px] font-medium transition-colors',
                days === w.id
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-border bg-surface text-text-2 hover:bg-surface-2',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* THE SOURCE CHIPS, first in the row because they say what the feed
              IS before any chip narrows it. They toggle OFF (both on by
              default) — a filter you have to switch on to see everything is a
              filter that hides things from whoever never touched it.
              Engine rows carry no outcome and no area, so these two are hidden
              entirely while one of those chips is on: offering a toggle that
              can only ever match zero rows is worse than not offering it. */}
          {!outcome && !area && engineCount > 0 && (
            <>
              {SOURCES.map((s) => {
                const on = !hiddenSrc.has(s.id)
                return (
                  <button
                    key={s.id}
                    onClick={() => setHiddenSrc((prev) => {
                      const next = new Set(prev)
                      // never let the last one be switched off: an empty feed with every chip dark reads as…
                      if (next.has(s.id)) next.delete(s.id)
                      else if (next.size < SOURCES.length - 1) next.add(s.id)
                      return next
                    })}
                    title={s.id === 'engine'
                      ? 'Events the compliance engine wrote itself — the rows it mirrors from this log are not counted twice'
                      : 'Every action on the platform'}
                    className={cn(
                      'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-colors',
                      on ? `${s.tint} border-transparent` : 'border-border text-text-3 hover:bg-surface-2',
                    )}
                  >
                    {s.label}
                    {s.id === 'engine' && <span className="text-[10px] opacity-70">{engineCount}</span>}
                  </button>
                )
              })}
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            </>
          )}
          {/* Failures first: they are why somebody opens this screen. */}
          {(['failed', 'denied'] as const).map((o) => (
            <button
              key={o}
              onClick={() => setOutcome(outcome === o ? '' : o)}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold transition-colors',
                outcome === o ? OUTCOME[o].cls + ' border-transparent' : 'border-border text-text-2 hover:bg-surface-2',
              )}
            >
              {o === 'failed' ? <AlertTriangle size={11} /> : <ShieldOff size={11} />}
              {OUTCOME[o].label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          {(data?.areas ?? []).map((a) => (
            <button
              key={a.area}
              onClick={() => setArea(area === a.area ? '' : a.area)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors',
                area === a.area
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-border text-text-2 hover:bg-surface-2',
              )}
            >
              {a.area}
              <span className={cn('text-[10px]', area === a.area ? 'opacity-80' : 'text-text-3')}>{a.count}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-[12px] border border-border bg-tint-danger px-3 py-2.5 text-[13px] text-tint-fg-danger">
          {error}
        </div>
      )}

      {/* HALF A FEED SAYS SO. The engine trail lives in another spreadsheet and
          fails on its own; the platform log below is still whole, and a reader
          has to know which half is missing before they conclude anything from
          what is there. */}
      {!error && engineErr && (
        <div className="mb-3 rounded-[12px] border border-tint-amber bg-tint-amber/40 px-3 py-2.5 text-[13px] text-tint-fg-amber">
          {engineErr}
        </div>
      )}

      {!error && !loading && shown === 0 && (
        <p className="py-10 text-center text-[13px] text-text-2">
          {filtering
            ? 'Nothing matches those filters — the events are there, this view is just narrow.'
            : 'No events recorded yet.'}
        </p>
      )}

      {/* THE SHEET VIEW — the exact spreadsheet replica. One column set now:
          the replica's whole point is to show the tab as the tab is, and the
          Activity view is where a shorter reading already lives. */}
      {view === 'sheet' && shown > 0 && (
        <SheetEditor
          toolbar
          title="system_logs"
          columns={SHEET_COLUMNS}
          rows={pager.slice as unknown as Record<string, unknown>[]}
        />
      )}

      {/* The flat table — the retired import's one honest advantage */}
      {view === 'table' && shown > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
          <div className="border-b border-border px-3 py-2">
            <p className="text-[12px] font-semibold text-text-2">The tab as it is — {shown} rows in this window</p>
          </div>
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Who</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Record</th>
                  <th className="px-3 py-2">Area</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">Summary</th>
                </tr>
              </thead>
              <tbody>
                {pager.slice.map((ev) => (
                  <tr key={ev.key} className="border-b border-border/60 align-top last:border-0 hover:bg-surface-2">
                    <td className="whitespace-nowrap px-3 py-2 text-text-2">{ohioDayYear(ev.at)} {clockLabel(ev.at)}</td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold', SOURCE_META[ev.src].tint)}>
                        {SOURCE_META[ev.src].label}
                      </span>
                    </td>
                    <td className="max-w-[160px] px-3 py-2">
                      <DragPerson name={ev.actor_name || ev.actor || ''} id={ev.actor} subtitle={ev.area || undefined} className="block min-w-0">
                        <span className="clamp-1 block text-text-1" title={ev.actor}>{ev.actor_name || ev.actor || '—'}</span>
                      </DragPerson>
                    </td>
                    <td className="max-w-[150px] break-all px-3 py-2 font-mono text-[11px] text-text-2">{ev.action || '—'}</td>
                    <td className="max-w-[130px] break-all px-3 py-2 font-mono text-[11px] text-text-3">{ev.target || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-2">{ev.area || '—'}</td>
                    <td className="px-3 py-2">
                      {(() => {
                        // An engine event is not an attempt that passed — it is something that happened.
                        if (ev.src === 'engine') return <span className="text-text-3/60" title="An engine event carries no outcome">—</span>
                        const bad = OUTCOME[ev.outcome as keyof typeof OUTCOME]
                        return bad
                          ? <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold', bad.cls)}><bad.Icon size={10} />{bad.label}</span>
                          : <span className="text-text-3">ok</span> })()}
                    </td>
                    <td className="max-w-[320px] px-3 py-2">
                      <span className="clamp-2 block text-text-2" title={ev.detail || ev.summary}>{ev.summary || '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* The feed */}
      {view === 'activity' && <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.day}>
            <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">{g.day}</h2>
            <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
              {g.events.map((ev, i) => {
                const key = ev.key
                const bad = OUTCOME[ev.outcome as keyof typeof OUTCOME]
                const isOpen = open === key
                return (
                  <div key={key} className={cn('px-3 py-2.5', i > 0 && 'border-t border-border')}>
                    <div className="flex items-start gap-2.5">
                      {/* A person always arrives with a face — and the face is
                          the only handle here, the sentence beside it is prose. */}
                      <DragPerson name={ev.actor_name || ev.actor || ''} id={ev.actor} subtitle={ev.area || undefined} className="mt-0.5 shrink-0">
                        <Avatar name={ev.actor_name || ev.actor || '?'} size="xs" />
                      </DragPerson>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-5 text-text-1">{ev.summary}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-3">
                          <span>{clockLabel(ev.at)}</span>
                          {/* The badge is drawn only for the ENGINE. Labelling
                              every platform row "Platform" would put a chip on
                              99% of the feed to distinguish the 1% — the odd
                              one out is the one worth naming. */}
                          {ev.src === 'engine' && (
                            <span className={cn('inline-flex rounded-full px-1.5 py-0.5 font-semibold', SOURCE_META.engine.tint)}>
                              {SOURCE_META.engine.label}
                            </span>
                          )}
                          {ev.area && <span>· {ev.area}</span>}
                          {bad && (
                            <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold', bad.cls)}>
                              <bad.Icon size={10} />
                              {bad.label}
                            </span>
                          )}
                        </div>
                      </div>
                      {(ev.action || ev.target || ev.detail) && (
                        <button
                          onClick={() => setOpen(isOpen ? null : key)}
                          aria-label={isOpen ? 'Hide the raw record' : 'Show the raw record'}
                          className="mt-0.5 shrink-0 rounded-sm p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                        >
                          <ChevronDown size={14} className={cn('transition-transform', isOpen && 'rotate-180')} />
                        </button>
                      )}
                    </div>
                    {/* Underneath, never instead: the ids are what you need
                        when the sentence is not enough. */}
                    {isOpen && (
                      <dl className="ml-[34px] mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-[10px] bg-surface-2 px-2.5 py-2 text-[11px]">
                        <dt className="text-text-3">action</dt>
                        <dd className="break-all font-mono text-text-2">{ev.action || '—'}</dd>
                        <dt className="text-text-3">record</dt>
                        <dd className="break-all font-mono text-text-2">{ev.target || '—'}</dd>
                        <dt className="text-text-3">account</dt>
                        <dd className="break-all text-text-2">{ev.actor || '—'}</dd>
                        {ev.detail && (
                          <>
                            <dt className="text-text-3">detail</dt>
                            <dd className="whitespace-pre-wrap break-words text-text-2">{ev.detail}</dd>
                          </>
                        )}
                      </dl>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>}

      {/* No silent caps: a truncated view that does not say so is a view that
          lies about what happened. */}
      {shown > 0 && (
        <>
          <Pager {...pager} onPage={pager.setPage} noun="events" className="mt-4" />
          <p className="mt-2 text-center text-[11px] text-text-3">
            {shown} matched{data && data.total > shown ? ` of ${data.total} recorded` : ''}
            {shown >= 400 ? ' — the newest 400 match; narrow the window or the filters to see further back.' : ''}
          </p>
        </>
      )}
    </motion.div>
  )
}
