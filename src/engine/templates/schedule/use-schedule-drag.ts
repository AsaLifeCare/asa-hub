// Pointer drags: drag-to-create ghost, drag-move (retime/reassign) and bottom-handle resize — all slot-snapped.
// Handler bodies moved verbatim from ScheduleTemplate.tsx; the values they closed over are now hook params…
import { useRef } from 'react'
import type * as React from 'react'
import { format } from 'date-fns'
import { api } from '@/lib/api'
import type { CalEvent } from '@/engine/types'
import type { DragState, Draft, Resource } from './types'
import { HOUR_PX, clampNum, fromMin, toMin } from './utils'

export function useScheduleDrag({
  canEdit,
  view,
  slot,
  snap,
  startMin0,
  endMin0,
  gridRef,
  resources,
  todayInWeek,
  now,
  weekStart,
  lastType,
  setDrag,
  setDraft,
  setAnchor,
  setEvents,
}: {
  canEdit: boolean
  view: string
  slot: number
  snap: (min: number) => number
  startMin0: number
  endMin0: number
  gridRef: React.RefObject<HTMLDivElement | null>
  resources: Resource[]
  todayInWeek: boolean
  now: Date
  weekStart: Date
  lastType: string
  setDrag: React.Dispatch<React.SetStateAction<DragState | null>>
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>
  setAnchor: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
  setEvents: React.Dispatch<React.SetStateAction<CalEvent[]>>
}) {
  const dragRef = useRef<any>(null)
  /* set after a move/resize so the trailing click doesn't open the detail panel */
  const suppressClick = useRef(false)

  const yToMin = (clientY: number) => {
    const rect = gridRef.current!.getBoundingClientRect()
    return startMin0 + ((clientY - rect.top) / HOUR_PX) * 60
  }
  const columnRects = () =>
    Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-res]') ?? []).map((el) => ({
      id: el.dataset.res!,
      rect: el.getBoundingClientRect(),
    }))

  const startCreateDrag = (e: React.PointerEvent, personId: string) => {
    if (e.button !== 0 || view !== 'week' || !canEdit) return
    const anchorMin = clampNum(snap(yToMin(e.clientY)), startMin0, endMin0 - slot)
    dragRef.current = { kind: 'create', personId, anchorMin, startMin: anchorMin, endMin: anchorMin + slot }
    setDrag({ kind: 'create', personId, startMin: anchorMin, endMin: anchorMin + slot })
    const move = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const cur = clampNum(snap(yToMin(ev.clientY)), startMin0, endMin0)
      d.startMin = Math.min(d.anchorMin, cur)
      d.endMin = Math.max(d.anchorMin + slot, cur)
      setDrag({ kind: 'create', personId: d.personId, startMin: d.startMin, endMin: d.endMin })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d || d.endMin - d.startMin < slot) return
      const date = todayInWeek ? format(now, 'yyyy-MM-dd') : format(weekStart, 'yyyy-MM-dd')
      setDraft({ personId: d.personId, date, startMin: d.startMin, durationMin: d.endMin - d.startMin, type: lastType, title: '' })
      setAnchor({ x: ev.clientX, y: ev.clientY })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startMoveDrag = (e: React.PointerEvent, ev0: CalEvent) => {
    if (e.button !== 0 || !canEdit || ev0.readOnly) return
    e.stopPropagation()
    const cols = columnRects()
    dragRef.current = {
      kind: 'move', id: ev0.id, startX: e.clientX, startY: e.clientY, active: false,
      origStart: toMin(ev0.start), startMin: toMin(ev0.start), personId: ev0.personId, cols, dur: ev0.durationMin,
    }
    setDrag({ kind: 'move', id: ev0.id, personId: ev0.personId, startMin: toMin(ev0.start), active: false })
    const move = (pev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const dy = pev.clientY - d.startY
      if (!d.active && Math.abs(dy) + Math.abs(pev.clientX - d.startX) < 5) return
      d.active = true
      d.startMin = clampNum(snap(d.origStart + (dy / HOUR_PX) * 60), startMin0, endMin0 - d.dur)
      const hit = d.cols.find((c: any) => pev.clientX >= c.rect.left && pev.clientX <= c.rect.right)
      if (hit && resources.some((r) => r.id === hit.id)) d.personId = hit.id
      setDrag({ kind: 'move', id: d.id, personId: d.personId, startMin: d.startMin, active: true })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d?.active) return
      suppressClick.current = true
      setEvents((prev) => prev.map((x) => (x.id === d.id ? { ...x, start: fromMin(d.startMin), personId: d.personId } : x)))
      api.update('events', d.id, { start: fromMin(d.startMin), personId: d.personId }).catch(() => {})
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startResizeDrag = (e: React.PointerEvent, ev0: CalEvent) => {
    if (e.button !== 0 || !canEdit || ev0.readOnly) return
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = { kind: 'resize', id: ev0.id, startY: e.clientY, origEnd: toMin(ev0.start) + ev0.durationMin, origStart: toMin(ev0.start), endMin: toMin(ev0.start) + ev0.durationMin }
    const move = (pev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      d.endMin = clampNum(snap(d.origEnd + ((pev.clientY - d.startY) / HOUR_PX) * 60), d.origStart + slot, endMin0)
      setDrag({ kind: 'resize', id: d.id, endMin: d.endMin })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d) return
      suppressClick.current = true
      const dur = d.endMin - d.origStart
      setEvents((prev) => prev.map((x) => (x.id === d.id ? { ...x, durationMin: dur } : x)))
      api.update('events', d.id, { durationMin: dur }).catch(() => {})
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return { startCreateDrag, startMoveDrag, startResizeDrag, suppressClick }
}
