// The shift screens' data: derived slices (server/shift_slices.py) read from the slice shelf directly, never…
// A refused slice falls back to the last good file, marked old.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { onSliceChange, readSlice, readSliceFloor } from '@/lib/snapshotClient'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import {
  houseById as seedHouseById,
  rosterDayISO,
  type ShiftCard,
  type ShiftHouse,
  type ShiftMatrixCell,
  type ShiftTimelineEntry,
} from '@/lib/seed-shifts2'
import type { TintName } from '@/engine/types'
import type { PublishedMark } from './publishedMark'
import { useBuilderRefresh } from '@/pages/features/calendarbuilder/builderRefresh'

/** `published`: see publishedMark. */
export type MatrixCell = ShiftMatrixCell & { date: string; houseName: string; published?: PublishedMark }
export type TimelineEntry = ShiftTimelineEntry & { houseName?: string }

const HOUSE_TINTS: TintName[] = ['blue', 'mint', 'lavender', 'peach', 'pink', 'amber', 'green']

const SHIFT_RESOURCES = ['shiftCards', 'shiftMatrix', 'shiftTimeline'] as const

const normalizeCell = (raw: ShiftMatrixCell & Partial<MatrixCell>): MatrixCell => ({
  ...raw,
  date: raw.date ?? rosterDayISO(raw.dayIndex),
  houseName: raw.houseName ?? seedHouseById(raw.houseId)?.name ?? raw.houseId,
})

/** One resource, slice-only. Throws when the roster cannot be served at all. */
async function readRoster<T>(resource: string, live: boolean): Promise<{ rows: T[]; old: boolean }> {
  if (!live) return { rows: (await api.list<T>(resource as never)) as T[], old: false }
  const fresh = await readSlice<T>(resource)
  if (fresh) return { rows: fresh, old: false }
  const floor = await readSliceFloor<T>(resource)
  if (floor) return { rows: floor.rows, old: true }
  throw new Error('The roster service is not answering — this is not an empty schedule.')
}

export function useShiftData() {
  const [cards, setCards] = useState<ShiftCard[] | null>(null)
  const [matrix, setMatrix] = useState<MatrixCell[] | null>(null)
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(null)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = useApiConfigStore((s) => s.driver) === 'apps-script'

  const load = useCallback(() => {
    let alive = true
    setError(null)
    Promise.all([
      readRoster<ShiftCard>('shiftCards', live),
      readRoster<ShiftMatrixCell>('shiftMatrix', live),
      readRoster<TimelineEntry>('shiftTimeline', live),
    ])
      .then(([c, m, t]) => {
        if (!alive) return
        setCards(Array.isArray(c.rows) ? c.rows : [])
        setMatrix((Array.isArray(m.rows) ? m.rows : []).map(normalizeCell))
        setTimeline(Array.isArray(t.rows) ? t.rows : [])
        setStale(c.old || m.old || t.old)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'The roster did not answer.')
      })
    return () => {
      alive = false
    }
  }, [live])

  useEffect(() => load(), [load])
  // Calendar Builder's Refresh (no-op elsewhere)
  useBuilderRefresh(load)

  // The slices turn over quietly (60s rule); re-serve without a spinner.
  useEffect(
    () =>
      onSliceChange((resource) => {
        if ((SHIFT_RESOURCES as readonly string[]).includes(resource)) load()
      }),
    [load],
  )

  /** Rail list derived from the cells; seed houses keep their identity in demo. */
  const houses = useMemo<ShiftHouse[]>(() => {
    const seen = new Map<string, string>()
    for (const c of matrix ?? []) if (!seen.has(c.houseId)) seen.set(c.houseId, c.houseName)
    return [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name], i) => {
        const seeded = seedHouseById(id)
        if (seeded) return seeded
        return {
          id,
          code: id,
          name,
          address: '',
          residents: [],
          capacity: 0,
          colorTint: HOUSE_TINTS[i % HOUSE_TINTS.length],
        }
      })
  }, [matrix])

  const houseLookup = useCallback(
    (id: string) => houses.find((h) => h.id === id),
    [houses],
  )

  return {
    cards: cards ?? [],
    matrix: matrix ?? [],
    timeline: timeline ?? [],
    houses,
    houseLookup,
    loading: cards === null && !error,
    /** serving the last known good file — say so on screen */
    stale,
    error,
    reload: load,
  }
}
