// Document cover-card grid + empty state + search highlight (moved verbatim from DocumentsTemplate.tsx).
// The motion wrappers — including the AnimatePresence popLayout around the cards — are unchanged, so enter/exit and…
import { AnimatePresence, motion } from 'framer-motion'
import { Clock, GraduationCap } from 'lucide-react'
// updated-at is an instant → Ohio wall-clock for every viewer
import { ohioDay } from '@/lib/ohio'
import type { TemplateProps } from '@/engine/PageRenderer'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import BookmarkButton from '@/components/shared/BookmarkButton'
import DragPerson from '@/components/shared/DragPerson'
import { AvatarStack } from '@/components/shared/Avatar'
import { AppIcon } from '@/lib/icons'
import { personById } from '@/lib/people-lookup'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { EASE_OUT_EXPO, staggerContainer, staggerItem } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { Doc, Person } from '@/engine/types'
import type React from 'react'
import { DndContext, closestCenter, type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { writePersonDrag } from '@/lib/focus'
import type { Focus } from '@/stores/useContextStore'
import type { CollectionCfg } from './types'
import { courseMinutes, ext, fmtMinutes, isCourse, modulesOf } from './utils'
import { CoverArt, bookmarkableCover } from './covers'

/* ---------------- search highlight (query escaped — regex chars like ( [ are safe) ---------------- */

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, 'ig'))
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-[3px] bg-primary-soft px-0.5 text-primary-strong">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  )
}

