/** Pagination footer: range label + numbered page buttons (moved verbatim from SheetTemplate.tsx). */
import type { Dispatch, SetStateAction } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function SheetPagination({
  total,
  rangeFrom,
  rangeTo,
  pageCount,
  safePage,
  setPage,
}: {
  total: number
  rangeFrom: number
  rangeTo: number
  pageCount: number
  safePage: number
  setPage: Dispatch<SetStateAction<number>>
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
      <span className="text-[12px] tabular-nums text-text-3">
        {rangeFrom}–{rangeTo} of {total}
      </span>
      {pageCount > 1 && (
        <div className="scroll-thin flex max-w-full items-center gap-1 overflow-x-auto">
          <button
            aria-label="Previous page"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="grid h-8 w-8 place-items-center rounded-sm text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            <ChevronLeft size={15} />
          </button>
          {/* Ten pages at a time. Beyond that the row of numbers becomes a
              scrollbar nobody aims at, so the window slides: 1–10, then
              11–20, and the ellipsis is the control that moves it. */}
          {(() => {
            const WINDOW = 10
            const block = Math.floor(safePage / WINDOW)
            const first = block * WINDOW
            const last = Math.min(pageCount, first + WINDOW)
            const nodes = []
            if (first > 0) {
              nodes.push(
                <button
                  key="prev-block"
                  aria-label={`Pages ${first - WINDOW + 1} to ${first}`}
                  title={`Back to pages ${first - WINDOW + 1}–${first}`}
                  onClick={() => setPage(first - 1)}
                  className="h-8 min-w-8 rounded-sm px-2 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2"
                >
                  …
                </button>,
              )
            }
            for (let i = first; i < last; i++) {
              nodes.push(
                <button
                  key={i}
                  aria-label={`Page ${i + 1}`}
                  aria-current={i === safePage ? 'page' : undefined}
                  onClick={() => setPage(i)}
                  className={cn(
                    'h-8 min-w-8 rounded-sm px-2 text-[13px] font-medium tabular-nums transition-colors duration-150',
                    i === safePage ? 'bg-primary text-on-primary' : 'text-text-2 hover:bg-surface-2',
                  )}
                >
                  {i + 1}
                </button>,
              )
            }
            if (last < pageCount) {
              nodes.push(
                <button
                  key="next-block"
                  aria-label={`Pages ${last + 1} to ${Math.min(pageCount, last + WINDOW)}`}
                  title={`Show pages ${last + 1}–${Math.min(pageCount, last + WINDOW)}`}
                  onClick={() => setPage(last)}
                  className="h-8 min-w-8 rounded-sm px-2 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2"
                >
                  …
                </button>,
              )
            }
            return nodes
          })()}
          <button
            aria-label="Next page"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="grid h-8 w-8 place-items-center rounded-sm text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
