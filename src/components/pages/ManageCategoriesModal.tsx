// Manage categories modal (App Hub, admins only — gated by useCan('apps.manage') at the button).
// Three parts: 1.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowUpDown, Check, GripVertical, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import SearchInput from '@/components/shared/SearchInput'
import { AppIcon, ICON_GROUPS } from '@/lib/icons'
import {
  CUSTOM_CATEGORY_TINTS,
  effectiveCategoryId,
  groupedApps,
  mergedCategoryDefs,
  type CategoryDef,
} from '@/lib/categories'
import { TINT_BG, TINT_FG, TINT_PAIR } from '@/lib/tints'
import { useCategoryStore } from '@/stores/useCategoryStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'

/** Icon pick subset: the first 4 icons of each curated group. */
const PICKABLE_ICONS: { group: string; icons: string[] }[] = ICON_GROUPS.map((g) => ({
  group: g.label,
  icons: g.icons.slice(0, 4),
}))

function CategoryChip({ def }: { def: CategoryDef }) {
  // No icon chosen: the tint alone identifies the category — a small dot, not a glyph standing in for one.
  if (!def.icon) {
    return <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', TINT_PAIR(def.tint))} />
  }
  return (
    <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-[8px]', TINT_PAIR(def.tint))}>
      <AppIcon name={def.icon} size={14} />
    </span>
  )
}

// Sortable app row inside a category group — GripVertical handle on the left (always visible so admins notice the…
function SortableAppRow({
  id,
  children,
}: {
  id: string
  children: (dragHandle: React.ReactNode) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const dragHandle = (
    <button
      {...attributes}
      {...listeners}
      type="button"
      aria-label="Drag to reorder"
      title="Drag to reorder"
      className="grid h-7 w-7 shrink-0 cursor-grab place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1 active:cursor-grabbing"
    >
      <GripVertical size={14} />
    </button>
  )
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10 rounded-md bg-surface shadow-2 ring-1 ring-primary/40')}
    >
      {children(dragHandle)}
    </div>
  )
}

