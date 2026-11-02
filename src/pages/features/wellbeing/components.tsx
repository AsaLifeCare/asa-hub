// Wellbeing suite — shared page bits (wellbeing-suite wave).
// Header/search/chips shared by Ideal Meals, Workout, Sleep and Hydration so the four feature pages stay thin.
import type { ReactNode } from 'react'
import { Zap, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TINT_PAIR } from '@/lib/tints'
import type { ExtendedTintName } from '@/lib/tints'
import { useContextStore } from '@/stores/useContextStore'
import { recordMatchesFocus } from '@/lib/focus'
import SearchInput from '@/components/shared/SearchInput'
import Avatar from '@/components/shared/Avatar'
import Card from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'

export { SearchInput }

// Round avatar + client name — standing rule for every person list.
export function ClientNameRow({ name, id, className }: { name: string; id?: string; className?: string }) {
  return (
    <DragPerson name={name} id={id} type="client">
      <span className={cn('inline-flex items-center gap-2 min-w-0', className)}>
        <Avatar name={name} size="sm" />
        <span className="truncate text-[14px] font-bold text-text-1">{name}</span>
      </span>
    </DragPerson>
  )
}

/* ---------------- header ---------------- */

export function WellbeingHeader({
  appName,
  pageLabel,
  subcopy,
  stats,
  actionLabel,
  onAction,
  actionDisabled,
  focusHint,
}: {
  /** e.g. "MEALS" */
  appName: string
  /** e.g. "IDEAL LUNCH" — rendered after the em-dash in mono */
  pageLabel: string
  subcopy: string
  /** e.g. "23 ready / 0 pending" (mono, top-right) */
  stats: string
  actionLabel?: string
  onAction?: () => void
  actionDisabled?: boolean
  /** Shown under stats when Person Focus Mode is narrowing the grid. */
  focusHint?: string
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-[640px]">
        <h1 className="font-display text-[22px] font-bold leading-7 text-text-1">
          {appName} <span className="text-text-3">—</span>{' '}
          <span className="font-mono text-[18px] tracking-wide text-tint-fg-primary">{pageLabel}</span>
        </h1>
        <p className="mt-1.5 text-[13px] leading-5 text-text-2">{subcopy}</p>
        {focusHint && (
          <p className="mt-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-tint-fg-primary">
            {focusHint}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="font-mono text-[12px] text-text-2">{stats}</span>
        {actionLabel && (
          <button
            onClick={onAction}
            disabled={actionDisabled}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5',
              'text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2',
              actionDisabled && 'cursor-not-allowed opacity-50 hover:bg-surface',
            )}
          >
            <Zap size={14} className="text-tint-fg-warning" />
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------------- chips ---------------- */

export function Chip({
  children,
  tint,
  className,
}: {
  children: ReactNode
  tint?: ExtendedTintName
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4',
        tint ? TINT_PAIR(tint) : 'bg-surface-3 text-text-2',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** ready = tint-primary / pending = tint-warning / generating = tint-blue */
export function StatusChip({ status }: { status: 'ready' | 'pending' | 'generating' }) {
  if (status === 'generating') return <Chip tint="blue">RENDERING…</Chip>
  return <Chip tint={status === 'ready' ? 'primary' : 'warning'}>{status === 'ready' ? 'READY' : 'PENDING'}</Chip>
}

/* ---------------- trend ---------------- */

export function TrendArrow({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up')
    return (
      <span className="inline-flex items-center gap-0.5 text-tint-fg-mint" title="Trending up">
        <ArrowUpRight size={14} />
      </span>
    )
  if (trend === 'down')
    return (
      <span className="inline-flex items-center gap-0.5 text-tint-fg-pink" title="Trending down">
        <ArrowDownRight size={14} />
      </span>
    )
  return (
    <span className="inline-flex items-center gap-0.5 text-text-3" title="Holding steady">
      <Minus size={14} />
    </span>
  )
}

/* ---------------- progress ---------------- */

export function ThinProgress({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${clamped}%` }} />
    </div>
  )
}

/* ---------------- ideal week strip ---------------- */

/** 7 dots: met target (primary) vs missed (surface-3). Deterministic per client id. */
export function IdealWeekDots({ seedKey, ratio }: { seedKey: string; ratio: number }) {
  // deterministic pseudo-random from the id so every boot matches
  const dots = Array.from({ length: 7 }, (_, d) => {
    const h = (seedKey.charCodeAt(d % seedKey.length) * (d + 3) * 37) % 100
    return h < ratio * 100
  })
  return (
    <div className="flex items-center gap-1.5" title="Ideal week — target met vs missed, Mon to Sun">
      {dots.map((met, d) => (
        <span
          key={d}
          className={cn('h-2 w-2 rounded-full', met ? 'bg-primary' : 'border border-border bg-surface-3')}
        />
      ))}
    </div>
  )
}

/* ---------------- loading skeleton ---------------- */

// Pulsing placeholder cards shown while the real rows load — the erase before any content is drawn, so stale/mock…
export function SkeletonCards({ count = 8, withImage = false }: { count?: number; withImage?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} padded={!withImage} className="overflow-hidden">
          {withImage && <div className="aspect-[3/2] w-full animate-pulse bg-surface-3" />}
          <div className={cn('space-y-2.5', withImage && 'p-4')}>
            <div className="h-3 w-2/5 animate-pulse rounded bg-surface-3" />
            <div className="h-4 w-3/5 animate-pulse rounded bg-surface-3" />
            <div className="h-3 w-full animate-pulse rounded bg-surface-3" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-surface-3" />
          </div>
        </Card>
      ))}
    </div>
  )
}

/* ---------------- focus + search scoping ---------------- */

// Person Focus Mode: scopes rows to the focused client (clientId / clientName via recordMatchesFocus), then applies…
export function useScopedRows<T extends { clientId: string; clientName: string }>(
  rows: T[],
  q: string,
  searchKeys: (keyof T)[],
): T[] {
  const focus = useContextStore((s) => s.focus)
  return rows.filter((r) => {
    if (
      focus?.type === 'client' &&
      !recordMatchesFocus(r.clientId, focus) &&
      !recordMatchesFocus(r.clientName, focus)
    )
      return false
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    return searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(needle))
  })
}
