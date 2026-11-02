import { Check, ChevronDown, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type ActiveFilter = { key: string; label: string; value: string }

/** Filter chip row (§11): dropdown add-chips + removable active chips, layout-animated. */
export default function FilterChips({
  filters,
  active,
  onAdd,
  onRemove,
  className,
}: {
  filters: { key: string; label: string; options: string[] }[]
  active: ActiveFilter[]
  onAdd: (f: ActiveFilter) => void
  onRemove: (key: string) => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {filters.map((f) => {
        const current = active.find((a) => a.key === f.key)
        return (
          <DropdownMenu key={f.key}>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors duration-150',
                  current
                    ? 'border-transparent bg-primary-soft text-primary-strong'
                    : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                )}
              >
                {f.label}
                {current && <span className="text-text-3">· {current.value}</span>}
                <ChevronDown size={13} className="text-text-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px]">
              {f.options.map((opt) => (
                <DropdownMenuItem key={opt} onClick={() => onAdd({ key: f.key, label: f.label, value: opt })}>
                  <span className="flex-1">{opt}</span>
                  {current?.value === opt && <Check size={14} className="text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      })}
      <AnimatePresence>
        {active.map((a) => (
          <motion.button
            key={a.key}
            layout
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.15 }}
            onClick={() => onRemove(a.key)}
            className="flex h-8 items-center gap-1.5 rounded-full bg-primary-soft px-3 text-[12px] font-medium text-primary-strong"
          >
            {a.value}
            <X size={13} />
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
