// Overtime — each employee's worked hours per Sunday–Saturday week, from PsiAnywhere's record, summed across every
// house, over 40 h highlighted. No screen in the Hub listed this before: Scheduling only warned about one house's
// PLANNED hours, on its own Saturday weeks. The weeks are PsiAnywhere's halves of a pay period, and each week's hours
// are the WHOLE week's even when the dates picked cut it (overtime is a week's fact, not a range's) — the lane says so
// with `inRange` beside `total`. A row opens the person's days and the entries behind them in the right panel.
// The tab answers to its own App Control row (time-recon.overtime): with no row, the master's alone.
import { useEffect, useMemo, useState } from 'react'
import { Loader2, MapPin, Users } from 'lucide-react'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import SidePanel from '@/components/shared/SidePanel'
import DragPerson from '@/components/shared/DragPerson'
import { relayLane } from '@/lib/noticesApi'
import { cn } from '@/lib/utils'
import EmployeePicker from './EmployeePicker'
import {
  consumerList, daySpan, daysBetween, hoursLabel, PSI_STATUS, timeLabel, weekdayLabel,
  type OvertimeData, type OvertimeEntries, type OvertimeEntry, type OvertimePerson, type PayWeek, type ReconEmployee,
} from './reconTypes'
import { entryRanges, OVERTIME_MAX_DAYS as MAX_DAYS, useOpenPerson } from './reconState'

const LANE = '/hub-lanes/time-recon/overtime'

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)
/** '10/25 – 10/31' — a week column's head, where the year only takes room */
const weekHead = (w: PayWeek): string => `${w.from.slice(5, 7)}/${w.from.slice(8, 10)} – ${w.to.slice(5, 7)}/${w.to.slice(8, 10)}`
const openCount = (p: OvertimePerson): number => (typeof p.open === 'number' ? p.open : p.open ? 1 : 0)

/** The lane's answer with every list a list — a missing key draws as empty, never as a crash. */
function shaped(d: OvertimeData | null | undefined): OvertimeData {
  const x = (d ?? {}) as Partial<OvertimeData>
  return {
    from: String(x.from ?? ''),
    to: String(x.to ?? ''),
    threshold: num(x.threshold) || 40,
    weeks: arr<PayWeek>(x.weeks),
    people: arr<OvertimePerson>(x.people).map((p) => ({
      ...p, weeks: arr(p.weeks), days: p.days && typeof p.days === 'object' ? p.days : {},
      total: num(p.total), inRange: num(p.inRange), overtime: num(p.overtime),
    })),
    totals: {
      people: num(x.totals?.people), peopleOver: num(x.totals?.peopleOver),
      overtimeHours: num(x.totals?.overtimeHours), hours: num(x.totals?.hours),
    },
    periods: arr(x.periods),
    employees: arr<ReconEmployee>(x.employees),
  }
}

