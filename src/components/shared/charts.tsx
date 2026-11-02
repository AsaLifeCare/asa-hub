// ThemedChart wrappers (§11).
// All colors come from CSS design tokens (var(...)), so every chart flips with the theme with zero conditional…
import { useState } from 'react'
import {
  Area,
  AreaChart as RAreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { motion } from 'framer-motion'
import { TINT_VAR } from '@/lib/tints'
import type { TintName } from '@/engine/types'

/* ---------- Sparkline (48×24 default, draw-in 600ms) ---------- */

export function Sparkline({
  points,
  tint,
  width = 48,
  height = 24,
}: {
  points: number[]
  tint: TintName
  width?: number
  height?: number
}) {
  const data = points.map((v, i) => ({ i, v }))
  return (
    <RAreaChart width={width} height={height} data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
      <Area
        type="monotone"
        dataKey="v"
        stroke={TINT_VAR[tint]}
        strokeWidth={1.6}
        fill={TINT_VAR[tint]}
        fillOpacity={0.08}
        isAnimationActive
        animationDuration={600}
        dot={false}
      />
    </RAreaChart>
  )
}

/* ---------- Themed tooltip ---------- */

function ThemedTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 shadow-2">
      {label != null && <div className="mb-1 text-[11px] font-medium text-text-3">{label}</div>}
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 text-[12px]">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.stroke }} />
          <span className="text-text-2">{p.name}</span>
          <span className="ml-auto font-stat font-bold text-text-1">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------- Area chart (smoothed series, gradient fill 20%→0) ---------- */

export function ThemedAreaChart({
  series,
  height = 240,
}: {
  series: { name: string; points: number[]; color: TintName }[]
  height?: number
}) {
  const len = Math.max(...series.map((s) => s.points.length), 0)
  const data = Array.from({ length: len }, (_, i) => {
    const row: Record<string, number> = { i }
    series.forEach((s) => (row[s.name] = s.points[i] ?? 0))
    return row
  })
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RAreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.name} id={`grad-${s.name}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TINT_VAR[s.color]} stopOpacity={0.2} />
              <stop offset="100%" stopColor={TINT_VAR[s.color]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
        <XAxis dataKey="i" hide />
        <YAxis tick={{ fill: 'var(--text-3)', fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip content={<ThemedTooltip />} cursor={{ stroke: 'var(--border-strong)' }} />
        {series.map((s) => (
          <Area
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={TINT_VAR[s.color]}
            strokeWidth={2}
            fill={`url(#grad-${s.name})`}
            isAnimationActive
            animationDuration={800}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 0, fill: TINT_VAR[s.color] }}
          />
        ))}
      </RAreaChart>
    </ResponsiveContainer>
  )
}

/* ---------- Donut (hover-expand slice, center label swap) ---------- */

export function ThemedDonut({
  slices,
  centerValue,
  centerLabel,
  size = 170,
}: {
  slices: { label: string; value: number; tint: TintName }[]
  centerValue?: string | number
  centerLabel?: string
  size?: number
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const total = slices.reduce((a, s) => a + s.value, 0)
  const active = activeIdx != null ? slices[activeIdx] : null
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <PieChart width={size} height={size}>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="label"
          innerRadius={size * 0.34}
          outerRadius={size * 0.46}
          paddingAngle={2}
          strokeWidth={0}
          isAnimationActive
          animationDuration={700}
          onMouseEnter={(_, i) => setActiveIdx(i)}
          onMouseLeave={() => setActiveIdx(null)}
        >
          {slices.map((s, i) => (
            <Cell
              key={s.label}
              fill={TINT_VAR[s.tint]}
              opacity={activeIdx == null || activeIdx === i ? 1 : 0.45}
              style={{ transform: activeIdx === i ? 'scale(1.04)' : 'scale(1)', transformOrigin: 'center', transition: 'transform .18s, opacity .18s' }}
            />
          ))}
        </Pie>
      </PieChart>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-stat text-[24px] font-bold leading-7 text-text-1">
            {active ? active.value : centerValue ?? total}
          </div>
          <div className="text-[11px] font-medium text-text-3">{active ? active.label : centerLabel}</div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Activity ring (0→percent, 800ms, rounded cap) ---------- */

export function ActivityRing({
  percent,
  tint = 'mint',
  size = 120,
  stroke = 10,
}: {
  percent: number
  tint?: TintName
  size?: number
  stroke?: number
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TINT_VAR[tint]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - percent / 100) }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-stat text-[22px] font-bold text-text-1">{percent}%</span>
      </div>
    </div>
  )
}