export function LibraryGrid({
  filtered,
  collections,
  config,
  query,
  setQuery,
  pctOf,
  openReader,
  focusFor,
  sortable,
  sensors,
  onOrderDragEnd,
}: {
  filtered: Doc[]
  collections: CollectionCfg[]
  config: TemplateProps['config']
  query: string
  setQuery: (q: string) => void
  pctOf: (d: Doc) => number
  openReader: (id: string) => void
  // The person behind a document, when there is one — the card becomes a drag source for the focus slot.
  focusFor?: (d: Doc) => Focus | null
  /** Manual mode: the cards are rearranged by hand instead of being dragged out. */
  sortable?: boolean
  sensors?: SensorDescriptor<SensorOptions>[]
  onOrderDragEnd?: (e: DragEndEvent) => void
}) {
  return filtered.length === 0 ? (
    <div className="flex-1">
      <EmptyState
        title="No documents found"
        body={query ? `Nothing matches “${query.trim()}” in this collection.` : 'This collection is empty.'}
        action={query ? { label: 'Clear search', onClick: () => setQuery('') } : undefined}
      />
    </div>
  ) : (
    <Sortable enabled={Boolean(sortable)} ids={filtered.map((d) => d.id)} sensors={sensors} onDragEnd={onOrderDragEnd}>
    <motion.div layout variants={staggerContainer} initial="hidden" animate="show" className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <AnimatePresence mode="popLayout">
        {filtered.map((d) => {
          const authors = d.authorIds.map((id) => personById(id)).filter((a): a is Person => Boolean(a))
          const col = collections.find((c) => c.id === d.collection)
          const isDraft = ext(d).status === 'draft'
          const course = isCourse(d)
          const pct = pctOf(d)
          return (
            <CardShell key={d.id} id={d.id} sortable={Boolean(sortable)}>
            <motion.div
              layout
              variants={staggerItem}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
              onClick={() => openReader(d.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openReader(d.id)
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={d.title}
              title={focusFor?.(d) ? `Drag ${d.title} to the top-left to focus the workspace on them` : undefined}
              // native drag by ref — framer-motion consumes onDragStart
              ref={(el: HTMLDivElement | null) => {
                if (!el) return
                const f = focusFor?.(d) ?? null
                el.draggable = Boolean(f)
                el.ondragstart = f
                  ? (e) => {
                      if (!e.dataTransfer) return
                      e.dataTransfer.setData('text/plain', f.name)
                      writePersonDrag(e.dataTransfer, f)
                    }
                  : null
              }}
              className={cn('group text-left', focusFor?.(d) && 'active:cursor-grabbing')}
            >
              <Card hover padded={false} className="h-full overflow-hidden">
                {config.cardStyle === 'cover' && (
                  <div className="relative overflow-hidden">
                    <motion.div
                      initial={{ opacity: 0, scale: 1.04 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
                      className="transition-transform duration-500 group-hover:scale-[1.03]"
                    >
                      <CoverArt cover={d.cover} className="aspect-[5/2] w-full" />
                    </motion.div>
                    {col && (
                      <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-medium text-white">
                        <AppIcon name={col.icon} size={11} />
                        {col.label}
                      </span>
                    )}
                    <span className="absolute right-3 top-3 flex items-center gap-1.5">
                      {isDraft && (
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_BG.amber, TINT_FG.amber)}>
                          Draft
                        </span>
                      )}
                      <BookmarkButton
                        size="sm"
                        bookmark={{
                          type: 'document',
                          refId: d.id,
                          title: d.title,
                          subtitle: col?.label ?? 'Document',
                          avatar: bookmarkableCover(d.cover),
                          tint: col?.tint ?? 'blue',
                          href: `/app/knowledge/docs#${d.id}`,
                        }}
                        className="bg-black/45 text-white hover:bg-black/60 hover:text-white"
                      />
                    </span>
                    {course && (
                      <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white">
                        <GraduationCap size={11} />
                        Course · {modulesOf(d).length} modules
                      </span>
                    )}
                    {course && pct > 0 && (
                      <span className="absolute bottom-3 right-3 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-on-primary">
                        {pct}% complete
                      </span>
                    )}
                  </div>
                )}
                <div className="p-4 pb-3">
                  <h3 className="clamp-2 text-[15px] font-semibold leading-5 text-text-1 transition-colors duration-150 group-hover:text-primary">
                    <Highlight text={d.title} query={query} />
                  </h3>
                  <p className="clamp-2 mt-1 text-[13px] leading-5 text-text-2">
                    <Highlight text={d.excerpt} query={query} />
                  </p>
                </div>
                <div
                  className="flex items-center gap-2 border-t border-border px-4 py-3"
                  // In a mapped library the CARD is a drag source too, and both handlers write the same MIME — the…
                  ref={(el: HTMLDivElement | null) => {
                    if (el) el.ondragstart = (e) => e.stopPropagation()
                  }}
                >
                  {/* the faces come draggable from AvatarStack; the name beside
                      them is the FIRST author, so it is wrapped on its own */}
                  <AvatarStack people={authors.map((a) => ({ src: a.avatar, name: a.name }))} max={2} />
                  <DragPerson
                    name={authors[0]?.name ?? ''}
                    id={authors[0]?.id}
                    avatar={authors[0]?.avatar}
                    subtitle={authors[0]?.role}
                    className="min-w-0"
                  >
                    <span className="clamp-1 text-[12px] font-medium text-text-2">{authors[0]?.name}</span>
                  </DragPerson>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-[12px] text-text-3">
                    <Clock size={12} />
                    {course ? `${modulesOf(d).length} modules · ~${fmtMinutes(courseMinutes(d))}` : `${d.readMinutes} min read`}
                  </span>
                  <span className="shrink-0 text-[12px] text-text-3">· {ohioDay(d.updatedAt)}</span>
                </div>
              </Card>
            </motion.div>
            </CardShell>
          )
        })}
      </AnimatePresence>
    </motion.div>
    </Sortable>
  )
}

// In manual mode a card is a sortable item; otherwise it is a plain wrapper, so nothing pays for machinery it is…
function CardShell({ id, sortable, children }: { id: string; sortable: boolean; children: React.ReactNode }) {
  if (!sortable) return <>{children}</>
  return <SortableCard id={id}>{children}</SortableCard>
}

function SortableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="cursor-grab active:cursor-grabbing"
    >
      {children}
    </div>
  )
}

// Only mounts the dnd-kit context while manual ordering is on — no listeners and no sensors on a library nobody is…
function Sortable({
  enabled,
  ids,
  sensors,
  onDragEnd,
  children,
}: {
  enabled: boolean
  ids: string[]
  sensors?: SensorDescriptor<SensorOptions>[]
  onDragEnd?: (e: DragEndEvent) => void
  children: React.ReactNode
}) {
  if (!enabled) return <>{children}</>
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}
