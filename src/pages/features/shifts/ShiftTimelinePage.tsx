// Shift Board · Timeline — day-level gantt (reference c).
// Toggle "By House / By Employee", week navigation + date select, hour axis 00→23.
import { useMemo, useState } from 'react'
import { addDays, format, startOfWeek } from 'date-fns'
import { ohioWall } from '@/lib/ohio'
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { ROSTER_DAYS } from '@/lib/seed-shifts2'
import { writePersonDrag } from '@/lib/focus'
import { useDragFocusEnabled } from '@/lib/dragFocus'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import PageHeader from '@/components/shared/PageHeader'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import EmptyState from '@/components/shared/EmptyState'
import { KIND_TINT } from './shiftUi'
import { TINT_BG_VAR, TINT_VAR } from '@/lib/tints'
import { useShiftData, type TimelineEntry } from './useShiftData'
import StaleRosterNote from './StaleRosterNote'
import ClockTimesToggle from './ClockTimesToggle'
import { useClockTimes } from './clockPref'
import { hourText } from './cellClock'
import { cn } from '@/lib/utils'

type Mode = 'house' | 'employee'

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const satStart = (d: Date) => startOfWeek(d, { weekStartsOn: 6 })

function Bar({
  entry,
  houseLabel,
  mode,
  dragEnabled,
  clock,
}: {
  entry: TimelineEntry
  houseLabel: string
  mode: Mode
  dragEnabled: boolean
  clock: boolean
}) {
  const start = Math.max(0, Math.min(23.9, entry.startHour))
  const end = Math.max(start + 0.5, Math.min(24, entry.endHour))
  const left = (start / 24) * 100
  const width = ((end - start) / 24) * 100
  const lead = mode === 'house' ? entry.staffName : houseLabel
  const label = [lead, entry.clientName].filter(Boolean).join(' - ')
  const tint = KIND_TINT[entry.kind]
  // The bar's own hours, spelled from the MINUTES the roster counted — an `815A` start is 8:15, and a timeline that…
  const fmt = (h: number) => hourText(h, clock)
  const tip = `${label} · ${fmt(entry.startHour)} → ${entry.endHour > 24 ? `+${fmt(entry.endHour)}` : fmt(entry.endHour)}`
  return (
    <div
      className="absolute top-1 flex h-7 items-center overflow-hidden rounded-sm border-l-[3px] px-1.5"
      style={{
        left: `${left}%`,
        width: `${width}%`,
        backgroundColor: TINT_BG_VAR[tint === 'slate' ? 'slate' : tint],
        borderLeftColor: tint === 'primary' ? 'var(--primary)' : TINT_VAR[tint],
      }}
      title={tip}
    >
      <span className="truncate font-mono text-[10.5px] font-semibold text-text-1">
        {/* by house the lead is the staff member; by employee it is the house, which never drags */}
        <DragPerson
          name={dragEnabled && mode === 'house' ? entry.staffName : ''}
          subtitle={houseLabel}
          title={tip}
        >
          {lead}
        </DragPerson>
        {lead && entry.clientName ? ' - ' : ''}
        {/* type client: the timeline names the consumer this shift covers */}
        <DragPerson
          name={dragEnabled ? entry.clientName : ''}
          type="client"
          subtitle={houseLabel}
          title={tip}
        >
          {entry.clientName}
        </DragPerson>
      </span>
    </div>
  )
}

