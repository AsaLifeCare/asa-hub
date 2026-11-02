// Collection rail — "All documents" + per-collection filters with counts, dashed "New collection" affordance…
import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import Card from '@/components/shared/Card'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { Doc, TintName } from '@/engine/types'
import type { CollectionCfg } from './types'

export function CollectionRail({
  collections,
  collection,
  setCollection,
  counts,
  visibleDocs,
  onNewCollection,
}: {
  collections: CollectionCfg[]
  collection: string
  setCollection: (id: string) => void
  counts: Map<string, number>
  visibleDocs: Doc[]
  // Opens the "New collection" prompt (admins only — the button explains itself to everyone else rather than…
  onNewCollection: () => void
}) {
  return (
    <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}>
      <Card padded={false} className="w-full p-2 md:sticky md:top-6 md:w-[200px] md:shrink-0">
        {[{ id: 'all', label: 'All documents', icon: 'layers', tint: 'blue' as TintName }, ...collections].map((c) => {
          const active = collection === c.id
          const count = c.id === 'all' ? visibleDocs.length : (counts.get(c.id) ?? 0)
          return (
            <button
              key={c.id}
              onClick={() => setCollection(c.id)}
              className={cn(
                'relative flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2 text-[13px] font-medium transition-colors duration-150',
                active ? 'bg-surface-2 text-text-1' : 'text-text-2 hover:bg-surface-2',
              )}
            >
              {active && <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-[4px] bg-primary" />}
              <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-[8px]', TINT_BG[c.tint])}>
                <AppIcon name={c.icon} size={13} className={TINT_FG[c.tint]} />
              </span>
              <span className="clamp-1 flex-1 text-left">{c.label}</span>
              <span className="text-[11px] tabular-nums text-text-3">{count}</span>
            </button>
          )
        })}
        <button
          onClick={onNewCollection}
          className="mt-1 flex h-9 w-full items-center gap-2.5 rounded-[10px] border border-dashed border-border-strong px-2 text-[13px] font-medium text-text-3 transition-colors duration-150 hover:bg-surface-2 hover:text-text-2"
        >
          <Plus size={14} className="ml-1" /> New collection
        </button>
      </Card>
    </motion.div>
  )
}
