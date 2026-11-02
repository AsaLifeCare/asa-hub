/** A box in the finance panes: the app's Card on its own screen, a flat surface-2 box inside the client record's card. */
import type { ReactNode } from 'react'
import Card from '@/components/shared/Card'
import { cn } from '@/lib/utils'

export default function Pane({ flat = false, padded = true, className, children }: {
  flat?: boolean
  padded?: boolean
  className?: string
  children: ReactNode
}) {
  if (!flat) return <Card padded={padded} className={className}>{children}</Card>
  return <div className={cn('rounded-md bg-surface-2', padded && 'p-4', className)}>{children}</div>
}
