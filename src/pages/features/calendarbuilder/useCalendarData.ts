// Calendar Builder data — the Master Calendar Creator's roster, slice-only.
// The five resources are DERIVED slices: the snapshot service shapes them from the workbook's Postgres mirror…
import { useCallback, useEffect, useState } from 'react'
import { onSliceChange, readSlice, readSliceFloor } from '@/lib/snapshotClient'

export type GridCellKind =
  | 'morning' | 'afternoon' | 'evening' | 'overnight' | 'day' | 'off' | 'ro' | 'alias' | 'empty'

/** One day of one staff row, as written in the workbook. */
export type GridCell = {
  date: string
  text: string
  kind: GridCellKind
  start: number | null
  end: number | null
  token: string | null
}

// One column of the period, carried by the period row so the page never has to infer the layout.
export type GridPeriodCol = { index: number; iso: string; label: string; weekday: string }

/** Slice row 0: the period descriptor, not a person. */
export type GridPeriod = {
  rowType: 'period'
  start: string
  end: string
  days: number
  cells: GridPeriodCol[]
}

export type GridRowType = 'staff' | 'open' | 'workshop'

export type GridRow = {
  house: string
  designation: string
  employee: string
  rowType: GridRowType
  sheetRow: number
  cells: GridCell[]
}

export type CalendarConflict = {
  staff: string
  date: string
  houseA: string
  startA: string
  endA: string
  houseB: string
  startB: string
  endB: string
  /** 'time_off': the shift falls in approved time off, `from`–`until` (ISO), request `ref` */
  kind?: 'time_off'
  ref?: string
  from?: string
  until?: string
}

export type CalendarHours = {
  staff: string
  totalHours: number
  weeks: number
  perWeekAvg: number
  houses: string[]
  weekly: { weekStart: string; hours: number }[]
}

export type CalendarStaffPref = {
  name: string
  shifts: string
  pickup: string
  weekend: string
  allergy: string
  note: string
}

// One house: the master workbook's link (when the Houses tab carries one) joined with the live mirror…
export type CalendarHouse = {
  house: string
  sheetUrl: string
  sheetId: string
  tab: string
  staffRows: number
  liveAt: string
  hasLiveGrid: boolean
}

// time-off requests are read by Requests through the relay's feed, not here
const BUILDER_RESOURCES = [
  'calendarGrid',
  'calendarConflicts',
  'calendarHours',
  'calendarStaff',
  'calendarHouses',
] as const

/** One resource, slice-only. Throws when the roster cannot be served at all. */
async function readBuilder<T>(resource: string): Promise<{ rows: T[]; old: boolean }> {
  const fresh = await readSlice<T>(resource)
  if (fresh) return { rows: fresh, old: false }
  const floor = await readSliceFloor<T>(resource)
  if (floor) return { rows: floor.rows, old: true }
  throw new Error('The calendar service is not answering — this is not an empty schedule.')
}

// The grid slice mixes both shapes — the period descriptor and the staff rows — so it is read as a loose row and…
type GridSliceRow = {
  rowType?: string
  start?: string
  end?: string
  days?: number
  cells?: unknown
}

export function useCalendarData() {
  const [period, setPeriod] = useState<GridPeriod | null>(null)
  const [grid, setGrid] = useState<GridRow[] | null>(null)
  const [conflicts, setConflicts] = useState<CalendarConflict[] | null>(null)
  const [hours, setHours] = useState<CalendarHours[] | null>(null)
  const [staff, setStaff] = useState<CalendarStaffPref[] | null>(null)
  const [houses, setHouses] = useState<CalendarHouse[] | null>(null)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    let alive = true
    setError(null)
    Promise.all([
      readBuilder<GridSliceRow>('calendarGrid'),
      readBuilder<CalendarConflict>('calendarConflicts'),
      readBuilder<CalendarHours>('calendarHours'),
      readBuilder<CalendarStaffPref>('calendarStaff'),
      readBuilder<CalendarHouse>('calendarHouses'),
    ])
      .then(([g, c, h, s, ho]) => {
        if (!alive) return
        const rows = Array.isArray(g.rows) ? g.rows : []
        // Row 0 is the period descriptor; everything else is a grid row.
        const periodRow = rows.find((row) => row.rowType === 'period')
        setPeriod(
          periodRow
            ? {
                rowType: 'period',
                start: String(periodRow.start ?? ''),
                end: String(periodRow.end ?? ''),
                days: Number(periodRow.days ?? 0),
                cells: (periodRow.cells ?? []) as unknown as GridPeriodCol[],
              }
            : null,
        )
        setGrid(rows.filter((row) => row.rowType !== 'period') as GridRow[])
        setConflicts(Array.isArray(c.rows) ? c.rows : [])
        setHours(Array.isArray(h.rows) ? h.rows : [])
        setStaff(Array.isArray(s.rows) ? s.rows : [])
        setHouses(Array.isArray(ho.rows) ? ho.rows : [])
        setStale(g.old || c.old || h.old || s.old || ho.old)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'The calendar service did not answer.')
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => load(), [load])

  // The slices turn over quietly (60s rule); re-serve without a spinner.
  useEffect(
    () =>
      onSliceChange((resource) => {
        if ((BUILDER_RESOURCES as readonly string[]).includes(resource)) load()
      }),
    [load],
  )

  return {
    period,
    grid: grid ?? [],
    conflicts: conflicts ?? [],
    hours: hours ?? [],
    staff: staff ?? [],
    houses: houses ?? [],
    loading: grid === null && !error,
    /** serving the last known good file — say so on screen */
    stale,
    error,
    reload: load,
  }
}
