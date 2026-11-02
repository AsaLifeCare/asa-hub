// THE TOOLBAR — the six tabs, the search box, and the chips a lane's own data offers.
// A chip row is cut from the rows on screen, so a request type the model coins tomorrow is a chip tomorrow and a…
import { useState } from 'react'
import { motion } from 'framer-motion'
import { List, Lock, Search, Table2, X } from 'lucide-react'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import { TABS, type TabId } from './items'

/** How many chips show before the row folds behind "more". */
const CHIPS_FOLDED = 8

const PLACEHOLDER: Record<TabId, string> = {
  calls: 'Search calls — name, phone, summary…',
  calloffs: 'Search call offs — name, type, notes…',
  queue: 'Search the queue — name, phone, type, description…',
  notes: 'Search daily notes — DSP, client, category, note…',
  incidents: 'Search incidents — client, category, summary…',
  screening: 'Search screening — candidate, phone, result…',
}

export default function HotlineToolbar({
  tab,
  counts,
  closed,
  onTab,
  query,
  onQuery,
  chips,
  chip,
  onChip,
  sheetable,
  asSheet,
  onSheet,
}: {
  tab: TabId
  /** null is "not read" and draws a dash, never a zero */
  counts: Record<TabId, number | null>
  /** a tab this session may not read draws a lock, with the sentence of why */
  closed: Partial<Record<TabId, string>>
  onTab: (t: TabId) => void
  query: string
  onQuery: (q: string) => void
  chips: { value: string; count: number }[]
  chip: string
  onChip: (v: string) => void
  sheetable: boolean
  asSheet: boolean
  onSheet: (v: boolean) => void
}) {
  const [unfolded, setUnfolded] = useState(false)
  const total = chips.reduce((a, c) => a + c.count, 0)
  const visible = unfolded ? chips : chips.slice(0, CHIPS_FOLDED)
  // the active chip stays in sight even when it sits past the fold
  const activeHidden = !!chip && !visible.some((c) => c.value === chip)
  const shown = activeHidden ? [...visible, ...chips.filter((c) => c.value === chip)] : visible

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="scroll-thin -mx-1 min-w-0 max-w-full overflow-x-auto px-1 py-0.5">
          <div role="tablist" aria-label="What to list" className="flex w-max items-center gap-0.5 rounded-full bg-surface-3 p-1">
            {TABS.map((t) => {
              const active = t.id === tab
              const n = counts[t.id]
              const lock = closed[t.id]
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={lock}
                  onClick={() => onTab(t.id)}
                  className={cn(
                    'relative shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors duration-150',
                    active ? 'text-text-1' : 'text-text-3 hover:text-text-2',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="hotline-tab"
                      className="absolute inset-0 rounded-full bg-surface shadow-1"
                      transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                    />
                  )}
                  <span className="relative inline-flex items-center gap-1.5">
                    {t.label}
                    {lock
                      ? <Lock size={11} className={active ? 'text-text-2' : 'text-text-3'} aria-label={lock} />
                      : (
                        <span className={cn('font-stat text-[11.5px]', active ? 'text-text-2' : 'text-text-3')}>
                          {n === null ? '—' : n.toLocaleString()}
                        </span>
                      )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="ml-auto flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-surface px-3 transition-colors focus-within:border-border-strong sm:w-[280px] sm:flex-none">
            <Search size={14} className="shrink-0 text-text-3" />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={PLACEHOLDER[tab]}
              aria-label="Search this tab"
              className="w-full min-w-0 bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
            />
            {query && (
              <button type="button" onClick={() => onQuery('')} aria-label="Clear the search"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-text-3 hover:bg-surface-3 hover:text-text-1">
                <X size={12} />
              </button>
            )}
          </label>
          {sheetable && (
            <button
              type="button"
              onClick={() => onSheet(!asSheet)}
              title={asSheet ? 'Back to the list' : 'Read this lane as a spreadsheet'}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[12.5px] font-medium text-text-2 transition-colors hover:bg-surface-2"
            >
              {asSheet ? <List size={14} /> : <Table2 size={14} />}
              <span className="hidden sm:inline">{asSheet ? 'List' : 'Spreadsheet'}</span>
            </button>
          )}
        </div>
      </div>

      {chips.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <ChipButton label="All" count={total} active={!chip} onClick={() => onChip('')} />
          {shown.map((c) => (
            <ChipButton key={c.value} label={c.value} count={c.count} active={chip === c.value}
              onClick={() => onChip(chip === c.value ? '' : c.value)} />
          ))}
          {chips.length > CHIPS_FOLDED && (
            <button
              type="button"
              onClick={() => setUnfolded((v) => !v)}
              className="h-7 rounded-full px-2.5 text-[12px] font-medium text-text-3 transition-colors hover:text-text-1"
            >
              {unfolded ? 'Fewer' : `${(chips.length - CHIPS_FOLDED).toLocaleString()} more`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ChipButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-150',
        active
          ? 'border-transparent bg-primary-soft text-primary-strong'
          : 'border-border bg-surface text-text-2 hover:bg-surface-2',
      )}
    >
      <span className="truncate">{label}</span>
      <span className={cn('font-stat text-[11px]', active ? 'opacity-80' : 'text-text-3')}>{count.toLocaleString()}</span>
    </button>
  )
}
