// The client's week in the natural My Week's own shape (myCalendarModel.Week): the backend's myFamily answer read…
// What is shown is the backend's; only the wording is decided here.
import type { Appointment, FamilyCalendar, FamilyShift, FamilySource } from '@/pages/features/family/myFamily'
import { sourceLine } from '@/pages/features/family/myFamily'
import { dayHead, dayShift, mondayOf, type Day, type Week } from './myCalendarModel'

/** Is the answer held the week the address asks for ('' is this week)? While another is read, none is drawn. */
export function familyWeekCurrent(view: FamilyCalendar | null | undefined, asked: string): boolean {
  if (!view?.week) return false
  const want = String(asked ?? '').trim() ? mondayOf(asked) : view.week.this
  return !want || want === view.week.from
}

const readable = (s: FamilySource | null | undefined) => s?.state === 'ok' || s?.state === 'empty'

/** "Shifts at the house: …" — a source's own sentence under its label. */
const labelled = (s: FamilySource) => `${s.label || s.key}: ${sourceLine(s)}`

/** The line under the grid for appointments with no day written; '' for none. */
export function undatedLine(n: number): string {
  if (!(n > 0)) return ''
  return n === 1
    ? 'One appointment on file has no date yet, so it is not placed on a day.'
    : `${n} appointments on file have no date yet, so they are not placed on a day.`
}

export function nextLine(next: Appointment | null | undefined): string {
  return next?.day ? `Next appointment after this week: ${next.title || 'Doctor appointment'} on ${dayHead(next.day)}.` : ''
}

// The answer as the natural week.
export function familyWeekOf(view: FamilyCalendar): Week | null {
  const w = view.week
  if (!w) return null
  const shifts = view.shifts
  const appts = view.appointments
  const shiftsRead = readable(shifts?.source)
  const drawn = new Set(shifts?.drawn ?? [])
  const days: Day[] = Array.from({ length: 7 }, (_, i) => {
    const iso = dayShift(w.from, i)
    const has = shiftsRead && (shifts?.rows ?? []).some((s) => s.day === iso)
    const state = !shiftsRead || has ? 'shifts' : drawn.has(iso) ? 'none' : 'not_drawn'
    return { iso, state, why: state === 'not_drawn' ? 'No house calendar shows this day.' : '', cards: [], off: null, notes: [] }
  })
  const failed: string[] = []
  const notes: string[] = []
  for (const s of [shifts?.source, appts?.source]) {
    if (!s) continue
    if (s.state === 'not_applicable') notes.push(labelled(s))
    else if (!readable(s)) failed.push(sourceLine(s))
    else if (String(s.why ?? '').trim()) failed.push(sourceLine(s))
  }
  if (!shifts) failed.push('The shifts at the house were not answered, so none is shown.')
  const undated = undatedLine(appts?.undated ?? 0)
  const next = nextLine(appts?.next)
  if (next) notes.push(next)
  if (undated) notes.push(undated)
  return {
    from: w.from, to: w.to, this: w.this, prev: w.prev, next: w.next,
    head: { state: failed.length ? 'unreadable' : 'ready', why: failed.join(' '), copied_at: '', stale: false, stale_why: '' },
    days, notes,
  }
}

/** What one day holds: its appointments (by the clock) and the staff shifts at the house (by their start). */
export function familyDayOf(view: FamilyCalendar, iso: string): { appointments: Appointment[]; shifts: FamilyShift[] } {
  const shifts = readable(view.shifts?.source) ? (view.shifts?.rows ?? []).filter((s) => s.day === iso) : []
  const appointments = readable(view.appointments?.source) ? (view.appointments?.rows ?? []).filter((a) => a.day === iso) : []
  return { appointments, shifts }
}

const half = (hm: string): string => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hm ?? '').trim())
  if (!m) return ''
  const h = Number(m[1])
  return h > 23 ? '' : `${h % 12 || 12}:${m[2]}${h < 12 ? 'A' : 'P'}`
}

// A shift's hours as the house calendars write them ("7:00A-3:00P"), so the Time switch spells them as it does…
export function familyShiftCode(s: Pick<FamilyShift, 'start' | 'end'>): string {
  const a = half(s.start)
  const b = half(s.end)
  return a && b ? `${a}-${b}` : a ? `From ${a}` : b ? `Until ${b}` : ''
}

/** "Dr Ada · 12 Main St", without the parts that are not written. */
export function appointmentLine(a: Pick<Appointment, 'doctor' | 'place'>): string {
  return [a.doctor, a.place].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ')
}
