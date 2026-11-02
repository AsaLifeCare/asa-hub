/** Shared building blocks for the two inventory pages (supplies / medications). */
import { motion } from 'framer-motion'
import Card from '@/components/shared/Card'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { staggerItem } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { InventoryItem } from '@/lib/seed-ops'
import type { TintName } from '@/engine/types'

export const isLowStock = (i: InventoryItem) => i.quantityOnHand <= i.reorderLevel

export type SummaryStat = { label: string; value: number | string; icon: string; tint: TintName }

/** Compact low-stock / expiry summary strip rendered above both inventory tables. */
export function SummaryStrip({ stats }: { stats: SummaryStat[] }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s) => (
        <motion.div key={s.label} variants={staggerItem}>
          <Card className="flex items-center gap-3 !p-3.5">
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[10px]', TINT_BG[s.tint])}>
              <AppIcon name={s.icon} size={16} className={TINT_FG[s.tint]} />
            </span>
            <div className="min-w-0">
              <div className="font-stat text-[18px] font-bold leading-6 text-text-1">{s.value}</div>
              <div className="clamp-1 text-[11px] text-text-3">{s.label}</div>
            </div>
          </Card>
        </motion.div>
      ))}
    </div>
  )
}
