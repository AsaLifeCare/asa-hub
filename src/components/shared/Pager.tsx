// The page control for `usePager` (src/lib/pager.ts).
// Renders nothing when everything fits on one page — a pager under a list of six is noise.
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const btn =
  'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border border-border bg-surface px-2 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-35 disabled:hover:bg-surface'

export default function Pager({
  page,
  pages,
  from,
  to,
  total,
  onPage,
  noun = 'items',
  className,
}: {
  page: number
  pages: number
  from: number
  to: number
  total: number
  onPage: (p: number) => void
  noun?: string
  className?: string
}) {
  if (pages <= 1) return null

  // A window of pages around the current one — forty numbered buttons is not navigation, it is wallpaper.
  const window: number[] = []
  const start = Math.max(0, Math.min(page - 2, pages - 5))
  for (let i = start; i < Math.min(pages, start + 5); i++) window.push(i)

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5 pt-1', className)}>
      {/* A RANGE OF ONE IS NOT A RANGE. With a page size of 1 — a client's
          Daily days, one to a page, in both chart views — `from` always equals
          `to`, so this could only ever print "3–3 of 12", where the dash is
          noise a reader has to stop and decode. Same sentence, one number,
          whenever the page holds one. */}
      <span className="mr-auto text-[12px] tabular-nums text-text-3">
        {from === to ? from : `${from}–${to}`} of {total} {noun}
      </span>
      <button className={btn} onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">
        <ChevronLeft size={14} />
      </button>
      {start > 0 && <span className="px-1 text-[12px] text-text-3">…</span>}
      {window.map((p) => (
        <button
          key={p}
          onClick={() => onPage(p)}
          aria-current={p === page ? 'page' : undefined}
          className={cn(btn, p === page && 'border-primary/40 bg-tint-blue text-tint-fg-blue')}
        >
          {p + 1}
        </button>
      ))}
      {start + 5 < pages && <span className="px-1 text-[12px] text-text-3">…</span>}
      <button className={btn} onClick={() => onPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page">
        <ChevronRight size={14} />
      </button>
    </div>
  )
}
