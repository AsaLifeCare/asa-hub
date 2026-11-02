/** Time off on the house grids, in one place: the Time Off app feeds each cell's mark, every view draws it from here. */
import { useMemo, type CSSProperties } from 'react'
import { cellKey, type Grid } from './houseCalTypes'

/** `scheduled`: on the roster (a slate hatch and TO). `asked`: a request not on it yet (a slate corner flag, never dashed). */
export type TimeOffMark = 'asked' | 'scheduled'

/** Keyed by the grid's cell key, `${employee}|${col_iso}` (houseCalTypes.cellKey). */
export type TimeOffMarks = ReadonlyMap<string, TimeOffMark>

/** What the relay lays on one cell for the Time Off app (`time_off`); `pending` is a request nobody approved yet. */
export type TimeOffFeed = { state?: string; ref?: string; until?: string }

const NONE: TimeOffMarks = new Map()

/** The feed's state as this grid draws it; a state it does not know draws nothing, never a guess. */
export function timeOffMarkOf(fed: TimeOffFeed | null | undefined): TimeOffMark | null {
  const state = String(fed?.state ?? '').trim().toLowerCase()
  if (state === 'scheduled') return 'scheduled'
  if (state === 'pending' || state === 'asked') return 'asked'
  return null
}

/** Every mark the relay laid on one house's grid; an asked day is kept for the house's editors only. */
export function timeOffMarksOf(grid: Pick<Grid, 'cols' | 'rows'> | null | undefined, editor: boolean): TimeOffMarks {
  if (!grid) return NONE
  const isos = grid.cols.map((c) => String(c.iso || c.date || ''))
  const out = new Map<string, TimeOffMark>()
  for (const r of grid.rows) {
    // an OPEN row or the call-off line is nobody, so nobody is off on it
    if (r.open_row || r.call_off_row) continue
    r.cells.forEach((c, i) => {
      const mark = timeOffMarkOf(c?.time_off)
      if (!mark || !isos[i] || (mark === 'asked' && !editor)) return
      out.set(cellKey(r.employee, isos[i]), mark)
    })
  }
  return out.size ? out : NONE
}

/** One house's marks for this reader, read off the grid the server answered; the relay cuts asked days, `editor` only hides. */
export function useTimeOffMarks(grid: Pick<Grid, 'cols' | 'rows'> | null | undefined, editor: boolean): TimeOffMarks {
  return useMemo(() => timeOffMarksOf(grid, editor), [grid, editor])
}

/** The mark this reader sees on one cell; an asked day is shown to the house's editors only. */
export function timeOffAt(marks: TimeOffMarks | null | undefined, key: string,
                          editor: boolean): TimeOffMark | null {
  const got = marks?.get(key) ?? null
  if (got === 'asked' && !editor) return null
  return got
}

/** The hatch, laid over whatever fill the cell has. */
export const TIME_OFF_HATCH: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, color-mix(in srgb, var(--text-2) 24%, transparent) 0 2px, transparent 2px 7px)',
}

/** The corner flag's classes: a slate triangle in the cell's top-left corner. */
export const TIME_OFF_FLAG = 'pointer-events-none absolute left-0 top-0 h-0 w-0 border-r-[7px] border-t-[7px] border-r-transparent border-t-text-2'

/** How each mark is drawn and said: the one reading every view shares. */
export const TIME_OFF_LOOK: Record<TimeOffMark, {
  /** the Key's state id (calendarScreen.statesPresent, RangeBar) */
  state: string
  /** the Key's label */
  key: string
  /** the cell's title */
  words: string
  /** the slate hatch over the fill */
  hatch: boolean
  /** the slate corner flag, top-left */
  flag: boolean
  /** the tag after the value; '' for none */
  tag: string
  /** the person is off that day: a shift on it is a conflict, and a phone's agenda lists them as off */
  away: boolean
}> = {
  scheduled: { state: 'time-off', key: 'Time off', words: 'Time off, on the roster',
               hatch: true, flag: false, tag: 'TO', away: true },
  asked: { state: 'time-off-asked', key: 'Time off asked', words: 'Time off asked, not on the roster yet',
           hatch: false, flag: true, tag: '', away: false },
}

/** The words for a marked cell's title and the key. */
export const TIME_OFF_WORDS: Record<TimeOffMark, string> = {
  scheduled: TIME_OFF_LOOK.scheduled.words,
  asked: TIME_OFF_LOOK.asked.words,
}

/** The Key's two entries, in the order the Key lists them. */
export const TIME_OFF_KEY: { id: string; label: string; style?: CSSProperties; flag: boolean }[] =
  (['scheduled', 'asked'] as const).map((m) => ({
    id: TIME_OFF_LOOK[m].state, label: TIME_OFF_LOOK[m].key,
    style: TIME_OFF_LOOK[m].hatch ? TIME_OFF_HATCH : undefined, flag: TIME_OFF_LOOK[m].flag,
  }))

/** The cell's fill: the hatch for scheduled time off, never over an OPEN fill (OPEN > hatch > kind). */
export function timeOffFill(mark: TimeOffMark | null | undefined, open: boolean): CSSProperties | undefined {
  return mark && TIME_OFF_LOOK[mark].hatch && !open ? TIME_OFF_HATCH : undefined
}

/** Whether the person is off that day; an asked day is not off until it is on the roster. */
export function isAway(mark: TimeOffMark | null | undefined): boolean {
  return Boolean(mark && TIME_OFF_LOOK[mark].away)
}

/** The editor's warning before a shift is saved onto a marked day: said, never a block here. */
export function timeOffWarning(mark: TimeOffMark, employee: string): string {
  return mark === 'scheduled'
    ? `${employee} has time off on the roster this day: a shift here is a conflict with it.`
    : `${employee} asked for this day off; it is not on the roster yet.`
}

/** When the relay could not lay time off on this grid: said, so an empty grid is never read as nobody off. */
export function timeOffUnreadLine(grid: Pick<Grid, 'time_off'> | null | undefined): string {
  const t = grid?.time_off
  if (!t || t.readable) return ''
  return `Time off could not be read${t.why ? ` (${t.why})` : ''} — this is not saying nobody is off.`
}
