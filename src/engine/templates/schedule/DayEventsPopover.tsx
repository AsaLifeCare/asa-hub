/** Day-events popover — "+N more" / staff day click (moved verbatim from ScheduleTemplate.tsx). */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { CalendarDays, Plus, X } from 'lucide-react'
import { TINT_BG, TINT_FG, TINT_VAR } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { CalEvent, TintName } from '@/engine/types'
import type { EventTypeMap } from './types'
import { clampNum, endLabel } from './utils'

export function DayEventsPopover({
  day,
  anchor,
  events,
  eventTypes,
  canEdit,
  onOpenEvent,
  onQuickCreate,
  onClose,
}: {
  day: Date
  anchor: { x: number; y: number }
  events: CalEvent[]
  eventTypes: EventTypeMap
  canEdit: boolean
  onOpenEvent: (e: CalEvent) => void
  onQuickCreate: (d: Date, x: number, y: number) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const x = clampNum(anchor.x - 130, 12, window.innerWidth - 280)
  const y = clampNum(anchor.y, 80, window.innerHeight - 320)
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start))
  return createPortal(
    <>
      <div className="fixed inset-0 z-[49]" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
        transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
        className="fixed z-50 w-[264px] rounded-lg border border-border bg-surface p-3 shadow-3"
        style={{ left: x, top: y }}
      >
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-text-1">
            <CalendarDays size={14} className="text-text-3" />
            {format(day, 'EEEE, MMM d')}
          </p>
          <button aria-label="Close" onClick={onClose} className="grid h-6 w-6 place-items-center rounded-[8px] text-text-3 hover:bg-surface-2">
            <X size={13} />
          </button>
        </div>
        <div className="max-h-[240px] space-y-1 overflow-auto scroll-thin">
          {sorted.length === 0 && <p className="px-1 py-2 text-[12px] text-text-3">Nothing scheduled.</p>}
          {sorted.map((e) => {
            const t = eventTypes[e.type] ?? { label: e.type, tint: 'blue' as TintName }
            return (
              <button
                key={e.id}
                onClick={() => onOpenEvent(e)}
                className={cn('flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left transition-all duration-150 hover:shadow-1', TINT_BG[t.tint])}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TINT_VAR[t.tint] }} />
                <span className="min-w-0">
                  <span className={cn('clamp-1 block text-[12px] font-medium leading-4', TINT_FG[t.tint])}>
                    {e.start}–{endLabel(e)} · {e.title}
                  </span>
                  <span className="clamp-1 block text-[11px] leading-4 text-text-3">{t.label}</span>
                </span>
              </button>
            )
          })}
        </div>
        {canEdit && (
          <button
            onClick={() => onQuickCreate(day, anchor.x, anchor.y)}
            className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border text-[12px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2"
          >
            <Plus size={13} /> New event
          </button>
        )}
      </motion.div>
    </>,
    document.body,
  )
}
