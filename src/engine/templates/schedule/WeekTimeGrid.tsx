// Week/day time grid: sticky resource header, time gutter, hour hairlines, blocked-time overlays, event blocks…
import { format, isSameDay } from 'date-fns'
import { ohioWall } from '@/lib/ohio'
import { motion } from 'framer-motion'
import Avatar from '@/components/shared/Avatar'
import { TINT_BG, TINT_FG, TINT_VAR } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { writePersonDrag } from '@/lib/focus'
import { cn } from '@/lib/utils'
import type { CalEvent } from '@/engine/types'
import type { BlockedTime, DragState, EventTypeMap, Laid, Resource } from './types'
import { COL_MIN_W, GUTTER_W, HOUR_PX, fromMin, layoutColumn, toMin } from './utils'

export function WeekTimeGrid({
  scrollRef,
  gridRef,
  view,
  colCount,
  gmtLabel,
  visibleResources,
  selectedDate,
  dayViewCols,
  gridH,
  hours,
  startH,
  startMin0,
  eventsForColumn,
  blockedFor,
  blockedTimes,
  isoWeekday,
  canEdit,
  startCreateDrag,
  renderBlock,
  drag,
  lastType,
  eventTypes,
  showNow,
  nowY,
  now,
  resourceDraggable = false,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  gridRef: React.RefObject<HTMLDivElement | null>
  view: string
  colCount: number
  gmtLabel: string
  visibleResources: Resource[]
  selectedDate: Date
  dayViewCols: Resource[] | null
  gridH: number
  hours: number[]
  startH: number
  startMin0: number
  eventsForColumn: (resId: string) => CalEvent[]
  blockedFor: (resId: string) => BlockedTime[]
  blockedTimes: BlockedTime[]
  isoWeekday: number
  canEdit: boolean
  startCreateDrag: (pev: React.PointerEvent, personId: string) => void
  renderBlock: (laid: Laid) => React.ReactNode
  drag: DragState | null
  lastType: string
  eventTypes: EventTypeMap
  showNow: boolean
  nowY: number
  now: Date
  /** shifts wave: column-header names double as person-focus drag handles */
  resourceDraggable?: boolean
}) {
  return (
    <div ref={scrollRef} className="scroll-thin max-h-[640px] overflow-auto">
      <div style={{ minWidth: GUTTER_W + colCount * COL_MIN_W }}>
        {/* sticky resource header */}
        <div className="sticky top-0 z-30 flex border-b border-border bg-surface">
          {/* gutter corner: sticks left on horizontal scroll (mobile) */}
          <div className="sticky left-0 z-10 w-16 shrink-0 bg-surface px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-text-3">{gmtLabel}</div>
          {view === 'week' ? (
            visibleResources.map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, duration: 0.2, ease: EASE_OUT_EXPO }}
                className="min-w-0 flex-1 border-l border-border"
              >
                {/* native div: framer's motion props shadow the HTML5 drag events */}
                <div
                  draggable={resourceDraggable}
                  onDragStart={(e) =>
                    resourceDraggable &&
                    writePersonDrag(e.dataTransfer, { type: 'staff', id: r.id, name: r.name, subtitle: r.role })
                  }
                  title={resourceDraggable ? 'Drag onto the top-left corner to focus the platform on this person' : undefined}
                  className={cn(
                    'flex min-w-0 items-center gap-2 px-3 py-2.5',
                    resourceDraggable && 'cursor-grab active:cursor-grabbing',
                  )}
                >
                  <Avatar src={r.avatar} name={r.name} size="xs" className="h-7 w-7 text-[11px]" />
                  <div className="min-w-0">
                    <div className="clamp-1 text-[13px] font-semibold leading-4 text-text-1">{r.name}</div>
                    <div className="clamp-1 text-[11px] text-text-3">{r.role}</div>
                  </div>
                </div>
              </motion.div>
            ))
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2 border-l border-border px-3 py-2.5">
              <span className="font-display text-[15px] font-bold text-text-1">{format(selectedDate, 'EEEE, MMM d')}</span>
              {/* the now-line only belongs on OHIO's today */}
              {isSameDay(selectedDate, ohioWall(new Date()) as Date) && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-on-primary">Today</span>
              )}
            </div>
          )}
        </div>

        {/* grid body */}
        <div ref={gridRef} className="relative flex" style={{ height: gridH }}>
          {/* time gutter — sticky first column while scrolling horizontally */}
          <div className="sticky left-0 z-10 w-16 shrink-0 bg-surface">
            {hours.map((h) => (
              <div key={h} className="relative" style={{ height: HOUR_PX }}>
                <span className="absolute -top-[7px] right-2 text-[11px] tabular-nums text-text-3">
                  {String(h).padStart(2, '0')}:00
                </span>
              </div>
            ))}
          </div>

          {/* columns */}
          {(dayViewCols ?? visibleResources).map((r) => {
            const laid = layoutColumn(eventsForColumn(r.id), startH)
            const blocked = view === 'week' ? blockedFor(r.id) : blockedTimes.filter((b) => !b.weekdays || b.weekdays.includes(isoWeekday))
            return (
              <div
                key={r.id}
                data-res={r.id}
                onPointerDown={(pev) => view === 'week' && startCreateDrag(pev, r.id)}
                className={cn('relative min-w-0 flex-1 border-l border-border', canEdit && view === 'week' && 'cursor-cell')}
              >
                {/* hour hairlines + half-hour dotted (single-pass draw) */}
                <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.3, ease: EASE_OUT_EXPO }} style={{ transformOrigin: 'left' }}>
                  {hours.map((h) => (
                    <div key={h} className="border-t border-border" style={{ height: HOUR_PX }}>
                      <div className="mt-[28px] border-t border-dotted border-surface-3" />
                    </div>
                  ))}
                </motion.div>

                {/* blocked-time dashed overlays */}
                {blocked.map((b, bi) => (
                  <div
                    key={bi}
                    className="pointer-events-none absolute left-1 right-1 rounded-[10px] border border-dashed border-border-strong bg-surface-2/60 px-2 py-1"
                    style={{ top: ((toMin(b.start) - startMin0) / 60) * HOUR_PX, height: Math.max((b.durationMin / 60) * HOUR_PX - 3, 18) }}
                  >
                    <span className="text-[11px] italic text-text-3">{b.label ?? 'Blocked'}</span>
                  </div>
                ))}

                {/* events */}
                {laid.map(renderBlock)}

                {/* drag-to-create ghost */}
                {drag?.kind === 'create' && drag.personId === r.id && (
                  <div
                    className={cn('pointer-events-none absolute left-1 right-1 z-20 rounded-[10px] border border-dashed px-2 py-1 opacity-40', TINT_BG[eventTypes[lastType]?.tint ?? 'blue'], TINT_FG[eventTypes[lastType]?.tint ?? 'blue'])}
                    style={{
                      top: ((drag.startMin - startMin0) / 60) * HOUR_PX,
                      height: ((drag.endMin - drag.startMin) / 60) * HOUR_PX - 2,
                      borderColor: TINT_VAR[eventTypes[lastType]?.tint ?? 'blue'],
                    }}
                  >
                    <span className="text-[11px] font-semibold">{fromMin(drag.startMin)}–{fromMin(drag.endMin)}</span>
                  </div>
                )}
              </div>
            )
          })}

          {/* now line: full width, gutter dot + time chip */}
          {showNow && (
            <div className="pointer-events-none absolute left-16 right-0 top-0 z-20 h-full">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
                style={{ transformOrigin: 'left', top: nowY }}
                className="absolute left-0 right-0 h-[2px] bg-danger"
              />
              <motion.span
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="absolute -left-1 h-2 w-2 rounded-full bg-danger"
                style={{ top: nowY - 3 }}
              />
              <span
                className="absolute -left-[58px] rounded-[6px] bg-danger px-1 py-0.5 text-[10px] font-bold leading-3 text-on-primary"
                style={{ top: nowY - 8 }}
              >
                {format(now, 'HH:mm')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
