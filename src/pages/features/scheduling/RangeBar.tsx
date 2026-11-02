/** The range bar: one Saturday week or the whole period, the week either side (past the period's edge, the period
 * either side), This week, and the Time switch. */
import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { rangeLabel } from '@/pages/features/calendarbuilder/calendarScreen'
import type { Drawn, SchedRange } from './schedulingModel'

export default function RangeBar({
  days, weeks, week, range, thisWeek, onWeek, onRange, time, weekOnly = false, onPrevPeriod, onNextPeriod, end,
}: {
  days: Drawn
  /** the Saturdays the period spans */
  weeks: string[]
  week: string
  range: SchedRange
  /** Ohio's week, or null when the period does not draw today */
  thisWeek: string | null
  /** a week to draw; `range` when the press also asks for the week range (This week) */
  onWeek: (week: string, range?: SchedRange) => void
  onRange: (range: SchedRange) => void
  time: ReactNode
  /** a phone draws one week only */
  weekOnly?: boolean
  /** the period either side, when there is one */
  onPrevPeriod?: () => void
  onNextPeriod?: () => void
  /** drawn at the bar's far end (the master's reload) */
  end?: ReactNode
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const at = weeks.indexOf(week)
  const byWeek = range === 'week'
  const prev = byWeek && at > 0 ? weeks[at - 1] : ''
  const next = byWeek && at >= 0 && at < weeks.length - 1 ? weeks[at + 1] : ''
  const goPrev = prev ? () => onWeek(prev) : onPrevPeriod
  const goNext = next ? () => onWeek(next) : onNextPeriod
  const btn = 'flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5" data-range-bar="">
      <button type="button" className={cn(btn, 'w-8 justify-center px-0')} aria-label={prev ? 'Previous week' : 'Previous period'}
        disabled={!goPrev} onClick={() => goPrev?.()}>
        <ChevronLeft size={15} />
      </button>
      <span className="min-w-[120px] text-center text-[13px] font-semibold text-text-1">{rangeLabel(days)}</span>
      <button type="button" className={cn(btn, 'w-8 justify-center px-0')} aria-label={next ? 'Next week' : 'Next period'}
        disabled={!goNext} onClick={() => goNext?.()}>
        <ChevronRight size={15} />
      </button>
      <button type="button" className={btn} disabled={!thisWeek}
        title={thisWeek ? 'The week that holds today, in Ohio' : 'This period does not draw today'}
        onClick={() => { if (thisWeek) onWeek(thisWeek, 'week') }}>
        This week
      </button>
      {!weekOnly && (
        <span role="group" aria-label="Range" className="inline-flex overflow-hidden rounded-md border border-border">
          {(['week', 'period'] as const).map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => onRange(r)}
              className={cn('h-8 px-3 text-[12.5px]',
                range === r ? 'bg-surface-3 font-semibold text-text-1' : 'bg-surface text-text-2 hover:bg-surface-2')}>
              {r === 'week' ? 'Week' : 'Period'}
            </button>
          ))}
        </span>
      )}
      <span className="hidden sm:contents">{time}</span>
      <span className="relative sm:hidden">
        <button type="button" className={cn(btn, 'w-8 justify-center px-0')} aria-label="More" aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}>
          <MoreHorizontal size={15} />
        </button>
        {moreOpen && (
          <span className="absolute right-0 top-full z-20 mt-1 flex rounded-md border border-border bg-surface p-1.5 shadow-3">
            {time}
          </span>
        )}
      </span>
      {end}
    </div>
  )
}