export default function OvertimeTab({
  from,
  to,
  rangeOk,
  fallbackEmployees,
  reloadKey,
}: {
  from: string
  to: string
  /** the dates read at all — when they are not, the page's filter card says so beside them; nothing is read here */
  rangeOk: boolean
  /** /periods' people, until this lane names everyone with hours in its weeks */
  fallbackEmployees: ReconEmployee[]
  reloadKey: number
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [onlyOver, setOnlyOver] = useState(true)
  const [data, setData] = useState<OvertimeData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // the open row by its key, looked up in every new answer: the panel always draws the answer on screen
  const { open, setOpenKey } = useOpenPerson(data?.people ?? null)

  const span = daySpan(from, to)
  const tooLong = span > MAX_DAYS
  const pickedKey = picked.join(',')

  useEffect(() => {
    if (!rangeOk || tooLong) return
    let alive = true
    const t = window.setTimeout(async () => {
      setBusy(true)
      try {
        const qs = new URLSearchParams({ from, to })
        if (pickedKey) qs.set('employees', pickedKey)
        const got = await relayLane<OvertimeData>(`${LANE}?${qs}`)
        if (!alive) return
        setData(shaped(got))
        setError('')
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Overtime could not be read.')
      } finally {
        if (alive) setBusy(false)
      }
    }, 250)
    return () => { alive = false; window.clearTimeout(t) }
  }, [from, to, pickedKey, rangeOk, tooLong, reloadKey])

  const employees = data?.employees.length ? data.employees : fallbackEmployees
  const threshold = data?.threshold ?? 40
  const rows = useMemo(() => {
    const list = (data?.people ?? []).filter((p) => !onlyOver || p.overtime > 0 || p.weeks.some((w) => w.over))
    return list.sort((a, b) => b.overtime - a.overtime || b.total - a.total || a.employeeName.localeCompare(b.employeeName))
  }, [data, onlyOver])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <EmployeePicker multi employees={employees} value={picked} onChange={setPicked} />
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 text-[13px] text-text-1">
          <input
            type="checkbox" checked={onlyOver} onChange={(e) => setOnlyOver(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--primary)]"
          />
          Only over {threshold} h
        </label>
        {busy && <Loader2 size={15} className="animate-spin text-text-3" />}
        {data && (
          <p className="ml-auto text-[12.5px] text-text-3">
            <span className="font-semibold text-text-1">{data.totals.peopleOver}</span> of {data.totals.people}{' '}
            {data.totals.people === 1 ? 'person' : 'people'} over {threshold} h ·{' '}
            <span className="font-semibold text-text-1">{hoursLabel(data.totals.overtimeHours)}</span> overtime ·{' '}
            {hoursLabel(data.totals.hours)} worked
          </p>
        )}
      </div>

      {!rangeOk ? null : tooLong ? (
        <p className="rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12.5px] text-tint-fg-amber">
          Overtime reads up to {MAX_DAYS} days at a time — these dates span {span}. Pick a pay period or a shorter range.
        </p>
      ) : error ? (
        <p className="rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{error}</p>
      ) : null}

      {rangeOk && !tooLong && (
        !data ? (
          error ? null : <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>
        ) : rows.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              title={onlyOver ? `Nobody over ${threshold} h` : 'No hours in these weeks'}
              body={onlyOver
                ? `No one${picked.length ? ' picked' : ''} worked more than ${threshold} h in any week of these dates. Turn off "Only over ${threshold} h" to see everyone's hours.`
                : 'PsiAnywhere holds no worked entry for these people in these weeks.'}
            />
          </Card>
        ) : (
          <Card padded={false} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-2/50 text-left text-[11.5px] font-semibold uppercase tracking-[0.06em] text-text-3">
                    <th className="px-4 py-2.5">Employee</th>
                    {data.weeks.map((w) => (
                      <th key={w.from} className="px-3 py-2.5 text-right" title={`Week ${w.label}`}>{weekHead(w)}</th>
                    ))}
                    <th className="px-3 py-2.5 text-right">Total</th>
                    <th className="px-4 py-2.5 text-right">Overtime</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const byWeek = new Map(p.weeks.map((w) => [w.from, w]))
                    const openN = openCount(p)
                    return (
                      <tr
                        key={p.key}
                        tabIndex={0}
                        onClick={() => setOpenKey(p.key)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenKey(p.key) } }}
                        className={cn(
                          'cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none',
                          open?.key === p.key && 'bg-tint-blue',
                        )}
                      >
                        <td className="px-4 py-2.5">
                          <span className="font-semibold text-text-1">{p.employeeName || 'Unknown employee'}</span>
                          {openN > 0 && (
                            <span className="ml-2 text-[11.5px] text-text-3" title="Entries with no clock-out: their hours are not counted yet">
                              {openN} open
                            </span>
                          )}
                        </td>
                        {data.weeks.map((w) => {
                          const cell = byWeek.get(w.from)
                          const h = num(cell?.hours)
                          const over = cell?.over ?? h > threshold
                          return (
                            <td key={w.from} className="px-3 py-2.5 text-right tabular-nums">
                              {h ? (
                                <span
                                  title={over ? `${hoursLabel(cell?.overtime ?? h - threshold)} over ${threshold} h` : undefined}
                                  className={cn('rounded-sm px-1.5 py-0.5', over ? 'bg-tint-amber font-semibold text-tint-fg-amber' : 'text-text-2')}
                                >
                                  {hoursLabel(h)}
                                </span>
                              ) : <span className="text-text-3">—</span>}
                            </td>
                          )
                        })}
                        <td
                          className="px-3 py-2.5 text-right tabular-nums text-text-1"
                          title={p.inRange !== p.total ? `${hoursLabel(p.inRange)} inside the dates picked` : undefined}
                        >
                          {hoursLabel(p.total)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {p.overtime > 0
                            ? <span className="font-bold text-tint-fg-amber">{hoursLabel(p.overtime)}</span>
                            : <span className="text-text-3">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-4 py-2 text-[12px] text-text-3">
              Weeks run Sunday to Saturday and count the whole week, even days outside the dates picked. Hours are
              PsiAnywhere’s worked entries (pending, awaiting approval, submitted, imported) across every house.
            </p>
          </Card>
        )
      )}

      {open && data && (
        <PersonPanel key={open.key} person={open} weeks={data.weeks} threshold={threshold} onClose={() => setOpenKey('')} />
      )}
    </div>
  )
}

