// A person's name you can pick up.
// Focus Mode's drop target is the brand slot at the TOP LEFT of the sidebar, and until now only the generic…
import { useEffect, useRef, type ReactNode } from 'react'
import type { FocusType } from '@/stores/useContextStore'
import { writePersonDrag } from '@/lib/focus'
import { cn } from '@/lib/utils'

export default function DragPerson({
  name,
  id,
  type = 'staff',
  avatar,
  subtitle,
  className,
  title,
  children,
}: {
  name: string
  id?: string
  type?: FocusType
  avatar?: string
  subtitle?: string
  className?: string
  title?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLSpanElement | null>(null)

  // The payload is built INSIDE the effect, from the props the effect closed over, and the effect re-runs when any…
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const draggable = !!name.trim()
    el.draggable = draggable
    if (!draggable) return
    const onStart = (e: DragEvent) => {
      if (!e.dataTransfer) return
      e.dataTransfer.setData('text/plain', name)
      writePersonDrag(e.dataTransfer, { type, id: id ?? '', name, avatar, subtitle })
    }
    el.addEventListener('dragstart', onStart)
    return () => el.removeEventListener('dragstart', onStart)
  }, [name, id, type, avatar, subtitle])

  if (!name.trim()) return <>{children}</>

  return (
    <span
      ref={ref}
      title={title ?? `Drag ${name} to the top-left to focus the workspace on them`}
      // inline-FLEX, deliberately.
      className={cn('inline-flex max-w-full items-center cursor-grab select-none align-middle active:cursor-grabbing', className)}
    >
      {children}
    </span>
  )
}
