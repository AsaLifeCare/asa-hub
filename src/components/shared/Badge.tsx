import { cn } from '@/lib/utils'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import type { TintName } from '@/engine/types'

/** Small tinted label chip (§11). */
export function Badge({
  label,
  tint = 'mint',
  className,
}: {
  label: string
  tint?: TintName
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize leading-4',
        TINT_BG[tint],
        TINT_FG[tint],
        className,
      )}
    >
      {label}
    </span>
  )
}

/** Numeric pill (sidebar counts etc). */
export function CountPill({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-[20px] items-center justify-center rounded-full bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold leading-4',
        className,
      )}
    >
      {count}
    </span>
  )
}

/** 6px status dot. green=true → primary dot (NEW / unread). */
export function Dot({ green = true, className }: { green?: boolean; className?: string }) {
  return (
    <span
      className={cn('inline-block h-1.5 w-1.5 rounded-full', green ? 'bg-primary' : 'bg-text-3', className)}
    />
  )
}
