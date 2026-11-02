// `dashboard` template (page-types.md §1) — EDITABLE MODULAR WIDGET GRID.
// Dogfooded by the Overview home page (home.md).
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { EyeOff, LayoutGrid, MoreHorizontal, Plus, RotateCcw } from 'lucide-react'
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import { AnimatePresence, motion } from 'framer-motion'
import type { TemplateProps } from '@/engine/PageRenderer'
import { EASE_OUT_EXPO, staggerContainer } from '@/engine/motion'
import Card, { CardHeader } from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import { ActivityRing, ThemedAreaChart, ThemedDonut } from '@/components/shared/charts'
import { TINT_VAR } from '@/lib/tints'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ActivityItem, TintName } from '@/engine/types'
import type { DashLayout, WidgetOverride } from './types'
import { EMPTY_LAYOUT, KIND_DEFAULTS, KIND_META, loadLayout, resolveWidget, schemaWidgetId } from './utils'
import { Greeting } from './Greeting'
import { ActionsWidget, EventsWidget, FeedWidget, ListWidget } from './ContentWidgets'
import { BarsWidget } from './BarsWidget'
import { ClockWidget, LinksWidget, NoteWidget, WeatherWidget } from './UtilityWidgets'
import { WidgetMenu } from './WidgetMenu'
import { SortableWidget } from './SortableWidget'
import { AddWidgetModal, PresetsModal, RenameModal } from './WidgetModals'

