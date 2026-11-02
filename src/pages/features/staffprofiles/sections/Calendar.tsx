// Calendar: the timed shifts this person works on Scheduling, every house, from today on — week by week with the…
// Each row names the house's clients first, then the house, the day, the times and hours, the shift's state and the…
import { Link } from 'react-router'
import { CalendarClock, Car, RefreshCw } from 'lucide-react'
import { TINT_BG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { useShellHides } from '@/lib/myWorkHides'
import { houseTint } from '@/pages/features/calendarbuilder/calendarScreen'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { MED_CLASS, addDays, badgeList, cellMinutes } from '@/pages/features/scheduling/schedulingModel'
import {
  readStaffCalendar, useSchedulingRead, type StaffShift, type StaffShiftHouse, type StaffShifts,
} from '@/pages/features/scheduling/schedulingLane'
import { PILL, dayWords, shiftKey, shiftPills } from '@/pages/features/scheduling/StaffCalendars'
import { hhmm, weekKeyOf } from '@/pages/features/shifts/houseCalTypes'
import { TONE_PILL } from '@/pages/features/vehiclecalendar/vehicleCalendarModel'
import {
  ROLE_WORD, tripHref, tripTimes, tripWhere, useStaffTrips, type PersonTrip,
} from '@/pages/features/vehiclecalendar/personTrips'
import type { RosterRow } from '../staffModel'
import { EmptyNote } from '../StaffParts'

const OFF_STATES = new Set(['called_off', 'requested_off', 'time_off', 'swapped_out'])
const GRID = 'sm:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.4fr)_minmax(0,1.2fr)]'
const TH = 'whitespace-nowrap text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'

export type ShiftWeek = { week: string; shifts: StaffShift[]; hours: number | null }

/** A row of a week: a shift or a trip, ordered by day and start. */
export type CalendarItem = { key: string; date: string; at: number; shift?: StaffShift; trip?: PersonTrip }
export type CalendarWeek = ShiftWeek & { items: CalendarItem[]; trips: number }

const minutesOf = (hm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

/** The shift weeks with today's and every later day's trips merged in by day and start time. */
export function calendarWeeks(weeks: ShiftWeek[], trips: PersonTrip[], today: string): CalendarWeek[] {
  const by = new Map<string, CalendarWeek>(weeks.map((w) => [w.week, {
    ...w, trips: 0,
    items: w.shifts.map((s) => ({ key: `s|${shiftKey(s)}`, date: s.date, at: cellMinutes(s)?.[0] ?? 0, shift: s })),
  }]))
  for (const t of trips) {
    if (!t.day || t.day < today) continue
    const week = weekKeyOf(t.day)
    const w = by.get(week) ?? { week, shifts: [], hours: null, items: [], trips: 0 }
    w.items.push({ key: `t|${t.id}`, date: t.day, at: minutesOf(t.start_label), trip: t })
    w.trips++
    by.set(week, w)
  }
  return [...by.keys()].sort().map((k) => {
    const w = by.get(k) as CalendarWeek
    w.items.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at)
    return w
  })
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The hours a shift adds to its week: a worked shift's, never one called off, off or on time off. */
export function workedHours(s: StaffShift): number {
  if (typeof s.hours !== 'number' || s.kind === 'ro' || OFF_STATES.has(s.state) || s.time_off === 'approved') return 0
  return s.hours
}

/** The shifts from today on that carry a time, by week in day order — a cell naming another house ("MS") or a word
 *  with no hours is no shift (the server leaves them out too); `hours` null while hours are hidden from this viewer. */
export function shiftWeeks(shifts: StaffShift[], today: string): ShiftWeek[] {
  const by = new Map<string, StaffShift[]>()
  for (const s of shifts) {
    if (s.date < today || typeof s.start !== 'number') continue
    const w = weekKeyOf(s.date)
    by.set(w, [...(by.get(w) ?? []), s])
  }
  return [...by.keys()].sort().map((week) => {
    const list = by.get(week) ?? []
    const shown = list.some((s) => typeof s.hours === 'number')
    const hours = shown ? Math.round(list.reduce((n, s) => n + workedHours(s), 0) * 100) / 100 : null
    return { week, shifts: list, hours }
  })
}

/** 'Ann Roe & Ben Left', or 'Ann Roe, Ben Left +2' for a house of more. */
export function clientsWords(names: string[]): string {
  if (names.length <= 2) return names.join(' & ')
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

export const hoursText = (h: number): string => `${Math.round(h * 100) / 100} h`

export const schedulingCellHref = (s: Pick<StaffShift, 'house_code' | 'date'>): string =>
  `/app/scheduling/calendar?house=${encodeURIComponent(s.house_code)}&day=${encodeURIComponent(s.date)}`

export default function CalendarSection({ row }: { row: RosterRow }) {
  const read = useSchedulingRead<StaffShifts>(`staffcal|${row.key}`, () => readStaffCalendar(row.key))
  const trips = useStaffTrips(row.key)
  const data = read.data
  const today = data?.today || trips.data?.today || ''
  const weeks = today ? calendarWeeks(data ? shiftWeeks(data.shifts, today) : [], trips.data?.trips ?? [], today) : []
  const houses = new Map((data?.houses ?? []).map((h) => [h.code, h]))
  const count = weeks.reduce((n, w) => n + w.shifts.filter((s) => s.date >= today).length, 0)
  const tripCount = (trips.data?.trips ?? []).filter((t) => t.day >= today).length
  const coming = [count ? plural(count, 'shift') : '', tripCount ? plural(tripCount, 'trip') : ''].filter(Boolean).join(' · ')
  const first = row.name.split(' ')[0] || row.name
  // the clients' names are the master's alone while Settings › My Work hides them; the house and the shift stay
  const hides = useShellHides()
  const hideClients = hides.staff_calendar_clients
  // the line under the title, the count, the weeks' headings and the badges: the same, one table in their place
  const bare = hides.staff_calendar_details
  const groups = bare && weeks.length ? [{ ...weeks[0], items: weeks.flatMap((w) => w.items) }] : weeks
  const hours = weeks.some((w) => w.hours !== null)

  return (
    <SectionCard title="Calendar" sub={bare ? undefined : 'The shifts on Scheduling, every house, and the Transportation trips, from today on.'}
      extra={coming && !bare ? <span className="text-[12.5px] text-text-3" data-shift-count="">{coming} coming up</span> : undefined}>
      <div className="grid gap-4" data-staff-calendar="">
        {read.status === 'loading' && !data && <p className="text-[12.5px] text-text-3" data-read="loading">Reading the shifts…</p>}
        {read.status === 'failed' && (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--danger)]" data-read="failed">
            The shifts could not be read — {read.error || 'the server did not answer'}.
            <button type="button" onClick={read.reload}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2">
              <RefreshCw size={13} /> Try again
            </button>
          </p>
        )}
        {read.status === 'ready' && read.error && (
          <p className="text-[12px] text-warning">It could not be read again just now — {read.error}. What is drawn is from before.</p>
        )}
        {trips.status === 'failed' && (
          <p className="text-[12px] text-warning" data-read="trips-failed">The Transportation trips could not be read — {trips.error}.</p>
        )}
        {data && weeks.length === 0 && (
          <EmptyNote>
            <CalendarClock size={22} className="mx-auto mb-1.5 text-text-3" />
            Nothing is scheduled for {first} from today on.
          </EmptyNote>
        )}
        {groups.map((w) => (
          <section key={w.week} className="overflow-hidden rounded-[16px] border border-border" data-week={bare ? undefined : w.week}>
            {!bare && (
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-4 py-2.5">
                <h3 className="text-[12.5px] font-semibold text-text-1">Week of {dayWords(w.week)} – {dayWords(addDays(w.week, 6))}</h3>
                <span className="text-[12px] text-text-3" data-week-total="">
                  {[w.shifts.length || !w.trips ? plural(w.shifts.length, 'shift') : '', w.trips ? plural(w.trips, 'trip') : '']
                    .filter(Boolean).join(' · ')}{w.hours !== null && ` · ${hoursText(w.hours)}`}
                </span>
              </header>
            )}
            <div className={cn('hidden gap-x-3 border-b border-border bg-surface-2/40 px-4 py-2 sm:grid', GRID)} data-calendar-head="">
              {['Location', 'Date', 'Time', hours ? 'Hours' : '', 'Status'].map((h, n) => <span key={n} className={TH}>{h}</span>)}
            </div>
            <ul className="divide-y divide-border">
              {w.items.map((i) => (i.trip
                ? <TripRow key={i.key} trip={i.trip} today={today} hideClients={hideClients} />
                : i.shift ? <ShiftRow key={i.key} shift={i.shift} house={houses.get(i.shift.house_code)} today={today}
                  hideClients={hideClients} hideBadges={bare} /> : null))}
            </ul>
          </section>
        ))}
      </div>
    </SectionCard>
  )
}

/** A house as the rows name it: its location without the city's prefix (CAN - 48TH (B) - ABD1711 → 48TH (B) - ABD1711),
 *  else its short name, else its code. */
export function houseWords(house: Pick<StaffShiftHouse, 'short' | 'location'> | undefined, code: string): string {
  const location = String(house?.location ?? '').trim()
  return location.replace(/^[A-Z]{2,4}\s*-\s*(?=.*-)/, '') || house?.short || code
}

function ShiftRow({ shift: s, house, today, hideClients = false, hideBadges = false }: {
  shift: StaffShift
  house: StaffShiftHouse | undefined
  today: string
  /** Settings › My Work hides the clients' names */
  hideClients?: boolean
  /** Settings › My Work hides the badges (Med, HM, Team leader) */
  hideBadges?: boolean
}) {
  const span = cellMinutes(s)
  const clients = hideClients ? [] : house?.clients ?? []
  const where = houseWords(house, s.house_code)
  const pills = shiftPills(s)
  const badges = hideBadges ? [] : badgeList(s.badges)
  return (
    <li>
      <Link to={schedulingCellHref(s)} data-shift={shiftKey(s)}
        className={cn('group grid grid-cols-2 items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px] text-text-1 transition-colors hover:bg-surface-2 sm:py-2.5',
          GRID, s.date < today && 'text-text-2')}>
        <span className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-1">
          <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full', TINT_BG[houseTint(house?.location || s.house_code)])} />
          <span className="min-w-0">
            {clients.length > 0 && (
              <span className="block truncate font-semibold" title={clients.join(', ')} data-clients="">{clientsWords(clients)}</span>
            )}
            {/* the house opens its day in Scheduling: drawn as the link it is */}
            <span className={cn('block truncate font-semibold text-primary group-hover:underline', clients.length && 'text-[12px]')}
              data-location="">{where}</span>
          </span>
        </span>
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          {dayWords(s.date)}
          {s.date === today && <span className="rounded-full bg-tint-primary px-1.5 text-[10.5px] font-semibold text-primary">Today</span>}
        </span>
        <span className="whitespace-nowrap text-right tabular-nums sm:text-left">{span ? `${hhmm(span[0] / 60)} – ${hhmm(span[1] / 60)}` : s.text}</span>
        <span className="tabular-nums text-text-2" data-hours="">{typeof s.hours === 'number' ? hoursText(s.hours) : ''}</span>
        <span className="flex flex-wrap justify-end gap-1 sm:justify-start">
          {pills.map((p) => (
            <span key={p.id} className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', PILL[p.tone])}>{p.label}</span>
          ))}
          {badges.map((b) => (
            <span key={b.id} title={b.label} data-badge={b.id}
              className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold',
                b.id === 'med' ? MED_CLASS[b.tone] : b.id === 'hm' ? 'bg-tint-mint text-tint-fg-mint' : 'bg-tint-lavender text-tint-fg-lavender')}>
              {b.id === 'hm' ? 'HM' : b.id === 'med' ? `Med ${b.level}` : 'Team leader'}
            </span>
          ))}
        </span>
      </Link>
    </li>
  )
}

