/** Sticky aside: mini month + event-type legend + timezone note (moved verbatim from ScheduleTemplate.tsx). */
import { motion } from 'framer-motion'
import { Globe } from 'lucide-react'
import Card from '@/components/shared/Card'
import { TINT_VAR } from '@/lib/tints'
import { staggerItem } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { CalEvent } from '@/engine/types'
import type { EventTypeMap } from './types'
import { MiniMonth } from './MiniMonth'
import { useFeatureAllowed } from '@/lib/featureAccess'

export function ScheduleAside({
  monthCursor,
  setMonthCursor,
  view,
  weekStart,
  selectedDate,
  events,
  eventTypes,
  pickDay,
  hiddenTypes,
  setHiddenTypes,
  countByType,
  tz,
  gmtLabel,
}: {
  monthCursor: Date
  setMonthCursor: (d: Date) => void
  view: string
  weekStart: Date
  selectedDate: Date
  events: CalEvent[]
  eventTypes: EventTypeMap
  pickDay: (d: Date) => void
  hiddenTypes: Set<string>
  setHiddenTypes: React.Dispatch<React.SetStateAction<Set<string>>>
  countByType: Map<string, number>
  tz: string
  gmtLabel: string
}) {
  const canFilterTypes = useFeatureAllowed('schedule.eventTypeFilters')
  return (
    <motion.div variants={staggerItem} className="sticky top-6 hidden w-[260px] shrink-0 space-y-4 xl:block">
      <MiniMonth
        cursor={monthCursor}
        onCursor={setMonthCursor}
        weekStart={view === 'week' ? weekStart : view === 'day' ? weekStart : null}
        events={events}
        eventTypes={eventTypes}
        selectedDate={view === 'day' ? selectedDate : null}
        onPick={pickDay}
      />
      {/* WHO MAY CHANGE WHAT THE CALENDAR DRAWS — the display-control buttons
          (Shifts, hiring and the rest) are governed by ROLE BADGE.
          Ungated it stays what it is: a legend anybody may fold. Gated, the
          rows still SHOW — the colours and the counts are how you read the
          month, and taking them away would answer a question about who may
          FILTER by hiding what everybody may see. Only the pressing goes. */}
      <Card className="!p-4">
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Event types</p>
        <div className="space-y-1">
          {Object.entries(eventTypes).map(([id, t]) => {
            const off = hiddenTypes.has(id)
            return (
              <button
                key={id}
                disabled={!canFilterTypes}
                title={canFilterTypes ? undefined : 'Filtering the calendar is not part of your badge'}
                onClick={() =>
                  setHiddenTypes((prev) => {
                    const next = new Set(prev)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })
                }
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 text-left transition-colors duration-150',
                  canFilterTypes ? 'hover:bg-surface-2' : 'cursor-default',
                )}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TINT_VAR[t.tint], opacity: off ? 0.3 : 1 }} />
                <span className={cn('flex-1 text-[13px] font-medium', off ? 'text-text-3 line-through' : 'text-text-1')}>{t.label}</span>
                <span className={cn('text-[11px]', off ? 'text-text-3/60 line-through' : 'text-text-3')}>{countByType.get(id) ?? 0}</span>
              </button>
            )
          })}
        </div>
      </Card>
      <p className="flex items-center gap-1.5 px-1 text-[12px] text-text-3">
        <Globe size={13} /> Times shown in {tz} ({gmtLabel})
      </p>
    </motion.div>
  )
}
