/** Draggable table row used in manual ordering mode (grip handle cell prepended) — moved verbatim from SheetTemplate.tsx. */
import type { CSSProperties, ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

export function SortableRow({
  id,
  className,
  style,
  onClick,
  rowRef,
  title,
  children,
}: {
  id: string
  className?: string
  style?: CSSProperties
  onClick?: () => void
  // Person-focus native drag, wired by the sheet exactly as on the animated row — the two orderings must not…
  rowRef?: (el: HTMLTableRowElement | null) => void
  title?: string
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <tr
      ref={(el) => {
        setNodeRef(el)
        rowRef?.(el)
      }}
      style={{ ...style, transform: CSS.Transform.toString(transform), transition }}
      onClick={onClick}
      title={title}
      className={cn(className, isDragging && 'relative z-10 bg-surface shadow-2')}
    >
      <td className="w-9 pl-3 pr-0" onClick={(e) => e.stopPropagation()}>
        <button
          {...attributes}
          {...listeners}
          // REORDERING IS NOT FOCUSING.
          draggable={false}
          aria-label={`Drag row ${id}`}
          title="Drag to reorder"
          className="grid h-7 w-7 cursor-grab place-items-center rounded-sm text-text-3 opacity-0 transition-opacity duration-150 hover:bg-surface-3 hover:text-text-1 focus:opacity-100 active:cursor-grabbing group-hover/row:opacity-100 max-md:opacity-100"
        >
          <GripVertical size={14} />
        </button>
      </td>
      {children}
    </tr>
  )
}
