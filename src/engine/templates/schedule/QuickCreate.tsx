/** Quick-create popover (moved verbatim from ScheduleTemplate.tsx). */
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { CalendarDays, Clock, X } from 'lucide-react'
import { TINT_BG, TINT_FG, TINT_VAR } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { Draft, EventTypeMap, Resource } from './types'
import { clampNum, fromMin } from './utils'

export function QuickCreate({
  anchor,
  draft,
  setDraft,
  resources,
  eventTypes,
  onCancel,
  onCreate,
}: {
  anchor: { x: number; y: number }
  draft: Draft
  setDraft: (d: Draft) => void
  resources: Resource[]
  eventTypes: EventTypeMap
  onCancel: () => void
  onCreate: () => void
}) {
  const x = clampNum(anchor.x - 140, 12, window.innerWidth - 300)
  const y = clampNum(anchor.y, 80, window.innerHeight - 300)
  const day = new Date(`${draft.date}T00:00:00`)
  return createPortal(
    <>
      <div className="fixed inset-0 z-[49]" onClick={onCancel} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
        transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
        className="fixed z-50 w-[288px] rounded-lg border border-border bg-surface p-4 shadow-3"
        style={{ left: x, top: y }}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[13px] font-semibold text-text-1">New event</p>
          <button aria-label="Cancel" onClick={onCancel} className="grid h-6 w-6 place-items-center rounded-[8px] text-text-3 hover:bg-surface-2">
            <X size={13} />
          </button>
        </div>
        <input
          autoFocus
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && onCreate()}
          placeholder="Shift or appointment title"
          className="mb-2 h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
        />
        <div className="mb-2 space-y-1">
          <p className="flex items-center gap-1.5 text-[12px] text-text-2">
            <CalendarDays size={13} className="text-text-3" />
            {format(day, 'EEE MMM d, yyyy')}
          </p>
          <p className="flex items-center gap-1.5 text-[12px] text-text-2">
            <Clock size={13} className="text-text-3" />
            {fromMin(draft.startMin)}–{fromMin(draft.startMin + draft.durationMin)}
          </p>
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {Object.entries(eventTypes).map(([id, t]) => (
            <button
              key={id}
              onClick={() => setDraft({ ...draft, type: id })}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all duration-150',
                draft.type === id ? cn(TINT_BG[t.tint], TINT_FG[t.tint], 'ring-1 ring-current') : 'bg-surface-2 text-text-3 hover:text-text-2',
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: TINT_VAR[t.tint] }} />
              {t.label}
            </button>
          ))}
        </div>
        <select
          value={draft.personId}
          onChange={(e) => setDraft({ ...draft, personId: e.target.value })}
          aria-label="Teammate"
          className="mb-3 h-9 w-full rounded-sm border border-border bg-surface px-2 text-[13px] text-text-1 outline-none focus:border-primary"
        >
          {resources.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="h-8 rounded-sm px-3 text-[12px] font-medium text-text-2 hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={onCreate}
            className="h-8 rounded-md bg-primary px-4 text-[12px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
          >
            Create
          </button>
        </div>
      </motion.div>
    </>,
    document.body,
  )
}
