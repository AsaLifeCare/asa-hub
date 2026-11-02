/** `calendar` section — mini month with event dots + upcoming events list (moved verbatim from DetailTemplate.tsx). */
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { AppIcon } from '@/lib/icons'
import { ohioWall } from '@/lib/ohio'
import { TINT_BG_VAR, TINT_VAR } from '@/lib/tints'
import { staggerItem } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'

export function CalendarSection({ section, record }: { section: any; record: any }) {
  const events: { date: string; title: string; location?: string; meta?: string; notes?: string }[] =
    (section.eventsField ? record?.[section.eventsField] : section.events) ?? []
  const tint = (section.tint ?? 'blue') as TintName
  // The whole month grid runs on OHIO's clock: a bare `yyyy-mm-dd` event is a calendar day and must not be dragged…
  const today = ohioWall(new Date()) as Date
  const year = today.getFullYear()
  const month = today.getMonth()
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7 // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const eventDays = new Set(
    events
      .map((e) => ohioWall(e.date))
      .filter((d): d is Date => d != null && d.getFullYear() === year && d.getMonth() === month)
      .map((d) => d.getDate()),
  )
  const upcoming = events
    .filter((e) => (ohioWall(e.date)?.getTime() ?? -Infinity) >= today.getTime() - 86_400_000)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, section.limit ?? 6)
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  return (
    <motion.section variants={staggerItem}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{section.title}</h3>
      <div className="rounded-md border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-text-1">{format(today, 'MMMM yyyy')}</span>
          <AppIcon name="calendar-days" size={14} className="text-text-3" />
        </div>
        <div className="grid grid-cols-7 gap-y-1 text-center">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i} className="text-[10px] font-semibold text-text-3">{d}</span>
          ))}
          {cells.map((d, i) => (
            <span key={i} className="flex h-7 flex-col items-center justify-center">
              {d != null && (
                <>
                  <span
                    className={cn(
                      'grid h-5 w-5 place-items-center rounded-full text-[11px] tabular-nums',
                      d === today.getDate() ? 'bg-primary font-semibold text-on-primary' : 'text-text-2',
                    )}
                  >
                    {d}
                  </span>
                  <span
                    className="mt-0.5 h-1 w-1 rounded-full"
                    style={{ background: eventDays.has(d) ? TINT_VAR[tint] : 'transparent' }}
                  />
                </>
              )}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2 space-y-1">
        {upcoming.length === 0 && <p className="text-[12px] text-text-3">No upcoming events.</p>}
        {upcoming.map((e, i) => {
          const d = ohioWall(e.date)
          return (
            <div key={i} className="flex items-center gap-2.5 rounded-sm px-1.5 py-1.5 transition-colors hover:bg-surface-2">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-center leading-none"
                style={{ background: TINT_BG_VAR[tint], color: TINT_VAR[tint] }}
              >
                <span className="text-[13px] font-bold">{d ? format(d, 'd') : '—'}</span>
                <span className="text-[9px] font-semibold uppercase">{d ? format(d, 'MMM') : ''}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="clamp-1 block text-[13px] font-medium text-text-1">{e.title}</span>
                <span className="clamp-1 block text-[11px] text-text-3">{e.location ?? e.meta}</span>
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-text-3">{d ? format(d, 'EEE') : ''}</span>
            </div>
          )
        })}
      </div>
    </motion.section>
  )
}