/** One person's weeks, their days and the PsiAnywhere entries behind them. */
function PersonPanel({ person, weeks, threshold, onClose }: {
  person: OvertimePerson
  weeks: PayWeek[]
  threshold: number
  onClose: () => void
}) {
  // The whole weeks drawn, read in runs of at most the lane's 62 days: dates of 61 days can touch 63 days of weeks, and
  // one read over them was refused. Each answer is kept with the reads it answers, so a new answer's weeks show their
  // skeleton — never the old weeks' entries — until their own entries land.
  const reads = entryRanges(weeks).map((r) => `${r.from}..${r.to}`).join(',')
  const want = `${person.key}|${reads}`
  const [got, setGot] = useState<{ want: string; entries: OvertimeEntries['entries'] | null; failed: string }>(
    { want: '', entries: null, failed: '' },
  )

  useEffect(() => {
    let alive = true
    const ranges = reads ? reads.split(',').map((r) => r.split('..')) : []
    Promise.all(ranges.map(([from, to]) => {
      const qs = new URLSearchParams({ employee: person.key, from, to })
      return relayLane<OvertimeEntries>(`${LANE}/entries?${qs}`)
    }))
      .then((all) => { if (alive) setGot({ want, entries: all.flatMap((a) => arr<OvertimeEntry>(a?.entries)), failed: '' }) })
      .catch((e) => {
        if (alive) setGot({ want, entries: null, failed: e instanceof Error ? e.message : 'The entries could not be read.' })
      })
    return () => { alive = false }
  }, [person.key, reads, want])

  const entries = got.want === want ? got.entries : null
  const failed = got.want === want ? got.failed : ''

  const byWeek = new Map(person.weeks.map((w) => [w.from, w]))
  const byDay = useMemo(() => {
    const m = new Map<string, OvertimeEntries['entries']>()
    for (const e of entries ?? []) {
      if (!m.has(e.date)) m.set(e.date, [])
      m.get(e.date)!.push(e)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [entries])
  const openN = openCount(person)

  return (
    <SidePanel
      open
      onClose={onClose}
      label="Overtime"
      title={
        <DragPerson name={person.employeeName} id={person.employeeId || undefined}>
          <span>{person.employeeName || 'Unknown employee'}</span>
        </DragPerson>
      }
    >
      <p className="mt-0.5 text-[13px] text-text-3">
        {hoursLabel(person.total)} in these weeks
        {person.overtime > 0 ? <> · <span className="font-semibold text-tint-fg-amber">{hoursLabel(person.overtime)} overtime</span></> : ''}
        {person.inRange !== person.total ? ` · ${hoursLabel(person.inRange)} inside the dates picked` : ''}
      </p>
      {openN > 0 && (
        <p className="mt-2 rounded-md bg-tint-amber px-3 py-2 text-[12.5px] text-tint-fg-amber">
          {openN} entr{openN === 1 ? 'y has' : 'ies have'} no clock-out yet — {openN === 1 ? 'its' : 'their'} hours are not counted.
        </p>
      )}

      <div className="mt-4 space-y-3">
        {weeks.map((w) => {
          const wk = byWeek.get(w.from)
          const h = num(wk?.hours)
          const over = wk?.over ?? h > threshold
          return (
            <div key={w.from} className="rounded-lg border border-border bg-surface">
              <div className={cn('flex items-center justify-between gap-2 border-b border-border px-3 py-2', over && 'bg-tint-amber')}>
                <span className={cn('text-[12.5px] font-semibold', over ? 'text-tint-fg-amber' : 'text-text-2')}>Week {w.label}</span>
                <span className={cn('text-[13px] font-semibold tabular-nums', over ? 'text-tint-fg-amber' : 'text-text-1')}>
                  {hoursLabel(h)}{over ? ` · ${hoursLabel(wk?.overtime ?? h - threshold)} over` : ''}
                </span>
              </div>
              <ul className="px-3 py-1.5">
                {daysBetween(w.from, w.to).map((d) => {
                  const dh = num(person.days[d])
                  return (
                    <li key={d} className="flex items-center justify-between py-0.5 text-[13px]">
                      <span className={dh ? 'text-text-1' : 'text-text-3'}>{weekdayLabel(d)}</span>
                      <span className={cn('tabular-nums', dh ? 'text-text-1' : 'text-text-3')}>{dh ? hoursLabel(dh) : '—'}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>

      <p className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-[0.07em] text-text-3">PsiAnywhere entries</p>
      {failed ? (
        <p className="rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{failed}</p>
      ) : !entries ? (
        <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
      ) : byDay.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-text-3">No entry in these weeks.</p>
      ) : (
        <div className="space-y-3">
          {byDay.map(([d, list]) => (
            <div key={d}>
              <p className="mb-1 px-1 text-[12.5px] font-semibold text-text-2">{weekdayLabel(d)}</p>
              <ul className="space-y-1.5">
                {list.map((e, i) => {
                  const consumers = consumerList(e.consumers)
                  const status = String(e.status ?? '').toUpperCase()
                  return (
                    <li key={`${d}|${e.startTime}|${i}`} className="rounded-md border border-border bg-surface px-3 py-2 text-[13px]">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-semibold tabular-nums text-text-1">
                          {timeLabel(e.startTime) || '?'} – {timeLabel(e.endTime) || 'open'}
                        </span>
                        <span className="tabular-nums text-text-2">{hoursLabel(e.hours)}</span>
                        {e.workCode && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-text-2">{e.workCode}</span>}
                        {status && <span className="ml-auto text-[11.5px] text-text-3">{PSI_STATUS[status] ?? status}</span>}
                      </div>
                      {(e.location || e.site) && (
                        <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-text-3">
                          <MapPin size={12} className="shrink-0" />
                          {[e.location, e.site].filter(Boolean).filter((v, k, a) => a.indexOf(v) === k).join(' · ')}
                        </p>
                      )}
                      {consumers.length > 0 && (
                        <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-text-3">
                          <Users size={12} className="shrink-0" />
                          {consumers.join(', ')}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SidePanel>
  )
}
