/** 2×2 stat mini-cards with count-up numeric values (moved verbatim from DetailTemplate.tsx). */
import { useEffect, useState } from 'react'
import { animate, motion } from 'framer-motion'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { EASE_OUT_EXPO, staggerItem } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'
import { resolve } from './utils'

/** One-shot 0→value count-up (500ms, easeOutExpo) for numeric stat values. */
function CountUp({ value, suffix = '', prefix = '' }: { value: number; suffix?: string; prefix?: string }) {
  const decimals = (String(value).split('.')[1] ?? '').length
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const controls = animate(0, value, {
      duration: 0.5,
      ease: EASE_OUT_EXPO,
      onUpdate: (v) => setShown(v),
    })
    return () => controls.stop()
  }, [value])
  return (
    <span className="tabular-nums">
      {prefix}
      {shown.toFixed(decimals)}
      {suffix}
    </span>
  )
}

export function StatGrid({ stats, record }: { stats: any[]; record: any }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map((s, i) => {
        const v = resolve(record, s.value)
        const numeric = typeof v === 'number' && isFinite(v)
        return (
          <motion.div key={i} variants={staggerItem} className="rounded-[16px] border border-border bg-surface p-3">
            <span className={cn('mb-1.5 grid h-8 w-8 place-items-center rounded-[10px]', TINT_BG[s.tint as TintName])}>
              <AppIcon name={s.icon} size={15} className={TINT_FG[s.tint as TintName]} />
            </span>
            <div className="font-stat text-[17px] font-bold leading-6 text-text-1">
              {numeric ? (
                <CountUp value={v} suffix={s.suffix ?? ''} prefix={s.prefix ?? ''} />
              ) : v != null && String(v).trim() !== '' ? (
                v
              ) : (
                '—'
              )}
            </div>
            <div className="text-[11px] text-text-3">{s.label}</div>
          </motion.div>
        )
      })}
    </div>
  )
}
