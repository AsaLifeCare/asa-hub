/** New widget kinds: weather / clock / note / links (moved verbatim from DashboardTemplate.tsx). */
import { memo, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { format } from 'date-fns'
import { CloudRain, CloudSun, Snowflake, Sun } from 'lucide-react'
import { motion } from 'framer-motion'
import { staggerItem } from '@/engine/motion'
import Card, { CardHeader } from '@/components/shared/Card'
import TintTile from '@/components/shared/TintTile'
import { AppIcon } from '@/lib/icons'
import { ohioWall } from '@/lib/ohio'
import { TINT_FG } from '@/lib/tints'
import type { TintName } from '@/engine/types'

function hashStr(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 — tiny deterministic PRNG so the mock forecast is stable per day. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WEATHER_CONDITIONS = [
  { id: 'sun', label: 'Sunny', icon: Sun, tint: 'amber' as TintName },
  { id: 'cloud-sun', label: 'Partly cloudy', icon: CloudSun, tint: 'peach' as TintName },
  { id: 'cloud-rain', label: 'Showers', icon: CloudRain, tint: 'blue' as TintName },
  { id: 'snow', label: 'Snow', icon: Snowflake, tint: 'lavender' as TintName },
]

/** Average Canton, OH high by month (Jan..Dec) — base for the mock forecast. */
const CANTON_MONTHLY_HIGH = [36, 40, 50, 63, 73, 81, 85, 83, 76, 64, 51, 40]

function mockForecast(dayOffset: number) {
  // Canton's own days, not the reader's — the forecast is FOR Ohio, so the strip has to start on Ohio's today.
  const d = ohioWall(new Date()) as Date
  d.setDate(d.getDate() + dayOffset)
  const rand = mulberry32(hashStr(format(d, 'yyyy-MM-dd')))
  const month = d.getMonth()
  const winter = month <= 2 || month === 11
  const r = rand()
  const cond =
    r < (winter ? 0.2 : 0.38) ? WEATHER_CONDITIONS[0]
    : r < (winter ? 0.45 : 0.68) ? WEATHER_CONDITIONS[1]
    : r < (winter ? 0.72 : 0.88) ? WEATHER_CONDITIONS[2]
    : WEATHER_CONDITIONS[3]
  const hi = CANTON_MONTHLY_HIGH[month] + Math.round(rand() * 10 - 5)
  const lo = hi - 8 - Math.round(rand() * 8)
  const temp = Math.round(lo + (hi - lo) * (0.35 + rand() * 0.5))
  return { date: d, cond, hi, lo, temp }
}

export function WeatherWidget({ w, tint }: { w: any; tint?: TintName }) {
  const today = useMemo(() => mockForecast(0), [])
  const week = useMemo(() => [1, 2, 3, 4, 5].map((i) => mockForecast(i)), [])
  const CondIcon = today.cond.icon
  return (
    <Card hover className="h-full" tint={tint ?? today.cond.tint}>
      <CardHeader title={w._title} sub={w.city ?? 'Canton, OH'} />
      <div className="flex items-center gap-4">
        <CondIcon size={42} strokeWidth={1.5} className={TINT_FG[today.cond.tint]} />
        <div>
          <div className="font-stat text-[40px] font-bold leading-none tabular-nums text-text-1">{today.temp}°</div>
          <div className="mt-1 text-[13px] text-text-2">
            {today.cond.label} · <span className="font-semibold">H {today.hi}°</span> L {today.lo}°
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-1">
        {week.map((d) => {
          const DIcon = d.cond.icon
          return (
            <div key={format(d.date, 'yyyy-MM-dd')} className="flex flex-col items-center gap-1 rounded-sm bg-surface/60 px-1 py-2">
              <span className="text-[11px] font-medium uppercase text-text-3">{format(d.date, 'EEE')}</span>
              <DIcon size={14} className={TINT_FG[d.cond.tint]} />
              <span className="text-[11px] font-semibold tabular-nums text-text-1">{d.hi}°</span>
              <span className="text-[11px] tabular-nums text-text-3">{d.lo}°</span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/** Live clock — isolated + memoized so the 1s tick never re-renders the grid. */
export const ClockWidget = memo(function ClockWidget({ w, tint }: { w: any; tint?: TintName }) {
  // The company clock, ticking once a second.
  const [now, setNow] = useState(() => ohioWall(new Date()) as Date)
  useEffect(() => {
    const id = setInterval(() => setNow(ohioWall(new Date()) as Date), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <Card hover className="h-full" tint={tint}>
      <CardHeader title={w._title} sub={format(now, 'EEEE, MMMM d, yyyy')} />
      <div className="flex items-baseline gap-2">
        <span className="font-stat text-[44px] font-bold leading-none tabular-nums text-text-1">{format(now, 'h:mm')}</span>
        <span className="font-stat text-[22px] font-semibold tabular-nums text-text-2">:{format(now, 'ss')}</span>
        <span className="text-[15px] font-semibold uppercase text-text-3">{format(now, 'a')}</span>
      </div>
    </Card>
  )
})

export function NoteWidget({ w, tint, note, onNote }: { w: any; tint?: TintName; note: string; onNote: (v: string) => void }) {
  return (
    <Card hover className="h-full" tint={tint ?? 'amber'}>
      <CardHeader title={w._title} sub="Saved automatically" />
      <textarea
        value={note}
        onChange={(e) => onNote(e.target.value)}
        placeholder="Jot something down…"
        aria-label={`${w._title} note`}
        className="min-h-[120px] w-full resize-y rounded-sm border border-transparent bg-surface/50 p-3 text-[13px] leading-5 text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-border"
      />
    </Card>
  )
}

export function LinksWidget({ w, tint }: { w: any; tint?: TintName }) {
  const navigate = useNavigate()
  const links: { icon?: string; label: string; href?: string }[] = w.links ?? []
  return (
    <Card hover className="h-full" tint={tint}>
      <CardHeader title={w._title} />
      <div className="space-y-1">
        {links.map((l, i) => (
          <motion.button
            key={`${l.label}-${i}`}
            variants={staggerItem}
            onClick={() => l.href && navigate(l.href)}
            className="group flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors duration-150 hover:bg-surface-2"
          >
            <TintTile icon={l.icon ?? 'link-2'} tint={tint ?? 'blue'} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">{l.label}</span>
            <AppIcon name="arrow-up-right" size={13} className="text-text-3 transition-transform duration-150 group-hover:translate-x-[2px] group-hover:-translate-y-[2px]" />
          </motion.button>
        ))}
      </div>
    </Card>
  )
}
