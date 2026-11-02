// The record's center strip: one row of underline tabs that scrolls sideways.
// The baseline is drawn INSIDE the scroller (an inset shadow), so the active underline is never clipped and no…
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { revealTab, stripEdges, type UniqueTab, type UniqueTabId } from './uniqueTabs'

type Edges = { left: boolean; right: boolean }

/** how far a chosen tab is kept from an edge button */
const EDGE_PAD = 44

/** The strip as drawn, from its edges; nothing is measured here. */
export function TabStripView({ tabs, current, counts, edges, onPick, onStep, scrollerRef, buttonRef, onScroll }: {
  tabs: readonly UniqueTab[]
  current: UniqueTabId
  /** a count beside a tab's label, drawn when above zero */
  counts?: Partial<Record<UniqueTabId, number>>
  edges: Edges
  onPick: (id: UniqueTabId) => void
  onStep: (dir: -1 | 1) => void
  scrollerRef?: RefObject<HTMLDivElement | null>
  buttonRef?: (id: UniqueTabId) => (el: HTMLButtonElement | null) => void
  onScroll?: () => void
}) {
  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex overflow-x-auto overflow-y-hidden shadow-[inset_0_-2px_0_var(--border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={buttonRef?.(t.id)}
            type="button"
            onClick={() => onPick(t.id)}
            aria-current={current === t.id ? 'true' : undefined}
            className={cn(
              'shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2 text-[13px] font-semibold transition-colors',
              current === t.id ? 'border-primary text-primary' : 'border-transparent text-text-3 hover:text-text-2',
            )}
          >
            {t.label}
            {counts?.[t.id] ? (
              <span className="ml-1.5 rounded-full bg-tint-pink px-1.5 text-[10.5px] tabular-nums text-tint-fg-pink">
                {counts[t.id]}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {edges.left && <Edge side="left" onStep={() => onStep(-1)} />}
      {edges.right && <Edge side="right" onStep={() => onStep(1)} />}
    </div>
  )
}

function Edge({ side, onStep }: { side: 'left' | 'right'; onStep: () => void }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute bottom-0.5 top-0 flex w-11 items-center',
        side === 'left'
          ? 'left-0 justify-start bg-[linear-gradient(to_right,var(--surface)_45%,transparent)]'
          : 'right-0 justify-end bg-[linear-gradient(to_left,var(--surface)_45%,transparent)]',
      )}
    >
      <button
        type="button"
        onClick={onStep}
        aria-label={side === 'left' ? 'Earlier tabs' : 'More tabs'}
        title={side === 'left' ? 'Earlier tabs' : 'More tabs'}
        className="pointer-events-auto grid h-7 w-7 place-items-center rounded-full border border-border bg-surface text-text-2 shadow-1 transition-colors hover:bg-surface-2 hover:text-text-1"
      >
        {side === 'left' ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
      </button>
    </div>
  )
}

export default function TabStrip({ tabs, current, counts, onPick }: {
  tabs: readonly UniqueTab[]
  current: UniqueTabId
  counts?: Partial<Record<UniqueTabId, number>>
  onPick: (id: UniqueTabId) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const buttons = useRef<Partial<Record<UniqueTabId, HTMLButtonElement | null>>>({})
  const [edges, setEdges] = useState<Edges>({ left: false, right: false })

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const next = stripEdges(el)
    setEdges((e) => (e.left === next.left && e.right === next.right ? e : next))
  }, [])

  // after every render: a tab or a count appearing widens the content, not the box
  useEffect(() => { measure() })
  useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])
  useEffect(() => {
    const el = scroller.current
    const btn = buttons.current[current]
    if (el && btn) revealTab(el, btn, EDGE_PAD)
  }, [current])

  const step = (dir: -1 | 1) => {
    const el = scroller.current
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' })
  }

  return (
    <TabStripView
      tabs={tabs}
      current={current}
      counts={counts}
      edges={edges}
      onPick={onPick}
      onStep={step}
      scrollerRef={scroller}
      buttonRef={(id) => (el) => { buttons.current[id] = el }}
      onScroll={measure}
    />
  )
}
