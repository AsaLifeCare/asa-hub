/** Aside mini-month calendar (moved verbatim from ScheduleTemplate.tsx). */
import { useMemo } from 'react'
import { addDays, endOfMonth, format, isSameDay, startOfMonth, startOfWeek } from 'date-fns'
import { ohioWall } from '@/lib/ohio'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Card from '@/components/shared/Card'
import { TINT_VAR } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { CalEvent, TintName } from '@/engine/types'
import type { EventTypeMap } from './types'

export function MiniMonth({
  cursor,
  onCursor,
  weekStart,
  events,
  eventTypes,
  selectedDate,
  onPick,
}: {
  cursor: Date
  onCursor: (d: Date) => void
  weekStart: Date | null
  events: CalEvent[]
  eventTypes: EventTypeMap
  selectedDate: Date | null
  onPick: (d: Date) => void
}) {
  const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)))
  const monthEnd = endOfMonth(cursor)
  const firstTintByDay = useMemo(() => {
    const map = new Map<string, TintName>()
    for (const e of events) if (!map.has(e.date)) map.set(e.date, eventTypes[e.type]?.tint ?? 'blue')
    return map
  }, [events, eventTypes])
  return (
    <Card className="!p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-display text-[14px] font-bold text-text-1">{format(cursor, 'MMMM yyyy')}</p>
        <div className="flex items-center gap-0.5">
          <button
            aria-label="Previous month"
            onClick={() => onCursor(addDays(startOfMonth(cursor), -1))}
            className="grid h-6 w-6 place-items-center rounded-[8px] text-text-3 transition-colors duration-150 hover:bg-surface-2 hover:text-text-2"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            aria-label="Next month"
            onClick={() => onCursor(addDays(endOfMonth(cursor), 1))}
            className="grid h-6 w-6 place-items-center rounded-[8px] text-text-3 transition-colors duration-150 hover:bg-surface-2 hover:text-text-2"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
      <motion.div
        key={format(cursor, 'yyyy-MM')}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="text-center"
      >
        <div className="grid grid-cols-7">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i} className="pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
              {d}
            </span>
          ))}
        </div>
        {weeks.map((row, wi) => {
          const isSelectedWeek = weekStart ? isSameDay(row[0], weekStart) : false
          return (
            <div key={wi} className={cn('grid grid-cols-7 rounded-[8px]', isSelectedWeek && 'bg-primary-soft')}>
              {row.map((d, di) => {
                const inMonth = d >= startOfMonth(cursor) && d <= monthEnd
                // "Today" is the COMPANY's today — the ring belongs on the day the houses are working.
                const today = isSameDay(d, ohioWall(new Date()) as Date)
                const tint = firstTintByDay.get(format(d, 'yyyy-MM-dd'))
                const picked = selectedDate && isSameDay(d, selectedDate)
                return (
                  <button
                    key={d.toISOString()}
                    onClick={() => onPick(d)}
                    className={cn(
                      'relative grid h-8 place-items-center text-[12px] font-medium transition-colors duration-150',
                      !today && inMonth && 'hover:bg-surface-2 rounded-[8px]',
                      today ? 'text-on-primary' : inMonth ? 'text-text-2' : 'text-text-3/40',
                      picked && !today && 'bg-surface-3 rounded-[8px]',
                    )}
                  >
                    <motion.span
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: Math.min(wi * 7 + di, 30) * 0.008, duration: 0.2, ease: EASE_OUT_EXPO }}
                      className={cn('grid h-7 w-7 place-items-center rounded-full', today && 'bg-primary font-bold')}
                    >
                      {format(d, 'd')}
                    </motion.span>
                    {tint && !today && (
                      <span className="absolute bottom-1 h-1 w-1 rounded-full" style={{ background: TINT_VAR[tint] }} />
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </motion.div>
    </Card>
  )
}
