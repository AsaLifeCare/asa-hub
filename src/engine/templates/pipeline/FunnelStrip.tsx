/** Funnel summary strip + count-up stat (moved verbatim from PipelineTemplate.tsx). */
import { useEffect, useState } from 'react'
import { animate, motion } from 'framer-motion'
import { Clock } from 'lucide-react'
import Card from '@/components/shared/Card'
import { TINT_VAR } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { Stage } from './types'

/** One-shot 0→value count-up (500ms easeOutExpo) for funnel counts. */
function CountUp({ value, delay = 0 }: { value: number; delay?: number }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const controls = animate(0, value, {
      duration: 0.5,
      delay,
      ease: EASE_OUT_EXPO,
      onUpdate: (v) => setShown(v),
    })
    return () => controls.stop()
  }, [value, delay])
  return <span className="tabular-nums">{Math.round(shown)}</span>
}

// Funnel summary strip: per-stage counts, conversions, aging spark bars.
export function FunnelStrip({ stages, byStage, footer, hideEmpty }: { stages: Stage[]; byStage: Map<string, any[]>; footer?: string; hideEmpty?: boolean }) {
  return (
    <Card padded={false} className="mb-6 flex flex-col divide-y divide-border sm:flex-row sm:divide-x sm:divide-y-0">
      {stages.map((s, i) => {
        const count = byStage.get(s.id)?.length ?? 0
        const prev = i > 0 ? byStage.get(stages[i - 1].id)?.length ?? 0 : 0
        const conv = i > 0 && prev > 0 ? Math.round((count / prev) * 100) : null
        // Dropped only AFTER the conversion is worked out: the whole funnel is still walked in order, so a…
        if (hideEmpty && count === 0) return null
        // aging histogram: 6 buckets (0-3d … 20d+) → tiny spark bars
        const buckets = [0, 0, 0, 0, 0, 0]
        ;(byStage.get(s.id) ?? []).forEach((c) => {
          const d = c.daysInStage ?? 0
          buckets[Math.min(5, Math.floor(d / 4))]++
        })
        const maxB = Math.max(1, ...buckets)
        return (
          <div key={s.id} className="flex-1 px-4 py-3.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: TINT_VAR[s.tint] }} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{s.label}</span>
            </div>
            {/* ONE LINE: the count, then the aging bars, then the conversion
                — the charts go in front of the percentages and the arrow
                goes away. The bars used to sit on
                a row of their own under the number, which cost the strip a
                third of its height to say something the eye reads sideways
                anyway. The arrow went with them: a percentage beside the stage
                it belongs to is already pointing. */}
            <div className="mt-1 flex items-end gap-2.5">
              <span className="font-stat text-[20px] font-bold leading-6 text-text-1">
                <CountUp key={count} value={count} delay={i * 0.06} />
              </span>
              <span
                className="flex h-3 items-end gap-[3px] pb-0.5"
                title={`Days in stage — ${buckets.map((b, bi) => `${bi * 4}-${bi * 4 + 3}d: ${b}`).join(' · ')}`}
              >
                {buckets.map((b, bi) => (
                  <motion.span
                    key={bi}
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.max(2, (b / maxB) * 12)}px` }}
                    transition={{ duration: 0.4, delay: 0.2 + i * 0.06, ease: EASE_OUT_EXPO }}
                    className="w-[6px] rounded-[2px]"
                    style={{ background: TINT_VAR[s.tint], opacity: b === 0 ? 0.2 : 0.55 }}
                  />
                ))}
              </span>
              {conv != null && (
                <span className="pb-0.5 text-[12px] font-semibold leading-4 text-tint-fg-mint">{conv}%</span>
              )}
            </div>
          </div>
        )
      })}
      {footer && (
        <div className="flex items-center gap-1.5 px-4 py-3.5 text-[12px] font-medium text-text-3">
          <Clock size={13} />
          {footer}
        </div>
      )}
    </Card>
  )
}
