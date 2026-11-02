/** Month grid view (moved verbatim from ScheduleTemplate.tsx). */
import { useMemo } from 'react'
import { addDays, endOfMonth, format, isSameDay, startOfMonth, startOfWeek } from 'date-fns'
import { ohioWall } from '@/lib/ohio'
import { motion } from 'framer-motion'
import { TINT_BG, TINT_FG, TINT_VAR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { CalEvent, TintName } from '@/engine/types'
import type { EventTypeMap } from './types'

const MAX_CHIPS = 3

export function MonthGrid({
  cursor,
  events,
  eventTypes,
  selectedId,
  canEdit,
  onOpenEvent,
  onPickDay,
  onMore,
}: {
  cursor: Date
  events: CalEvent[]
  eventTypes: EventTypeMap
  selectedId?: string
  canEdit: boolean
  onOpenEvent: (e: CalEvent) => void
  onPickDay: (d: Date, x: number, y: number) => void
  onMore: (d: Date, x: number, y: number) => void
}) {
  const monthStart = startOfMonth(cursor)
  const monthEnd = endOfMonth(cursor)
  const weeks: Date[][] = []
  for (let cur = startOfWeek(monthStart, { weekStartsOn: 1 }); cur <= monthEnd; cur = addDays(cur, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)))
  }
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>()
    for (const e of events) {
      const list = m.get(e.date) ?? []
      list.push(e)
      m.set(e.date, list)
    }
    for (const list of m.values()) list.sort((a, b) => a.start.localeCompare(b.start))
    return m
  }, [events])

  return (
    <div>
      {/* weekday header */}
      <div className="grid grid-cols-7 border-b border-border">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span key={d} className="px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3 max-sm:px-0.5 max-sm:text-center">
            <span className="max-sm:hidden">{d}</span>
            <span className="sm:hidden">{d[0]}</span>
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {weeks.flat().map((d, i) => {
          const inMonth = d >= monthStart && d <= monthEnd
          // Ohio's today carries the ring, not the reader's.
          const today = isSameDay(d, ohioWall(new Date()) as Date)
          const dayEvents = byDay.get(format(d, 'yyyy-MM-dd')) ?? []
          const shown = dayEvents.slice(0, MAX_CHIPS)
          const more = dayEvents.length - shown.length
          return (
            <motion.div
              key={d.toISOString()}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i, 34) * 0.008, duration: 0.18 }}
              onClick={(mev) => onPickDay(d, mev.clientX, mev.clientY)}
              className={cn(
                'min-h-[76px] p-1 text-left align-top sm:min-h-[108px] sm:p-1.5',
                inMonth ? 'bg-surface' : 'bg-surface-2/40',
                canEdit ? 'cursor-cell' : 'cursor-default',
              )}
            >
              <div className="mb-1 flex justify-end px-0.5">
                <span
                  className={cn(
                    'grid h-6 w-6 place-items-center rounded-full text-[12px] font-medium',
                    today ? 'font-bold text-primary ring-2 ring-primary' : inMonth ? 'text-text-2' : 'text-text-3/50',
                  )}
                >
                  {format(d, 'd')}
                </span>
              </div>
              <div className="space-y-0.5">
                {shown.map((e) => {
                  const t = eventTypes[e.type] ?? { label: e.type, tint: 'blue' as TintName }
                  return (
                    <button
                      key={e.id}
                      onClick={(cev) => {
                        cev.stopPropagation()
                        onOpenEvent(e)
                      }}
                      className={cn(
                        'flex w-full items-center gap-1 rounded-[6px] px-1 py-0.5 text-left transition-all duration-150 hover:shadow-1',
                        TINT_BG[t.tint],
                        selectedId === e.id && 'outline outline-2 outline-primary',
                      )}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full max-sm:h-2 max-sm:w-2" style={{ background: TINT_VAR[t.tint] }} />
                      {/* phones show dots only — tap the day to see the list */}
                      <span className={cn('clamp-1 text-[12px] font-medium leading-4 max-sm:hidden', TINT_FG[t.tint])}>
                        {e.start} {e.title}
                      </span>
                    </button>
                  )
                })}
                {more > 0 && (
                  <button
                    onClick={(mev) => {
                      mev.stopPropagation()
                      onMore(d, mev.clientX, mev.clientY)
                    }}
                    className="w-full rounded-[6px] px-1 py-0.5 text-left text-[11px] font-medium text-text-3 transition-colors duration-150 hover:bg-surface-2 hover:text-text-2"
                  >
                    +{more} more
                  </button>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
