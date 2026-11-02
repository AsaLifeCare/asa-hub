import { useId } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/** Segmented control with sliding indicator (§11, §7.3/§8). */
export default function SegmentedTabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
  className?: string
}) {
  const layoutId = useId()
  return (
    <div className={cn('flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5', className)}>
      {tabs.map((t) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              'relative rounded-full px-3 py-1 text-[12px] font-medium transition-colors duration-150',
              active ? 'text-text-1' : 'text-text-3 hover:text-text-2',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-full bg-surface shadow-1"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative">{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}
