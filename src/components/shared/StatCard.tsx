import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Card from '@/components/shared/Card'
import DeltaPill from '@/components/shared/DeltaPill'
import { Sparkline } from '@/components/shared/charts'
import type { TintName } from '@/engine/types'

function useCountUp(target: number, duration = 600) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return v
}

/** KPI stat card (§11): overline label, count-up number, delta pill, sparkline. */
export default function StatCard({
  label,
  value,
  delta,
  deltaLabel = 'vs last month',
  spark,
  tint,
  onClick,
}: {
  label: string
  // A number counts up; anything else is shown verbatim.
  value: number | string
  delta?: number
  deltaLabel?: string
  spark?: number[]
  tint: TintName
  onClick?: () => void
}) {
  const numeric = typeof value === 'number' && Number.isFinite(value)
  // hooks run unconditionally; the counter simply has nothing to count
  const displayed = useCountUp(numeric ? value : 0)
  return (
    <motion.div whileTap={onClick ? { scale: 0.98 } : undefined} transition={{ duration: 0.16 }}>
      <Card hover className={onClick ? 'cursor-pointer' : undefined}>
        <div onClick={onClick} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{label}</div>
            <div className="mt-1.5 font-stat text-[28px] font-bold leading-[34px] text-text-1">
              {numeric ? displayed.toLocaleString() : String(value ?? '')}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              {delta != null && <DeltaPill delta={delta} />}
              <span className="text-[12px] text-text-3">{deltaLabel}</span>
            </div>
          </div>
          {spark && (
            <div className="shrink-0 pt-1">
              <Sparkline points={spark} tint={tint} />
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  )
}
