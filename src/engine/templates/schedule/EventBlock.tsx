// One positioned event block inside a week/day column (body moved verbatim from ScheduleTemplate.tsx's renderBlock…
import { format, isSameDay } from 'date-fns'
import { ohioWall } from '@/lib/ohio'
import { motion } from 'framer-motion'
import { MapPin, Repeat } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { TINT_BG, TINT_FG, TINT_VAR } from '@/lib/tints'
import { peopleByIds } from '@/lib/people-lookup'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import { asList } from '@/lib/asList'
import type { CalEvent, TintName } from '@/engine/types'
import type { DragState, EventTypeMap, Laid, Resource } from './types'
import { fromMin, houseOf, toMin } from './utils'

export function EventBlock({
  laid,
  eventTypes,
  hiddenTypes,
  selectedId,
  drag,
  canEdit,
  view,
  dayResource,
  resources,
  orderIdx,
  suppressClick,
  startMoveDrag,
  startResizeDrag,
  openEvent,
  showTip,
  hideTip,
}: {
  laid: Laid
  eventTypes: EventTypeMap
  hiddenTypes: Set<string>
  selectedId?: string
  drag: DragState | null
  canEdit: boolean
  view: string
  dayResource: string
  resources: Resource[]
  orderIdx: Map<string, number>
  suppressClick: React.RefObject<boolean>
  startMoveDrag: (pev: React.PointerEvent, e: CalEvent) => void
  startResizeDrag: (pev: React.PointerEvent, e: CalEvent) => void
  openEvent: (e: CalEvent) => void
  showTip: (el: HTMLElement, e: CalEvent) => void
  hideTip: () => void
}) {
  const { e, lane, lanes, top, height } = laid
  const t = eventTypes[e.type] ?? { label: e.type, tint: 'blue' as TintName }
  const hidden = hiddenTypes.has(e.type)
  const isSelected = selectedId === e.id
  const isDragged = drag?.kind !== 'create' && (drag as any)?.id === e.id
  const compact = e.durationMin <= 30
  const tiny = e.durationMin <= 15
  const endMin = toMin(e.start) + e.durationMin
  // a sheet row hands attendees over as one cell, never an array
  const guests = asList(e.attendees)
  // an event is "today's" on the company clock
  const todayEvent = isSameDay(new Date(`${e.date}T00:00:00`), ohioWall(new Date()) as Date)
  const owner = resources.find((r) => r.id === e.personId)
  const ownerName = view === 'day' && dayResource === 'all' ? owner?.name : undefined
  const widthPct = 100 / lanes
  return (
    <motion.button
      key={e.id}
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: hidden ? 0.15 : 1 }}
      transition={{ delay: Math.min(orderIdx.get(e.id) ?? 0, 12) * 0.02, duration: 0.2, ease: EASE_OUT_EXPO }}
      whileHover={canEdit && !e.readOnly ? { y: -1 } : undefined}
      onPointerDown={(pev) => startMoveDrag(pev, e)}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false
          return
        }
        openEvent(e)
      }}
      onMouseEnter={(mev) => showTip(mev.currentTarget, e)}
      onMouseLeave={hideTip}
      className={cn(
        'group absolute overflow-hidden rounded-[10px] px-2 py-1 text-left',
        TINT_BG[t.tint],
        isDragged ? 'z-30 cursor-grabbing shadow-2' : canEdit && !e.readOnly ? 'z-10 cursor-grab hover:shadow-2' : 'z-10 cursor-default hover:shadow-1',
        isSelected && 'outline outline-2 outline-primary',
      )}
      style={{
        top,
        height,
        left: `calc(${lane * widthPct}% + 4px)`,
        width: `calc(${widthPct}% - 8px)`,
        borderLeft: `3px solid ${TINT_VAR[t.tint]}`,
      }}
    >
      {tiny ? (
        <div className={cn('clamp-1 text-[11px] font-semibold leading-4', TINT_FG[t.tint])}>{e.title}</div>
      ) : compact ? (
        <div className="clamp-1 text-[12px] leading-4">
          <span className={cn('font-semibold', TINT_FG[t.tint])}>{e.start}</span>
          <span className="font-medium text-text-1"> · {e.title}</span>
        </div>
      ) : (
        <>
          <div className="clamp-2 text-[12px] font-semibold leading-4 text-text-1">{e.title}</div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-text-2">
            {e.type === 'shift' && <Repeat size={11} className="shrink-0 text-text-3" />}
            {view === 'week' && (
              <span className={cn(todayEvent && 'font-semibold text-primary')}>{format(new Date(`${e.date}T00:00:00`), 'EEE d')} · </span>
            )}
            {e.start}–{fromMin(endMin)}
            {/* The shift belongs to somebody, and their first name sat here as
                a bare text node. pointerdown is stopped on the name alone: the
                block's own press starts the calendar move-drag, and two drags
                from one press would move the shift while the ghost flies to
                the tracker. The rest of the block still moves. */}
            {ownerName ? ' ·' : ''}
            {ownerName && (
              <span onPointerDown={(ev) => ev.stopPropagation()} className="inline-flex">
                <DragPerson
                  name={ownerName}
                  id={String(e.personId ?? '')}
                  avatar={owner?.avatar}
                  subtitle={owner?.role}
                  className="inline-flex"
                >
                  {ownerName.split(' ')[0]}
                </DragPerson>
              </span>
            )}
          </div>
          {e.durationMin >= 60 && houseOf(e) !== '—' && (
            <div className="clamp-1 mt-0.5 flex items-center gap-1 text-[11px] text-text-3">
              <MapPin size={11} className="shrink-0" />
              {houseOf(e)}
            </div>
          )}
          {e.durationMin >= 60 && guests.length > 0 && (
            <div className="absolute bottom-1 left-2 flex items-center">
              {/* Real faces of real people. Each gets its own handle (the
                  AvatarStack law), and the overlap moves to the wrapper —
                  the negative margin belongs to the box that is the flex item
                  now. pointerdown is stopped for the reason the owner name
                  above stops it: the block's press is the calendar move. */}
              {peopleByIds(guests).slice(0, 3).map((p, i) => (
                <span
                  key={i}
                  onPointerDown={(ev) => ev.stopPropagation()}
                  className={cn('inline-flex shrink-0', i > 0 && '-ml-1')}
                >
                  <DragPerson name={p.name} avatar={p.src} className="inline-flex">
                    <Avatar src={p.src} name={p.name} size="xs" className="h-4 w-4 border border-surface text-[7px]" />
                  </DragPerson>
                </span>
              ))}
              {guests.length > 3 && <span className="ml-0.5 text-[9px] font-semibold text-text-2">+{guests.length - 3}</span>}
            </div>
          )}
        </>
      )}
      {/* resize handle (admins only; never on a mirrored roster shift) */}
      {canEdit && !e.readOnly && (
        <span
          onPointerDown={(pev) => startResizeDrag(pev, e)}
          className="absolute inset-x-0 bottom-0 h-[7px] cursor-ns-resize opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        >
          <span className="absolute bottom-[2px] left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full" style={{ background: TINT_VAR[t.tint] }} />
        </span>
      )}
    </motion.button>
  )
}
