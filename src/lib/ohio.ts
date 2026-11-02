// OHIO WALL-CLOCK, FOR EVERYONE.
// Ohio's timezone for every user, and never changed by mistake.

// Exported so screens that must NAME the platform zone (the schedule's "Times shown in …" line) say it from one…
export const ZONE = 'America/New_York'

/** Anything callers hand us → a valid Date, or null. */
function toDate(v: string | Date): Date | null {
  const d = v instanceof Date ? v : new Date(String(v ?? '').trim())
  return Number.isNaN(d.getTime()) ? null : d
}

const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
})
const TIME = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric' })
const DAY_YEAR = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', year: 'numeric' })
const LONG_DAY = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'long', month: 'long', day: 'numeric' })
const PARTS = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/** 'Aug 15, 2026, 9:14 AM' — the full stamp. */
export function ohioDateTime(v: string | Date): string {
  const d = toDate(v)
  return d ? DATE_TIME.format(d) : ''
}

/** '9:14 AM' — the clock alone. */
export function ohioTime(v: string | Date): string {
  const d = toDate(v)
  return d ? TIME.format(d) : ''
}

/** 'Aug 15' — the day, short. */
export function ohioDay(v: string | Date): string {
  const d = toDate(v)
  return d ? DAY.format(d) : ''
}

/** 'Aug 15, 2026' — the day with its year. */
export function ohioDayYear(v: string | Date): string {
  const d = toDate(v)
  return d ? DAY_YEAR.format(d) : ''
}

/** 'Friday, August 15' — the day, spoken. */
export function ohioLongDay(v: string | Date): string {
  const d = toDate(v)
  return d ? LONG_DAY.format(d) : ''
}

/** The Ohio calendar day an instant falls on, as a comparable 'y-m-d' key. */
function ohioDayKey(d: Date): string {
  const p: Record<string, string> = {}
  for (const { type, value } of PARTS.formatToParts(d)) p[type] = value
  return `${p.year}-${p.month}-${p.day}`
}

/** The Ohio calendar day an instant falls on, 'yyyy-mm-dd'; '' when unreadable. */
export function ohioDayOf(v: string | Date): string {
  const d = toDate(v)
  return d ? ohioDayKey(d) : ''
}

// Do two instants land on the same OHIO calendar day?
export function ohioSameDay(a: string | Date, b: string | Date): boolean {
  const da = toDate(a)
  const db = toDate(b)
  if (!da || !db) return false
  return ohioDayKey(da) === ohioDayKey(db)
}

// A bare 'yyyy-mm-dd' back as itself, anything else null — the sentry for the day-parse fixes: a value this shape…
export function dayOnly(v: string): string | null {
  const s = String(v ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

// OHIO'S TODAY as 'yyyy-mm-dd' — the default every date input and "today" comparison must use.
export function ohioToday(): string {
  return ohioDayKey(new Date())
}

const OFFSET = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, timeZoneName: 'shortOffset' })

// 'GMT-4' in summer, 'GMT-5' in winter — computed, never hardcoded, because a literal offset becomes a lie every…
export function ohioOffsetLabel(): string {
  const part = OFFSET.formatToParts(new Date()).find((p) => p.type === 'timeZoneName')
  return part ? part.value : 'GMT-5'
}

// Does this string carry its own zone?
const ZONED = /\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i

const WALL = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})

// OHIO'S CLOCK AS A PLAIN Date — for the places that must keep a date-fns pattern: a sheet column's own…
export function ohioWall(v: string | Date): Date | null {
  if (!(v instanceof Date)) {
    const s = String(v ?? '').trim()
    if (!s) return null
    const day = dayOnly(s)
    if (day) return new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), 12, 0, 0)
    if (!ZONED.test(s)) {
      const naive = new Date(s)
      return Number.isNaN(naive.getTime()) ? null : naive
    }
  }
  const d = toDate(v)
  if (!d) return null
  const p: Record<string, string> = {}
  for (const { type, value } of WALL.formatToParts(d)) p[type] = value
  // hour12:false answers '24' for midnight on some engines; '24:10' is 00:10.
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
}
