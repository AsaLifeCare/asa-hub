// The calendar's filters: which vehicles are drawn (an anchored checkbox list; on a phone it rises as the panel's…
// Every time is Eastern.
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Clock } from 'lucide-react'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import SidePanel, { usePanelEscape } from '@/components/shared/SidePanel'
import { useMediaQuery } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { vehicleFilterLabel, type Vehicle } from './vehicleCalendarModel'
import { TintDot } from './parts'

export type CalendarView = 'month' | 'week'
const VIEWS = [{ id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }]
const CONTROL = 'h-10 rounded-[12px] border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary'

export default function FilterBar({ vehicles, shown, onShown, view, onView, date, onDate }: {
  vehicles: Vehicle[]
  /** null = every vehicle */
  shown: ReadonlySet<string> | null
  onShown: (next: Set<string> | null) => void
  view: CalendarView
  onView: (v: CalendarView) => void
  date: string
  onDate: (d: string) => void
}) {
  const [open, setOpen] = useState(false)
  const phone = useMediaQuery('(max-width: 639px)')
  const box = useRef<HTMLDivElement | null>(null)
  usePanelEscape(open && !phone, () => setOpen(false))

  useEffect(() => {
    if (!open || phone) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, phone])

  const toggle = (id: string) => {
    const next = new Set(shown ?? vehicles.map((v) => v.id))
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onShown(vehicles.every((v) => next.has(v.id)) ? null : next)
  }
  const list = (
    <ul role="listbox" aria-multiselectable="true" aria-label="Vehicles" className="grid gap-0.5" data-vehicle-list="">
      {vehicles.map((v) => {
        const on = !shown || shown.has(v.id)
        return (
          <li key={v.id} role="option" aria-selected={on}>
            <button type="button" onClick={() => toggle(v.id)} data-vehicle-option={v.id}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-text-1 hover:bg-surface-2">
              <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border',
                on ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface')}>
                {on && <Check size={11} />}
              </span>
              <TintDot tint={v.tint} />
              <span className="min-w-0 flex-1 truncate font-medium">{v.name}</span>
              <span className="shrink-0 text-[11px] text-text-3">{v.seats ? `${v.seats} seats` : ''}</span>
            </button>
          </li>
        )
      })}
      <li className="mt-1 flex justify-between border-t border-border px-2.5 pt-2 text-[12px]">
        <button type="button" onClick={() => onShown(null)} className="font-semibold text-primary hover:underline">Show all</button>
        <button type="button" onClick={() => setOpen(false)} className="text-text-3 hover:text-text-1">Done</button>
      </li>
    </ul>
  )

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-filter-bar="">
      <div ref={box} className="relative">
        <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} data-vehicle-filter=""
          className={cn(CONTROL, 'inline-flex items-center gap-2 font-semibold')}>
          {vehicleFilterLabel(shown, vehicles)}
          <ChevronDown size={14} className={cn('text-text-3 transition-transform', open && 'rotate-180')} />
        </button>
        {phone ? (
          <SidePanel open={open} onClose={() => setOpen(false)} label="Vehicles" title="Vehicles on the calendar">{list}</SidePanel>
        ) : open && (
          <div className="absolute left-0 top-full z-40 mt-2 w-[280px] rounded-[14px] border border-border bg-surface p-2 shadow-3">{list}</div>
        )}
      </div>
      <div className="flex items-center gap-2 text-[12.5px] text-text-2">
        <span className="hidden sm:inline">View</span>
        <SegmentedTabs tabs={VIEWS} value={view} onChange={(v) => onView(v === 'week' ? 'week' : 'month')} />
      </div>
      <label className="flex items-center gap-2 text-[12.5px] text-text-2">
        <span className="hidden sm:inline">Date</span>
        <input type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} aria-label="Date"
          className={cn(CONTROL, 'w-[150px]')} data-date="" />
      </label>
      <span className="inline-flex items-center gap-1.5 text-[12px] text-text-3 sm:ml-auto"><Clock size={12} /> All times Eastern Time</span>
    </div>
  )
}