function TripRow({ trip: t, today, hideClients = false }: { trip: PersonTrip; today: string; hideClients?: boolean }) {
  const where = tripWhere(t)
  return (
    <li>
      <Link to={tripHref(t.id)} data-trip={t.id}
        className={cn('grid grid-cols-2 items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px] text-text-1 transition-colors hover:bg-surface-2 sm:py-2.5',
          GRID, t.day < today && 'text-text-2')}>
        <span className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-1">
          <Car size={14} aria-hidden className="shrink-0 text-tint-fg-blue" />
          <span className="min-w-0">
            {hideClients
              ? <span className="block truncate font-semibold">Transportation trip</span>
              : <span className="block truncate font-semibold" data-clients="">{t.client_name || 'No client named'}</span>}
            <span className="block truncate text-[12px] text-text-3">
              {[where, t.vehicle_name || 'No vehicle yet'].filter(Boolean).join(' · ')}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          {dayWords(t.day)}
          {t.day === today && <span className="rounded-full bg-tint-primary px-1.5 text-[10.5px] font-semibold text-primary">Today</span>}
        </span>
        <span className="whitespace-nowrap text-right tabular-nums sm:text-left">{tripTimes(t)}</span>
        <span />
        <span className="flex flex-wrap justify-end gap-1 sm:justify-start">
          <span className="rounded-full bg-tint-blue px-2 py-0.5 text-[11px] font-semibold text-tint-fg-blue" data-kind="trip">Trip</span>
          {t.role && <span className="rounded-full bg-tint-slate px-2 py-0.5 text-[11px] font-medium text-tint-fg-slate" data-role={t.role}>{ROLE_WORD[t.role]}</span>}
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', TONE_PILL[t.tone])}>{t.word}</span>
        </span>
      </Link>
    </li>
  )
}
