import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'
import { TINT_BG } from '@/lib/tints'

/** Signature 20px-radius card (§11). Optional pastel tint variant + hover-lift. */
export default function Card({
  children,
  className,
  tint,
  hover = false,
  padded = true,
}: {
  children: ReactNode
  className?: string
  tint?: TintName
  /** lift y:-2 + shadow-1→2 on hover (150ms) */
  hover?: boolean
  padded?: boolean
}) {
  return (
    <motion.div
      whileHover={hover ? { y: -2 } : undefined}
      transition={{ duration: 0.15 }}
      className={cn(
        'rounded-lg border border-border shadow-1',
        tint ? TINT_BG[tint] : 'bg-surface',
        hover && 'hover:shadow-2 transition-shadow duration-150',
        padded && 'p-5',
        className,
      )}
    >
      {children}
    </motion.div>
  )
}

export function CardHeader({ title, sub, extra }: { title: string; sub?: string; extra?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-text-2">{sub}</p>}
      </div>
      {extra}
    </div>
  )
}
