// `sheet` template entry — the implementation lives in ./sheet/ (split into focused files); existing imports of…
// Two additions (App Studio): - pages WITHOUT a `columns` config — imported Google Sheet apps ship `config: {}`…
import { useMemo, useState } from 'react'
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import Sheet from './sheet'
import type { Column } from './sheet/types'
import type { TemplateProps } from '@/engine/PageRenderer'
import { TINT_BG_VAR, TINT_VAR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'

type StatSpec = {
  label: string
  tint?: TintName
  filter?: { key: string; equals?: string; nonEmpty?: boolean }
  withinDays?: { key: string; days: number }
}

function statCount(rows: any[], spec: StatSpec): number {
  let out = rows
  if (spec.filter?.key) {
    const { key, equals, nonEmpty } = spec.filter
    out = out.filter((r) =>
      equals !== undefined
        ? String(r[key] ?? '').toLowerCase() === String(equals).toLowerCase()
        : nonEmpty
          ? String(r[key] ?? '').trim() !== ''
          : true,
    )
  }
  if (spec.withinDays?.key) {
    const floor = Date.now() - spec.withinDays.days * 86400000
    out = out.filter((r) => {
      const t = new Date(String(r[spec.withinDays!.key] ?? '')).getTime()
      return !isNaN(t) && t >= floor
    })
  }
  return out.length
}

/** Stored tile order (label array) for `key` — [] when absent/invalid. */
function loadStatsOrder(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(raw) ? raw.filter((l): l is string => typeof l === 'string') : []
  } catch {
    return []
  }
}

function SortableStatTile({ spec, rows }: { spec: StatSpec; rows: any[] }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: spec.label })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group cursor-grab select-none rounded-[14px] border border-border bg-surface p-3.5 active:cursor-grabbing',
        isDragging && 'relative z-10 shadow-2',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{spec.label}</span>
        <span className="flex items-center gap-1.5">
          <GripVertical size={12} className="text-text-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
          <span className="h-2 w-2 rounded-full" style={{ background: TINT_VAR[spec.tint ?? 'blue'] }} />
        </span>
      </div>
      <p className="mt-1 text-[26px] font-bold leading-none tabular-nums text-text-1">
        {statCount(rows, spec)}
      </p>
      <div className="mt-2.5 h-1 rounded-full" style={{ background: TINT_BG_VAR[spec.tint ?? 'blue'] }} />
    </div>
  )
}

function StatsStrip({ rows, specs, storageKey }: { rows: any[]; specs: StatSpec[]; storageKey: string }) {
  const [order, setOrder] = useState<string[]>(() => loadStatsOrder(storageKey))
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // press-and-hold to drag on touch, so page scrolling stays free
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )
  // stored labels first (validated against config), unknown labels appended in config order
  const ordered = useMemo(() => {
    const byLabel = new Map(specs.map((s) => [s.label, s]))
    const kept = order.filter((l) => byLabel.has(l))
    return [...kept, ...specs.map((s) => s.label).filter((l) => !kept.includes(l))].map((l) => byLabel.get(l)!)
  }, [specs, order])
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const labels = ordered.map((s) => s.label)
    const next = arrayMove(labels, labels.indexOf(String(active.id)), labels.indexOf(String(over.id)))
    setOrder(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      // durable per-user prefs: sync the bundle to the Hub sheet (debounced)
      void import('@/lib/prefsSync').then((m) => m.schedulePrefsPush())
    } catch {
      // storage blocked/full — order still applies for this session
    }
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ordered.map((s) => s.label)} strategy={horizontalListSortingStrategy}>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ordered.map((s) => (
            <SortableStatTile key={s.label} spec={s} rows={rows} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

const prettify = (key: string) =>
  key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())

export default function SheetTemplate(props: TemplateProps) {
  const { config, data, schema } = props
  const configured = Array.isArray(config.columns) && config.columns.length > 0
  const merged = useMemo(() => {
    if (configured || data.length === 0) return config
    const keys = Object.keys(data[0] ?? {}).filter((k) => !k.startsWith('_'))
    const shown = keys.filter((k) => k !== 'id')
    const columns: Column[] = (shown.length ? shown : keys)
      .slice(0, 8)
      .map((key) => ({ key, label: prettify(key), kind: 'text', sortable: true }))
    return { ...config, columns }
  }, [configured, config, data])
  const stats = Array.isArray(config.stats) ? (config.stats as StatSpec[]) : []
  const statsKey = `asa-stats-order:${schema?.id ?? 'page'}:${schema?.dataSource?.resource ?? ''}`
  return (
    <>
      {stats.length > 0 && <StatsStrip key={statsKey} rows={data} specs={stats} storageKey={statsKey} />}
      <Sheet {...props} config={merged} />
    </>
  )
}