export default function DashboardTemplate({ config, data, schema }: TemplateProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const storageKey = `asa-dash-layout:${pathname}`
  const [layout, setLayout] = useState<DashLayout>(() => loadLayout(storageKey))
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [presetsOpen, setPresetsOpen] = useState(false)

  // re-read when navigating between dashboard pages without a remount
  useEffect(() => setLayout(loadLayout(storageKey)), [storageKey])

  const save = (next: DashLayout) => {
    setLayout(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      /* storage full/blocked — layout stays in-memory */
    }
  }

  // Compose the live widget list: schema widgets + palette-added widgets, reordered by the persisted layout…
  const widgets = useMemo(() => {
    const schemaW = (config.widgets ?? []).map((w: any, i: number) => ({ ...w, _id: schemaWidgetId(w, i), _added: false }))
    // Page-suggested widgets: computed live by the page like any schema widget, but OFF until the person turns them…
    const catalogW = (config.catalog ?? [])
      .filter((w: any) => layout.catalog.includes(String(w.id)))
      .map((w: any) => ({ ...w, _id: String(w.id), _added: false, _catalog: true }))
    const addedW = layout.added.map((a) => ({ ...(a.config ?? {}), id: a.id, kind: a.kind, title: a.title, span: a.span, _id: a.id, _added: true }))
    const byId = new Map<string, any>()
    for (const w of [...schemaW, ...catalogW, ...addedW]) if (!byId.has(w._id)) byId.set(w._id, w)
    const kept = layout.order.filter((id) => byId.has(id))
    const missing = [...byId.keys()].filter((id) => !kept.includes(id))
    return [...kept, ...missing].map((id) => {
      const raw = byId.get(id)!
      const ov: WidgetOverride = layout.overrides[id] ?? {}
      const w = resolveWidget(raw, data)
      return {
        ...w,
        _id: id,
        _title: ov.title ?? w.title ?? w.label ?? KIND_META[w.kind]?.label ?? 'Widget',
        _tint: ov.tint ?? w.tint,
        _span: ov.span ?? w.span,
        _hidden: ov.hidden ?? false,
        _note: ov.note ?? w.text ?? '',
      }
    })
  }, [config.widgets, config.catalog, layout, data])

  const visible = widgets.filter((w) => !w._hidden)
  const hiddenCount = widgets.length - visible.length
  const renaming = renamingId ? widgets.find((w) => w._id === renamingId) : null

  const setOverride = (id: string, patch: WidgetOverride) =>
    save({ ...layout, overrides: { ...layout.overrides, [id]: { ...layout.overrides[id], ...patch } } })

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const ids = widgets.map((w) => w._id)
    save({ ...layout, order: arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))) })
  }

  const addWidget = (kind: string) => {
    const def = KIND_DEFAULTS[kind] ?? {}
    const id = `custom-${kind}-${Date.now().toString(36)}`
    save({
      ...layout,
      added: [...layout.added, { id, kind, title: def.title, span: def.span, config: def.config }],
      order: [...widgets.map((w) => w._id), id],
    })
  }

  const removeAdded = (id: string) => {
    const overrides = { ...layout.overrides }
    delete overrides[id]
    save({
      order: layout.order.filter((x) => x !== id),
      overrides,
      added: layout.added.filter((a) => a.id !== id),
      catalog: layout.catalog.filter((x) => x !== id),
    })
  }

  // The app's own data list — the app itself makes the suggestions, from a list of its data.
  const suggestions = useMemo(() => {
    const rows: { id: string; title: string; description: string; kind: string; on: boolean }[] = []
    ;(config.widgets ?? []).forEach((w: any, i: number) => {
      const id = schemaWidgetId(w, i)
      rows.push({
        id,
        title: layout.overrides[id]?.title ?? String(w.title ?? w.label ?? 'Widget'),
        description: String(w.description ?? ''),
        kind: String(w.kind),
        on: !(layout.overrides[id]?.hidden ?? false),
      })
    })
    ;(config.catalog ?? []).forEach((w: any) => {
      const id = String(w.id)
      rows.push({
        id,
        title: layout.overrides[id]?.title ?? String(w.title ?? w.label ?? 'Widget'),
        description: String(w.description ?? ''),
        kind: String(w.kind),
        on: layout.catalog.includes(id) && !(layout.overrides[id]?.hidden ?? false),
      })
    })
    return rows
  }, [config.widgets, config.catalog, layout])

  // READY-MADE BOARDS: the preset lists which of the page's widget ids show; everything else the page computes is…
  const applyPreset = (presetId: string) => {
    const preset = (config.presets ?? []).find((p: any) => p.id === presetId)
    if (!preset) return
    const catalogIds = new Set((config.catalog ?? []).map((w: any) => String(w.id)))
    const schemaIds = (config.widgets ?? []).map((w: any, i: number) => schemaWidgetId(w, i))
    const on: string[] = preset.on.filter((id: string) => catalogIds.has(id) || schemaIds.includes(id))
    const overrides: Record<string, WidgetOverride> = {}
    for (const id of schemaIds) overrides[id] = { ...layout.overrides[id], hidden: !on.includes(id) }
    for (const id of on) overrides[id] = { ...layout.overrides[id], hidden: false }
    if (preset.spans) for (const [id, span] of Object.entries(preset.spans)) overrides[id] = { ...overrides[id], span: span as 1 | 2 }
    save({
      ...layout,
      overrides,
      catalog: on.filter((id) => catalogIds.has(id)),
      order: [...on, ...layout.added.map((a) => a.id)],
    })
  }

  const toggleSuggestion = (id: string, on: boolean) => {
    const isCatalog = (config.catalog ?? []).some((w: any) => String(w.id) === id)
    const overrides = { ...layout.overrides, [id]: { ...layout.overrides[id], hidden: !on } }
    if (!isCatalog) {
      save({ ...layout, overrides })
      return
    }
    const catalog = on
      ? layout.catalog.includes(id) ? layout.catalog : [...layout.catalog, id]
      : layout.catalog.filter((x) => x !== id)
    const order = on && !layout.order.includes(id) && layout.order.length > 0
      ? [...widgets.map((w) => w._id).filter((x) => x !== id), id]
      : layout.order
    save({ ...layout, overrides, catalog, order })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // press-and-hold to drag on touch, so scrolling the page stays free
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const csvFor = (w: any) =>
    w.kind === 'area'
      ? `series,point,value\n${(w.series ?? []).flatMap((s: any) => s.points.map((p: number, i: number) => `${s.name},${i},${p}`)).join('\n')}`
      : w.kind === 'donut'
        ? `label,value\n${(w.slices ?? []).map((s: any) => `${s.label},${s.value}`).join('\n')}`
        : undefined

  const headerActions = (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setAddOpen(true)}
        className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]"
      >
        <Plus size={15} /> Add widget
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label="Dashboard options" className="grid h-9 w-9 place-items-center rounded-md border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2">
            <MoreHorizontal size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(config.presets ?? []).length > 0 && (
            <DropdownMenuItem onClick={() => setPresetsOpen(true)}>
              <LayoutGrid size={14} /> Ready-made boards
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={hiddenCount === 0}
            onClick={() =>
              save({
                ...layout,
                overrides: Object.fromEntries(Object.entries(layout.overrides).map(([k, v]) => [k, { ...v, hidden: false }])),
              })
            }
          >
            <EyeOff size={14} /> Show hidden widgets{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => save(EMPTY_LAYOUT)}>
            <RotateCcw size={14} /> Reset layout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  const renderWidget = (w: any) => {
    switch (w.kind) {
      case 'stat':
        return (
          <StatCard
            label={w._title}
            value={w.value ?? 0}
            delta={w.delta}
            deltaLabel={w.deltaLabel}
            spark={w.spark}
            tint={w._tint ?? 'blue'}
            onClick={w.href ? () => navigate(w.href) : undefined}
          />
        )
      case 'area':
        return (
          <Card hover className="h-[320px]" tint={w._tint}>
            <CardHeader
              title={w._title}
              extra={
                <div className="flex items-center gap-2 pr-16">
                  {(w.series ?? []).map((s: any) => (
                    <span key={s.name} className="flex items-center gap-1.5 text-[11px] font-medium text-text-3">
                      <span className="h-2 w-2 rounded-full" style={{ background: TINT_VAR[s.color as TintName] }} />
                      {s.name}
                    </span>
                  ))}
                </div>
              }
            />
            <ThemedAreaChart series={w.series ?? []} height={220} />
          </Card>
        )
      case 'donut': {
        if (w.unavailable) {
          return (
            <Card hover className="h-[320px]" tint={w._tint}>
              <CardHeader title={w._title} />
              <p className="font-stat text-[30px] font-bold leading-none text-text-1">—</p>
              <p className="mt-2 text-[12.5px] leading-5 text-text-2">{String(w.unavailable)}</p>
            </Card>
          )
        }
        const slices = w.slices ?? []
        const total = slices.reduce((a: number, s: any) => a + s.value, 0)
        return (
          <Card hover className="h-[320px]" tint={w._tint}>
            <CardHeader title={w._title} />
            <div className="flex items-center gap-4">
              <ThemedDonut slices={slices} size={150} centerValue={total} centerLabel={w.centerLabel} />
              <div className="flex-1 space-y-2">
                {slices.map((s: any) => (
                  <div key={s.label} className="flex items-center gap-2 text-[12px]">
                    <span className="h-2 w-2 rounded-full" style={{ background: TINT_VAR[s.tint as TintName] }} />
                    <span className="text-text-2">{s.label}</span>
                    <span className="ml-auto font-stat font-semibold text-text-1">{s.value}</span>
                    <span className="w-9 text-right text-text-3">{total ? Math.round((s.value / total) * 100) : 0}%</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )
      }
      case 'events':
        return <EventsWidget w={w} tint={w._tint} />
      case 'list':
        return <ListWidget w={w} tint={w._tint} />
      case 'feed':
        return <FeedWidget w={w} data={data as ActivityItem[]} tint={w._tint} />
      case 'ring':
        return (
          <Card hover className="h-full" tint={layout.overrides[w._id]?.tint}>
            <CardHeader title={w._title} />
            <div className="flex items-center gap-4">
              <ActivityRing percent={w.percent} tint={w._tint} />
              <p className="text-[13px] leading-5 text-text-2">{w.caption}</p>
            </div>
          </Card>
        )
      case 'bars':
        return <BarsWidget w={w} tint={w._tint} onNavigate={navigate} />
      case 'actions':
        return <ActionsWidget w={w} tint={w._tint} />
      case 'weather':
        return <WeatherWidget w={w} tint={layout.overrides[w._id]?.tint} />
      case 'clock':
        return <ClockWidget w={w} tint={w._tint} />
      case 'note':
        return <NoteWidget w={w} tint={w._tint} note={w._note} onNote={(v) => setOverride(w._id, { note: v })} />
      case 'links':
        return <LinksWidget w={w} tint={w._tint} />
      default:
        return null
    }
  }

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="w-full">
      {config.greeting ? (
        <Greeting name={config.greeting.name} subtitle={config.greeting.subtitle} actions={headerActions} />
      ) : (
        <PageHeader
          title={config.title ?? schema.title}
          subtitle="Drag widgets to rearrange · ⋯ menu on any widget to customize"
          actions={headerActions}
        />
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible.map((w) => w._id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-6 xl:grid-cols-12">
            <AnimatePresence>
              {visible.map((w, i) => (
                <SortableWidget
                  key={w._id}
                  w={w}
                  menu={
                    <WidgetMenu
                      w={w}
                      isAdded={w._added || w._catalog === true}
                      csv={csvFor(w)}
                      pagePath={pathname}
                      pageTitle={schema.title}
                      onRename={() => setRenamingId(w._id)}
                      onTint={(t) => setOverride(w._id, { tint: t })}
                      onSpan={() => setOverride(w._id, { span: w._span === 2 ? 1 : 2 })}
                      onHide={() => setOverride(w._id, { hidden: true })}
                      onRemove={() => removeAdded(w._id)}
                    />
                  }
                >
                  <motion.div
                    initial={{ opacity: 0, y: i < 12 ? 14 : 0 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 12) * 0.05, duration: 0.28, ease: EASE_OUT_EXPO }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="h-full"
                  >
                    {renderWidget(w)}
                  </motion.div>
                </SortableWidget>
              ))}
            </AnimatePresence>
          </div>
        </SortableContext>
      </DndContext>

      <RenameModal
        open={renaming != null}
        initial={renaming?._title ?? ''}
        onOpenChange={(open) => !open && setRenamingId(null)}
        onSave={(title) => renaming && setOverride(renaming._id, { title })}
      />
      <AddWidgetModal
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={addWidget}
        suggestions={suggestions}
        onToggle={toggleSuggestion}
      />
      <PresetsModal
        open={presetsOpen}
        onOpenChange={setPresetsOpen}
        presets={config.presets ?? []}
        onApply={applyPreset}
      />
    </motion.div>
  )
}
