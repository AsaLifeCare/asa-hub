/** Floating bulk-action bar shown while rows are selected (moved verbatim from SheetTemplate.tsx). */
import { unwiredAction } from '@/engine/templates/unwired'
import type { Dispatch, SetStateAction } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { AppIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { ConfigAction } from '@/engine/configActions'

export function BulkBar({
  config,
  entity,
  selected,
  setSelected,
  onDelete,
  configActions,
  onRunConfig,
}: {
  config: Record<string, any>
  entity: [string, string]
  selected: Set<string>
  setSelected: Dispatch<SetStateAction<Set<string>>>
  // Real bulk deletion — wired by the sheet when `config.rowDelete` is declared and the signed-in person holds its…
  onDelete?: () => void
  // Real bulk config actions (`kind: 'patch'` + `bulk` rowActions, already permission-filtered) — applied to every…
  configActions?: ConfigAction[]
  onRunConfig?: (a: ConfigAction) => void
}) {
  return (
    <AnimatePresence>
      {config.selectable && selected.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 24, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: 24, x: '-50%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          // the shell reserves a floor under the page while this is up
          data-floating-bar=""
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-30 flex h-12 w-[min(560px,calc(100vw-24px))] items-center gap-3 rounded-full border border-border bg-surface pl-5 pr-2 shadow-3 sm:bottom-6"
        >
          <span className="text-[13px] font-semibold tabular-nums text-text-1">{selected.size} selected</span>
          <span className="h-5 w-px bg-border" />
          <div className="ml-auto flex items-center gap-1">
            {(configActions ?? []).map((a) => (
              <button
                key={a.id}
                onClick={() => onRunConfig?.(a)}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors duration-150',
                  a.danger ? 'text-danger hover:bg-tint-pink' : 'text-text-1 hover:bg-surface-2',
                )}
              >
                {a.icon && <AppIcon name={a.icon} size={14} />} {a.label}
              </button>
            ))}
            {(config.bulkActions ?? []).map((a: any) => (
              <button
                key={a.id}
                onClick={() => {
                  unwiredAction(a.label, `no bulk handler is wired for this action yet (${selected.size} ${selected.size === 1 ? entity[0] : entity[1]} selected).`)
                  setSelected(new Set())
                }}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors duration-150',
                  a.danger ? 'text-danger hover:bg-tint-pink' : 'text-text-1 hover:bg-surface-2',
                )}
              >
                <AppIcon name={a.icon} size={14} /> {a.label}
              </button>
            ))}
            {onDelete && (
              <button
                onClick={onDelete}
                className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-danger transition-colors duration-150 hover:bg-tint-pink"
              >
                <AppIcon name="trash-2" size={14} /> Delete
              </button>
            )}
            <button
              aria-label="Clear selection"
              onClick={() => setSelected(new Set())}
              className="grid h-8 w-8 place-items-center rounded-full text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
