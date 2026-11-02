import { cn } from '@/lib/utils'
import Card from '@/components/shared/Card'
import type { PageType } from '@/engine/types'

/** Shimmer skeleton (§11): surface-2 → surface-3 sweep, 1.6s. */
export default function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-shimmer rounded-md', className)}
      style={{
        background: 'linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%)',
        backgroundSize: '400px 100%',
      }}
    />
  )
}

/** A whole page still loading: PageRenderer's while its rows arrive, the shell's while a page's code does. */
export function PageSkeleton({ type }: { type?: PageType }) {
  if (type === 'sheet') {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-64" />
        <Card padded={false} className="p-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-12 w-full" />
          ))}
        </Card>
      </div>
    )
  }
  if (type === 'pipeline') {
    return (
      <div className="w-full space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-36 w-full rounded-lg" />
        ))}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-lg" />
      ))}
    </div>
  )
}
