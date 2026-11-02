// The unfinished-work post-it: typing something — a Kanban card, a suggestion, a dashboard indicator — and leaving…
// Hover (or focus) slides it out: "Save your work", one row per unfinished thing; clicking a row navigates back to…
import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useDraftStore } from '@/stores/useDraftStore'
import { EASE_OUT_EXPO } from '@/engine/motion'

export default function DraftPostIt() {
  const drafts = useDraftStore((s) => s.drafts)
  const clearDraft = useDraftStore((s) => s.clearDraft)
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const here = pathname + search

  // stable list (newest first) — built from the map so the selector identity never loops a render
  const list = useMemo(
    () => Object.values(drafts).sort((a, b) => b.at - a.at),
    [drafts],
  )

  const show = list.length > 0 && list.every((d) => d.href !== here)

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
          // pointer-events-none on the box, -auto on the strip: the fixed box spans the strip's FULL width even…
          className="group pointer-events-none fixed right-0 top-[96px] z-40 print:hidden"
        >
          {/* collapsed: only ~14px of the amber tab peeks; hover/focus slides
              the whole strip (tab + panel) fully into view */}
          <div className="pointer-events-auto flex translate-x-[calc(100%-14px)] items-start transition-transform duration-300 ease-out group-focus-within:translate-x-0 group-hover:translate-x-0">
            <div
              aria-hidden
              className="flex w-[28px] shrink-0 items-center justify-center rounded-l-md border border-r-0 border-border bg-tint-amber px-1 py-3 shadow-2"
            >
              <span
                className="whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-tint-fg-amber"
                style={{ writingMode: 'vertical-rl' }}
              >
                Save your work
              </span>
            </div>
            <div className="w-[248px] overflow-hidden rounded-bl-md border border-border bg-surface shadow-2">
              <p className="bg-tint-amber px-3 py-2 text-[12px] font-bold text-tint-fg-amber">
                Save your work
              </p>
              <p className="px-3 pb-1 pt-2 text-[11.5px] leading-4 text-text-3">
                You left these unfinished — click one to go back.
              </p>
              <div className="pb-1.5">
                {list.map((d) => (
                  <div key={d.id} className="flex items-center gap-1 px-1.5 py-0.5">
                    <button
                      onClick={() => navigate(d.href)}
                      className="min-w-0 flex-1 truncate rounded-sm px-1.5 py-1.5 text-left text-[12.5px] font-medium text-text-1 transition-colors hover:bg-surface-2"
                    >
                      {d.label}
                    </button>
                    <button
                      onClick={() => clearDraft(d.id)}
                      aria-label={`Dismiss "${d.label}"`}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
