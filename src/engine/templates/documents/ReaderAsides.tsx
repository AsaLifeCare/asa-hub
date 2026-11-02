// Reader side rails — course module sidebar + sticky scroll-spy TOC (moved verbatim from the Reader in…
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { DocBlock } from '@/engine/types'
import type { CourseModule } from './types'

/** TOC entries are the heading blocks of the doc body. */
export type TocEntry = Extract<DocBlock, { kind: 'h2' | 'h3' }>

/* course module sidebar (numbered, checkable — progress persisted per user) */
export function CourseModulesAside({
  modules,
  courseChecked,
  onToggleModule,
  coursePct,
  jumpTo,
}: {
  modules: CourseModule[]
  courseChecked: string[]
  onToggleModule: (moduleId: string) => void
  coursePct: number
  jumpTo: (id: string) => void
}) {
  return (
    <motion.aside
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO, delay: 0.18 }}
      className="doc-no-print sticky top-6 hidden h-fit w-[240px] shrink-0 xl:block"
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Course modules</p>
      <div className="mb-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${coursePct}%` }} />
        </div>
        <span className="text-[11px] font-semibold tabular-nums text-primary-strong">{coursePct}%</span>
      </div>
      <div className="space-y-1">
        {modules.map((m, i) => {
          const done = courseChecked.includes(m.id)
          return (
            <div key={m.id} className="flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors duration-150 hover:bg-surface-2">
              <button
                aria-pressed={done}
                aria-label={done ? `Mark "${m.title}" as not done` : `Mark "${m.title}" as done`}
                onClick={() => onToggleModule(m.id)}
                className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border transition-colors duration-150',
                  done ? 'border-transparent bg-primary text-on-primary' : 'border-border-strong text-transparent hover:border-primary hover:text-primary/40',
                )}
              >
                <Check size={12} strokeWidth={3} />
              </button>
              <button onClick={() => jumpTo(m.id)} className="min-w-0 flex-1 text-left">
                <span className={cn('clamp-1 block text-[13px] leading-4', done ? 'text-text-3 line-through' : 'font-medium text-text-1')}>
                  {i + 1}. {m.title}
                </span>
                <span className="text-[11px] text-text-3">{m.minutes} min</span>
              </button>
            </div>
          )
        })}
      </div>
      <p className="mt-3 px-2 text-[11px] leading-4 text-text-3">Progress is saved on this device, just for you.</p>
    </motion.aside>
  )
}

/* sticky TOC rail with scroll-spy (non-course docs) */
export function TocRail({
  toc,
  activeId,
  jumpTo,
}: {
  toc: TocEntry[]
  activeId: string
  jumpTo: (id: string) => void
}) {
  return (
    <motion.aside
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO, delay: 0.18 }}
      className="doc-no-print sticky top-6 hidden h-fit w-[200px] shrink-0 xl:block"
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">On this page</p>
      <div className="space-y-1">
        {toc.map((t) => (
          <button
            key={t.id}
            onClick={() => jumpTo(t.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors duration-150',
              t.kind === 'h3' && 'pl-6',
              activeId === t.id ? 'font-medium text-text-1' : 'text-text-3 hover:text-text-2',
            )}
          >
            {/* fixed-size slot — the dot no longer shifts rows when it appears */}
            <span className="grid h-1.5 w-1.5 shrink-0 place-items-center">
              {activeId === t.id && (
                <motion.span
                  layoutId="toc-dot"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  className="h-1.5 w-1.5 rounded-full bg-primary"
                />
              )}
            </span>
            {t.text}
          </button>
        ))}
      </div>
    </motion.aside>
  )
}
