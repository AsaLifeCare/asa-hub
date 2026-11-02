import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { TINT_VAR } from '@/lib/tints'
import type { TintName } from '@/engine/types'

export default function ProgressBar({
  value, // 0..1
  tint = 'mint',
  height = 6,
  className,
  animate = true,
}: {
  value: number
  tint?: TintName
  height?: number
  className?: string
  animate?: boolean
}) {
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-surface-3', className)} style={{ height }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: TINT_VAR[tint] }}
        initial={animate ? { width: 0 } : false}
        animate={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  )
}
