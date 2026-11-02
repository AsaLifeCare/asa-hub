// The calendar: the month or the week, Sunday first, compact — an empty day stays short and a day grows only with…
// A chip is the vehicle in bold, the reserved time and what the trip is for ("Booked" when its details are…
import type { MouseEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import {
  TINT, WEEKDAYS, addDays, chipsFor, monthLabel, monthOf, monthWeeks, shiftMonthDay, weekLabel, weekOf,
  type Chip, type Panel, type Trip, type Vehicle,
} from './vehicleCalendarModel'
import type { CalendarView } from './FilterBar'
import { ROUND_BTN, TintDot } from './parts'

export const FOOTNOTE = 'Vehicle availability includes every client. Private trip details appear in the client workspace or manager views.'

export default function CalendarCard({ view, date, today, trips, vehicles, shown, onDate, onPanel, pending, onDay }: {
  view: CalendarView
  date: string
  today: string
  trips: Trip[]
  vehicles: Vehicle[]
  shown: ReadonlySet<string> | null
  onDate: (d: string) => void
  onPanel: (p: Panel) => void
  /** the undecided trips this page also draws, as awaiting approval */
  pending?: (t: Trip) => boolean
  /** a day pressed (not one of its trips): a new trip on that day */
  onDay?: (day: string) => void
}) {
  const month = monthOf(date)
  const days = view === 'week' ? weekOf(date) : monthWeeks(month).flat()
  const title = view === 'week' ? weekLabel(days) : monthLabel(month)
  const step = (by: number) => onDate(view === 'week' ? addDays(date, 7 * by) : shiftMonthDay(date, by))
  const drawn = days.some((d) => d && chipsFor(trips, d, vehicles, shown, pending).length > 0)

  return (
    <section className="overflow-hidden rounded-[16px] border border-border bg-surface shadow-1" data-calendar={view}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <h2 className="font-display text-[16px] font-semibold text-text-1" data-calendar-title="">{title}</h2>
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label={view === 'week' ? 'The week before' : 'The month before'} onClick={() => step(-1)} className={ROUND_BTN}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => onDate(today)} disabled={!today}
            className="h-9 rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2">
            Today
          </button>
          <button type="button" aria-label={view === 'week' ? 'The week after' : 'The month after'} onClick={() => step(1)} className={ROUND_BTN}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="p-2 sm:p-3">
        <div className="grid grid-cols-7 overflow-hidden rounded-[12px] border border-border" data-month-grid={view === 'month' ? month : undefined}
          data-week-grid={view === 'week' ? days[0] : undefined}>
          {WEEKDAYS.map((d) => (
            <div key={d} className="border-b border-border bg-surface-2/60 px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3 sm:px-2 sm:text-left sm:text-[10.5px]">
              {d}
            </div>
          ))}
          {days.map((day, i) => (
            <DayCell key={day || `blank-${i}`} day={day} last={(i + 1) % 7 === 0} today={today} week={view === 'week'}
              chips={day ? chipsFor(trips, day, vehicles, shown, pending) : []} onPanel={onPanel} onDay={onDay} />
          ))}
        </div>
        {!drawn && (
          <p className="mt-2 text-[12px] text-text-3" data-calendar-empty="">
            No trip is on the calendar {view === 'week' ? 'this week' : `in ${monthLabel(month)}`}{shown ? ' for the vehicles shown' : ''}.
          </p>
        )}
      </div>
    </section>
  )
}

function DayCell({ day, last, today, week, chips, onPanel, onDay }: {
  day: string
  last: boolean
  today: string
  week: boolean
  chips: Chip[]
  onPanel: (p: Panel) => void
  onDay?: (day: string) => void
}) {
  const isToday = Boolean(day) && day === today
  const opens = Boolean(day && onDay)
  // a trip pressed opens that trip, never the day under it
  const trip = (e: MouseEvent, id: string) => {
    e.stopPropagation()
    onPanel({ kind: 'trip', id })
  }
  return (
    <div data-day={day || undefined} data-trips={chips.length || undefined} data-day-opens={opens || undefined}
      onClick={opens ? () => onDay?.(day) : undefined}
      className={cn('min-w-0 border-b border-r border-border p-1', week ? 'min-h-[72px]' : 'min-h-[44px]',
        !day && 'bg-surface-2/40', last && 'border-r-0', opens && 'cursor-pointer hover:bg-surface-2/50')}>
      {day && (
        <p className="mb-0.5 flex items-center justify-between px-0.5">
          {opens ? (
            <button type="button" aria-label={`New trip on ${day}`} onClick={(e) => { e.stopPropagation(); onDay?.(day) }}
              className={cn('grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold',
                isToday ? 'bg-primary text-on-primary' : 'text-text-3 hover:bg-surface-2')}>
              {Number(day.slice(8, 10))}
            </button>
          ) : (
            <span className={cn('grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold',
              isToday ? 'bg-primary text-on-primary' : 'text-text-3')}>
              {Number(day.slice(8, 10))}
            </span>
          )}
        </p>
      )}
      {chips.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1 px-0.5 sm:hidden" data-dots="">
            {chips.map((c) => (
              <button key={c.id} type="button" aria-label={`${c.vehicle} ${c.time}`} onClick={(e) => trip(e, c.id)} className="p-0.5">
                <TintDot tint={c.tint} className="h-2 w-2" />
              </button>
            ))}
          </div>
          <div className="hidden gap-0.5 sm:grid">
            {chips.map((c) => (
              <button key={c.id} type="button" onClick={(e) => trip(e, c.id)} data-trip={c.id} data-pending={c.pending || undefined}
                title={`${c.vehicle} ${c.time} · ${c.text}`}
                className={cn('block w-full min-w-0 rounded-md px-1.5 py-1 text-left text-[11px] leading-[1.3] transition-opacity hover:opacity-80',
                  TINT_BG[TINT[c.tint]], TINT_FG[TINT[c.tint]], c.pending && 'border border-dashed border-current opacity-80')}>
                <span className="block truncate"><span className="font-bold">{c.vehicle}</span> {c.time}</span>
                <span className={cn('block', week ? 'line-clamp-2' : 'truncate')}>{c.text}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