export default function ManageCategoriesModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const apps = useRegistryStore((s) => s.apps)
  const { customCategories, appCategory, appOrder, labelOverrides, categoryOrder, addCategory, renameCategory, removeCategory, assignApp, setAppOrder } =
    useCategoryStore()
  const defs = useMemo(() => mergedCategoryDefs(customCategories, labelOverrides, categoryOrder), [customCategories, labelOverrides, categoryOrder])

  /** app counts per effective category */
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of apps) {
      const cid = effectiveCategoryId(a, appCategory, defs)
      map.set(cid, (map.get(cid) ?? 0) + 1)
    }
    return map
  }, [apps, appCategory, defs])

  /* create form */
  const [name, setName] = useState('')
  const [tint, setTint] = useState<TintName>('mint')
  // Optional by rule: a category is a name; the icon is a flourish.
  const [icon, setIcon] = useState('')

  /* rename state */
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  /* assignment search */
  const [q, setQ] = useState('')
  const visibleApps = useMemo(() => {
    const query = q.trim().toLowerCase()
    return query ? apps.filter((a) => `${a.name} ${a.category}`.toLowerCase().includes(query)) : apps
  }, [apps, q])

  // assignment groups — per effective category, in the stored drag order.
  const fullGroups = useMemo(() => groupedApps(apps, appCategory, defs, appOrder), [apps, appCategory, defs, appOrder])
  const groups = useMemo(
    () => groupedApps(visibleApps, appCategory, defs, appOrder),
    [visibleApps, appCategory, defs, appOrder],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const group = fullGroups.find((g) => g.apps.some((a) => a.id === active.id))
    // only reorder inside one category — moving between categories is the Select's job
    if (!group || !group.apps.some((a) => a.id === over.id)) return
    const ids = group.apps.map((a) => a.id)
    setAppOrder(group.def.id, arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
  }

  const create = () => {
    const def = addCategory({ label: name, tint, icon })
    if (def) {
      setName('')
      setTint('mint')
      setIcon('sparkles')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden bg-surface p-0 sm:max-w-[640px]">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">Workspace sections</DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            The sidebar's own sections and which apps stand in each one. This is the WORKSPACE's shape,
            not yours alone — what you arrange here is what everybody sees, next time their session
            reads it. Who may open each app is the badge matrix's answer, one screen back.
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-thin flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* ---------- create ---------- */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">New category</h3>
            <div className="rounded-md border border-border bg-surface-2 p-4">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
                placeholder="Category name — e.g. Finance, People Ops…"
                className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
              />
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="mr-1 text-[12px] font-medium text-text-2">Tint</span>
                  {CUSTOM_CATEGORY_TINTS.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTint(t)}
                      aria-label={`Tint ${t}`}
                      aria-pressed={tint === t}
                      className={cn(
                        'grid h-6 w-6 place-items-center rounded-full ring-2 ring-transparent transition-all',
                        TINT_BG[t],
                        tint === t && 'ring-primary',
                      )}
                    >
                      {tint === t && <Check size={12} className={TINT_FG[t]} strokeWidth={3} />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3">
                <span className="mb-1.5 block text-[12px] font-medium text-text-2">
                  Icon <span className="font-normal text-text-3">· optional</span>
                </span>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-[52px] shrink-0 text-[11px] text-text-3">None</span>
                    <button
                      onClick={() => setIcon('')}
                      aria-label="No icon"
                      aria-pressed={icon === ''}
                      className={cn(
                        'flex h-8 items-center rounded-[8px] border px-2.5 text-[11.5px] font-medium transition-colors',
                        icon === ''
                          ? 'border-primary bg-primary-soft text-primary-strong'
                          : 'border-border bg-surface text-text-3 hover:border-border-strong hover:text-text-1',
                      )}
                    >
                      No icon
                    </button>
                  </div>
                  {PICKABLE_ICONS.map((g) => (
                    <div key={g.group} className="flex items-center gap-1.5">
                      <span className="w-[52px] shrink-0 text-[11px] text-text-3">{g.group}</span>
                      {g.icons.map((i) => (
                        <button
                          key={i}
                          onClick={() => setIcon(i)}
                          aria-label={`Icon ${i}`}
                          aria-pressed={icon === i}
                          className={cn(
                            'grid h-8 w-8 place-items-center rounded-[8px] border transition-colors',
                            icon === i
                              ? 'border-primary bg-primary-soft text-primary-strong'
                              : 'border-border bg-surface text-text-3 hover:border-border-strong hover:text-text-1',
                          )}
                        >
                          <AppIcon name={i} size={14} />
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <button
                onClick={create}
                disabled={!name.trim()}
                className="mt-4 flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
              >
                <Plus size={14} /> Create category
              </button>
            </div>
          </section>

          {/* ---------- existing categories ---------- */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
              Categories · {defs.length}
            </h3>
            <div className="divide-y divide-border rounded-md border border-border">
              {defs.map((def) => {
                const renaming = renamingId === def.id
                return (
                  <div key={def.id} className="flex items-center gap-3 px-3 py-2.5">
                    <CategoryChip def={def} />
                    {renaming ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            renameCategory(def.id, renameValue)
                            setRenamingId(null)
                          }
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        onBlur={() => {
                          renameCategory(def.id, renameValue)
                          setRenamingId(null)
                        }}
                        className="h-8 min-w-0 flex-1 rounded-sm border border-border bg-surface px-2.5 text-[13px] text-text-1 outline-none focus:border-border-strong"
                      />
                    ) : (
                      <span className="min-w-0 flex-1">
                        <span className="clamp-1 block text-[13px] font-medium text-text-1">{def.label}</span>
                        <span className="text-[11px] text-text-3">
                          {counts.get(def.id) ?? 0} {(counts.get(def.id) ?? 0) === 1 ? 'app' : 'apps'}
                          {def.custom ? ' · custom' : ''}
                        </span>
                      </span>
                    )}
                    <span className="flex shrink-0 items-center gap-1">
                      {!renaming && (
                        <button
                          onClick={() => {
                            setRenamingId(def.id)
                            setRenameValue(def.label)
                          }}
                          aria-label={`Rename ${def.label}`}
                          className="grid h-7 w-7 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {def.custom ? (
                        <button
                          onClick={() => removeCategory(def.id)}
                          disabled={(counts.get(def.id) ?? 0) > 0}
                          title={(counts.get(def.id) ?? 0) > 0 ? 'Move its apps out first' : undefined}
                          aria-label={`Delete ${def.label}`}
                          className="grid h-7 w-7 place-items-center rounded-sm text-text-3 transition-colors hover:bg-tint-pink hover:text-tint-fg-pink disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-3"
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-text-3">
                          <Lock size={11} /> Built-in
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* ---------- app assignment (grouped, drag-reorderable) ---------- */}
          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
              App assignment · {apps.length}
            </h3>
            <p className="mb-2 flex items-center gap-1.5 text-[12px] text-text-3">
              <ArrowUpDown size={12} className="shrink-0" />
              Drag to reorder — the sidebar and App Hub follow this order.
            </p>
            <SearchInput value={q} onChange={setQ} placeholder="Search apps…" className="mb-2 w-full" />
            {visibleApps.length === 0 ? (
              <div className="rounded-md border border-border">
                <p className="px-3 py-6 text-center text-[13px] text-text-3">No apps match “{q}”.</p>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <div className="space-y-3">
                  {groups.map((g) => (
                    <div key={g.def.id}>
                      <div className="mb-1 flex items-center gap-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                        {g.def.icon && <AppIcon name={g.def.icon} size={11} className="shrink-0" />}
                        {g.def.label} · {g.apps.length}
                      </div>
                      <SortableContext items={g.apps.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                        <div className="divide-y divide-border rounded-md border border-border">
                          {g.apps.map((a) => {
                            const eff = effectiveCategoryId(a, appCategory, defs)
                            const overridden = !!appCategory[a.id]
                            return (
                              <SortableAppRow key={a.id} id={a.id}>
                                {(dragHandle) => (
                                  <div className="flex items-center gap-2 px-2 py-2">
                                    {dragHandle}
                                    <AppIcon name={a.icon} size={15} className="shrink-0 text-text-3" />
                                    <span className="min-w-0 flex-1">
                                      <span className="clamp-1 block text-[13px] font-medium text-text-1">{a.name}</span>
                                      <span className="text-[11px] text-text-3">
                                        {overridden ? `default: ${a.category}` : a.category}
                                      </span>
                                    </span>
                                    <Select
                                      value={eff}
                                      onValueChange={(v) => assignApp(a.id, v === a.category ? null : v)}
                                    >
                                      <SelectTrigger className="h-8 w-[150px] shrink-0 rounded-sm border-border bg-surface text-[12px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {defs.map((d) => (
                                          <SelectItem key={d.id} value={d.id}>
                                            {d.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                )}
                              </SortableAppRow>
                            )
                          })}
                        </div>
                      </SortableContext>
                    </div>
                  ))}
                </div>
              </DndContext>
            )}
          </section>
        </div>

        {/* footer — v10: jump to the full App Control screen */}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-6 py-3">
          <p className="text-[11px] text-text-3">Board, matrix and list layouts live in App Control.</p>
          <button
            onClick={() => {
              onOpenChange(false)
              navigate('/app/app-control/board')
            }}
            className="flex h-8 items-center gap-1 text-[12px] font-semibold text-primary-strong transition-colors hover:text-primary"
          >
            Open App Control →
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
