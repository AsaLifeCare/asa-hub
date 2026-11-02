// Ordering state for the sheet (moved verbatim from SheetTemplate.tsx): mode + shuffle seed, session-persisted…
import { useEffect, useMemo, useState } from 'react'
import { PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import type { OrderingMode } from './types'
import { loadOrder } from './ordering'

export function useSheetOrdering(orderStorageKey: string, allIds: string[]) {
  const [ordering, setOrdering] = useState<OrderingMode>('default')
  const [shuffleSeed, setShuffleSeed] = useState(1)
  const [manualOrder, setManualOrder] = useState<string[]>(() => loadOrder(orderStorageKey))
  // reload the stored session order if the tenant/resource key changes
  useEffect(() => {
    setManualOrder(loadOrder(orderStorageKey))
  }, [orderStorageKey])
  const orderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // press-and-hold to drag on touch, so row scrolling stays free
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  /** Live ids → stored order validated (unknown dropped, new appended). */
  const effectiveOrder = useMemo(() => {
    const kept = manualOrder.filter((id) => allIds.includes(id))
    return [...kept, ...allIds.filter((id) => !kept.includes(id))]
  }, [manualOrder, allIds])
  /** Natural 1-based row numbers, so a dragged row keeps its original `#n`. */
  const naturalIndex = useMemo(() => new Map(allIds.map((id, i) => [id, i + 1])), [allIds])

  const persistOrder = (ids: string[]) => {
    setManualOrder(ids)
    try {
      sessionStorage.setItem(orderStorageKey, JSON.stringify(ids))
    } catch {
      /* storage blocked — order stays in-memory */
    }
  }

  const onOrderDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    persistOrder(arrayMove(effectiveOrder, effectiveOrder.indexOf(String(active.id)), effectiveOrder.indexOf(String(over.id))))
  }

  const moveRow = (id: string, action: 'top' | 'up' | 'down') => {
    const ids = [...effectiveOrder]
    const i = ids.indexOf(id)
    if (i < 0) return
    ids.splice(i, 1)
    const j = action === 'top' ? 0 : action === 'up' ? Math.max(0, i - 1) : Math.min(ids.length, i + 1)
    ids.splice(j, 0, id)
    persistOrder(ids)
  }

  return { ordering, setOrdering, shuffleSeed, setShuffleSeed, orderSensors, effectiveOrder, naturalIndex, onOrderDragEnd, moveRow }
}
