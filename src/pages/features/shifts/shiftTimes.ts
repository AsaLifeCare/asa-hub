// Shift times for the Builder's panel.
// `codeOf` matches calendar_builder_houses.code_of (both held to tests/spa/fixtures/builder-codes.json); a cell…
import { ZONE } from '@/lib/ohio'
import { readRange } from './cellClock'

/** One end of a range: 8 → '8A', 21.5 → '930P', 31.25 → '715A' (past 24 wraps). */
function halfOf(hour: number): string {
  const total = ((Math.round(hour * 60) % 1440) + 1440) % 1440
  const hh = Math.floor(total / 60)
  const mm = total % 60
  const ap = hh >= 12 ? 'P' : 'A'
  const twelve = hh % 12 === 0 ? 12 : hh % 12
  return mm ? `${twelve}${String(mm).padStart(2, '0')}${ap}` : `${twelve}${ap}`
}

/** Two decimal hours → the cell code: (21.5, 7.5) → '930P-730A'. */
export function codeOf(start: number, end: number): string {
  return `${halfOf(start)}-${halfOf(end)}`
}

/** Range length, overnight wrapped: (22, 8) → 10; equal ends are a whole day. */
export function spanHours(start: number, end: number): number {
  const len = (((end - start) % 24) + 24) % 24
  return len === 0 ? 24 : Math.round(len * 100) / 100
}

/** A decimal hour as a time input's value: 21.5 → '21:30', 31.5 → '07:30'. */
export function timeInputOf(hour: number | null | undefined): string {
  if (hour === null || hour === undefined || Number.isNaN(hour)) return ''
  const total = ((Math.round(hour * 60) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** A time input's value as a decimal hour: '21:30' → 21.5; '' → null. */
export function hourOfTimeInput(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h + min / 60
}

/** A plain range's two times (and its leading star), else null. */
export function timesOf(text: string | null | undefined): { start: number; end: number; star: boolean } | null {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const got = readRange(raw)
  return got ? { ...got, star: raw.startsWith('*') } : null
}

/** How long a shift that began at `startsAt` has been running: '3h 12m'. */
export function runningFor(startsAt: string, nowMs: number): string {
  const began = Date.parse(startsAt)
  if (!Number.isFinite(began) || nowMs < began) return ''
  const mins = Math.floor((nowMs - began) / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

const OHIO_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
})

/** Ohio's hour now, rounded to `step` minutes ("End now"). */
export function ohioHourNow(nowMs: number, step = 15): number {
  const parts = OHIO_CLOCK.formatToParts(new Date(nowMs))
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  const rounded = Math.round((h * 60 + m) / step) * step
  return (rounded % 1440) / 60
}
