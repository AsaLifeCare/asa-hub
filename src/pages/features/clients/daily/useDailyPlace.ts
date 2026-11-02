// WHERE THE READER IS IN ONE CLIENT'S DAILY NOTES — the filter and the page — and the lists they page through.
// THE SECTION DOES NOT STAY MOUNTED.
import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { forgetKeptPage, usePager } from '@/lib/pager'
import { onForgetAllKept } from '@/lib/kept'
import type { DailyNote } from './dailyApi'
import {
  type DailyDay, type DailyFilter, type ScheduleRead,
  DAYS_PER_PAGE, filterNotes, groupNotes,
} from './grouping'

export type DailyLook = 'record' | 'unique'

const LOOKS: readonly DailyLook[] = ['record', 'unique']

/** One view of one client's Daily notes — what a place is kept under. */
export function placeKey(look: DailyLook, client: string): string {
  return `daily:${look}:${client}`
}

// The id a kept page follows: the DAY itself, which is what the door cut from the row and never moves — not the…
export const dayId = (d: DailyDay): string => `day:${d.day}`

const daysKey = (place: string) => `${place}:days`

export const MAX_KEPT_FILTERS = 100

const filters = new Map<string, DailyFilter>()

export function keptFilter(place: string): DailyFilter {
  return filters.get(place) ?? 'all'
}

/** 'all' is where every place starts, so keeping it is forgetting the rest. */
export function keepFilter(place: string, filter: DailyFilter): void {
  filters.delete(place)
  if (filter === 'all') return
  filters.set(place, filter)
  while (filters.size > MAX_KEPT_FILTERS) {
    const oldest = filters.keys().next().value
    if (oldest === undefined) break
    filters.delete(oldest)
  }
}

export function forgetKeptFilters(): void {
  filters.clear()
}

onForgetAllKept(forgetKeptFilters)

/** Forget one client's place in both views — its filter and its page of days. */
export function forgetDailyPlace(client: string): void {
  for (const look of LOOKS) {
    const place = placeKey(look, client)
    filters.delete(place)
    forgetKeptPage(daysKey(place))
  }
}

// THE CHART'S HOLD ON THE PLACE.
export function useDailyPlaceScope(client: string): void {
  useEffect(() => {
    if (!client) return
    return () => forgetDailyPlace(client)
  }, [client])
}

// The Daily section's filter, its list of days and its pager, with the place kept.
export function useDailyPlace(look: DailyLook, client: string, notes: DailyNote[], schedule: ScheduleRead) {
  const place = placeKey(look, client)
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const filter = keptFilter(place)
  const setFilter = useCallback((f: DailyFilter) => {
    keepFilter(place, f)
    redraw()
  }, [place, redraw])

  const days = useMemo(() => groupNotes(filterNotes(notes, filter), schedule), [notes, filter, schedule])
  // a separator no client name carries, so no name and filter run together
  const resetKey = `${client}${filter}`
  const pager = usePager(days, DAYS_PER_PAGE, resetKey, { key: daysKey(place), idOf: dayId })

  return { filter, setFilter, days, pager }
}
