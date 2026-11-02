// Person Focus Mode — slim context banner (context-mode wave).
// Rendered under a page header while a focus is active and the page declares `config.scopeBy`.
import { motion } from 'framer-motion'
import { Crosshair, X } from 'lucide-react'
import { useContextStore } from '@/stores/useContextStore'
import { toast } from '@/stores/useToastStore'

export default function ContextBanner({ filtered }: { filtered?: boolean }) {
  const focus = useContextStore((s) => s.focus)
  const clearFocus = useContextStore((s) => s.clearFocus)
  if (!focus) return null

  return (
    <motion.div
      key={focus.id}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="mb-4 flex items-center gap-2.5 rounded-md border border-primary/25 bg-primary-soft px-3.5 py-2"
      role="status"
    >
      <Crosshair size={14} className="shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">
        Showing records related to <span className="font-semibold text-primary-strong">{focus.name}</span>
        {filtered === false && <span className="text-text-3"> — no exact matches on this page, showing all</span>}
      </span>
      <button
        onClick={() => {
          clearFocus()
          toast({ type: 'info', title: 'Back to full workspace', body: 'Person Focus Mode cleared.' })
        }}
        className="flex h-6 shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-2.5 text-[11px] font-semibold text-text-2 transition-colors duration-150 hover:bg-surface-2 hover:text-text-1"
      >
        <X size={11} /> Clear
      </button>
    </motion.div>
  )
}
