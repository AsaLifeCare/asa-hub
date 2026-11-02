/** Sortable widget shell: grip handle + ⋯ menu on hover (moved verbatim from DashboardTemplate.tsx). */
import type { ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

export function SortableWidget({
  w,
  children,
  menu,
}: {
  w: any
  children: ReactNode
  menu: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: w._id })
  // below md the grid is 2-col: stats sit 2-up, every other widget spans both
  const spanCls =
    w._span === 2
      ? w.kind === 'stat'
        ? 'col-span-2 md:col-span-6 xl:col-span-6'
        : 'col-span-2 md:col-span-6 xl:col-span-8'
      : w.kind === 'stat'
        ? 'col-span-1 md:col-span-3 xl:col-span-3'
        : 'col-span-2 md:col-span-3 xl:col-span-4'
  return (
    <div
      ref={setNodeRef}
      id={`widget-${w._id}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('group/widget relative', spanCls, isDragging && 'z-20 opacity-70')}
    >
      <div
        className={cn(
          'absolute right-2 top-2 z-10 flex items-center gap-1 transition-opacity duration-150',
          // no hover on touch — keep the grip + ⋯ visible below md
          'opacity-0 focus-within:opacity-100 group-hover/widget:opacity-100 max-md:opacity-100',
          isDragging && 'opacity-100',
        )}
      >
        <button
          {...attributes}
          {...listeners}
          aria-label={`Drag ${w._title}`}
          title="Drag to rearrange"
          className="grid h-7 w-7 cursor-grab place-items-center rounded-sm bg-surface/80 text-text-3 shadow-1 transition-colors hover:bg-surface-2 hover:text-text-1 active:cursor-grabbing"
        >
          <GripVertical size={14} />
        </button>
        {menu}
      </div>
      {children}
    </div>
  )
}
