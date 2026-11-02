/** Small SVG progress rings (moved verbatim from VideosTemplate.tsx). */
import { motion } from 'framer-motion'
import { EASE_OUT_EXPO } from '@/engine/motion'

/* ---------------- small ring (progress strip) ---------------- */

export function MiniRing({ percent, size = 48, stroke = 5 }: { percent: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--tint-mint-fg)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - percent / 100) }}
          transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-stat text-[11px] font-bold text-text-1">{percent}%</span>
      </div>
    </div>
  )
}

/** small countdown ring for the up-next overlay (autoplayNext: true only) */
export function CountdownRing({ seconds }: { seconds: number }) {
  const size = 36
  const stroke = 3
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: 0 }}
        animate={{ strokeDashoffset: c }}
        transition={{ duration: seconds, ease: 'linear' }}
      />
    </svg>
  )
}
