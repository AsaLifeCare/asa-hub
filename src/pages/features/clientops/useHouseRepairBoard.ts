// House Repair's rows and what the reader did to them: the focus scope, the ordering, the header's figures, and the…
// The list and the black header both draw from here, so a figure and its list cannot disagree.
import { useEffect, useMemo, useState } from 'react'
import { recordMatchesFocus } from '@/lib/focus'
import { ohioSameDay } from '@/lib/ohio'
import { useContextStore } from '@/stores/useContextStore'
import { useOpsCrud, type OpsOrder } from '@/features/ops-flows/useOpsCrud'
import {
  analyseRepairs,
  repairFilterTest,
  sameRepairFilter,
  statusTints,
  toRepairRow,
  type Priority,
  type RepairFilter,
  type RepairRow,
} from '@/lib/houseRepairAnalysis'
import type { RepairRead } from './HouseRepairHero'

/** The shared four, plus the urgency ordering a maintenance coordinator reaches for first. */
export type RepairOrder = OpsOrder | 'priority'

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
/** An unreadable urgency sorts after low. */
const priorityRank = (r: RepairRow) => (r.priority ? PRIORITY_RANK[r.priority] : 4)

/** An undated request sinks to the bottom of either date ordering, never leads it. */
const UNDATED_LAST = { newest: -8.64e15, oldest: 8.64e15 }
const time = (r: RepairRow, undated: number) => r.reported?.getTime() ?? undated

function ordered(rows: RepairRow[], order: RepairOrder, seed: number): RepairRow[] {
  const out = [...rows]
  if (order === 'random') {
    // one shuffle per press, stable across re-renders
    let s = seed || 1
    for (let i = out.length - 1; i > 0; i--) {
      s = (s * 1664525 + 1013904223) % 4294967296
      const j = s % (i + 1)
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  const newest = (a: RepairRow, b: RepairRow) => time(b, UNDATED_LAST.newest) - time(a, UNDATED_LAST.newest)
  out.sort((a, b) => {
    // a cancelled request is not work — it sinks under everything still live
    if (a.cancelled !== b.cancelled) return a.cancelled ? 1 : -1
    if (order === 'priority') return priorityRank(a) - priorityRank(b) || newest(a, b)
    if (order === 'name') return a.house.localeCompare(b.house) || priorityRank(a) - priorityRank(b)
    if (order === 'oldest') return time(a, UNDATED_LAST.oldest) - time(b, UNDATED_LAST.oldest) || priorityRank(a) - priorityRank(b)
    return newest(a, b) || priorityRank(a) - priorityRank(b)
  })
  return out
}

/** The instant the figures are aged against; it moves when Ohio's day turns, seen each minute and at every read. */
function useOhioNow(clock: () => number, read: unknown): number {
  const [now, setNow] = useState(clock)
  useEffect(() => {
    const tick = () => {
      const t = clock()
      setNow((prev) => (ohioSameDay(new Date(prev), new Date(t)) ? prev : t))
    }
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [clock, read])
  return now
}

export function useHouseRepairBoard(clock: () => number = Date.now) {
  const crud = useOpsCrud({
    resource: 'workOrders',
    titleKey: 'select_address_vehicle',
    dateKey: 'timestamp',
    witnessKey: 'select_address_vehicle',
  })
  const raw = crud.rows
  const rows = useMemo(() => (crud.loading ? null : raw.map(toRepairRow)), [raw, crud.loading])
  const order = crud.order as RepairOrder
  const setOrder = (o: RepairOrder) => crud.setOrder(o as OpsOrder)

  /** The house IS the client side of this dataset — that is the join it has. */
  const focus = useContextStore((s) => s.focus)
  const clientFocus = focus?.type === 'client' ? focus : null
  const scoped = useMemo(() => {
    const all = rows ?? []
    if (!clientFocus) return all
    const matched = all.filter((r) => recordMatchesFocus(r.house, clientFocus))
    return matched.length ? matched : all
  }, [rows, clientFocus])
  const focusFiltered = !!clientFocus && scoped.some((r) => recordMatchesFocus(r.house, clientFocus))

  const sorted = useMemo(() => ordered(scoped, order, crud.shuffleSeed), [scoped, order, crud.shuffleSeed])

  const now = useOhioNow(clock, rows)
  const figures = useMemo(() => analyseRepairs(scoped, now), [scoped, now])
  const tints = useMemo(() => statusTints(figures.statuses), [figures])
  const read: RepairRead = crud.error
    ? { state: 'failed', reason: crud.error }
    : rows === null ? { state: 'loading' } : { state: 'ready', figures }

  const [picked, setPicked] = useState<RepairFilter | null>(null)
  /** the ordering the 'Oldest open' figure replaced, put back when that figure lets go */
  const [orderBefore, setOrderBefore] = useState<RepairOrder | null>(null)
  // "done this month" stays this month's when the month turns under an open page
  const filter = useMemo<RepairFilter | null>(
    () => (picked?.kind === 'month-done' && picked.month !== figures.month.key
      ? { ...picked, month: figures.month.key, name: figures.month.name }
      : picked),
    [picked, figures.month],
  )
  const visible = useMemo(() => (filter ? sorted.filter(repairFilterTest(filter)) : sorted), [sorted, filter])

  const letGoOfOldest = () => {
    if (orderBefore) setOrder(orderBefore)
    setOrderBefore(null)
  }
  const clearFilter = () => {
    letGoOfOldest()
    setPicked(null)
  }
  /** A figure clicked narrows the list to what it counted; clicked again, it lets go. */
  const pick = (f: RepairFilter) => {
    if (sameRepairFilter(filter, f)) return clearFilter()
    if (f.kind === 'oldest') {
      if (order !== 'oldest') {
        setOrderBefore(order)
        setOrder('oldest')
      }
    } else letGoOfOldest()
    setPicked(f)
  }
  /** The ordering select: the reader's own choice, so nothing is put back over it. */
  const chooseOrder = (o: RepairOrder) => {
    setOrderBefore(null)
    if (filter?.kind === 'oldest' && o !== 'oldest') setPicked({ kind: 'open' })
    setOrder(o)
  }

  return {
    crud,
    rows,
    order,
    chooseOrder,
    clientFocus,
    focusFiltered,
    sorted,
    visible,
    figures,
    tints,
    read,
    filter,
    pick,
    clearFilter,
  }
}

export type HouseRepairBoard = ReturnType<typeof useHouseRepairBoard>
