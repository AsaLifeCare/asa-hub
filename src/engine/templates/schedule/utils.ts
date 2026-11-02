/** Layout constants + pure time/geometry helpers (moved verbatim from ScheduleTemplate.tsx). */
import type { CalEvent } from '@/engine/types'
import type { Laid } from './types'

export const HOUR_PX = 56
export const GUTTER_W = 64
export const COL_MIN_W = 180
/** A stored view outranks the configured default — bump this key to deliver a new default. */
export const VIEW_KEY = 'asa-hub:schedule-view.month-default'

export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
export const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const endLabel = (e: CalEvent) => fromMin(toMin(e.start) + e.durationMin)
export const houseOf = (e: CalEvent) => e.notes?.match(/House: ([^.]+)/)?.[1]?.trim() ?? '—'

/* ---------------- overlap layout: side-by-side split (50/50…) ---------------- */

export function layoutColumn(evs: CalEvent[], startH: number): Laid[] {
  const items = evs
    .map((e) => ({ e, s: toMin(e.start), en: toMin(e.start) + e.durationMin }))
    .sort((a, b) => a.s - b.s || a.en - b.en)
  const out: Laid[] = []
  let cluster: typeof items = []
  let clusterEnd = -1
  const flush = () => {
    if (!cluster.length) return
    const laneEnds: number[] = []
    const startIdx = out.length
    for (const it of cluster) {
      let lane = laneEnds.findIndex((end) => end <= it.s)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(0)
      }
      laneEnds[lane] = it.en
      out.push({
        e: it.e,
        lane,
        lanes: 0,
        top: ((it.s - startH * 60) / 60) * HOUR_PX,
        height: Math.max((it.e.durationMin / 60) * HOUR_PX - 3, 20),
      })
    }
    for (let i = startIdx; i < out.length; i++) out[i].lanes = laneEnds.length
    cluster = []
  }
  for (const it of items) {
    if (cluster.length && it.s < clusterEnd) {
      cluster.push(it)
      clusterEnd = Math.max(clusterEnd, it.en)
    } else {
      flush()
      cluster = [it]
      clusterEnd = it.en
    }
  }
  flush()
  return out
}
