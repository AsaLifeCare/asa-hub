/** Shared types for the `schedule` template (moved verbatim from ScheduleTemplate.tsx). */
import type { CalEvent, TintName } from '@/engine/types'

export type Resource = { id: string; name: string; avatar: string; role: string }
export type BlockedTime = { resourceId: string | 'all'; weekdays?: number[]; start: string; durationMin: number; label?: string }
export type Draft = { personId: string; date: string; startMin: number; durationMin: number; type: string; title: string }
export type DragState =
  | { kind: 'create'; personId: string; startMin: number; endMin: number }
  | { kind: 'move'; id: string; personId: string; startMin: number; active: boolean }
  | { kind: 'resize'; id: string; endMin: number }

/** config.eventTypes entry map: type id → label + tint */
export type EventTypeMap = Record<string, { label: string; tint: TintName }>

/** one event positioned inside a day column (overlap lanes resolved) */
export type Laid = { e: CalEvent; lane: number; lanes: number; top: number; height: number }
