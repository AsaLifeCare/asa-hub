/** The last roster the platform built (the slices), read-only, drawn when the live calendar does not answer. */
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, History, Loader2 } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { ROSTER_DAYS } from '@/lib/seed-shifts2'
import { useDragFocusEnabled } from '@/lib/dragFocus'
import { ohioDateTime, ohioToday } from '@/lib/ohio'
import { sliceAgeMs } from '@/lib/snapshotClient'
import { cn } from '@/lib/utils'
import { cellText } from './cellClock'
import ClockTimesToggle from './ClockTimesToggle'
import { useClockTimes } from './clockPref'
import { publishedLine } from './publishedMark'
import { cellTint } from './shiftUi'
import { houseCode, houseShort, weekKeyOf } from './houseCalTypes'
import { useShiftData, type MatrixCell } from './useShiftData'
import { lastRosterNote, withoutAbsences } from '@/pages/features/calendarbuilder/calendarScreen'

const DAY_MS = 86_400_000

function plusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1) + n * DAY_MS).toISOString().slice(0, 10)
}


export default function LastRosterWeek({ location, why, seesCallers = false, onPick }: {
  /** the house the live door failed for: full location, code or short name; '' when the rail is down too */
  location: string
  /** the live door's own words */
  why: string
  /** the relay said this reader edits the house; nobody else sees who called off or did not show */
  seesCallers?: boolean
  /** the rail is down too: the slices' own houses are picked here */
  onPick?: (house: string) => void
}) {
  const { matrix, houses, loading, stale, error } = useShiftData()
  const clock = useClockTimes()
  const dragNames = useDragFocusEnabled('calendarbuilder')
  const code = houseCode(location)
  const short = houseShort(location).toUpperCase()
  const named = location ? houses.find((h) => h.id.toUpperCase() === code || h.code.toUpperCase() === code
    || h.name.toUpperCase() === short) : undefined
  // with no house named (the rail is down too), the first the slices hold
  const house = named ?? (!location && onPick ? houses[0] : undefined)
  const cells = useMemo(() => withoutAbsences(house ? matrix.filter((c) => c.houseId === house.id) : [], seesCallers),
    [matrix, house, seesCallers])
  const range = useMemo(() => {
    let min = ''
    let max = ''
    for (const c of cells) {
      if (!min || c.date < min) min = c.date
      if (!max || c.date > max) max = c.date
    }
    return { min: min ? weekKeyOf(min) : '', max }
  }, [cells])
  const [picked, setPicked] = useState('')
  const today = weekKeyOf(ohioToday())
  // this week, kept inside what the slices hold
  const week = picked || (range.min && today < range.min ? range.min
    : range.max && today > range.max ? weekKeyOf(range.max) : today)
  const days = Array.from({ length: 7 }, (_, i) => plusDays(week, i))
  const canPrev = Boolean(range.min) && week > range.min
  const canNext = Boolean(range.max) && days[6] < range.max
  const rows = useMemo(() => {
    const by = new Map<string, (MatrixCell | null)[]>()
    for (const c of cells) {
      const i = days.indexOf(c.date)
      if (i < 0) continue
      const slots = by.get(c.staffName) ?? Array<MatrixCell | null>(7).fill(null)
      slots[i] = c
      by.set(c.staffName, slots)
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    // `days` is derived from `week`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, week])
  const age = sliceAgeMs('shiftMatrix')
  const stamp = age === null ? '' : ohioDateTime(new Date(Date.now() - age))

  return (
    <div className="p-3">
      <p className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px] leading-5 text-text-2">
        <History size={13} className="mt-1 shrink-0 text-text-3" />
        {lastRosterNote(why, stamp, stale)}
      </p>
      {onPick && houses.length > 0 && (
        <label className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-text-2">
          House
          <select value={house?.name ?? ''} onChange={(e) => onPick(e.target.value)}
            className="h-8 rounded-md border border-border bg-surface px-2 text-[12.5px] font-normal text-text-1">
            {houses.map((h) => <option key={h.id} value={h.name}>{h.name}</option>)}
          </select>
        </label>
      )}
      {error ? (
        <p className="p-6 text-center text-[13px] text-text-3">The roster did not load — {error}</p>
      ) : loading ? (
        <p className="flex items-center justify-center gap-2 p-6 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the last roster…
        </p>
      ) : !house ? (
        <p className="p-6 text-center text-[13px] text-text-3">
          {location ? `${houseShort(location) || location} is not on the last roster the platform built.`
            : 'The last roster the platform built holds no house.'}
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" aria-label="Previous week" disabled={!canPrev} onClick={() => setPicked(plusDays(week, -7))}
              className="grid h-8 w-8 place-items-center rounded-md border border-border bg-surface text-text-2 disabled:opacity-40">
              <ChevronLeft size={15} />
            </button>
            <span className="text-[13px] font-semibold text-text-1">{days[0]} – {days[6]}</span>
            <button type="button" aria-label="Next week" disabled={!canNext} onClick={() => setPicked(plusDays(week, 7))}
              className="grid h-8 w-8 place-items-center rounded-md border border-border bg-surface text-text-2 disabled:opacity-40">
              <ChevronRight size={15} />
            </button>
            <span className="ml-auto flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[11px] text-text-3">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" /> Published on the platform
              </span>
              <ClockTimesToggle className="h-8 text-[12.5px]" />
            </span>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-semibold text-text-2">Staff</th>
                  {days.map((d, i) => (
                    <th key={d} className={cn('px-2 py-2 text-left font-semibold text-text-3', clock ? 'min-w-[152px]' : 'min-w-[92px]')}>
                      {ROSTER_DAYS[i]} {d.slice(5).replace('-', '/')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([name, slots]) => (
                  <tr key={name} className="border-b border-border">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 font-medium text-text-1">
                      <span className="flex items-center gap-1.5">
                        <Avatar name={name} size="xs" className="h-5 w-5 shrink-0 text-[9px]" />
                        {dragNames ? <DragPerson name={name} subtitle={house.name}>{name}</DragPerson> : name}
                      </span>
                    </td>
                    {slots.map((c, i) => (
                      <td key={i} className="p-0.5">
                        <span title={c ? [c.code, publishedLine(c.published)].filter(Boolean).join(' · ') : undefined}
                          className={cn('relative flex min-h-9 items-center justify-center rounded-[9px] px-1.5 text-center',
                            clock ? 'min-w-[148px]' : 'min-w-[88px] font-mono max-sm:min-w-[68px]', c ? cellTint(c.kind) : 'text-text-3')}>
                          {c ? cellText(c.code, clock) : '·'}
                          {/* published on the platform, the workbook's copy not caught up yet */}
                          {c?.published && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-success" />}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-[12.5px] text-text-3">
                    Nobody on the last roster at {house.name} this week.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
