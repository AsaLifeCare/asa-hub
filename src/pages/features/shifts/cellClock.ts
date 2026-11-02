// THE CLOCK SPELLING OF A CELL — `930P-730A` read out loud as `9:30 PM – 7:30 AM`, and nothing else.
// WHY IT EXISTS.
import { hhmm } from './houseCalTypes'

/** The dash the estate's own time ranges are written with. */
export const CLOCK_DASH = '–'

// One time of day: 8A · 8:30A · 830a · 2pm · 1145a (shift_slices._T), and the same with the meridiem optional, for…
const T_MERIDIEM = String.raw`(\d{1,2})(?::?(\d{2}))?\s*([AP])M?`
const T_LOOSE = String.raw`(\d{1,2})(?::?(\d{2}))?\s*([AP])?M?`
const RANGE = `${T_LOOSE}\\s*[-–]\\s*${T_MERIDIEM}`

// The anchored shape — a segment that IS a range, leading star and short trailing word included ("6P-7P IST")…
const WHOLE = new RegExp(`^\\*?\\s*${RANGE}(?:\\s+[A-Za-z]{1,4})?\\s*$`, 'i')
/** The same range wherever it sits, for cells that carry words too. */
const ANYWHERE = new RegExp(RANGE, 'gi')
/** The segment separators inside one cell: "BM > 8P-8A", "48TH (B)<7A-3P". */
const CHAIN = /(\s*[><]\s*)/

/** One half of a range in decimal hours — shift_slices._hour. */
function hourOf(h: string, m: string | undefined, ap: string): number {
  return (Number(h) % 12) + (ap.toUpperCase() === 'P' ? 12 : 0) + (m ? Number(m) / 60 : 0)
}

/** A matched range in decimal hours — shift_slices._range, same rules. */
function fromMatch(m: RegExpMatchArray): { start: number; end: number } {
  const [, h1, m1, ap1, h2, m2, ap2] = m
  // "230-10p": the first half borrows the meridiem of the second, and is then pushed back a half-day when that…
  let start = hourOf(h1, m1, ap1 || ap2)
  let end = hourOf(h2, m2, ap2)
  if (!ap1 && start >= end) start = (((start - 12) % 24) + 24) % 24
  if (end <= start) end += 24 // crosses midnight, carried past 24 as the relay carries it
  return { start, end }
}

// One segment → the hours the estate reads in it, or null when it is not a range: the answer…
export function readRange(segment: string): { start: number; end: number } | null {
  const m = WHOLE.exec(segment.trim())
  return m ? fromMatch(m) : null
}

/** A range in clock times: `9:30 PM – 7:30 AM`. */
export function rangeText(start: number, end: number): string {
  return `${hhmm(start)} ${CLOCK_DASH} ${hhmm(end)}`
}

// A character a range must not be glued to.
const GLUED = /[A-Za-z0-9:\-–]/

/** Every range in one segment, spelled out; everything around them kept. */
function spellRanges(part: string): string {
  let out = ''
  let cut = 0
  for (const m of part.matchAll(ANYWHERE)) {
    const at = m.index ?? 0
    const before = at > 0 ? part[at - 1] : ''
    const after = part[at + m[0].length] ?? ''
    if ((before && GLUED.test(before)) || (after && GLUED.test(after))) continue
    const { start, end } = fromMatch(m)
    out += part.slice(cut, at) + rangeText(start, end)
    cut = at + m[0].length
  }
  return out + part.slice(cut)
}

// THE CELL, SPELLED OUT.
export function clockText(raw: string | undefined | null): string {
  const text = String(raw ?? '')
  if (!text.trim()) return text
  // Chained segments are spelled one by one, and the separator between them is the sheet's own: a cell says "BM >…
  return text.split(CHAIN).map((part, i) => (i % 2 ? part : spellRanges(part))).join('')
}

/** The cell as the screen should draw it, under the Time switch or not. */
export function cellText(raw: string | undefined | null, clock: boolean): string {
  return clock ? clockText(raw) : String(raw ?? '')
}

// A DECIMAL HOUR, WRITTEN OUT — for the calendars that never see a code at all.
export function hourText(h: number, clock: boolean): string {
  if (clock) return hhmm(h)
  const total = Math.round(h * 60)
  const hours = (((Math.floor(total / 60) % 24) + 24) % 24)
  const mins = (((total % 60) + 60) % 60)
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}
