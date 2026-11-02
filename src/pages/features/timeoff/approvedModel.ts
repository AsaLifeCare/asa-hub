/** The approved time off's panel (the operator's layout): its words, pure. The facts are the server's (app/time_off_approved.py). */

/** One scheduled shift the request overlaps, on Scheduling's calendars; minutes from its day's midnight. */
export type ImpactedShift = {
  date: string
  house_code: string
  location: string
  start_min: number
  end_min: number
  text: string
  /** 'given_up' when the approval put it up as an open shift */
  state: string
}

/** What the panel shows past the request's own facts; a part that could not be read is null with its sentence. */
export type ApprovedFacts = {
  year: number | null
  year_days: number | null
  year_why?: string
  shifts: ImpactedShift[] | null
  shifts_why?: string
}

/** What the approved panel draws, from whichever record opened it. */
export type ApprovedView = {
  person: string
  start: string
  end: string
  /** when the request was filed: a day or a timestamp */
  requested: string
  days: number
  /** null: this reader is not one who reads the reason; undefined: not read yet */
  reason: string | null | undefined
  facts: ApprovedFacts | null
  /** why the facts are missing whole */
  factsWhy?: string
  /** the record is still being read */
  reading?: boolean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The calendar day a day or a timestamp is in Ohio, as YYYY-MM-DD; '' when it is neither. */
export function ohioDay(v: string): string {
  const s = String(v || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (!s || Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

/** 'Nov 03, 2026' — a day as the panel writes it, never moved by the reader's clock. */
export function longDate(v: string): string {
  const day = ohioDay(v)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return v ? String(v) : '—'
  return `${MONTHS[Number(m[2]) - 1]} ${m[3]}, ${m[1]}`
}

/** The day `n` days after an ISO day. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** '10:00 PM' for minutes from a midnight; 1860 is 7:00 AM the next day. */
export function clockWords(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** One table row: the end's own day under the time when the shift ends on another day. */
export function shiftCells(s: Pick<ImpactedShift, 'date' | 'start_min' | 'end_min'>): {
  date: string; start: string; end: string; endDate: string
} {
  const over = Math.floor(s.end_min / 1440)
  return {
    date: longDate(s.date),
    start: clockWords(s.start_min),
    end: clockWords(s.end_min),
    endDate: over > 0 ? longDate(addDays(s.date, over)) : '',
  }
}

export function daysLine(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`
}

/** 'Approved time off · 2026' — the request's own year. */
export function yearLabel(facts: ApprovedFacts | null, start: string): string {
  const year = facts?.year ?? (Number(ohioDay(start).slice(0, 4)) || null)
  return year ? `Approved time off · ${year}` : 'Approved time off'
}