export default function ShiftTimelinePage({ embedded = false }: { embedded?: boolean }) {
  const { timeline, houseLookup, loading, stale, error, reload } = useShiftData()
  const dragEnabled = useDragFocusEnabled('shiftboard')
  const [mode, setMode] = useState<Mode>('house')
  /** The same Time switch the grids answer to — here it spells the tooltip. */
  const clock = useClockTimes()
  const [weekStart, setWeekStart] = useState(() => satStart(ohioWall(new Date()) as Date))
  const [dayIdx, setDayIdx] = useState(() => {
    // default to today — OHIO's today; it always falls inside the current SAT-start week
    const today = ohioWall(new Date()) as Date
    return Math.round((today.getTime() - satStart(today).getTime()) / 86400000) % 7
  })

  const houseLabel = (e: TimelineEntry) =>
    houseLookup(e.houseId)?.name ?? e.houseName ?? e.houseCode

  const dayISO = iso(addDays(weekStart, dayIdx))
  const entries = useMemo(() => timeline.filter((e) => e.date === dayISO), [timeline, dayISO])

  // Clamp week navigation to where the data actually is.
  const dataRange = useMemo(() => {
    let min = '', max = ''
    for (const e of timeline) {
      if (!min || e.date < min) min = e.date
      if (!max || e.date > max) max = e.date
    }
    return { min, max }
  }, [timeline])
  const canPrev = !!dataRange.min && iso(addDays(weekStart, -1)) >= dataRange.min
  const canNext = !!dataRange.max && iso(addDays(weekStart, 6)) < dataRange.max

  const rows = useMemo(() => {
    const key = (e: TimelineEntry) => (mode === 'house' ? e.houseId : e.staffName)
    const label = (e: TimelineEntry) => (mode === 'house' ? houseLabel(e) : e.staffName)
    const sub = (e: TimelineEntry) => (mode === 'house' ? e.houseId : '')
    const m = new Map<string, { label: string; sub: string; entries: TimelineEntry[] }>()
    for (const e of entries) {
      const k = key(e)
      const row = m.get(k) ?? { label: label(e), sub: sub(e), entries: [] }
      row.entries.push(e)
      m.set(k, row)
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, mode, houseLookup])

  if (error) return <EmptyState title="The roster did not load" body={error} />
  if (loading) return <EmptyState title="Loading the roster…" body="Serving the latest schedule." />

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="Shift Timeline"
          subtitle="Hour-by-hour coverage across houses and staff"
          actions={
            <button
              onClick={reload}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
            >
              <RefreshCw size={14} /> Refresh
            </button>
          }
        />
      )}

      {stale && <StaleRosterNote />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedTabs
          tabs={[
            { id: 'house', label: 'By House' },
            { id: 'employee', label: 'By Employee' },
          ]}
          value={mode}
          onChange={(id) => setMode(id as Mode)}
        />
        <div className="flex items-center overflow-hidden rounded-sm border border-border bg-surface">
          <button
            onClick={() => canPrev && setWeekStart((w) => addDays(w, -7))}
            disabled={!canPrev}
            aria-label="Previous week"
            className="grid h-9 w-9 place-items-center text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={15} />
          </button>
          <label className="flex h-9 items-center gap-2 border-x border-border px-3">
            <CalendarDays size={14} className="shrink-0 text-text-3" />
            <select
              value={dayIdx}
              onChange={(e) => setDayIdx(Number(e.target.value))}
              className="bg-transparent text-[13px] text-text-1 outline-none"
              aria-label="Roster day"
            >
              {ROSTER_DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d} · {format(addDays(weekStart, i), 'MMM d')}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => canNext && setWeekStart((w) => addDays(w, 7))}
            disabled={!canNext}
            aria-label="Next week"
            className="grid h-9 w-9 place-items-center text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight size={15} />
          </button>
        </div>
        {/* the switch lives on every Shift Board tab, so whoever pressed it
            can find it again on the tab where the times are being read */}
        <ClockTimesToggle className="rounded-sm" />
        <span className="font-mono text-[11px] text-text-3">
          {entries.length} SHIFTS · {rows.length} {mode === 'house' ? 'HOUSES' : 'STAFF'}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No shifts this day" body="Pick another day or another week." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <div className="min-w-[920px]">
            {/* hour axis */}
            <div className="flex border-b border-border bg-surface-2">
              <div className="w-48 shrink-0 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                {mode === 'house' ? 'House' : 'Employee'}
              </div>
              <div className="relative flex-1">
                <div className="flex">
                  {HOURS.map((h) => (
                    <div key={h} className="flex-1 border-l border-border px-1 py-2 first:border-l-0">
                      <span className="font-mono text-[9.5px] text-text-3">{String(h).padStart(2, '0')}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* rows */}
            {rows.map((row, ri) => (
              <div key={row.label} className={cn('flex border-b border-border last:border-b-0', ri % 2 === 1 && 'bg-surface-2/40')}>
                <div
                  className={cn(
                    'flex w-48 shrink-0 items-center gap-2 px-3 py-1.5',
                    mode === 'employee' && dragEnabled && 'cursor-grab active:cursor-grabbing',
                  )}
                  draggable={mode === 'employee' && dragEnabled}
                  onDragStart={(e) =>
                    mode === 'employee' &&
                    dragEnabled &&
                    writePersonDrag(e.dataTransfer, {
                      type: 'staff',
                      id: row.label,
                      name: row.label,
                      subtitle: 'Direct Support Pro',
                    })
                  }
                  title={
                    mode === 'employee' && dragEnabled
                      ? 'Drag onto the top-left corner to focus the platform on this person'
                      : undefined
                  }
                >
                  {mode === 'employee' && <Avatar name={row.label} size="xs" className="shrink-0" />}
                  <div className="flex min-w-0 flex-col justify-center">
                    <span className="truncate text-[13px] font-medium text-text-1">{row.label}</span>
                    {row.sub && <span className="truncate font-mono text-[10px] text-text-3">{row.sub}</span>}
                  </div>
                </div>
                <div className="relative h-9 flex-1">
                  {/* gridlines */}
                  <div className="pointer-events-none absolute inset-0 flex">
                    {HOURS.map((h) => (
                      <div key={h} className="flex-1 border-l border-border/60 first:border-l-0" />
                    ))}
                  </div>
                  {row.entries.map((e) => (
                    <Bar
                      key={e.id}
                      entry={e}
                      houseLabel={houseLabel(e)}
                      mode={mode}
                      dragEnabled={dragEnabled}
                      clock={clock}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
