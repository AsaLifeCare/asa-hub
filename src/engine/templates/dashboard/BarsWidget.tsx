// `bars` widget — ranked horizontal bars for CATEGORY counts.
// Why not recharts: a vertical BarChart puts the category names on a YAxis, and recharts leaks `YAxis width` into…
import { TINT_VAR } from '@/lib/tints'
import Card, { CardHeader } from '@/components/shared/Card'
import type { TintName } from '@/engine/types'
import { cn } from '@/lib/utils'

export type BarRow = { label: string; value: number; tint?: TintName; href?: string }

const CYCLE: TintName[] = ['pink', 'peach', 'amber', 'blue', 'lavender', 'mint']

export function BarsWidget({
  w,
  tint,
  onNavigate,
}: {
  w: any
  tint?: TintName
  onNavigate?: (href: string) => void
}) {
  const rows: BarRow[] = (w.bars ?? []).filter((b: BarRow) => b && b.label)
  const max = Math.max(1, ...rows.map((b) => Number(b.value) || 0))
  const total = rows.reduce((n, b) => n + (Number(b.value) || 0), 0)
  return (
    <Card hover className="h-full" tint={tint}>
      <CardHeader
        title={w._title}
        extra={
          total > 0 ? (
            <span className="pr-16 font-mono text-[11px] font-semibold text-text-3">{total} total</span>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <p className="text-[13px] text-text-2">{w.empty ?? 'Nothing to show yet.'}</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((b, i) => {
            const pct = Math.round(((Number(b.value) || 0) / max) * 100)
            const color = TINT_VAR[(b.tint ?? CYCLE[i % CYCLE.length]) as TintName]
            const clickable = !!b.href && !!onNavigate
            return (
              <li
                key={`${b.label}-${i}`}
                onClick={clickable ? () => onNavigate!(b.href!) : undefined}
                className={cn('min-w-0', clickable && 'cursor-pointer')}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[12.5px] text-text-2" title={b.label}>
                    {b.label}
                  </span>
                  <span className="shrink-0 font-stat text-[13px] font-semibold text-text-1">{b.value}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${Math.max(pct, 3)}%`, backgroundColor: color }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {w.viewAllHref && onNavigate && (
        <button
          onClick={() => onNavigate(w.viewAllHref)}
          className="mt-3 text-[12px] font-semibold text-primary transition-colors hover:text-primary-hover"
        >
          {w.viewAllLabel ?? 'See all'} →
        </button>
      )}
    </Card>
  )
}
